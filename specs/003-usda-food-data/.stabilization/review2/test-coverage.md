# Adversarial Review — Lens: test-coverage (Feature 003, source-agnostic food data)

**Reviewer mode:** adversarial pre-implementation validation. Question: is the test plan DEEP and BROAD
enough that a green suite earns trust in the build?

**Scope read:** `v-model/unit-test.md` (MOD-001..MOD-021, 2543 lines), `v-model/integration-test.md`
(ARCH-001..ARCH-019, ITP incl. concurrency cases), `v-model/system-test.md` (SYS-001..SYS-020),
`v-model/acceptance-plan.md` (AT/ATP, 81 BDD scenarios + per-REQ matrix + exit gates), `tasks.md`
(45 `[Test-first: true]` red-gate tasks + UTP map), `decision-register.md` (16 D-\* decisions), the
`Test-first task → UTP map`, and the E2E harness task (T-190, LocalStack + Docker Postgres).

---

## Verdict: ISSUES (2 high, blocks-impl)

### Overall assessment

This is an unusually strong, well-traced test corpus. **Breadth is essentially complete:** every FR/REQ has
at least one AT (acceptance per-REQ matrix is exhaustive, lines 1385–1448); every endpoint
(`POST /v1/foods`, `GET /{id}`, `/{id}/status`, `/{id}/candidates`, `PATCH /{id}`, `/search`, `/batch`,
WS `$connect`) is covered; every HTTP status (202/200/404/400/403/409/503 — and the deliberate **no-429**)
is asserted; the full lifecycle enum (`PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED`) is round-tripped at unit
(UTP-001-B/D, UTP-006-B), integration (ITP-001-D), system (STP-007-B), and acceptance (AT-003/004/007) layers;
the auth slice is deep (UTP-012-A..J: networkless verify, fail-closed 401, 403 scope + precedence, M2M `svc_`
classification, forged-header strip incl. `x-debug-sub`, `azp` enforcement, load-shed; plus MOD-014 async
provenance UTP-014-A..E); and **concurrency/race depth is real** — rate-limit TOCTOU (ITP-005-A: 999+2 → one
allowed; 1500 → exactly 1000), add-by-name advisory-lock dedup (ITP-014-A, STP-018-A), distinct-requester
dedup collapse (ITP-003-C), crash-reclaim via `leased_at` reaper (UTP-003-E, ITP-003-D), provenance same-food
FK rejection (ITP-014-C, UTP-019-A3). Merge correctness, candidate out-of-set rejection, idempotent PATCH,
NOT_FOUND/UNRESOLVED TTLs, and batch partial-results are all covered.

The gaps that remain are concentrated in **negative/error and edge paths of the NEW flows** that the
stabilization decisions introduced (PATCH-resolve re-fetch, legal-transition set, near-ceiling flood-shed,
limiter pruning, the `FetchFailed` event). Two of these are blocking because they leave a `[Test-first]`
red-gate undefined for behavior that mutates state or guards an invariant the decision register explicitly
created.

---

## Findings

### H1 (HIGH, blocks impl) — Illegal lifecycle transitions are never tested; FR-028a's "explicit and testable" legal set is only enum-value-checked

**Where:** `unit-test.md` UTP-006-B "updateStatus — lifecycle enum guard" (lines 900–928);
`decision-register.md` §3.10 D-LIFECYCLE + §4.4 FR-028a.

The decision register §3.10 states the exact reason this decision exists: _"transitions were only
enum-value-checked; the legal set + manual-pick protection must be explicit and testable."_ The legal set is
`PENDING→{RESOLVED,UNRESOLVED,NOT_FOUND,FAILED}`; `UNRESOLVED→RESOLVED`; `FAILED→PENDING`;
`NOT_FOUND→PENDING` (post-TTL). Yet UTP-006-B still only asserts that `updateStatus` rejects values **outside
the enum** (`"fetched"` → ValidationError) and writes for valid enum values. There is **no test that an
illegal but enum-valid transition is rejected** — e.g. `NOT_FOUND→RESOLVED` direct (skipping PENDING),
`RESOLVED→PENDING` outside the refresh path, `UNRESOLVED→FAILED`, or a transition that would clobber a manual
pick. The positive reactivation paths are tested (AT-028a, ATS-049-A2), but the negative half of FR-028a is
absent. Following test-first, no red test exists → the transition guard will not be built, and the exact bug
D-LIFECYCLE was raised to prevent re-enters.

