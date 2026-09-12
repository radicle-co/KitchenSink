# Deduplication before queuing on the parse-job path

**Status:** IMPLEMENTED and committed (`316ce869`). `staff-architect` PLANNING review folded in; suites
written RED-first, then green. Gates in §9.
**Superseded in part by:** [2026-09-19-002](2026-09-19-002-feat-parse-once-guarantee-plan.md) and ADR-0044.
The owner ruled later the same day that a failed parse is not remembered, which removed `unparseable` from
the copyable set — so this document's roster of copyable statuses records what was decided when it was
written, and `COPYABLE_LINE_STATUSES` is the live authority.
**Owner constraint:** _"this needs a strong plan before the subagent begins work and the subagent needs to
build out a large test suite first"_ — so the order is PLAN → RED TESTS → IMPLEMENTATION.
**Scope:** `packages/services/recipe-service/**` only. `recipe-workers`, `recipe-import-core` and
`recipe-core/src/parsing` are staged for another agent's push and are READ-ONLY here.

---

## 1. The defect, re-measured rather than restated

I confirmed **which** metric the brief's figure is, because the answer decides whether an enqueue-side fix
can save anything at all. Queried directly (`AWS/SQS`, `QueueName=kitchensink-recipe-parse-pr-91`,
2026-09-01 → 2026-09-19, `us-east-1`):

| Metric                     | Sum       |
| -------------------------- | --------- |
| `NumberOfMessagesSent`     | 1,650,952 |
| `NumberOfMessagesReceived` | 277,586   |
| `NumberOfMessagesDeleted`  | 248,882   |

**1,650,952 is `NumberOfMessagesSent`** — the PRODUCER's own count, not redelivery. So this is an
enqueue-side defect and dedup-before-queue is the right lever. (Had it been `Received`, redelivery would
have explained it and this work would have saved ~nothing.) Received/Sent = **16.8%**, the brief's "17%".

Daily `Sum`: `2026-09-04 66,820 · 09-05 336,986 · 09-08 508,120 · 09-09 268,472 · 09-10 320,752 ·
09-11 149,782` — then 0, 0, 4, 10. Five heavy days then nothing: the signature of **the same corpus
submitted over and over** (1,650,952 / 2,502 ≈ **660 corpus-equivalents**), not of within-paste duplicates
and not of redelivery.

### The four facts about the current code

1. **Transport:** standard SQS (`RecipeWorkersStack.ts:1284`) — no `FifoQueue`, no `ContentBasedDeduplication`.
2. **Application:** none. `create` → `enqueueOrMark` → `queue.enqueue(messages)`, no lookup.
3. **The cache is read in the WRONG PLACE** — `parsePorts.ts` runs inside the worker, after the send, the
   receive and the claim have all been paid for.
4. **Duplicate enqueue is documented as intentional** (`parseJobs.service.ts` rule 2).

---

## 2. ⛔ The literal ask is not implementable here — the premise, pressure-tested

The brief says to prefer reusing `ingredient_parse_cache`'s key over inventing a second identity. That is
right about the **identity** (`lineDigest`), which this design reuses. But "read the cache at `create` and
skip on a hit" cannot ship from `recipe-service`:

**(a) The service cannot turn cache rows into a proposal.** No `@kitchensink/recipe-import-core` dependency
(verified), so `compareParses` is unreachable. The cache holds **one row per engine**; a job line's
`proposal` is the **merged** `ParsedLine`. Two rows are not a proposal.

**(b) The service does not know what "current" means.** The key's third member is `engineVersion` — the
CRF's from the worker's env, the LLM's computed at `gatedLlm.ts:407`. Mirroring either here is a second
copy of another deployable's number, and it fails in the **silent-skip** direction: a line skipped against
a stale version is a line **never parsed with the current model**. That is the brief's question 2, and it
is why this design reads the cache not at all.

**(c) A per-job digest collapse hangs the job.** The worker's landing is
`WHERE job_id AND line_index AND line_digest` (`parseLine.ts:279`), so a collapsed twin never lands, stays
`pending`, and `PARSE_JOB_AGGREGATE_SQL`'s first arm keeps the job `running` until TTL. The fan-out fix
lives in the off-limits worker.

