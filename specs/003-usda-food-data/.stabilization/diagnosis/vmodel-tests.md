# Diagnosis — cluster `vmodel-tests` (feature 003 source-agnostic food data)

**Scope of this diagnosis.** The four V-Model test-layer docs under `specs/003-usda-food-data/v-model/`:
`unit-test.md`, `integration-test.md`, `system-test.md`, `acceptance-plan.md`. Cross-checked against the
canonical inputs (`.stabilization/inputs/staff-review.md`, `.stabilization/inputs/autoresolutions.md`),
against the canonical data model (`plan.md` §2/§4), and across layers (spec ↔ plan ↔ v-model).

**Bottom line.** The 2026-06-22 re-baseline of these four docs is _mostly_ applied (lifecycle enum, internal
`id`, per-source limiter, distinct-requester demand, fan-out/merge, `fdcId` largely confined to the USDA
adapter). But the re-baseline is **half-applied** in five specific ways and has **eight gaps** against the
autoresolution defaults. The single biggest defect is the completion-event name: every V-Model doc still uses
`FoodDataReceived`, which D-EVENT mandates be renamed to `FoodFetchCompleted`. Two design contradictions
(`drain_priority_tier` / `enqueueLowPriority` "tier" vs the canonical no-tier demand-weighted queue) are
_internal to the V-Model set itself_ — unit-test contradicts integration-test contradicts plan.

Evidence is cited as `file:line`. Counts: **5 contradictions, 8 gaps** (plus residual-framing/quality items).

---

## 1. Contradictions

### C-1 — Completion event name `FoodDataReceived` everywhere; canonical is `FoodFetchCompleted` (D-EVENT)

**Docs/locations:** all four V-Model docs. `FoodDataReceived` appears **46 times** total; `FoodFetchCompleted`
appears **0 times**. Representative hits:

- `unit-test.md:451` Test Case UTP-002-C is literally titled `publishFoodDataReceived — fire-and-forget
EventBridge completion` and asserts `DetailType='FoodDataReceived'` (`:456`, `:468`).
- `unit-test.md` — the method `publishFoodDataReceived(...)` is referenced 9× (e.g. `:668`, `:678`, `:683`,
  `:698`, `:710`); `integration-test.md` 4× (e.g. `:229`, `:332`, `:366`, `:371`).
- `integration-test.md:225` "FoodDataReceived carries the food `id`, never `fdcId`"; `:231` `DetailType='FoodDataReceived'`.
- `system-test.md:218`, `:233`, `:240`; `acceptance-plan.md` references the completion event by the old name.

**Problem:** Naming drift flagged in staff-review ("completion event is `FoodFetchCompleted` (plan §4 + CDK
rule) vs `FoodDataReceived` (spec.md + v-model)"). Note that the **method identifier** `publishFoodDataReceived`
also carries the dead name and must be renamed (e.g. `publishFoodFetchCompleted`), and a third variant
`FoodDataEvent` exists upstream in `plan.md:545` — so three names are in play.

**Resolution:** **D-EVENT** — replace every `FoodDataReceived` (event name, `DetailType`, method name, prose)
with `FoodFetchCompleted` across all four V-Model docs. (Cross-layer note: `plan.md` itself still uses
`FoodDataReceived`/`FoodDataEvent` — 0 `FoodFetchCompleted` in `plan.md` — so the "matches plan §4" premise in
D-EVENT is currently false; the plan cluster must apply the same rename so the canonical name actually exists.)

---

### C-2 — `drain_priority_tier` ORDER-BY prefix (unit-test) vs "no priority column / no tier" (integration-test + plan)

**Docs/locations:**

- `unit-test.md:531` UTP-003-B title "demand-weighted + **demotion-tier** ordering"; `:536` and `:549` assert the
  claim SQL `ORDER BY` is `drain_priority_tier(q.food_id) ASC, q.request_count DESC, q.first_requested ASC`.
- `integration-test.md:247` (ITP-003-A) "**There is no priority column and no high/low tier** — every row lands
  in the one `fetch_queue` ordered by `request_count DESC, first_requested ASC`"; `:260` "a separate
  low-priority tier is not needed (demand weight alone orders it)"; `:198` "demand-weighted order, not a
  separate tier".
