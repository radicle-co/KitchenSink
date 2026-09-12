# 0044 — A line already answered is copied forward, not queued again

- **Status:** Accepted
- **Date:** 2026-09-19
- **Relates to:** [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md) — the two-engine pipeline whose
  cache this tier sits above; [ADR-0041](0041-queue-work-guarantees.md) — the claim, the lease and the
  digest guard this design leans on instead of adding a lock of its own;
  [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md) — the spend ceiling every avoided engine call
  is charged against; [ADR-0039](0039-database-role-split.md) — the service role the lookup runs as.

## Context

`ParseJobsService.create` sent one SQS message per pasted line, unconditionally. The parse cache was
consulted, but inside the WORKER — after the send, the receive and the claim had all been paid for. Every
layer that could decline the work sat downstream of the layer that committed to it.

Measured on the September queue: `NumberOfMessagesSent` = 1,650,952 against a 2,502-line corpus, of which
16.8% were ever received. That is a PRODUCER count, not redelivery — the messages were created, not merely
re-delivered.

The cost is not only SQS. A message that reaches a worker takes a claim, a lease and, on a miss, two engine
calls, one of which is billed against ADR-0024's ceiling. Declining the work after all of that has been
spent is the expensive place to decline it.

## Decision

**A line whose answer this caller can already see is never queued.** `createJob` resolves each submitted
line against previously landed job lines and, where one is found, writes the answer straight onto the new
line inside the same transaction that creates the job. No message is produced for it.

The decision itself is a pure policy module — `recipes/domain/copyForwardPolicy.ts`, the sibling of
`transcriptionCarryForward.ts`, `provenancePolicy.ts` and `visibilityPolicy.ts`. The clock, the window and
the corrections watermark are injected, so the rule is exhaustible as a truth table and reads nothing
ambient.

### Why the source is a prior JOB LINE, not `ingredient_parse_cache`

The cache is keyed `(line_digest, engine, engine_version)` and holds one row PER ENGINE. A job line's
`proposal` is the MERGED `ParsedLine` that `compareParses` adjudicates out of both engines.

recipe-service depends on neither `recipe-import-core` (so it cannot merge two engine rows) nor either
engine's version string (so it cannot tell a current row from a retired one). Skipping a line against a
retired version would mean the line is never parsed with the current model. A prior job line's proposal is
already merged, and this service owns that table.

### The three gates, and why each exists

1. **Status.** Only `parsed` carries an answer — the set is `COPYABLE_LINE_STATUSES`
   (`recipes/domain/copyForwardPolicy.ts`), which the copy-forward SQL derives rather than repeats, and that
   module states why each status is in or out. Both exclusions come to the same place from opposite
   directions: `failed_retryable` means "we kept trying and could not get to it", which is ABSENCE rather
   than a reading, and `unparseable` cannot distinguish a genuinely food-free line from an exhausted
   validator loop — so copying either turns something transient into a permanent fact about a line,
   ADR-0026 §3's rule one table over.