**Fix:** Add UTP-006-B (or a dedicated UTP-006-E) scenarios asserting `updateStatus`/the transition guard
**rejects** each illegal transition in the FR-028a matrix (status unchanged, no write), and an integration
scenario (ITP-014) that a refresh re-merge cannot overwrite a field whose provenance is a manual pick
(AT-LC-D is named in §4.4 but has no UTP/ITP/STP scenario — only the acceptance ATS-031-B1 references the
mechanism, not the rejection). If the design enforces legality only at call sites rather than in the DAO,
state that explicitly and add the call-site (worker/PATCH) negative tests instead.

### H2 (HIGH, blocks impl) — PATCH-resolve source re-fetch FAILURE path is untested

**Where:** `unit-test.md` UTP-018-C (lines 2208–2227, success only) and UTP-018-B/D;
`integration-test.md` ITP-016-B (success only); contrast `acceptance-plan.md` ATS-049-A3 (lines 431–438).

Per D-CANDIDATES the `food_candidates` table holds only `source/external_key/name/summary` — **no nutrient
payload** — so PATCH-resolve **re-fetches** the picked candidate from its source (`fetchByKey`), a budgeted
external call that **can fail**. ATS-049-A3 (acceptance) explicitly specifies the contract: _"if the re-fetch
fails the resolve aborts with `SourceApiError` and the food remains `UNRESOLVED` (status unchanged, the user
may retry the pick)."_ But **no unit or integration scenario drives `fetchByKey` throwing during resolve.**
UTP-018-C covers only the happy path (re-fetch succeeds → merge → RESOLVED → `clear(id)`). Without a red test,
the implementer can plausibly clear the `food_candidates` set, partially persist, or leave the food in a
half-merged state on a re-fetch error — corrupting an UNRESOLVED food and making the documented retry
impossible. This is a new external-I/O flow that mutates state; a single acceptance BDD line is not enough.

**Fix:** Add UTP-018-E: `resolve` with an in-set pick where `adapterFor(source).fetchByKey` throws
`SourceApiError` → assert food `status` unchanged (`UNRESOLVED`), `CandidateStore.clear` **not** called,
`upsertGoldenRecord` **not** called, error propagated. Add ITP-016-B2-equivalent integration scenario against
a stubbed adapter that 5xx/timeouts on the re-fetch, asserting the candidate set survives for retry.

### M1 (MEDIUM) — Near-ceiling flood-shed (FR-043b) selection logic has only one acceptance BDD line; no unit/integration coverage

**Where:** `decision-register.md` §3.8 / §4.6 (FR-043b, AT-044b-A); `acceptance-plan.md` ATS-041-F3
(lines 1104–1109); `unit-test.md` UTP-012-H (lines 1588–1620, queue-depth + open-circuit only).

FR-043b is a NEW fairness/DoS control: near the **global rolling-window ceiling**, NEW enqueues from the
**highest-pending `sub`** are shed first with `503`+`Retry-After`, while _other users'_ enqueues are admitted
and **reads/PATCH-resolves are never shed and never 429**. This selection logic (identify the flooding sub,
shed only its NEW enqueues, exempt reads/resolves) is non-trivial. UTP-012-H tests only the
`MAX_QUEUE_DEPTH`-ceiling and open-circuit 503 branches — **not** the rolling-window-ceiling sub-selective
shed. Coverage is a single acceptance scenario (ATS-041-F3). For a security/fairness control this is thin.