Recorded as **evaluated and rejected**, not overlooked.

---

## 3. The design: COPY-FORWARD at `create`, watermark-gated

> **A line the caller has already had answered by the worker is inserted WITH that answer and produces no
> message** — unless a correction has moved since, or the answer is too old.

The source is the caller's own prior `recipe_parse_job_lines` rows that are **terminal**
(`parsed` / `unparseable`), carry a non-null `proposal`, and were **landed by the worker** (not themselves
copied). That proposal is already merged, so nothing needs adjudicating.

### ⛔ 3a. The ordering rule, and how it is discharged

`parsePipeline.ts` states the one rule it owns: **"A human correction outranks a cached parse; a cached
parse outranks an engine call."** A create-time copy-forward is **a new tier above `corrections`, in a
different deployable, that cannot consult the corrections tier.** Unaddressed, a cook corrects a parse,
re-pastes, silently gets the pre-correction answer back, and corrects it forever.

**Discharge — a corrections WATERMARK.** One scalar read per `create`:

```sql
SELECT max(GREATEST(created_at, COALESCE(superseded_at, created_at))) AS changed_at
  FROM ingredient_parse_corrections
 WHERE scope = 'global' OR user_id = $1
```

A candidate whose `landedAt` precedes the watermark is **not copied**. `superseded_at` is in the
`GREATEST` because a retraction is a bare update with no accompanying insert, which `max(created_at)`
alone would miss.

⛔ It asks only **"did the set move?"** It deliberately does **not** re-derive `findInForce`'s precedence —
`parsePorts.ts` warns by name that _"two readers with different precedence would let a correction bind on
the API path and not on the import path"_. That restraint is the point.

**The asymmetry matters and is stated:** the **watermark is a sound bound** (if nothing in the correction
set moved since the answer landed, no correction now in force could have changed it); the **recency window
below is only a proxy**.

⚠️ Cost: a single global correction suppresses copy-forward install-wide until lines re-land. Accepted;
`PARSE_COPY_FORWARD_MAX_AGE_HOURS = 0` is the kill switch if it proves too blunt.

### ⛔ 3b. Generation laundering — why `copied_at` is load-bearing

`landedAt` comes from `recipe_parse_job_lines.updated_at`, and a **copied** row's `updated_at` is its
**insert** time. So line lands at T0 → copied at T1 → copied again from that copy at T2 with
`landedAt = T1`: **the answer never ages out, and both the window and the watermark are defeated by a chain
of copies.** The candidate predicate therefore carries `copied_at IS NULL` — only a line the **worker**
landed may be a source. `copied_at` does two jobs (the anti-laundering predicate, and the only observable
hit rate this feature will ever have); both go in its column COMMENT so nobody deletes it as unused.

### ⛔ 3c. The real bound on the candidate pool is the PURGE, not the window

`expireParseJobs` (`recipe-workers/src/parsing/parseJobExpiry.ts`) does two things: it flips a job to
`expired` at `expires_at` (24h), and **`DELETE`s the job 7 days past that — cascading to its lines.**

So **no candidate can ever be older than ~8 days.** The plan's first draft specified a 720-hour (30-day)
window; that was **fiction**, and it is corrected to **168 hours (7 days)**, which sits inside the purge
horizon and therefore actually binds.

**An `expired` job's lines ARE a valid source, explicitly.** Expiry ends the _review session_, not the
parse's validity, and excluding expired jobs would shrink the pool to **24 hours** and make the feature
nearly useless. It is a stated predicate (the candidate join does not filter on job status), not an
accident of the join.

### Answering the five questions the brief demands

**Q1 — Where does the check belong?** At **`create`, inside the existing `createJob` transaction**. The
decision "this line needs no message" must commit atomically with the line's non-`pending` status.