- Canonical `plan.md:565-566` "**No priority field** — fetch_queue is ordered purely by demand
  (`request_count DESC, first_requested ASC`); ... with demotion applied at drain time (FR-043)"; `plan.md:611`
  "no high/low priority tier; demotion applied at drain time"; the only index is
  `plan.md:248-250 / :796` on `(request_count DESC, first_requested ASC) WHERE status='pending'`.

**Problem:** The unit-test introduces a `drain_priority_tier` column/function in the claim `ORDER BY` that does
**not** exist in the canonical `fetch_queue` schema and is explicitly disavowed by the integration-test and
plan. This is a direct V-Model-internal contradiction (unit ↔ integration) and a V-Model ↔ plan contradiction.

**Resolution:** **D-FAIRNESS** (complete, don't redesign demotion). The canonical mechanism is a single
demand-weighted queue ordered `request_count DESC, first_requested ASC` with demotion **applied at drain time**
(computed live from the per-`sub` pending count, `plan.md:381-383`), not a stored/ordered `drain_priority_tier`
column. Reconcile UTP-003-B to the canonical ORDER BY and express demotion as the drain-time live computation,
not a tier prepended to the SQL sort key.

---

### C-3 — `enqueueLowPriority` refresh method vs the canonical "no low-priority tier" model

**Docs/locations:** `enqueueLowPriority` is used as a distinct `FetchQueueRouter`/ARCH-003 method:

- `integration-test.md` 8×: ITP-018-A/B spy on `ARCH-003 enqueueLowPriority` (`:1125`, `:1139`, `:1141`,
  `:1242`, `:1243`); `:1127` "re-enqueues the food as **low-priority** `fetch_queue` work".
- `unit-test.md` 5×: `:2295` `Spy: enqueueLowPriority(foodId, requestedBy)`, `:2300` asserts
  `FetchQueueRouter.enqueueLowPriority('f1','svc_change_refresh')`.
- 1× each in `system-test.md` / `acceptance-plan.md`.

**Problem:** Same root contradiction as C-2. The change-driven refresh is described as calling a dedicated
**low-priority** enqueue method, but the canonical model (`plan.md:565`, `integration-test.md:247/:260`,
`ITP-003-A2 :257-260`) has **one** queue with **no** low/high tier — refresh rows simply carry low/zero
distinct-requester `request_count` (e.g. `requestedBy='svc_change_refresh'`, `integration-test.md:258`) and
sort last under the demand-weighted ORDER BY. A separate `enqueueLowPriority` method/tier contradicts that.

**Resolution:** **D-FAIRNESS** / canonical plan — refresh re-enqueues via the ordinary
`enqueue(food_id, 'svc_change_refresh')` path (ON CONFLICT dedup), yielding a low-demand row; remove the
`enqueueLowPriority` "tier" framing from MOD-020/ARCH-018 tests and the traceability map. Reconcile so unit,
integration, system, acceptance, and plan all describe the single demand-weighted queue.

---

### C-4 — Lease column named `lease_expires_at` (unit-test) vs canonical `leased_at` (D-LEASE)

**Docs/locations:** `unit-test.md:538` and `:549` assert `lease_expires_at = now() + 30s` and a reclaim
`WHERE (q.status='in_flight' AND q.lease_expires_at < now())`. This is the **only** place a lease column is
named in the V-Model set (integration/system reference `in_flight` leasing but no lease-expiry column —
`integration-test.md:255`, `:315`).

**Problem:** The autoresolution **D-LEASE** specifies a `leased_at` column plus a reaper that reclaims
`in_flight` rows whose lease is older than the lease window (30s). The unit-test instead invents
`lease_expires_at`. Worse, the canonical `plan.md` §2 `fetch_queue` (`:237-250`) currently has **neither**
column — so the V-Model unit-test is asserting against a column that does not exist in the canonical schema and
does not match the autoresolution's chosen name.

**Resolution:** **D-LEASE** — standardize on the autoresolution column name `leased_at` (with the reaper
computing expiry as `leased_at < now() - lease_window`), and ensure `plan.md` §2 adds that column so the
unit-test asserts against the canonical schema. (Cross-layer: plan must add the column; v-model must use the
canonical name.)

---

### C-5 — V-Model uses distinct-requester `request_count`; canonical `plan.md` §4 still does raw `+1` (D-DEMAND)

**Docs/locations:** The V-Model is **correct** and ahead of plan here:

- `unit-test.md:511/:522` UTP-003-A asserts `request_count = LEAST((SELECT count(*) FROM fetch_requesters
WHERE food_id=$1), <cap>)` — capped distinct count, "never a raw `+1`".
- `integration-test.md:247` "capped distinct-`sub` count (PRIORITY_CAP=1, never a raw `+1`)"; ITP-003-C
  (`:276-289`) tests the concurrent collapse; `system-test.md:332-343` STP-004-A drives `request_count=2` from
  two distinct subs.
- **But** canonical `plan.md:617` still does `SET request_count = fetch_queue.request_count + 1`.

**Problem:** Cross-layer contradiction: the canonical enqueue SQL in `plan.md` §4 contradicts the
distinct-requester model the V-Model already encodes (the exact [C] FR-014 vs FR-044 defect in staff-review).

**Resolution:** **D-DEMAND** — the V-Model is already conformant; the fix lands in `plan.md` §4 (rewrite the
`+1` to the capped distinct-`sub` upsert). Flagged here because the V-Model traces to a plan that still
mis-states the rule; once plan is fixed the layers agree. No change needed to the V-Model SQL.

---

## 2. Gaps / missing requirements

### G-1 — `food_candidates` table never named; CandidateStore/ITP-016 are unbound abstractions (D-CANDIDATES)

**Docs/locations:** `food_candidates` appears **0 times** in all four V-Model docs. Candidate persistence is
referenced only abstractly:

- `unit-test.md` MOD-018 uses a `CandidateStore` with `idsForFood(id)` / `fetch(id, ids)` / `clear(id)`
  (UTP-018, e.g. `unit-test.md:2154-2186`) but never names the backing table, columns, or uniqueness.
- `integration-test.md:1024-1041` ARCH-016/ITP-016-A "candidate store"; `:1237` test setup "Seed an UNRESOLVED
  food with a retained candidate set" — table unnamed.
- `integration-test.md:1013/:1020` "candidate set retained ... available to ARCH-016 `/candidates`".
- Candidate DTO shape `{ candidateId, source, externalKey, name, summary }` appears at `unit-test.md:359`,
  `system-test.md:1138` — consistent with the table columns but never tied to them.

**Problem:** **D-CANDIDATES** requires the `food_candidates` table (`id, food_id, source, external_key, name,
summary, created_at`; `UNIQUE(food_id, source, external_key)`) to be added to plan §2, ARCH-006,
module-design, spec FR-028, tasks, **and the traceability matrices**. In the V-Model layer this means: (a) the
persistence test (ITP-016 / the DAO/provenance ITPs) should reference `food_candidates` and assert its
`UNIQUE(food_id, source, external_key)` constraint; (b) the UNRESOLVED persist path (ITS-004-? /
ITP-015-B / ITP-016-A) should state the candidate set is written to `food_candidates`; (c) traceability maps
should bind the candidate REQ ids to `food_candidates`.

**Resolution:** **D-CANDIDATES** — bind the abstract CandidateStore/candidate-set tests to the named
`food_candidates` table and its uniqueness; add the table to the V-Model traceability matrices.

---

### G-2 — Auto-RESOLVE boundary uses vague "confidently collapsible", not the concrete D-AUTORESOLVE rule

**Docs/locations:**

- `unit-test.md:1989-2011` UTP-017-? `merge(candidates)` outcome branches: empty → `NOT_FOUND`; "a
  **non-confidently-collapsible** multi-candidate set" → `UNRESOLVED`; "a **confidently collapsible** set" →
  `RESOLVED`. Scenarios at `:2004` "two candidates that are NOT confidently collapsible (distinct logical
  items)" and `:2009` "two candidates that ARE confidently collapsible (same logical item)".