**Fix:** Add a unit case (UTP-012 or a new MOD-013 case) isolating the flood-shed decision: (a) flooding sub's
NEW enqueue near ceiling → 503; (b) a different (lower-pending) sub's enqueue → admitted; (c) a read and a
PATCH-resolve near ceiling → never shed. Add an integration scenario over the real `fetch_queue`/limiter that
two subs near the ceiling get asymmetric outcomes (closes AT-044b-A, which §4.6 names but no UTP/ITP realizes).

### M2 (MEDIUM) — PATCH-resolve bypassing the limiter pause is asserted but untested

**Where:** `acceptance-plan.md` ATS-049-A3 ("the resolve is never 429'd / shed, but it does consume budget");
`unit-test.md` UTP-018-C records `checkAndRecordCall` but only with the window open.

The worker path **defers** a source call when `shouldPauseDraining`/window-full (UTP-004-A, ITP-004-A2). The
resolve path deliberately **diverges**: it proceeds and consumes budget even at/over the pause threshold (a
human pick must not be blocked). No test asserts this divergence — i.e. that `resolve` calls `fetchByKey`
**even when** `shouldPauseDraining(source)` is true / the window is full. This is exactly the kind of subtle
path-specific behavior that silently regresses (an implementer copying the worker's defer logic into resolve
would break the contract, and nothing fails).

