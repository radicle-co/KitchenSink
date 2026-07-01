# Pre-implementation adversarial review — lens: impl-readiness

**Feature:** 003 source-agnostic food data integration
**Question:** As the engineer about to start a clean TDD build from `tasks.md`, is anything ambiguous,
undefined, or missing that would block construction or make two engineers build different things?
**Verdict:** ISSUES — 4 high (blocking) defects, plus several medium under-specifications.

The design _intent_ is coherent and the stabilization decisions (`D-*`) are applied broadly. The problems
below are not redesign requests — they are places where the contract is internally contradictory, references
an undefined constant, references a non-existent column, or leaves a required behavior with no design
realization. Each would surface immediately in TDD (the red test cannot be written deterministically, or the
green implementation two engineers write would differ in observable behavior).

---

## HIGH / blocking

### H1. `request_count` enqueue formula is contradictory across three docs and contains an undefined constant

**Where:**

- `v-model/module-design.md:355` (MOD-003 `enqueue`): `request_count = LEAST((SELECT count(*) FROM fetch_requesters WHERE food_id=$1), <PRIORITY_CAP_SCALE>)`
- `spec.md:363-375` (FR-014 SQL): `request_count = (SELECT count(*) FROM fetch_requesters fr WHERE fr.food_id = $1)` (no cap)
- `plan.md:677-681` (§4 SQL): `request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id = $1)` (no cap)
- `decision-register.md:123` (§3.2): `SET fetch_queue.request_count = LEAST(distinct-sub count, PRIORITY_CAP=1)`

Three formulas: spec/plan = uncapped distinct-sub count; MOD-003 = `LEAST(count, <PRIORITY_CAP_SCALE>)` where
`<PRIORITY_CAP_SCALE>` is **literally an unresolved placeholder defined nowhere** in the corpus
(grep confirms zero definitions); decision-register = `LEAST(count, 1)` which, read literally, caps
`request_count` at **1 for every row** — collapsing all demand weighting and breaking US-5 scenario 1
("`A` (50 distinct requesters) processed before `B` (1)") and SC-012. `PRIORITY_CAP = 1` is meant to express
"each `sub` contributes at most 1" (which the `fetch_requesters` PK already guarantees), NOT "cap the total at
1", but the `LEAST(...)` phrasing in two authoritative docs says the latter.
**Fix:** Pick one. The intent is `request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id=$1)`
(uncapped; per-sub cap is structural via PK). Delete the `LEAST(..., <PRIORITY_CAP_SCALE>)` from MOD-003:355
and the `LEAST(distinct-sub count, PRIORITY_CAP=1)` wording from decision-register:123, or define
`PRIORITY_CAP_SCALE` as a concrete large bound and explain it. Make spec FR-014, plan §4, MOD-003, and the
register byte-identical.

### H2. Change-driven refresh (US-7) has no executable home — MOD-020 detects the change then throws the result away, and MOD-004 (the only drainer) cannot honor FR-031

**Where:** `v-model/module-design.md:1977-1997` (MOD-020), `v-model/module-design.md:466-531` (MOD-004
`processRow`), `plan.md:823-835` (§5 change-refresh), `spec.md:436-437` (FR-031/FR-032), `tasks.md` T-170/T-171.

MOD-020 computes `itemChanged(source, external_key, item_version)` then **re-enqueues only `food_id`** via the
ordinary `enqueue(food_id,'svc_change_refresh')` path (discarding _which_ item/field changed). MOD-020:1995
states the re-enqueued row is "later drained by MOD-004 [and] only the fields whose originating item changed
are re-pulled." But MOD-004 `processRow` (the single worker drain path) **always** does full fan-out-by-name:
it reads `food.name`, iterates the adapter registry, `searchByName` + `fetchByKey` every hit, pre-merges, and
runs the full `RESOLVED/UNRESOLVED/NOT_FOUND/FAILED` merge. It has:

- no branch distinguishing a refresh row from a fresh add (the only signal, `fetch_requesters.sub =
'svc_change_refresh'`, is never read by MOD-004),
- no `item_version` comparison,
- no "re-pull only the changed field" logic,
- no manual-pick preservation.