⛔ **THE HANG TRAP, and the remedy is not the obvious one.** A copied line never lands, so nothing ever
calls `PARSE_JOB_AGGREGATE_SQL` for it; an all-copied job would sit `running` forever with zero pending
lines. The first draft prescribed a post-commit aggregate call — **wrong**, because it opens a durability
gap that does not exist today: in the all-copies case nothing else will _ever_ call the aggregate, so a
crash between commit and that query strands the job until TTL with no self-heal. Instead the job row's
status is **derived inside the transaction** from the pending count: `pending > 0 ? 'running' : 'complete'`.
`create` then never calls the aggregate at all. An integration assertion pins that running
`PARSE_JOB_AGGREGATE_SQL` afterwards is a **no-op**, so the two representations cannot drift.

**Q2 — Correctness vs the cache key.** This design never consults the cache, so the "skip a line whose
cached answer is for a different engine version" failure is structurally absent. What replaces it is
weaker and is labelled as such: `recipe_parse_job_lines` carries **no engine version**, so copy-forward is
**version-blind by construction**, and the recency window is a **PROXY**, not the check — a model pin
changed inside the window still serves the old answer. **Owed follow-up (a `recipe-workers` ticket):**
record the engine version on the landed line, then delete the window and gate on version equality. ⛔ The
column is deliberately **not** shipped now — a column whose writer lives in another package with no
commitment is dead weight.

**Q3 — Within-request duplicates.** **One job line per pasted line, never collapsed.** A recipe legitimately
repeats an ingredient, the paste is positional, and collapsing is §2(c). ⚠️ Reframed: the cache already
deduplicates the **expensive** half — the second occurrence's worker call hits `ingredient_parse_cache` for
both engines and calls neither. What a within-paste duplicate costs is one send + receive + claim + merge,
the cheap part. Settle-on-read would fix it but makes a read path a writer and races the in-flight landing.
Not worth v1.

**Q4 — Concurrency.** **No lock, no conditional write.** Two simultaneous identical pastes both miss, both
enqueue, both parse. What absorbs the duplicate is the cache's `ON CONFLICT (parse_key) DO NOTHING`. (The
claim lease is _not_ the mechanism here — it refuses a redelivery of the same `(job_id, line_index)`; two
pastes are different rows and both legitimately parse.) The race costs **one extra parse, never a wrong
answer**. Candidates are read outside the transaction; a landing racing the read yields either a slightly
older answer or an extra enqueue — benign both ways.

**Q5 — What must not break.** `PARSE_DELIVERY_ALLOWANCE` / `CLAIM_ATTEMPT_ALLOWANCE = 20` (a copied line is
never delivered, so it spends none of it); the R17 digest guard (a copied line's digest comes from the same
`lineDigest`); the job aggregate (the rule stays in the one shared SQL — `create` simply never invokes it).

**Fail toward doing the work.** If the candidate lookup or the watermark read throws, **enqueue
everything** — the pipeline's own posture: a tier whose I/O failed continues, because _"a stale cache row
taking down a parse it exists to accelerate"_ is worse. Never the reverse.

### ⛔ 3d. The HAZ-041 hazard — a copied proposal must be re-`raw`'d

`ParsedLine.raw` is the cook's line **byte-identical**, but `lineDigest` NFC-normalizes and collapses
whitespace, so two lines sharing a digest can differ in bytes. `runParsePipeline`: _"the digest asserts the
two spellings are the same line, not that they are the same string."_ Copying without rewriting would show
a proposal quoting a **different string** than the row's own `sourceLine`, in one payload. The copy rebases
`proposal.raw` onto the new row's `sourceLine`.

### Owner scoping — the copy source is the caller's own lines

**Owner-scoped**, but **not** on privacy grounds: ADR-0027 already rules the phrase is not personal data,
and a copied row belongs to the new owner and is swept with them. The durable objection is different —
`ingredient_parse_cache` **is** the install-wide, owner-less, purpose-built authority for "the known parse
of this digest". A cross-owner copy out of `recipe_parse_job_lines` would stand up **a second install-wide
cache, in an owner-scoped erasable table, consulted first, with no version discipline**: two authorities
for one fact, and the wrong one wins. Owner-scoping keeps the new tier's claim narrow and non-competing —
and it is what makes the watermark computable at all (cross-owner would need the _source_ owner's
correction history too).

---

## 4. Files