- Task map `unit-test.md:2466` "pre-merge dedup + auto-resolve" → UTP-017-A, UTP-004-C (no concrete rule).
- `integration-test.md:1013-1020` mirrors "outcome='UNRESOLVED' with the candidate set retained".

**Problem:** **D-AUTORESOLVE** specifies an _exact_ rule: auto-RESOLVE when **exactly one** candidate survives
normalized-name exact match (after dedup); **>1 → UNRESOLVED**; **0 → NOT_FOUND**; bias toward UNRESOLVED. The
V-Model encodes a fuzzy "confidently collapsible / same logical item" heuristic instead of the survivor-count
rule, so the ≥90%-auto-resolve metric still rests on an undefined boundary (staff-review [H]). No unit/accept
scenario asserts "exactly one survivor after normalized-name exact match → RESOLVED".

**Resolution:** **D-AUTORESOLVE** — restate UTP-017 (and add an acceptance scenario) around the concrete
count-of-survivors-after-normalized-name-exact-match rule: 1 → RESOLVED, >1 → UNRESOLVED, 0 → NOT_FOUND.

---

### G-3 — No UNRESOLVED candidate-set 30-day TTL / re-fan-out test (D-UNRESOLVED-TTL)

**Docs/locations:** Every "30-day TTL" hit in the V-Model is for **NOT_FOUND** tombstones, not UNRESOLVED
candidate sets: `acceptance-plan.md:334`, `:1318`, `:1371`; `system-test.md:302-316`, `:412-423`;
`integration-test.md:156-170` (ITP-001-E). Searching the V-Model for an UNRESOLVED candidate-set expiry yields
nothing.