So a refreshed food is **re-fanned-out by name and re-merged wholesale**, which directly violates FR-031
("MUST NOT blindly re-blend") and FR-028a/FR-031 ("refresh MUST NOT overwrite a user's manual pick"), and makes
US-7 acceptance scenarios 1 and 3 (only-changed-field re-pulled; user-resolved field preserved) impossible to
satisfy. Two engineers will diverge: one puts the detection+selective-update entirely inside MOD-020 (no
re-enqueue), another adds a refresh branch to MOD-004 keyed on the requester/a new row column.
**Fix:** Decide and document the single execution model. Either (a) MOD-020 performs the per-field re-pull and
in-place update itself (using the `itemChanged` result it already has) and does **not** re-enqueue, or (b) the
re-enqueued row carries the changed-item set (needs a column/payload on `fetch_queue` or a side table) and
MOD-004 gains an explicit "refresh: selective re-pull, preserve manual picks" branch. Update MOD-004's
`processRow`, MOD-020, FR-031/FR-032, and T-170/T-171 to match the chosen model.

### H3. Terminal-row reactivation leaves the food stuck `PENDING` — the enqueue `ON CONFLICT` guard never resets the `tombstone` queue row

**Where:** `v-model/module-design.md:1590-1604` (MOD-016 `createByName` reactivation),
`v-model/module-design.md:347-359` (MOD-003 `enqueue`), `spec.md:363-375` (FR-014 SQL, `WHERE
fetch_queue.status = 'pending'`), `plan.md:677-681`, `spec.md:339`/`:424` (FR-005/FR-028a reactivation).

On `NOT_FOUND`/`FAILED` the worker calls `tombstone(foodId)` → `fetch_queue.status='tombstone'` (the row is
kept as audit, never deleted). On a later add past TTL, `createByName` reactivates the **food** row to
`PENDING` and returns `reactivated:true` so "caller re-enqueues." The caller's enqueue is
`INSERT INTO fetch_queue (food_id) … ON CONFLICT (food_id) DO UPDATE SET … WHERE fetch_queue.status='pending'`.
Because the existing row is `status='tombstone'`, the `WHERE` predicate is false → **no update**, no error, the
row stays `tombstone`. `leaseNext` only claims `status='pending'` (or expired `in_flight`) rows, so the
reactivated food is **never drained** and sits `PENDING` forever. This breaks the FR-005/FR-028a reactivation
guarantee and T-140's acceptance ("an add for a terminal-state past-TTL row reactivates it to `PENDING`").
The `WHERE status='pending'` guard (present identically in spec FR-014, plan §4, and MOD-003) exists to avoid
bumping `in_flight`/`tombstone` demand, but it also silently blocks reactivation.
**Fix:** Add an explicit reactivation step that flips the queue row `tombstone → pending` and resets
`attempts=0, last_error=NULL, last_requested=now()` (and clears `leased_at`) when `reactivated:true`. State it
in FR-005/FR-028a, MOD-016/MOD-003, plan §5, and add a T-140/T-153 acceptance assertion that the reactivated
food is actually re-drained.

### H4. MOD-004 reads `row.requested_by`, but `fetch_queue` has no such column

**Where:** `v-model/module-design.md:468` (MOD-004: `AsyncProducerAuthz.assertEnqueueProvenance(dbSessionRole,
row.requested_by)`), schema in `plan.md:276-287` / `v-model/module-design.md:340-341` / `tasks.md` T-101.

`processRow` validates async-producer provenance (FR-048) by reading `row.requested_by` off the leased
`fetch_queue` row. The `fetch_queue` schema has no `requested_by`/`requestedBy` column — the requester `sub`
lives only in the separate `fetch_requesters` table, and `FetchQueueRow` (MOD-003 §3, spec FR-028/FetchQueueRow
entity) lists no such field. So the FR-048 provenance check in the worker reads `undefined`, and T-053
("consumer validates provenance; rejects rows with no valid `requestedBy`") cannot be implemented against the
row as designed. Two engineers diverge: one adds a `requested_by` column to `fetch_queue`, another joins
`fetch_requesters`, another drops the worker-side check.
**Fix:** Either add a `requested_by`/last-requester column to `fetch_queue` (and set it in the enqueue), or
redefine `assertEnqueueProvenance` to validate against `fetch_requesters` (and define what "valid" means when a
food has many requesters). Reconcile MOD-004, the `fetch_queue` DDL (plan §2, T-101), and the `FetchQueueRow`
entity/structure.

---

## MEDIUM (does not block starting, but will cause divergence/rework)

### M1. Demotion drain ORDER BY is not index-serviceable and its correctness is unverified