| File                                                       | Change                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/database/migrations/0048_parse_line_copy_forward.sql` | **NEW.** `ADD COLUMN copied_at timestamptz` + `COMMENT` naming both jobs. Index **only if** `EXPLAIN` asks for one. Plain `CREATE INDEX`, never `CONCURRENTLY` — `applyMigrations.ts:269-274` wraps each file in `BEGIN`/`COMMIT`. Expand-only, reversible.                           |
| `src/database/schema/parseJobs.ts`                         | Mirror `copiedAt` (SQL stays source of truth); `schemaModelConformance` catches a mismatch.                                                                                                                                                                                           |
| `src/recipes/domain/copyForwardPolicy.ts`                  | **NEW.** Pure `evaluateCopyForward`. Shaped after `transcriptionCarryForward.ts` — the carry-forward policy module already in this directory.                                                                                                                                         |
| `src/recipes/dal/parseJobs.dal.ts`                         | `findCopyForwardCandidates` (owner join, terminal status, `proposal IS NOT NULL`, `copied_at IS NULL`, in-window, `DISTINCT ON` newest per digest); `correctionsChangedAt`; `createJob` takes the decision, inserts copies terminal with `copied_at = now()`, derives the job status. |
| `src/recipes/parseJobs.service.ts`                         | Two reads concurrently → policy → enqueue only `enqueue` lines; skip `queue.enqueue` entirely when none; degrade to enqueue-all on a lookup failure; narrow the failure-branch rebuild to the lines actually sent.                                                                    |
| `src/config/config.types.ts`                               | `PARSE_COPY_FORWARD_MAX_AGE_HOURS` (default **168**; `0` disables).                                                                                                                                                                                                                   |

**⚠️ `DISTINCT ON`, and where the window is applied.** A hot digest the owner has submitted 660 times would
otherwise fetch 660 `proposal` blobs per `create`, so the SQL picks the winner
(`DISTINCT ON (line_digest) … ORDER BY line_digest, updated_at DESC`) and filters age.

⛔ **Ordering is the statement's alone.** `DISTINCT ON` yields exactly ONE row per digest, so the policy's
newest-wins loop maximises over a singleton and cannot re-check it — flip the `DESC` to `ASC` and the
oldest answer is copied with every unit test green. It is protected by an integration case
(`__tests__/integration/parseJobs/parseJobCopyForward.integration.test.ts`, "copies the most recently
landed answer when a digest has several") that is verified to fail when the clause is reversed. The policy
DOES independently re-assert the other two gates — the status set, and the window, which is not redundant
because the two checks read different clocks (the SQL the database's `now()`, the policy an injected one).

**No wire-contract change for v1.** A copied line simply arrives already terminal. `copied_at` is a column,
not a wire field — a `copied` flag would mean an ADR-0014 regeneration on every client for information no
surface uses.

---

## 5. Test suite (written, RED — see §8 for real output)

**Unit** — `copyForwardPolicy.test.ts` (22 cases): first sight; exact repeat; `unparseable` copied;
`failed_retryable` / `pending` refused; null and non-object proposals refused; window boundary pinned on
both sides and one millisecond past; newest candidate wins; watermark before/at/after and `null`; HAZ-041
rebase; batch positionality; within-paste duplicates; empty batch; irrelevant candidate ignored.

**Unit** — `parseJobCopyForward.service.test.ts` (13 cases): digest is the lookup key; no message for an
answered line; mixed paste enqueues only the unanswered; **all-copied → `complete` with zero messages**;
partially-copied stays `running`; repeat copied to every position; owner scoping; HAZ-041 through the view;
enqueue failure marks only what it tried to send; no queue call at all when nothing to send; edit still
enqueues; a thrown lookup enqueues everything.

**Integration** — `database/parseJobCopyForward.integration.test.ts`: the migration's column/index exist;
the DAL's WHERE clauses (another owner, `failed_retryable`, null proposal, out-of-window, **`copied_at`
laundering**); `EXPLAIN` on the candidate query.

**Integration** — `parseJobs/parseJobCopyForward.integration.test.ts` (real app + real Postgres + **real
LocalStack SQS**): a repeat produces **no message on the real queue**; the copy commits with the job;
all-copied job is `complete` **and** a subsequent `PARSE_JOB_AGGREGATE_SQL` is a no-op; partly-copied stays
`running`; no cross-owner copy; `unparseable` copied; `failed_retryable` re-queued; HAZ-041 through `jsonb`;
concurrent submission loses nothing.

**e2e** — `tests/e2e/parseJobs.e2e.test.ts`: paste the same block twice through the public surface.

---

## 6. Expected saving

Per **1,000 submitted lines**, where _r_ is the fraction already **landed** by the same owner inside the
window and unaffected by a correction: **1,000 × _r_ messages avoided**, and with them the receives, claims
and Lambda invocations.

⚠️ **Bedrock is NOT saved proportionally.** A re-submitted line's worker call already hit
`ingredient_parse_cache` and called neither engine. What copy-forward removes is the **message, receive,
claim, invocation and cache round-trip** — plus latency, since a copied line arrives already `parsed` in
the 202. It is a transport-and-latency win, not a dollar win. ADR-0024's spend is unaffected.

⚠️ **The 99.8% figure from draft 1 is withdrawn.** Only 277,586 of 1,650,952 messages were ever
**received** — ~85% were enqueued and abandoned, so those lines never landed and have **no proposal to copy
forward from**. Copy-forward eliminates re-sends of lines that _have been answered_; it does nothing for a
backlog that was enqueued and dropped. The honest ceiling is _r_ × submitted lines, conditioned on the
first pass having landed; the September burst would have benefited far less than the corpus arithmetic
suggests.

---

## 7. What this does NOT establish

- **The brief's "repeat with a different engine version must NOT be skipped" cannot be tested as written** —
  this mechanism has no engine version. A test that appeared to check it would be test theatre. The window
  cases pin the rule actually chosen; the gap is the owed `recipe-workers` follow-up.
- **The recency window is a proxy.** A model pin changed inside it still serves the old answer.
- **The watermark's hit-rate cost is unmeasured.** Nothing in the repo records global-correction frequency.
  `copied_at` exists partly so this becomes measurable.
- **Bedrock savings are not proportional** (§6), and the 99.8% ceiling is withdrawn.
- **Within-paste duplicates are not deduped** (Q3), by decision.
- **A second, larger amplifier exists and is NOT fixed here.** `enqueueOrMark` marks **every** message in
  the call `failed_retryable` when `sqsBatchQueue` throws, and it throws if **any** batch failed — so one
  failed batch of 10 in a 200-line paste marks all 200 retryable, and the retry re-enqueues all 200. A 20×
  amplifier, in `recipe-service`, fixable by having the queue port report _which_ messages failed. Out of
  scope for "dedup before queuing"; the architect rates it the higher-leverage fix per line of code.
- **k6 was NOT re-run.** `tests/load/parseJobCreate.load.js` asserts a p95 for this exact endpoint, and
  `create` now carries up to two extra round trips before its transaction. k6 is manual-only by owner
  ruling, so not running it is correct — but the latency budget is **unverified against the new path**.
  The added cost is one indexed candidate lookup plus one `correctionsChangedAt`, issued CONCURRENTLY.
- **The watermark query is a measured SEQ SCAN.** `EXPLAIN (ANALYZE, BUFFERS)` over 20,000 corrections:
  `Seq Scan … Buffers: shared hit=254 … Execution Time: 1.735 ms`. No index can serve its
  `scope = 'global' OR user_id = $1` disjunction (both partial indexes on that table are
  `WHERE superseded_at IS NULL`). Acceptable at today's volume and recorded rather than hidden; the
  `maxAgeHours = 0` kill switch now skips it entirely, and past ~1M corrections it wants a maintained
  watermark row rather than an index.
- **The e2e case is a weak guard.** It asserts copy-forward does not OVER-trigger on never-answered lines;
  no plausible mutation makes it fail, because the e2e harness lands nothing.
- **`unparseable` residual:** a line whose LLM leg exhausted and cached nothing loses its fresh roll of the
  dice on re-paste within the window. `editLine` remains the escape hatch.

---

## 8. Build order

1. Plan (this document) — done.
2. `staff-architect` PLANNING review — done; rulings folded in above.
3. Extend the red suites with the watermark, laundering and degradation cases. **Watch them fail.**
4. Migration 0048 + Drizzle mirror.
5. `copyForwardPolicy.ts`.
6. DAL — run `EXPLAIN` here and decide the index.
7. Service orchestration.
8. `typecheck`, `lint`, `test`, `test:integration`; then `staff-code-quality` GATE + `code-reviewer`.
9. ADR-0044 — `docs/architecture/decisions/0044-copy-forward-dedup-before-enqueue.md`. **Written.**

---

## 9. Verification — real output

| Gate                                         | Result                              |
| -------------------------------------------- | ----------------------------------- |
| `tsc --noEmit`                               | clean                               |
| `eslint .`                                   | clean                               |
| unit (`vitest run`)                          | **153 files, 2542 tests passed**    |
| integration (`vitest.integration.config.ts`) | **88 files, 659 passed**, 9 skipped |
| e2e (`vitest.e2e.config.ts`)                 | **20 files, 95 passed**             |

⚠️ The 9 integration skips are all `tests/load/__tests__/integration/nutritionFanoutFixture.integration.test.ts`
— a k6 load fixture, unrelated and pre-existing.

### The index was MEASURED, not assumed

`EXPLAIN (ANALYZE, BUFFERS)` over a seeded 50,000-line table (500 owners × 100 lines, 2,000 distinct
digests) shows the planner **choosing** the new index:

```
->  BitmapAnd
      ->  Bitmap Index Scan on recipe_parse_job_lines_pkey
            Index Cond: (job_id = j.id)
      ->  Bitmap Index Scan on recipe_parse_job_lines_copy_forward_idx
            Index Cond: ((line_digest = ANY (...)) AND (updated_at >= (now() - '168:00:00'::interval)))