**Problem:** **D-UNRESOLVED-TTL** decides that an UNRESOLVED food's candidate set **expires after 30 days** and
re-fan-out occurs on the next request (mirroring the NOT_FOUND 30-day TTL). The V-Model has no test for the
UNRESOLVED→re-fan-out path or candidate-set expiry.

**Resolution:** **D-UNRESOLVED-TTL** — add a scenario (acceptance + integration) parallel to the NOT_FOUND TTL:
UNRESOLVED candidate set older than 30 days → next add re-fans-out against the normal budget; a human pick
still wins if made earlier.

---

### G-4 — No same-food provenance integrity test (D-PROVENANCE-FK)

**Docs/locations:** The provenance/persist tests assert only `UNIQUE(source, external_key)` on `food_sources`
(`integration-test.md:332`, `:469`, `:475`) and per-value `source_id` columns (`unit-test.md:1919/:2052`,
MOD-019 at `unit-test.md:2189+`). No test asserts the composite `(food_id, source_id)` FK or
`UNIQUE(food_id, id)` "same-food" invariant (grep for `(food_id, source_id)` / `UNIQUE(food_id` → 0 hits).

**Problem:** Staff-review [C] "Provenance `source_id` can cross foods". **D-PROVENANCE-FK** mandates documenting
`UNIQUE(food_id, id)` on `food_sources` and composite `(food_id, source_id)` FKs on
nutrients/portions/field-provenance. The V-Model persistence ITPs/UTPs do not verify this structural invariant,
so a `source_id` from another food could be accepted without a failing test.

**Resolution:** **D-PROVENANCE-FK** — add an integration scenario (ITP-006 / ITP-017) asserting that a
nutrient/portion/provenance row whose `source_id` belongs to a _different_ `food_id` is rejected by the
composite FK; reference `UNIQUE(food_id, id)` on `food_sources`.

---

### G-5 — Worker-lease reaper not tested; only a WHERE-clause reclaim in one unit test (D-LEASE)

**Docs/locations:** The only lease-reclaim assertion is the WHERE clause in `unit-test.md:549` (UTP-003-B).
Integration/system docs describe leasing (`integration-test.md:255`, `:315`, `:330`) and the per-source pause
revert (`:315`), but there is **no** test for a crashed-worker orphaned `in_flight` row being reclaimed by a
reaper (grep `reaper|orphan|reclaim` in integration/system → 0 substantive hits).

**Problem:** Staff-review [H] "Worker lease has no expiry/reclaim ... a worker crash mid-lease orphans the row
forever". **D-LEASE** requires documenting the `leased_at` column **and a reaper** that reclaims expired
`in_flight` rows, with the single drainer enforced via advisory lock (the advisory lock _is_ tested at
`unit-test.md:590-611` UTP-003-D, good). The reaper itself has no UTP/ITP/STP.

**Resolution:** **D-LEASE** — add a test (unit on the reclaim query / integration on the orphan→reclaim seam)
for the reaper that requeues `in_flight` rows whose `leased_at` is older than the lease window (30s).

---

### G-6 — Change-driven refresh compute vehicle unspecified (D-REFRESH: Fargate scheduled task, not VPC Lambda)

