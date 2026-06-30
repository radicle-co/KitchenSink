# Adversarial design-correctness review — Feature 003 (source-agnostic food data)

**Lens:** design-correctness (adversarial). **Phase:** pre-implementation design-baseline.
**Goal of this loop:** confirm the stabilized docs are correct/complete enough to START implementation.
**Method:** constructed failure scenarios (worker crash, concurrent adds, 5xx storm, rate-limit
boundary, queue flood, refresh-vs-pick race, PATCH on non-UNRESOLVED, tombstone revival, NOT_FOUND TTL,
partial golden-record write) and traced each against the authoritative docs _and the concrete pseudocode_
in `v-model/module-design.md` (MOD-001..MOD-021), `plan.md §2/§4/§5`, `spec.md` FRs, and
`v-model/hazard-analysis.md`.

**Verdict: ISSUES.** 1 critical + 2 high (all block implementation) + 6 medium + 2 low. The data model,
provenance FK integrity (D-PROVENANCE-FK), partial-write atomicity (HAZ-014/031 single-transaction
`upsertGoldenRecord`), merge idempotency (`replaceForFood`), candidate-set integrity, and the
single-drainer rate-limit invariant are sound. The defects below are in **lifecycle transitions and the
queue/retry/budget control loop** — exactly the surfaces FR-028a/D-LIFECYCLE and D-LEASE were meant to
close. Several are confirmed by reading the actual pseudocode, not inferred.

What held up under attack (no action needed): concurrent same-name adds collapse correctly (advisory
lock + `UNIQUE(normalized_name)` backstop, MOD-016); partial golden-record write is one transaction
(MOD-016 `upsertGoldenRecord`, HAZ-014/HAZ-031); retry-after-crash is idempotent because the merge uses
`replaceForFood` (delete-then-insert); provenance cannot cross foods (composite same-food FK + `NO ACTION`
cascade reasoning is correct); rolling-window overshoot is bounded by the single-drainer advisory lock +
atomic check-and-record (HAZ-016); refresh re-fetches only the _picked_ source item by `external_key`
(never re-fans-out), so a manual pick's _choice of candidate_ is preserved (HAZ-047).

---

## CRITICAL

### C1 — Reactivation re-enqueue is structurally broken: a reactivated terminal food never drains

**Scenario:** A food is `NOT_FOUND` (or `FAILED`) with `tombstoned_at` > 30 days ago. A user adds it again
by name (tombstone revival, the FR-028a `NOT_FOUND→PENDING` / `FAILED→PENDING` transition).

**Trace through the actual pseudocode:**

1. `createByName` (MOD-016, module-design L1597-1599) reactivates: `UPDATE food SET status='PENDING',
tombstoned_at=NULL …` and returns `{ id, created:false, reactivated:true }` — comment: _"caller
   re-enqueues."_ It touches **only the `food` table**.
2. The `fetch_queue` row for that food is still `status='tombstone'` — set earlier by `tombstone()`
   (MOD-003 L400-402: `UPDATE fetch_queue SET status='tombstone' …`). `resolve()` (DELETE) is only called
   for RESOLVED/UNRESOLVED, never for tombstones, so the row persists.
3. `handleAddByName` (MOD-001 L120) destructures only `{ id, created }` — it **ignores `reactivated`** —
   and unconditionally calls `publishFoodRequested` → `enqueue(foodId, sub)`.
4. `enqueue` (MOD-003 L351-358 / FR-014 / plan.md L678-681) is `INSERT … ON CONFLICT (food_id) DO UPDATE
SET request_count=…, last_requested=now() **WHERE fetch_queue.status='pending'**`. The existing row is
   `'tombstone'`, so the `WHERE` is false → the `DO UPDATE` is a **no-op**. The row stays `'tombstone'`.
5. `leaseNext` (MOD-003 L368-389) only selects `status='pending'` OR expired-`in_flight`. A `'tombstone'`
   row is never claimed.

**Result:** `food.status='PENDING'` forever, with a `'tombstone'` queue row that is never drained. Reads
return `202 PENDING` indefinitely. The `NOT_FOUND→PENDING` and `FAILED→PENDING` transitions that FR-028a
declares legal are **unreachable through the documented code.** The same dead-end hits the `FAILED`
re-fetch path advertised in FR-027 ("a `FAILED` food is itself re-fetchable").