```

It is ANDed with the PK under an owner-first nested loop off `recipe_parse_jobs_owner_idx` — so the owner
filter stays selective and `owner_id` is NOT denormalised onto the line row. Dropping the index in a
rolled-back transaction moves the plan to the PK bitmap alone (16 shared buffers vs 9 at the inner node).

### ⛔ Mutation results — and two tests that were theatre

Four cases were written AFTER the code they cover and passed on first run, so their "red" was never
earned. Each was therefore mutation-tested. **Two were theatre and are now repaired.**

| #   | Mutation                             | Test                                        | Detected?                                |
| --- | ------------------------------------ | ------------------------------------------- | ---------------------------------------- |
| A   | drop `AND l.copied_at IS NULL`       | never treats a copied line as a copy source | ✅ `expected [] to have a length of 1`   |
| B   | job status always `'running'`        | all-copied job is complete                  | ✅ `expected 'running' to be 'complete'` |
| B   | job status always `'running'`        | aggregate no-op                             | ❌ **SURVIVED** → repaired → ✅          |
| C   | drop the watermark conjunct          | watermark (1 integration + 3 unit)          | ✅ all four                              |
| D   | drop `j.owner_id = $1`               | no cross-owner copy                         | ✅                                       |
| E   | admit `failed_retryable` as copyable | failed_retryable is re-queued               | ❌ **SURVIVED** → repaired → ✅          |

**B's survivor** asserted only the END state after running `PARSE_JOB_AGGREGATE_SQL` — which the aggregate
itself produces, so it passed whether or not `create` derived the status. It now asserts `complete`
**before** the aggregate runs (the actual claim) and unchanged after.

**E's survivor** flipped a never-landed line to `failed_retryable`, leaving `proposal` NULL — so the row was
excluded by the `proposal IS NOT NULL` predicate and the status rule was never exercised. The line is now
landed first and only then demoted, so its status is the only thing excluding it.

⚠️ The policy's watermark unit cases first went red on `Cannot find module`, not on an assertion — a weaker
red than an assertion failure. Mutation C is what actually earns them.

### ⚠️ What the e2e tier structurally cannot prove

The e2e harness runs no worker and makes no direct database writes, so nothing ever LANDS — and with no
landing there is never an answer to copy. The positive case is therefore unreachable at that tier and is
proven in the integration tier, which stands in for the worker and reads the real LocalStack queue. What
e2e _does_ assert is the negative: a repeated paste of never-answered lines must NOT short-circuit.