**Fix:** Add a UTP-018-C scenario where `RollingWindowLimiter.shouldPauseDraining('usda')` returns `true` /
the window is at cap, and assert `resolve` still calls `fetchByKey` and records the call (proceeds, never
deferred/429'd). Mirror it at ITP-016-B.

### M3 (MEDIUM) — `source_call_log` pruning correctness (FR-020 retention sweep) has no test; prune interacts with the load-bearing count

**Where:** `decision-register.md` §3.16 / §4.9 (prune rows older than the trailing 60-min window);
`tasks.md` T-110 ("...prune"); no unit scenario in UTP-005-A/B/C.

The register marks this "AT optional (inspection-covered)," but the prune is **not** a neutral housekeeping
op — it deletes from the same ledger the limiter counts (SC-002 "zero 429 in any window" depends on it). A
prune that removes rows **still inside** the trailing-60-min window would under-count and breach the cap. An
inspection cannot catch an off-by-one in the prune predicate; a boundary unit test can.

**Fix:** Add a UTP-005 boundary scenario: with rows at `now()-59m`, `now()-60m`, `now()-61m`, the prune
deletes **only** the `>60m` row and the trailing count is unchanged for the in-window rows. (Cheap, high-value
given the cap is load-bearing.)

### M4 (LOW–MEDIUM) — `FetchFailed` is a canonical event name with zero tests and an apparent design ambiguity

**Where:** `decision-register.md` §1 (`FetchFailed` "keep as-is"); `tasks.md` T-165 ("`FoodFetchCompleted` /
`FetchFailed` event emission"); but every terminal-disposition test (UTP-004-B, ITP-004-D, STP-005-D/F,
AT-027/025) signals failure via `publishFoodFetchCompleted({status:'FAILED'|'NOT_FOUND'})`. `grep FetchFailed`
across all four test plans returns **zero** matches.

So `FetchFailed` is either (a) vestigial — terminal failure is actually carried on `FoodFetchCompleted`'s
status, in which case it should be struck from the canonical names + T-165 to match the cleanup discipline of
§3.1/§5; or (b) a real event whose emission no test asserts. Either way it is an untested/inconsistent
surface.

**Fix:** Decide whether `FetchFailed` is emitted. If yes, add a UTP-002 / ITP-004-D assertion that it is put
on the bus on FAILED/NOT_FOUND (carrying the food `id`, fire-and-forget). If no, remove it from
`decision-register.md` §1 and T-165 so the canonical event set is `FoodFetchCompleted` + `IngestionScheduled`
(+ in-process `FoodRequested`/`FoodBatchRequested`).

### M5 (LOW–MEDIUM) — Single-drainer advisory-lock invariant is only unit-mocked, never integration-tested with two instances

**Where:** `unit-test.md` UTP-003-D (mocked `pg_try_advisory_lock` true/false); `decision-register.md`
§2 Addition B (the advisory lock is load-bearing: it makes the read-committed count+insert "effectively
serial," which is _why_ "zero 429 in any window" is safe).

No integration scenario stands up two real consumer instances and asserts exactly one acquires the drain lock
while the other idles. The invariant is partly de-risked by ITP-005-A (which tests the stronger atomic
count-and-record directly under 1500-way concurrency) and by `FOR UPDATE SKIP LOCKED` preventing double-lease,
so this is not blocking — but the explicitly load-bearing single-drainer claim has no end-to-end concurrency
test of its own.

**Fix:** Add an ITP-003 (or STP-005) concurrency scenario: two `acquireWorkerLock()` callers against one real
Postgres → exactly one `true`; the loser drains nothing until the holder releases.

### L1 (LOW) — Reactivation-under-concurrency and intra-batch duplicate names not explicitly tested

**Where:** `acceptance-plan.md` ATS-028a (single reactivation), ITP-014-A (concurrent createByName for a
**new** name); `system-test.md` STP-001-F2 (in-flight collapse across separate adds).

Two thin spots: (1) two concurrent re-adds of the **same** terminal-state (NOT_FOUND/FAILED past-TTL)
normalized name should collapse to one reactivation (one `→PENDING`, one enqueue, no `23505`) — the advisory
lock should serialize it, but no test asserts it. (2) A single batch body containing the **same name twice**
(intra-batch dedup) should create one row — STP-001-F2 only covers in-flight collapse across distinct
requests.

**Fix:** Extend ITP-014-A with a concurrent re-add of a past-TTL terminal row (assert single reactivation,
no `23505`); add an STP-001-F/UTP-001-F scenario with a duplicated name inside one batch payload.

---

## What is well-covered (no action)

- FR/REQ breadth: acceptance per-REQ matrix (lines 1385–1448) + summary matrix (1454–1506) leave no REQ
  without an AT or an explicit method-covered note.
- Every endpoint + every status code (202/200/404/400/403/409/503; deliberate no-429) and the
  `401→403→400` precedence (UTP-012-D, STP-013-E, ITP-012-F).
- Auth depth: networkless verify + egress-deny boundary proof (ATS-037-B2), fail-closed 401 family
  (UTP-012-B), forged-header strip incl. `x-debug-sub` (UTP-012-C), M2M `svc_` (UTP-012-A3, ITP-012-B,
  ATP-008-H), load-shed (UTP-012-I), WS `$connect` 403 + mid-connection expiry (UTP-012-J), async-producer
  provenance fail-closed (UTP-014-A..E, ITP-004-E, STP-005-G).
- Concurrency/race: rate-limit TOCTOU (ITP-005-A), advisory-lock add-by-name dedup (ITP-014-A, STP-018-A),
  distinct-requester collapse (ITP-003-C), crash-reclaim reaper (UTP-003-E, ITP-003-D), demotion fairness
  boundary incl. all-requesters-over-threshold and dynamic re-promotion (UTP-012-E), provenance same-food FK
  cross-food rejection (ITP-014-C).
- Merge correctness (presence>absence, identity→priority, free-text→longer, per-100g-before-blend,
  conflict→priority, no incoherent blend): UTP-017-A..D, ITP-015, STP-015, AT-051.
- Candidate resolution (out-of-set 409 incl. partial-in-set, idempotent no-op, TTL re-fan-out keeping
  UNRESOLVED): UTP-018-A..D, ITP-016, STP-016.
- Change-refresh (changed-only re-pull, unchanged no-write, manual-pick preserved, validated re-pull):
  UTP-020, ITP-018, STP-019, AT-031.
- Batch partial-results, NOT_FOUND/FAILED tombstone disposition, exponential backoff, source 429 vs 5xx vs
  no-source classification: UTP-001-F, UTP-004-B, ITP-004-C/D, STP-005-D/E/F.
- E2E harness (T-190) explicitly exercises add-by-name→fan-out/merge→200, dedup, candidates/PATCH, batch
  partial, EventBridge completion over LocalStack + Docker Postgres.