**Where:** `v-model/module-design.md:368-389` (MOD-003 `leaseNext`).
The demotion clause is a per-candidate-row, per-requester, correlated `COUNT(*)` over a `fetch_queue ⋈
fetch_requesters` join inside the `ORDER BY` of a `… FOR UPDATE SKIP LOCKED LIMIT 1`. This is an O(rows ×
requesters × queue-scan) nested loop with no supporting index (staff-review already flagged "not
index-serviceable"), evaluated on every claim. At the FR-046 ceiling (10,000 rows) this is a per-drain table
scan, jeopardizing SC-003. It is now _concretely specified_ (so a build can start), but no index or
materialization strategy is given and there is no perf budget/test tied to it.
**Fix:** Add a note on expected cost + a materialization option (e.g. a maintained per-`sub` pending count), or
an explicit "acceptable at launch scale, revisit at N rows" caveat, and a perf test in T-151/T-195.

### M2. `FR-044` "queue ordering MUST apply aging" has no design realization

**Where:** `spec.md:460` (FR-044), vs every ORDER BY (`request_count DESC, first_requested ASC`) in
`spec.md:377`, `plan.md:727`, `v-model/module-design.md:384`.
FR-044 mandates "queue ordering MUST apply aging so no `id` can be pinned to the front indefinitely," but the
ordering is pure `request_count DESC, first_requested ASC`, which pins a high-demand row ahead of everything
forever (no time-decay term). The MUST has no implementation anywhere; an engineer will either silently ignore
it or invent an undefined aging function.
**Fix:** Either drop the aging clause from FR-044 (if demand-weighting is intended to be absolute) or specify a
concrete aging term in the ORDER BY (e.g. effective score blending `request_count` with age) and reflect it in
plan §4/§5 and MOD-003.

### M3. Nutrient-dictionary dedup is undefined when `external_code` is NULL

**Where:** `plan.md:178-184` (`nutrient` DDL: `external_code text` nullable, `UNIQUE(external_code)`),
`tasks.md` T-107 ("dictionary upsert by `external_code`"), `v-model` NutrientDao.
`UNIQUE(external_code)` permits multiple NULLs, and `name` is not unique. A USDA nutrient with no INFOODS
tagname (NULL `external_code`) has no dedup key, so "upsert by `external_code`" cannot collapse it → duplicate
`nutrient` rows for e.g. "Protein" → multiple `nutrient_id`s → `food_nutrients UNIQUE(food_id, nutrient_id)`
fails to collapse the golden value. The fan-out/merge then produces split nutrient rows.
**Fix:** Define the dedup key when `external_code` is NULL (e.g. fall back to a normalized `name`+`unit` unique
key, or require a synthesized code). Update the `nutrient` DDL, T-107, and the merge/upsert contract.

### M4. `PATCH`-resolve behavior at the hard window cap is unspecified

**Where:** `plan.md:809-821` (PATCH re-fetch), `spec.md:346` (FR-RES-2), `tasks.md` T-110/T-122/T-142.
`PATCH`-resolve re-fetches by `external_key` as "a budgeted per-source call" and is "exempt from flood-shed and
the 90% drain pause and never returns 429" — yet the atomic check-and-record (T-110:
`INSERT … WHERE (count) < cap RETURNING`) returns no row when the window is at the hard cap (1,000). The docs
say "if the re-fetch fails, the resolve aborts with `SourceApiError` and the food stays `UNRESOLVED`", but do
not say whether hitting the cap counts as a re-fetch failure (abort) or whether PATCH may exceed the cap
(breaching SC-002). Two engineers build opposite things.
**Fix:** State explicitly: at the hard cap, PATCH either (a) aborts with a retryable error (preserving SC-002),
or (b) waits. Reconcile FR-RES-2, plan §5 PATCH path, and the limiter contract (T-110/T-122).

### M5. M2M (Clerk machine token) verification mechanism is under-specified

**Where:** `spec.md:463` (FR-047), `spec.md:542` (A-012), `tasks.md` T-047, `plan.md` §2A.2.
FR-047/A-012 assert downstream services authenticate with a "Clerk machine (M2M) token" verified "networklessly
via `CLERK_JWT_KEY` with `azp` enforcement." Clerk **machine/OAuth tokens are a different token class than
session JWTs** and are not necessarily verifiable by the session JWKS / do not necessarily carry an `azp`
claim. T-047 ("accept Clerk machine tokens (azp-allowlisted)") will hit this wall. The shared
`@kitchensink/clerk-verify` (`verifyToken`) extracted from the identity service only verifies session tokens
today.
**Fix:** Specify the concrete M2M verification path (which Clerk token type, which key/endpoint, what claim is
allowlisted in place of `azp`) and whether it can truly stay networkless. If it cannot, surface the conflict
with FR-036's networkless mandate before building T-046/T-047.