**Docs/locations:** ARCH-018 / MOD-020 (ChangeRefreshConsumer) is described only as "on `IngestionScheduled`,
ARCH-018 iterates ... re-enqueues" (`integration-test.md:1109-1141`, `unit-test.md:2248-2300`,
`system-test.md:1266`). The execution vehicle (Fargate scheduled task vs Lambda) is never stated for the
refresh consumer. By contrast the _worker_ is explicitly Fargate (`system-test.md:37`, `acceptance-plan.md:302`).

**Problem:** **D-REFRESH** decides refresh runs as a **Fargate scheduled task (ADR-0004), not a VPC Lambda**.
The V-Model leaves ARCH-018's runtime ambiguous, risking an implicit Lambda reading (the surrounding identity
service uses VPC lambdas), which D-REFRESH and ADR-0004 disallow.

**Resolution:** **D-REFRESH** — state in the ARCH-018/MOD-020 test preambles that the refresh consumer is a
Fargate scheduled task (idle-drain, yields to live demand), aligned with ADR-0004.

---

### G-7 — Explicit lifecycle transition set incomplete; terminal→PENDING retries and PATCH-idempotency untested (D-LIFECYCLE)

**Docs/locations:** Transitions are covered piecemeal: PENDING→RESOLVED/UNRESOLVED/NOT_FOUND/FAILED
(`unit-test.md:142-165`, `integration-test.md:142-150`), UNRESOLVED→RESOLVED via PATCH
(`unit-test.md:2189+`, `acceptance-plan.md:401`, `:1328`). NOT_FOUND→re-attempt after TTL is covered
(`integration-test.md:167-170`). **But**:

- `FAILED → PENDING` (retry) is not covered as a transition test (grep `FAILED.*PENDING` → 0 hits).
- `NOT_FOUND → PENDING` is exercised only as an add-by-name re-attempt, not stated as a legal transition.
- PATCH-resolve **idempotency** and **UNRESOLVED-only** enforcement on an already-RESOLVED (non-UNRESOLVED)
  food is untested (grep `already RESOLVED|idempotent` against PATCH → no PATCH-on-RESOLVED scenario; the
  resolve UTPs all start from `findById → { status:'UNRESOLVED' }`, e.g. `unit-test.md` MOD-018 §`:2154+`).

**Problem:** **D-LIFECYCLE** requires the explicit legal transition set (PENDING→{RESOLVED,UNRESOLVED,
NOT_FOUND,FAILED}; UNRESOLVED→RESOLVED; FAILED→PENDING retry; NOT_FOUND→PENDING after TTL) and that PATCH-
resolve is UNRESOLVED-only + idempotent + candidate-in-set validated. The candidate-in-set guard is well
tested (UTP-018, `integration-test.md`/`acceptance-plan.md:401`), but the retry transitions and the
UNRESOLVED-only/idempotency guard are not.

**Resolution:** **D-LIFECYCLE** — add state-transition scenarios for FAILED→PENDING and NOT_FOUND→PENDING, and a
PATCH-resolve scenario asserting a non-UNRESOLVED (e.g. already-RESOLVED) target is rejected/no-op (idempotent)
without re-merging.

---

### G-8 — SC-005 / REQ-NF-015 not restated; throughput still framed as a single "5,000 foods/hr" (+80% cache hit) (D-SC005)

**Docs/locations:** `acceptance-plan.md:1465` "REQ-NF-014 (**80% cache hit rate**) and REQ-NF-015 (**5,000
foods/hr throughput**) are P2 analysis targets ... once the local store reaches 5,000+ RESOLVED foods".

**Problem:** Staff-review [C] SC-002 vs SC-005: the flat "5,000 foods/hr" cannot coexist with the USDA
1,000 req/hr cap (~500–900/hr real ceiling for NEW foods). **D-SC005** requires restating SC-005/REQ-NF-015 to
**separate** read/serve throughput (local golden-record reads, high target) from first-time **NEW-food
resolution rate** (USDA-budget-bounded, ~500–900/hr). The acceptance plan still lumps them as one ambiguous
target, and the "80% cache hit rate" framing is residual cache language (see Q-1).

**Resolution:** **D-SC005** — split REQ-NF-015 into a read/serve-throughput criterion (keep a high target,
measured on local reads with no source call) and a NEW-food resolution-rate criterion (~500–900/hr, bounded by
the USDA budget); recast REQ-NF-014 off "cache hit rate" (D-CLEANUP). Keep SC-002 unchanged.