2. **The corrections watermark.** A human correction outranks a cached parse (ADR-0026's ordering rule), and
   this tier runs in a deployable that cannot consult the corrections table. The discharge is
   `correctionsChangedAt`: an answer that landed at or before the last moment this caller's visible
   correction set moved is not copied. It asks only whether the set MOVED, never which correction wins —
   re-deriving `findInForce`'s precedence here is exactly the two-readers drift `parsePorts.ts` warns about.
3. **A recency window.** A PROXY for version-awareness, and explicitly weaker than the other two:
   `recipe_parse_job_lines` carries no engine version, so a model pin changed inside the window still serves
   the old answer. The owed follow-up is recording the engine version on the landed line, after which the
   window is DELETED rather than tuned.

⚠️ The asymmetry is deliberate. The watermark is a SOUND bound; the window is a proxy. Flattening them into
"two staleness checks" loses the distinction that says which one is allowed to be approximate.

### The cross-invocation case: a per-digest LEASE, not a lock

Two submissions of a never-before-answered line, in flight together, miss every layer above — all three
need an answer to already exist. Migration 0049 NARROWS it with `ingredient_parse_leases`, one row per line
being parsed, taken in `parseLine.ts` around the pipeline call.

⛔ **NARROWS, NOT CLOSES, AND THE DIFFERENCE IS THE WHOLE SAFETY ARGUMENT.** A refusal is not a denial: the
refused caller waits once and then parses regardless, so a winner whose parse outlasts `PARSE_LEASE_WAIT_MS`
still costs the loser an ask. Each loser wakes independently and each asks once, so the bound is **at most
one extra ask per concurrent loser — N−1 extra asks per engine at concurrency N**, not a constant. Prod runs
`reserved: 5` / `maximumConcurrency: 5` (`consumerConcurrency.ts`), so the worst case there is four.

⚠️ **THE BOUND SCALES WITH CONCURRENCY, AND THAT IS WHY IT CONSTRAINS THE SETTING.** Reading it as a
constant is what would license raising prod's `reservedConcurrentExecutions`, or deleting the wait as
pointless; both are unsafe. `parseLeg.integration.test.ts`'s "a winner slower than the wait costs the loser
an ask" pins the N=2 case — two asks when the winner sleeps past the wait — and states in its own docstring
that it pins that case only. A third concurrent submission would cost a third ask.

Two constraints shaped it, and both rule out the obvious answers:

- **Nothing may be held across the engine call.** An advisory lock would hold a pooled connection for the
  seconds a parse takes. So the lease is a row, taken and released by two ordinary statements.
- **A holder that dies must not block its digest forever.** Those crashes correlate with the contention the
  mechanism exists to contain — the same durability argument ADR-0024 §5 makes for the spend counter. So the
  row carries `leased_until`, and a row past it is indistinguishable from no row.

⛔ **A refusal means "somebody else is asking", never "do not ask".** The refused caller waits once, then
runs the pipeline regardless; the pipeline reads the cache first, so a holder that has landed costs it no
engine call. Treating a refusal as a denial would strand a cook's line behind a crashed holder, which is
worse than the duplicate call being avoided. A lease operation that throws is swallowed for the same
reason: it may cost a billed call, never an answer.

⚠️ **The window was only ever reachable in prod, and prod has no parse Lambda deployed.**
`consumerConcurrency.ts` gives non-prod `reservedConcurrentExecutions: 1` and `RecipeWorkersStack.ts` sets
the event source to `batchSize: 1`, so messages are handled one at a time and the second finds the cache
warm; prod is configured at 5. The lease is what makes the guarantee a property of the system rather than
of one number in an infra file that someone will
eventually tune without knowing it is load-bearing.

## Consequences

**The dedup contract, in one line:** one distinct submission of a string costs at most one engine ask per
engine generation.

⛔ Two shipped mechanisms make the stronger reading ("one ask per string, ever") FALSE, and a test asserting
it would go red on a correct deploy:

- `engine_version` is part of the cache key, so a model pin or `PARSE_PROMPT_VERSION` bump invalidates every
  row BY DESIGN and the next submission re-parses. That is the invalidation mechanism.
- The retry rules (ADR-0026 §10) deliberately re-ask ONE submission whose validator disputed the foods.
  Retry is one submission asked again; dedup is a second submission not asked at all.

**Where each window is proved:**

| Window                                                    | Layer that closes it                                                                       | Proof                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repeat of an ANSWERED line, any time later                | copy-forward at `createJob`                                                                | `__tests__/integration/parseJobs/parseJobCopyForward.integration.test.ts` — real Postgres + real SQS, counting messages off the drained queue                                        |
| The same line twice within one paste                      | `distinct`/`representative` in `runParsePipeline`                                          | `parsePipeline.test.ts` — engine batch lists asserted                                                                                                                                |
| A second submission of a line the first submission parsed | `ingredient_parse_cache`                                                                   | `recipe-workers/__tests__/integration/parsing/parseLeg.integration.test.ts` — real cache table, engine ask count asserted unmoved                                                    |
| Two submissions genuinely in flight at once               | per-digest lease (0049) — **narrows**; bound is N−1 extra asks per engine at concurrency N | `parseLeg.integration.test.ts` — two concurrent `processParseLine` calls with the asks counted, plus "a winner slower than the wait costs the loser an ask", which asserts the bound |

⚠️ The schema half is asserted separately from the behaviour half on purpose: the partial index the lookup
reads is a claim about the DATABASE and must stay observable when the service code changes shape.

⚠️ A copied row is never itself a copy source (`copied_at IS NULL` in the DAL). A chain of copies would
present an ever-refreshing landing time and defeat both the window and the watermark.

⚠️ The real bound on the candidate pool is neither gate: `expireParseJobs` deletes a job seven days past its
24-hour expiry, cascading to its lines, so no candidate is ever older than ~8 days however wide the window
is set.

⚠️ **Residual, and it is the thing to challenge:** the recency window is a proxy for a fact the schema does
not carry. Until the landed line records its engine version, a model pin inside the window serves answers
from the previous generation — silently, because a stale hit raises no error and costs nothing anyone sees.