**Fix:** Reactivation must reset the queue row, not just the food row. Either (a) in `createByName`'s
reactivation branch (or a dedicated reactivate path) `DELETE FROM fetch_queue WHERE food_id=$1` (so the
subsequent `INSERT … ON CONFLICT` creates a fresh `pending` row), or (b) `UPDATE fetch_queue SET
status='pending', attempts=0, leased_at=NULL, last_error=NULL, last_requested=now() WHERE food_id=$1`.
AND `handleAddByName` must branch on `created`/`reactivated` and only enqueue when a (re)fetch is actually
wanted. Reconcile the `WHERE fetch_queue.status='pending'` guard in the canonical FR-014 enqueue SQL
(plan.md L681, spec.md L374, MOD-003 L357) with the reactivation requirement — today they directly
contradict. **Docs:** `v-model/module-design.md` MOD-001/MOD-003/MOD-016; `spec.md` FR-005/FR-014/FR-028a;
`plan.md §4` enqueue SQL + §5 reactivation paragraph (L766). **blocksImpl: yes.**

---

## HIGH

### H1 — `attempts` counts leases, not failures: rate-limit deferrals + crash-reclaims silently burn the retry budget → spurious FAILED tombstones

**Scenario:** Busy hour. The per-source 90% pause (USDA: 900) trips repeatedly; the worker also restarts
once or twice. A perfectly healthy food gets tombstoned `FAILED`.

**Trace:** `leaseNext` (MOD-003 L371) increments `attempts = attempts + 1` **at claim time**, before any
source call. In `processRow` (MOD-004), the 90%-pause branch (L478-480) and the window-full branch
(L482-484) call `requeueWithBackoff` and `RETURN` **without making any call and without an error** —
`requeueWithBackoff` (MOD-003 L404-407) sets `status='pending'` but does **not** reset `attempts`.
Reaper-reclaims (D-LEASE) likewise re-lease → `attempts++`. The `FAILED` gate (MOD-004 L509
`IF row.attempts >= 5`) therefore trips after far fewer than 5 _real_ errors: e.g. 4 rate-limit deferrals
(attempts→4) then a single transient 5xx (claim→5, gate fires) → `FAILED` tombstone after exactly **one**
actual failure. FR-016 promises "5 cumulative attempts" of _retry on transient source failure_; the
implementation spends that budget on normal back-pressure and on crash recovery.

**Why it matters:** the 90% pause is a _normal, expected_ steady-state at scale (it is the whole point of
the limiter), so this is not a rare edge — foods will routinely tombstone `FAILED` on their first real
5xx during any busy window, degrading availability and firing the tombstone alarm (plan §8).

**Fix:** Separate the lease/claim counter from the failure/retry counter. Increment `attempts` **only** in
the 5xx/timeout failure branch (MOD-004 L494-495 path), not in `leaseNext`. Rate-limit deferrals and
reaper reclaims must not consume the FR-016 budget. **Docs:** `v-model/module-design.md` MOD-003
`leaseNext`/`requeueWithBackoff` + MOD-004 `processRow`; `spec.md` FR-016/FR-018/FR-027; `plan.md §5`
error-handling bullet; `v-model/hazard-analysis.md` HAZ-008 (its "idempotent re-claim is safe" mitigation
misses budget consumption). **blocksImpl: yes** (the documented algorithm is incorrect as written).

### H2 — PATCH-resolve "never gated / always consumes budget" contradicts the hard cap ("zero 429, never exceed cap in any window")

**Scenario:** A disambiguation-heavy window where >100 users resolve `UNRESOLVED` foods while the worker
drains at the 90% pause (the reserved 10% headroom = ~100 calls).