---

## 3. Residual `fdcId` / cache framing & quality issues (D-CLEANUP)

### Q-1 — Residual "cache hit / cache miss" framing on the demand and read paths

The demand-driven model has **no** request-path cache by default (the only cache is the deferred optional Redis
variant, ARCH-007). These uses are residual pre-re-baseline framing:

- `system-test.md:226` "add-by-name **cache miss** inserts one row"; `:231` "resolves an add-by-name **cache
  miss**" — should be "add-by-name **miss**".
- `system-test.md:86` and `:656` serve the golden record "from the ... **cache hit**" as the _primary_ clause
  with the lean Postgres `findById` parenthesized — should lead with the DAO `findById` default and treat the
  Redis cache hit as the deferred variant.
- `acceptance-plan.md:1307` "Single add-by-name **cache miss**"; `:1310` "**Cache-miss** admissions resolved";
  `:1465` "**80% cache hit rate**".
- `unit-test.md:1217` UTP-010-A "getSourceApiKey — per-source **cache hit / miss** / expiry" — borderline (this
  is the in-process secret cache, not the food cache), but the wording invites confusion; prefer "secret cache".

**Resolution:** **D-CLEANUP** — purge cache-hit/miss framing from the demand/read paths; reserve "cache" for the
explicitly-deferred ARCH-007 Redis variant. Re-key the demand path as "add-by-name miss" and the default read as
"DAO `findById`".

### Q-2 — `fdcId` confinement is correctly applied (no action, recorded for completeness)

`fdcId` appears 28× in `acceptance-plan.md`, 31× in `system-test.md`, 28× in `integration-test.md`, 37× in
`unit-test.md`, but every occurrence is either (a) inside the USDA-adapter boundary (MOD-008/ARCH-008/ITP-008,
e.g. `integration-test.md:552-574`, `acceptance-plan.md:1106-1152`), (b) a "no `fdcId` in the public surface"
assertion (e.g. `acceptance-plan.md:130`, `:1325`, `unit-test.md:145/:361`), or (c) a re-baseline note
describing what was removed (e.g. `system-test.md:15`, `acceptance-plan.md:19`). This matches D-CLEANUP's
allowance ("`fdcId` may appear ONLY as USDA's `external_key`, inside the adapter boundary"). **No change needed**
beyond C-1 (the event rename) and Q-1 (cache framing).

### Q-3 — Auth slice (D-AUTH) is consistent; no forgeable path leaked

The V-Model tests the real `FoodAuthGuard` networkless verify, fail-closed `401`, scope `403` from
`public_metadata`, M2M, and DoS load-shed (`unit-test.md:1348-1620`, `integration-test.md:712-840`,
`system-test.md:853`). No `x-debug-sub` / forgeable-header path is tested anywhere (grep → 0 hits). This aligns
with **D-AUTH**. Minor: the explicit "the forgeable `x-debug-sub` path is removed" statement that D-AUTH asks be
_stated_ lives in spec/plan, not the test layer — no defect in this cluster.

---

## 4. Cross-reference / traceability notes

- The V-Model is internally consistent on the lifecycle enum (`PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED`),
  the per-source rolling window, distinct-requester demand, and `fetch_queue` status enum
  (`pending|in_flight|tombstone`) — these match `plan.md:131/:242`.
- The `drain_priority_tier` (C-2) and `enqueueLowPriority` (C-3) contradictions also surface in the V-Model
  **traceability/task maps** (`unit-test.md:2295`, `integration-test.md:1242-1243`), so reconciling them
  requires editing the maps too, not just prose.
- Once C-1 (event rename) and G-1 (`food_candidates`) land, re-run a trace check: REQ-031/032/048/050/054 and
  the candidate REQ ids should each map to a named table/event in the matrices (no orphan abstractions).

---

## 5. Items needing a decision (none new)

All findings above are resolved by an existing autoresolution default (D-EVENT, D-CANDIDATES, D-AUTORESOLVE,
D-UNRESOLVED-TTL, D-PROVENANCE-FK, D-LEASE, D-REFRESH, D-LIFECYCLE, D-SC005, D-DEMAND, D-FAIRNESS, D-CLEANUP,
D-AUTH). No "needs decision" items remain in this cluster — every defect maps to a canonical default.