### M6. No task/CDK construct for the change-refresh Fargate scheduled-task target

**Where:** `tasks.md` T-001 (`[x]`, built for the **old** design), T-170 (app code only), FU-ESBUILD note
(`tasks.md:659`), `plan.md:75-79`/§5.
D-REFRESH moved change-refresh from a VPC Lambda to a **Fargate scheduled task** (EventBridge rule → ECS
`RunTask`). T-170 covers the app code, but the **CDK wiring** (EventBridge schedule with an ECS task target +
the `RunTask`/task-execution IAM role + task definition for the scheduled task) is not a defined task — T-001 is
checked-off against the prior (Lambda) design. The infra to actually launch the scheduled task is missing from
the task list.
**Fix:** Add an explicit infra task (or extend T-001) for the EventBridge-schedule → ECS-scheduled-task target,
its IAM role, and the task definition, in `packages/services/food-service/infra/lib/`.

### M7. `CandidateMismatchError` HTTP status is left as "400/409"

**Where:** `spec.md:346` / `:142` (FR-RES-2, "`400`/`409`"), `plan.md:554` (example shows `409`),
`v-model/module-design.md:151`/`:236` ("400 / 409"), `decision-register.md:230`.
The mismatch status is consistently written as "`400`/`409`" — an unresolved either/or. This is a client-facing
contract; `@kitchensink/food-service-client` (T-057) must map one specific code, and the US-2a acceptance test
asserts a specific status. Two engineers pick differently.
**Fix:** Pick one (recommend `409 Conflict` for "candidate not in this food's set", reserving `400` for
malformed body) and make spec/plan/module-design/client/tests agree.

---

## LOW (note; not blocking)

### L1. `estimatedWaitSeconds` has no computation rule

`spec.md:337` (FR-003), `plan.md:517/538/570`, `v-model/module-design.md:107/125` all return a hardcoded `30`
(or `20`). Fine to ship as a constant, but the field reads as if dynamic. Either state "static placeholder at
launch" or define the estimate (e.g. from queue depth / window headroom).

### L2. Migration authoring approach is ambiguous (drizzle-kit generate vs hand-written ordered SQL)

T-100 says "`drizzle-kit generate` emits valid SQL" while T-102/T-103/T-104 say "Ordered SQL creating…"; the
FU-MIGRATE runner "applies the Phase-1 ordered SQL." It is unclear whether the schema source of truth is the
Drizzle schema (generated migrations) or hand-authored SQL files. The composite `(food_id, source_id)` FKs to
`UNIQUE(food_id, id)` with `ON DELETE NO ACTION`, partial indexes, and `gin_trgm_ops` GIN indexes need
verification that `drizzle-kit generate` emits them faithfully (some require raw SQL). Mirroring identity's
`migrate.ts` (generate + apply) is implied but not stated.
**Fix:** State the authoring model and confirm the composite-FK/GIN/partial-index DDL is expressible via the
chosen path.

---

## What is solid (no action)

- The 13-table canonical schema, enums, provenance composite-FK / `ON DELETE NO ACTION` rationale, and the
  `food_candidates` shape are concrete and consistent across plan §2, spec FR-028, and MOD-006/MOD-016/MOD-019.
- API request/response shapes (status codes, `202`/`200`/`404` precedence, batch partial, error bodies) in
  plan §3 and MOD-001 are buildable.
- Auth contract (`FoodAuthGuard`, networkless verify, `x-debug-sub` removal, `401→403→400→…` precedence,
  fail-closed) is concrete for the session-token path (the M2M gap is M5).
- Event taxonomy (`FoodFetchCompleted`/`publishFoodFetchCompleted`, demand-path-is-not-EventBridge,
  `IngestionScheduled`/`FetchFailed`) is reconciled and matches the CDK rule.
- The rolling-window limiter (atomic check-and-record, single-drainer advisory-lock serialization, prune
  rule), lease/reaper (`leased_at`, 30s), retry/backoff/tombstone, and survivor-count auto-resolve boundary
  are concrete and TDD-ready.
- Package/DB layout (4 packages, `kitchensink_food` logical DB, shared ALB host rule p200) is unambiguous;
  FU-MIGRATE (in-VPC runner, Docker-Postgres until then) is a clear, sound story modulo L2.
  </content>
  </invoke>