**Trace:** MOD-018 `resolve` (L1832) calls `RollingWindowLimiter.checkAndRecordCall(p.source)` and then
**ignores the result** — comment: _"consumes budget; not gated for resolve … does NOT bail on a full
window; it consumes from the reserved headroom and proceeds"_ (L1828-1833); plan §5 echoes "never gated,
never 429." But `checkAndRecordCall` (FR-020, MOD-005, HAZ-016) is the _hard_ cap:
`INSERT … WHERE (count(*) … ) < cap RETURNING`. At the cap (1000/window) the conditional INSERT records
**nothing**, yet resolve still calls `adapter.fetchByKey` (L1833). So the real outbound call count exceeds
the recorded window count → the limiter under-counts → the next window genuinely **breaches SC-002
("never exceed the source cap in any rolling 60-min window")**. The reserved 10% headroom bounds the
_pause_, but nothing bounds _resolve volume_ to ≤100/window, so the two settled invariants ("resolve never
gated" and "never exceed cap") cannot both hold once resolves exceed the headroom.

**Fix:** Pick one and make it consistent across plan §5, spec FR-019/FR-020/FR-RES-2, and MOD-018: either
(a) resolve **blocks/waits** for headroom when the window is full (gated, but still no `429` to the
client — return after the window drains, or `503 Retry-After`), or (b) resolve draws from a _counted_
reserved sub-budget that is itself part of the cap. The current "make an unrecorded call and proceed"
breaks the limiter's central guarantee. **Docs:** `v-model/module-design.md` MOD-018 `resolve` + MOD-005
`checkAndRecordCall`; `plan.md §5` candidate-resolution; `spec.md` FR-019/FR-020/FR-RES-2; `v-model/
hazard-analysis.md` HAZ-016. **blocksImpl: yes** (two stated requirements are mutually contradictory).

---

## MEDIUM

### M1 — Re-adding an already-RESOLVED food re-enqueues and re-fetches it, burning the scarce source budget

`handleAddByName` (MOD-001 L120-124) unconditionally enqueues. A RESOLVED food has **no** `fetch_queue`
row (`resolve()` DELETEd it, MOD-003 L398), so `enqueue`'s `INSERT … ON CONFLICT (food_id)` finds no
conflict and inserts a **fresh `pending` row** → the worker re-drains → re-fans-out → re-resolves an
already-resolved food, spending USDA's 1000/hr budget for nothing. Every POST for an existing name is a
free source call. **Fix:** only enqueue when `created` OR `reactivated`; for an existing
RESOLVED/UNRESOLVED/in-flight row return the existing `id` (and current status) without enqueuing.
**Docs:** MOD-001; `spec.md` FR-005; `plan.md` data-flow step 2.

### M2 — PATCH-resolve has no concurrency guard against double-resolve

MOD-018 `resolve` (L1807-1838) does `findById → check status==UNRESOLVED → re-fetch → merge →
upsertGoldenRecord → clearCandidates` with **no row lock and no enclosing transaction** over the check
(the re-fetch is an intentional network call outside any tx). Two concurrent PATCHes for the same
`UNRESOLVED` food both pass the status check, both make budgeted re-fetches (2× budget), both merge, both
set RESOLVED. A PATCH can also race the worker's FR-025a re-fan-out or a C1-style reactivation. The
"idempotent" claim (FR-028a) only covers the _already-RESOLVED_ case. **Fix:** guard with
`SELECT … FOR UPDATE` on the `food` row, or commit via a conditional `UPDATE food SET status='RESOLVED'
WHERE id=$1 AND status='UNRESOLVED'` and treat a 0-rowcount as the lost race (idempotent return).
**Docs:** MOD-018; `spec.md` FR-RES-2/FR-028a; `plan.md §5`.

### M3 — `request_count DESC, first_requested ASC` has no aging, contradicting FR-044's anti-starvation "aging" claim

FR-044 ("queue ordering MUST apply aging so no `id` can be pinned to the front indefinitely") and
decision-register §3.8 ("ordering aged so no food id is pinned to the front") promise aging, but the
priority index/ORDER BY (plan.md L289/L925, spec.md FR-015, MOD-003 `leaseNext` L384) is pure demand-DESC
then FIFO — **no time-decay term**. A continuous stream of multi-requester foods starves a single-requester
item forever. **Fix:** either add an age-boost/decay term to the drain ordering (e.g. order by a score that
rises with `now() - first_requested`) or strike the "aging" wording from FR-044 and §3.8. **Docs:**
`spec.md` FR-044/FR-015; `decision-register.md §3.8`; `plan.md §2/§4`; `v-model/module-design.md` MOD-003.

### M4 — Consumer validates `row.requested_by`, but `fetch_queue` has no such column

`processRow` (MOD-004 L468) calls `AsyncProducerAuthz.assertEnqueueProvenance(dbSessionRole,
row.requested_by)`, but the `fetch_queue` schema (plan §2 L276-287; MOD-003 `FetchQueueRow` L421) has **no
`requested_by` field** — requesters live in `fetch_requesters (food_id, sub)`, many per food. The
async-producer provenance that FR-048/§2A.6 require the consumer to validate is not stored on the row it
drains. **Fix:** either persist the originating principal on `fetch_queue` (and reconcile with the
distinct-requester model), or define provenance validation over `fetch_requesters` / the named service
principal. **Docs:** `v-model/module-design.md` MOD-004; `plan.md §2A.6/§2`; `spec.md` FR-048.

### M5 — NOT_FOUND is treated as a failure/tombstone that alarms, guaranteeing alert noise

`NOT_FOUND` (no source has the item) is a **normal, common** outcome (typos, non-USDA/branded foods), yet
MOD-004 L502-504 sets `status='tombstone'`, the `FetchFailed` entity is emitted on
`FAILED`/`NOT_FOUND` (spec.md L506), and the alarms "tombstone-row count > 0 → SNS" (plan §8 L956) +
"tombstone-row alarm fires immediately" (spec.md US-10 sc2 L284) will fire on every legitimately-unknown
food. The pipeline will page on normal operation. **Fix:** separate `NOT_FOUND` from failure alarming —
alarm only on `FAILED`, or exclude `no_source_has_item` tombstones from the `FetchFailed`/SNS path; keep
NOT_FOUND as a queryable tombstone without an alert. **Docs:** `plan.md §8`; `spec.md` US-10 sc2 +
FetchFailed entity; `v-model/module-design.md` MOD-004.

### M6 — `fetch_requesters` is never pruned → unbounded growth

On `resolve()` the `fetch_queue` row is deleted, but `fetch_requesters` rows persist (FK cascade only on
`food` delete; foods are kept). The demotion per-sub pending count (MOD-003 L381-382) correctly filters to
`fq.status IN ('pending','in_flight')`, so _correctness_ holds — but the table accumulates one row per
`(requester, food)` for every food ever resolved, forever. The `source_call_log` retention rule (D §4 /
FR-020) was added for exactly this class of growth; `fetch_requesters` was missed. **Fix:** prune
`fetch_requesters` for a food on `resolve()`/`tombstone()` (or document a periodic sweep), and state it
alongside the source_call_log retention rule. **Docs:** `plan.md §2/§4`; `spec.md` FR-020 area; `v-model/
module-design.md` MOD-003.

---

## LOW

### L1 — 30s lease is borderline vs multi-call fan-out, and the per-minute reaper can reclaim a _live_ worker's active row

Single-drainer makes the in-v1 self-reclaim mostly benign, but HAZ-008 is itself rated _Undesirable_ and
the lease has no heartbeat. A fan-out that legitimately exceeds 30s (USDA `searchByName` + N×`fetchByKey`
near 10s timeouts; or any rate-limit sleep held `in_flight`) gets reaped, re-leased, and — per H1 — burns
an `attempts`. **Fix:** heartbeat the lease during long fan-outs, or have the reaper exclude the row the
live worker is currently processing. **Docs:** `v-model/hazard-analysis.md` HAZ-008; `plan.md §4` lease
paragraph; MOD-003/MOD-004.

### L2 — Dedup advisory lock and single-drainer advisory lock share Postgres's global advisory-lock key space

`createByName` uses `pg_advisory_xact_lock(hashToBigint(normalized_name))` (MOD-016 L1593) and the drainer
uses `pg_try_advisory_lock(FETCH_QUEUE_LOCK_KEY)` (MOD-003 L363). Both draw from the single 64-bit advisory
key space; a hash collision between a name hash and the constant drainer key would cross-block dedup and
draining. **Fix:** use the two-int form (`pg_advisory_xact_lock(classid, objid)`) with distinct `classid`s
so the namespaces cannot collide. **Docs:** `v-model/module-design.md` MOD-003/MOD-016.

---

## Scenarios that PASSED (documented behavior holds)

- **Concurrent same-name adds:** advisory `pg_advisory_xact_lock(hash(normalized_name))` + `UNIQUE
(normalized_name)` backstop + `ON CONFLICT (food_id)` → one row, one fan-out (MOD-016, HAZ-046). OK.
- **Partial golden-record write on crash:** `upsertGoldenRecord` is one transaction; status is written in
  the same tx (MOD-016 L1617-1630; HAZ-014/HAZ-031). No partial commit. OK.
- **Retry idempotency:** `FoodNutrientsDao.replaceForFood`/`replaceForFood` (delete-then-insert) make a
  re-processed row idempotent despite `UNIQUE(food_id, nutrient_id)`. OK.
- **Provenance crossing foods:** composite `(food_id, source_id)` FK to `food_sources(food_id, id)` with
  `ON DELETE NO ACTION` (correct vs RESTRICT for the food-cascade case). OK (D-PROVENANCE-FK).
- **Rolling-window overshoot under concurrency:** single-drainer advisory lock (FR-022) makes the
  count+insert serial; atomic conditional insert (FR-020) is the hard cap (HAZ-016). OK — _except_ the
  PATCH-resolve bypass in H2.
- **Refresh vs manual pick:** refresh re-fetches only existing backing `food_sources` items by
  `external_key` and never re-fans-out, so the user's _candidate choice_ survives; only that same source's
  data is freshened (HAZ-047, FR-031/FR-032). OK (the FR's "never overwrite a manual pick" holds for v1's
  candidate-level picks; note there is no field-level user-lock flag, which is fine for single-source v1
  but worth a one-line note if field-level overrides are ever added).
- **PATCH on non-UNRESOLVED:** RESOLVED → idempotent 200; other non-UNRESOLVED → 409 (MOD-018
  L1810-1813). OK except the concurrency gap in M2.
- **NOT_FOUND TTL re-attempt within/after TTL:** within TTL read returns 404 without enqueue (FR-025);
  after TTL the _intent_ is reactivation — but see C1, which makes the reactivation itself dead-end.
