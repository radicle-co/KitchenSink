# V-Model Peer Review: USDA Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Review Date**: 2026-05-09
**Reviewer**: AI Peer Review (speckit.v-model.peer-review)
**Artifacts Reviewed**:

- `specs/003-usda-food-data/v-model/requirements.md`
- `specs/003-usda-food-data/v-model/acceptance-plan.md`
- `specs/003-usda-food-data/v-model/unit-test.md`
- `specs/003-usda-food-data/v-model/trace.md`

**Standard Applied**: ISO 29119 / V-Model bidirectional traceability

> [!IMPORTANT]
> **SUPERSEDED — historical record.** This 2026-05-09 review (and its 2026-06-19 addendum) examined the
> **pre-reconciliation** design: SQS fetch queues, a **token-bucket** limiter, **Redis-first** reads, the
> `fetch_status` enum (`pending/fetched/failed/not_found/stale`), and `fdcId` keys. That design no longer
> exists. It was reconciled to **Postgres-as-queue + rolling-window + demotion** (2026-06-20; see the
> per-artifact `peer-review-*.md`), then **stabilized** by the **decision register**
> (`../decision-register.md`). The findings below are retained verbatim as history; read every term through
> the canonical mapping in **"Stabilization reconciliation"** at the foot of this file. The only in-place
> body edit is the mandated completion-event rename to **`FoodFetchCompleted`** (the retired `FoodData*` completion-event name; D-EVENT).

---

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 4     |
| WARNING  | 9     |
| PASSED   | 12    |

> ⚠️ **Verdict superseded** — the counts and verdict in this Summary predate doc-stabilization; read them through the **Stabilization reconciliation (decision register, 2026-06-28)** appendix at the foot of this file, which is the controlling record.

Overall assessment: **CONDITIONAL PASS** — the artifact set is structurally sound and demonstrates strong traceability discipline. Four critical issues must be resolved before implementation begins; nine warnings should be addressed before the first integration test cycle.

---

## CRITICAL Findings

---

### PRF-003-A1 — `fetch_status = 'failed'` is a declared enum value with no acceptance coverage

**Artifact**: `requirements.md` (REQ-028), `acceptance-plan.md`, `trace.md` (Matrix A)

**Evidence**:

- REQ-028 declares `fetch_status` enum values: `pending`, `fetched`, `failed`, `not_found`, `stale`.
- The `failed` state is never referenced in any acceptance test case or BDD scenario.
- Matrix A has no row for a requirement covering the `failed` state transition or its observable API behaviour.
- REQ-002 covers `fetched`, REQ-003/004 cover `pending`, REQ-005 covers `not_found`, REQ-031 covers `stale` — `failed` is the only state with zero acceptance coverage.

**Impact**: A consumer that receives a `GET /v1/foods/{fdcId}` for a food in `fetch_status = 'failed'` has undefined observable behaviour. The system could return 200, 202, 404, or 500 — none are specified. This is a contract gap that will surface as a production defect.

**Required Action**: Add a requirement (e.g., REQ-036) specifying the HTTP response for `fetch_status = 'failed'` (recommended: `202 Accepted` with `{"status": "failed"}` to allow client retry, or `500` with a retry-after header). Add a corresponding acceptance test case and BDD scenario. Update Matrix A.

---

### PRF-003-A2 — REQ-020 (atomic token bucket) has no acceptance test; unit test technique is insufficient for atomicity verification

**Artifact**: `requirements.md` (REQ-020), `trace.md` (Matrix A, row REQ-020), `unit-test.md` (UTP-005-A)

**Evidence**:

- Matrix A row for REQ-020: `*(Unit test coverage via UTP-005-A)*` — no AT defined.
- REQ-020 states: "The token bucket check-and-consume operation SHALL be atomic: a Redis Lua script in the full architecture, or a PostgreSQL `UPDATE ... RETURNING` query in the lean launch variant."
- UTP-005-A mocks `RedisClient.eval()` and executes Lua script logic in-process. An in-process mock cannot verify atomicity — it verifies the Lua script's arithmetic, not that the script executes as a single Redis command under concurrent load.
- HAZ-003 rates this hazard as **Critical**: "Token bucket race condition allows >1,000 USDA API calls per hour."

**Impact**: The most critical safety property of the system (rate-limit compliance) is verified only by a unit test that cannot detect the race condition it is designed to prevent. A concurrent integration test against real Redis is the minimum bar for this requirement.

**Required Action**: Add an acceptance test `AT-020-A` using Fault Injection / Concurrency technique: fire N concurrent consumer invocations against a real Redis instance with 1 token remaining; assert exactly 1 USDA API call is made. Update Matrix A. Mark REQ-020 verification method as `Test` (not just unit-level).

---

### PRF-003-A3 — `UTP-003-B` tests `maxReceiveCount = 5` for Low Priority queue, contradicting REQ-016

**Artifact**: `unit-test.md` (UTP-003-B, UTS-003-B2), `requirements.md` (REQ-016)

**Evidence**:

- REQ-016: "All SQS queues SHALL have a max receive count of **3** before routing failed messages to the Dead Letter Queue."
- UTP-003-B description: "Verifies `configureDlq()` sets `maxReceiveCount` correctly for HighPriority (**3**) and LowPriority (**5**) queues."
- UTS-003-B2: `set maxReceiveCount = 5` for Low Priority queue.
- Matrix D maps UTP-003-B to REQ-016 without flagging this discrepancy.

**Impact**: If implemented as tested, the Low Priority queue will allow 5 receive attempts before DLQ routing, violating REQ-016. This is an internal consistency failure between the unit test plan and the requirements specification. One of the two documents is wrong; the discrepancy must be resolved before implementation.

**Required Action**: Either (a) update REQ-016 to specify different `maxReceiveCount` values per queue type (3 for High Priority, 5 for Low Priority) and add rationale, or (b) correct UTP-003-B / UTS-003-B2 to use `maxReceiveCount = 3` for both queues. Update Matrix A and Matrix D accordingly.

---

### PRF-003-A4 — `handleGetFoodStatus` state machine (UTP-001-D) is missing the `'stale'` fetch_status transition

**Artifact**: `unit-test.md` (UTP-001-D), `requirements.md` (REQ-028, REQ-031)

**Evidence**:

- REQ-028 declares `fetch_status` enum includes `stale`.
- UTP-001-D description: "Verifies `handleGetFoodStatus()` transitions: invalid fdcId → Rejected; DB null + pending → 200 pending; DB null + not pending → 404; DB row found → 200 with status."
- UTP-001-D defines scenarios UTS-001-D1 through D5, covering: invalid, null+pending, null+not-pending, fetched, not_found.
- No scenario covers `fetch_status = 'stale'` or `fetch_status = 'failed'`.
- State Transition Testing (the declared technique) requires every valid state to be exercised.

**Impact**: The status endpoint's behaviour for `stale` and `failed` foods is untested. A client polling `/v1/foods/{fdcId}/status` for a stale food will receive an undetermined response.

**Required Action**: Add UTS-001-D6 for `fetch_status = 'stale'` (assert: 200 OK with `{"status": "stale"}` and full food data, since stale foods have been fetched). Add UTS-001-D7 for `fetch_status = 'failed'` once PRF-003-A1 is resolved and the expected response is defined.

---

## WARNING Findings

---

### PRF-003-A5 — REQ-002 response body has a double-comma typo that may indicate a missing field

**Artifact**: `requirements.md` (REQ-002)

**Evidence**:

- REQ-002: "...`fdcId`, `description`, `calories`, `protein`, `carbs`, `fat`**,,** available micronutrients..."
- The double comma (`,,`) appears in multiple requirements (REQ-013, REQ-024, REQ-029, REQ-NF-001, REQ-NF-002, REQ-NF-006, REQ-NF-007) and may be a systematic copy-paste artifact from a source document.
- In REQ-002 specifically, the double comma between `fat` and `available micronutrients` may indicate a field was deleted (e.g., `fiber` or `sodium`) without removing the trailing comma.

**Impact**: Ambiguous response contract. If a field was accidentally deleted, the acceptance test ATS-002-A1 ("no field is null or missing") will not catch the omission because the missing field is not named.

**Required Action**: Audit all double-comma occurrences. For REQ-002, explicitly enumerate the required response fields (including any micronutrients that are mandatory vs. optional). Fix the formatting throughout the document.

---

### PRF-003-A6 — `AT-010-A` performance scenario uses "sequential requests" but the requirement is a p95 latency target

**Artifact**: `acceptance-plan.md` (ATS-010-A1), `requirements.md` (REQ-010)

**Evidence**:

- REQ-010: "Search results SHALL be ranked by relevance, returned within 200ms for a local store of up to 50,000 foods."
- ATS-010-A1: "...the total server-side processing time is under 200ms **at p95 across 100 sequential requests**."
- Sequential requests do not produce a meaningful p95 distribution — they measure throughput under no concurrency. A p95 latency target is meaningful only under concurrent load (e.g., 10–50 concurrent clients).

**Impact**: The acceptance test as written will pass even if the system degrades to 500ms under realistic concurrent load, because sequential requests will always be faster.

**Required Action**: Revise ATS-010-A1 to specify concurrent load: e.g., "10 concurrent clients each sending 20 requests (200 total); p95 server-side latency across all 200 responses is under 200ms."

---

### PRF-003-A7 — `AT-NF011-A` latency probe is referenced in Matrix B but not defined in `acceptance-plan.md`

**Artifact**: `trace.md` (Matrix B, row AT-NF011-A), `acceptance-plan.md`

**Evidence**:

- Matrix B row: `AT-NF011-A | Latency probe for cache-hit path | REQ-NF-011 | Cache-hit food lookups return within 50ms at p95`.
- Searching `acceptance-plan.md` for `AT-NF011-A`: the test case is referenced in the non-functional section of the trace but does not appear as a defined test case with BDD scenarios in the acceptance plan document.
- Similarly, `AT-NF012-A`, `AT-NF013-A`, `AT-NF016-A`, `AT-NF018-A`, and `AT-NF007-A` are referenced in Matrix B but their BDD scenarios are not visible in the reviewed portion of `acceptance-plan.md`.

**Impact**: Matrix B claims backward traceability for these AT IDs, but the test cases are not fully specified. Testers cannot execute tests that have no defined scenarios.

**Required Action**: Verify that all `AT-NF*` test cases have Tier 3 BDD scenarios defined in `acceptance-plan.md`. If they are present but beyond the reviewed range, confirm their existence. If missing, add them.

---

### PRF-003-A8 — `UTP-001-D` scenario count mismatch: description says D4 is the last, but D5 exists

**Artifact**: `unit-test.md` (UTP-001-D), `trace.md` (Matrix D, MOD-001 row)

**Evidence**:

- UTP-001-D description: "Verifies `handleGetFoodStatus()` transitions: invalid fdcId → Rejected; DB null + pending → 200 pending; DB null + not pending → 404; DB row found → 200 with status." — four transitions described.
- Scenarios defined: UTS-001-D1 through D5 (five scenarios). D5 covers `fetch_status = 'not_found'`.
- Matrix D MOD-001 row: "UTS-001-D1 through **D4**" — D5 is not listed.

**Impact**: Matrix D undercounts the UTS scenarios for MOD-001. The traceability matrix is inaccurate, which undermines audit confidence.

**Required Action**: Update Matrix D MOD-001 row to read "UTS-001-D1 through D5 (24 total)" and update the UTP-001-D description to enumerate all five transitions.

---

### PRF-003-A9 — `REQ-IF-005` (EventBridge event schemas) is Inspection-only with no schema definition

**Artifact**: `requirements.md` (REQ-IF-005), `trace.md` (Matrix A, row REQ-IF-005)

**Evidence**:

- REQ-IF-005: "EventBridge events: `FoodRequested`, `FoodBatchRequested`, `IngestionScheduled`, `FoodFetchCompleted`, `FetchFailed`" — verification method: Inspection.
- No event schema (field names, types, required/optional) is defined in the requirements or referenced artifact.
- `FetchFailed` event is listed in REQ-IF-005 but does not appear in any acceptance test, unit test, or hazard entry. It is not referenced in REQ-024 through REQ-027 (the consumer error handling requirements).

**Impact**: Without a schema, inspection cannot verify correctness. The `FetchFailed` event has no consumer defined — it may be dead code or a missing requirement.

**Required Action**: Define the payload schema for all five EventBridge events (at minimum: required fields and types). Clarify the purpose and consumer of `FetchFailed` — if it is emitted on USDA 5xx after DLQ routing, add a requirement for it. If it is unused, remove it from REQ-IF-005.

---

### PRF-003-A10 — `REQ-NF-004` and `REQ-NF-005` are P2 UI requirements with no corresponding module in the unit test plan

**Artifact**: `requirements.md` (REQ-NF-004, REQ-NF-005), `unit-test.md`

**Evidence**:

- REQ-NF-004: "Any UI components created for food data display SHALL expose accessible names queryable via `getByRole`/`getByLabel` in Playwright tests."
- REQ-NF-005: "Color SHALL NOT be the sole conveyor of food fetch status."
- The unit test plan covers MOD-001 through MOD-011, all of which are backend Lambda/infrastructure modules. No UI module is defined.
- Matrix A maps both requirements to `*(Inspection — no AT defined)*`.

**Impact**: If UI components are built (even as a thin status display), there is no test coverage plan for accessibility. The requirements exist but have no verification path.

**Required Action**: Either (a) explicitly scope these requirements out of the current feature (noting they apply only when a UI is built in a future feature), or (b) add a UI module to the module design and unit test plan, and add acceptance test cases for accessibility. If scoped out, mark as `N/A` in Matrix A with a rationale note.

---

### PRF-003-A11 — `UTP-004-A` has only one scenario (UTS-004-A1) for the rate-limit-exhausted branch

**Artifact**: `unit-test.md` (UTP-004-A), `trace.md` (Matrix D, MOD-004 row: "UTS-004-A1, ... 8 total")

**Evidence**:

- UTP-004-A description: "Verifies `processRecord()` changes message visibility and returns `{ failed: false }` when token bucket is exhausted."
- Only UTS-004-A1 is defined. It covers the case where `checkTokens()` returns `{ allowed: false }` and `getWaitTime()` returns `25`.
- Missing scenarios: (a) `getWaitTime()` returns `0` (bucket just refilled, edge case for visibility timeout calculation), (b) `SqsClient.changeMessageVisibility()` throws (error propagation from SQS call failure).

**Impact**: The visibility timeout calculation `waitTime + 5` is not boundary-tested. A `getWaitTime()` of `0` would set visibility to `5` seconds — potentially too short for the bucket to refill (refill rate is 16.67 tokens/minute = ~3.6 seconds per token, but the bucket needs to accumulate to 1.0 tokens).

**Required Action**: Add UTS-004-A2 for `getWaitTime() = 0` (assert visibility timeout = 5 seconds minimum). Add UTS-004-A3 for `SqsClient.changeMessageVisibility()` throwing (assert error is logged and `{ failed: true }` is returned, or define the expected error handling behaviour in the module design).

---

### PRF-003-A13 — `REQ-029` index coverage claim is not verified by any dedicated test

**Artifact**: `requirements.md` (REQ-029), `trace.md` (Matrix A, row REQ-029)

**Evidence**:

- REQ-029: "The system SHALL index the `foods` table on: `fdc_id` (B-tree primary), `fetch_status` + `fetched_at` (composite), `last_requested_at`, full-text on `description` (GIN index for search)."
- Matrix A: `*(Covered by AT-010-A latency probe)*` — no dedicated index verification test.
- AT-010-A verifies search latency under load, which implicitly requires the GIN index to exist. However, it does not verify the composite `fetch_status + fetched_at` index (used for stale detection) or the `last_requested_at` index.

**Impact**: If the composite index is missing, stale-data queries (REQ-031, REQ-032) will perform full table scans. This will not be caught by AT-010-A, which only exercises the search path.

**Required Action**: Add an inspection checklist item or a dedicated integration test that verifies all four indexes exist in the deployed schema (e.g., via `pg_indexes` query). Alternatively, add a migration test that asserts the schema matches the specification.

---

## PASSED Findings

---

### PRF-003-P1 — Forward traceability (Matrix A) is complete for all P1 and P2 functional requirements

Every P1 and P2 functional requirement (REQ-001 through REQ-035) has at least one acceptance test case mapped in Matrix A. P3 requirements (REQ-034) are correctly marked as `Demonstration` with no AT required. Inspection-only requirements are correctly excluded from the AT gate.

---

### PRF-003-P2 — Backward traceability (Matrix B) has no orphan acceptance tests

Every AT case in Matrix B maps to at least one REQ-ID. No orphan acceptance tests were found. The dual-mapping of AT-007-A to both REQ-007 and REQ-033 is correct and well-justified.

---

### PRF-003-P3 — All six ISO 29119-4 white-box techniques are represented in the unit test plan

The unit test plan correctly applies all six required techniques: Statement & Branch Coverage, Boundary Value Analysis, Equivalence Partitioning, Strict Isolation, Error Guessing, and State Transition Testing. Each test case identifies its technique and anchors it to a specific module design view.

---

### PRF-003-P4 — Hazard matrix (Matrix H) is comprehensive and well-linked

Matrix H identifies 9+ hazards covering all critical security and data-integrity risks: API key exposure (HAZ-001), unauthenticated access (HAZ-002), token bucket race condition (HAZ-003), thundering herd (HAZ-004), poison-pill messages (HAZ-005), data rounding (HAZ-006), stale data (HAZ-007), 429 cascade (HAZ-008), and invalid fdcId queue pollution (HAZ-009). Each hazard links to both unit test and acceptance test mitigations.

---

### PRF-003-P5 — `isValidFdcId` boundary value analysis is thorough

UTP-001-A covers all five BVA points: min-1 (0), min (1), mid (5,000,000), max (9,999,999), max+1 (10,000,000), plus non-numeric and negative inputs. This is a model BVA test case.

---

### PRF-003-P6 — Consumer error handling (REQ-024 through REQ-027) has distinct acceptance tests for each USDA response code

AT-024-A (200 OK), AT-025-A (404), AT-026-A (429), and AT-027-A (5xx) are each independently specified with clear BDD scenarios and distinct fault injection techniques. The side-effect assertions in ATS-024-A1 (five side effects verified) are particularly strong.

---

### PRF-003-P7 — Deduplication requirement (REQ-013) is tested at both unit and acceptance levels

UTP-007-C covers the Redis `SISMEMBER`/`SADD` logic at the unit level. AT-013-A covers concurrent deduplication at the acceptance level with a realistic concurrency scenario (5 simultaneous clients). The two levels are complementary and non-redundant.

---

### PRF-003-P8 — Priority queue routing (REQ-014, REQ-015) has bidirectional acceptance coverage

AT-014-A verifies both routing directions (FoodRequested → High Priority, FoodBatchRequested → Low Priority). AT-015-A verifies processing order under mixed queue load. Together they fully cover the priority routing invariant.

---

### PRF-003-P9 — Mock registry discipline is consistent across all unit test cases

Every unit test case that has external dependencies includes a Dependency & Mock Registry table specifying the dependency source (ARCH-NNN), mock strategy, and rationale. Pure functions are explicitly noted as having no dependencies. This is a strong pattern that will make test implementation straightforward.

---

### PRF-003-P10 — Matrix C (Integration Verification) correctly identifies all 14 integration boundaries

Matrix C enumerates every cross-module boundary and explicitly notes that all integration tests are pending. The notes column provides actionable guidance for each integration test (e.g., "real Redis token bucket", "real USDA sandbox endpoint"). This is a complete integration test backlog.

---

### PRF-003-P11 — Non-functional performance requirements have quantified acceptance criteria

REQ-NF-011 (50ms p95 cache hit), REQ-NF-012 (≤1,000 USDA calls/hour), REQ-NF-013 (60s p95 backfill), REQ-NF-016 (zero data loss) are all quantified with measurable thresholds. The corresponding AT cases reference these thresholds explicitly.

---

### PRF-003-P12 — `REQ-IF-006` (API key security) is covered at unit, acceptance, and hazard levels

UTP-010-A through UTP-010-C verify Secrets Manager retrieval and in-memory caching. HAZ-001 identifies the exposure risk. The requirement correctly specifies Secrets Manager as the storage mechanism and prohibits logging or response inclusion. This is a complete security coverage chain.

---

## Resolution Priority

| Priority | Finding                                                                                | Action Owner               | Blocking                                           |
| -------- | -------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| P0       | PRF-003-A1 — `failed` state has no contract or coverage                                | Requirements author        | Yes — implementation will have undefined behaviour |
| P0       | PRF-003-A3 — `maxReceiveCount` contradiction between REQ-016 and UTP-003-B             | Requirements + test author | Yes — one document is wrong                        |
| P1       | PRF-003-A2 — REQ-020 atomicity not verifiable by unit test alone                       | Test author                | Yes — critical safety property unverified          |
| P1       | PRF-003-A4 — `stale` and `failed` states missing from status endpoint state machine    | Test author                | Yes — state machine is incomplete                  |
| P2       | PRF-003-A7 — AT-NF\* cases referenced in Matrix B but not confirmed in acceptance plan | Test author                | Before integration test cycle                      |
| P2       | PRF-003-A8 — Matrix D undercounts UTS-001-D5                                           | Trace author               | Before audit                                       |
| P2       | PRF-003-A9 — `FetchFailed` event undefined and untraced                                | Requirements author        | Before integration test cycle                      |
| P3       | PRF-003-A5 — Double-comma typos throughout requirements                                | Requirements author        | Before implementation                              |
| P3       | PRF-003-A6 — Sequential load test cannot produce valid p95                             | Test author                | Before performance testing                         |
| P3       | PRF-003-A10 — UI accessibility requirements have no verification path                  | Requirements author        | Before any UI work                                 |
| P3       | PRF-003-A11 — Rate-limit-exhausted branch under-tested                                 | Test author                | Before unit test implementation                    |
| P3       | PRF-003-A13 — Index coverage not independently verified                                | Test author                | Before schema migration                            |

---

## Addendum — Auth V&V slice pending review (2026-06-19)

The Clerk authentication/authorization slice (US-0, FR-035–FR-053) was added across the
v-model on 2026-06-19 to close sync-verify DRIFT-101 and the red-team findings
(`../red-team-findings-2026-06-19.md`): **REQ-IF-008, REQ-037..044 · SYS-013 · ARCH-012 ·
MOD-012/MOD-013 · UTP-012 · ITP-012 · STP-013 · ATP-008/ATS-036 · HAZ-036/HAZ-037**.

**These auth artifacts have NOT yet been peer-reviewed** — the review above (2026-05-09)
predates them. A `speckit.v-model.peer-review` pass over the auth slice, and a regeneration
of `release-audit-report.md` (its REQ-035 row still carries the old "shared API Gateway
authorizer" wording), are required before release readiness. Auth tests remain unexecuted.

The auth slice was subsequently peer-reviewed per-artifact (2026-06-20, see `peer-review-requirements.md`
and `peer-review-system-design.md`) and reconciled to the **in-process `FoodAuthGuard`** model. Its
canonical form is recorded in the stabilization section below; this slice must **not** be weakened or dropped.

---

## Stabilization reconciliation (decision register, 2026-06-28)

> The findings above target the **pre-reconciliation** design and are kept only as history. The stabilization
> **decision register** (`../decision-register.md`), with `../.stabilization/inputs/`, is the single canonical
> resolution; the per-artifact `peer-review-*.md` files carry the live findings. Map every superseded term in
> the body to the canonical model below.

**Canonical names (§1; D-EVENT / D-CLEANUP / D-AUTH).**

- Completion event = **`FoodFetchCompleted`** (EventBridge `DetailType`; publisher `publishFoodFetchCompleted`). `FoodRequested`/`FoodBatchRequested` are in-process enqueue markers, **not** EventBridge types; `IngestionScheduled`/`FetchFailed` keep their names.
- `food.status` lifecycle enum = **`PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`** — this **replaces** the `fetch_status` enum (`pending/fetched/failed/not_found/stale`) the findings below critique; "stale" is no longer a status (it is stale-while-revalidate on a `RESOLVED` record). `fetch_queue.status` = `pending | in_flight | tombstone`.
- USDA native id = **`external_key`**; the public/PK id is the internal **ULID `id`**. `fdcId`/`fdc_id` is **adapter-only** and must not appear on schema/DTO/API/DAO (so `GET /v1/foods/{fdcId}` and the `foods.fdc_id` index in the findings below are pre-reconciliation). Source = the **`food_source`** enum; errors use **`SourceApiError`** (not `UsdaApiError`).
- Read framing = **local-store read (RESOLVED) / local-store serve rate / add-by-name miss**; "cache hit/miss/hit-rate" (e.g. PRF-003-A7, P11) is reserved for the deferred Redis variant (ARCH-007) only.
- Auth = **`FoodAuthGuard`** (food service; networkless Clerk verify, fail-closed, scopes from `public_metadata`); the forgeable **`x-debug-sub`** / trusted-identity-header path is removed. The auth slice is unchanged in scope.

**Canonical schema (§2; D-CANDIDATES / D-LEASE / D-PROVENANCE-FK).** plan.md §2 = **13 tables** (the 12 there **plus `food_candidates`** — `id, food_id, source, external_key, name, summary, created_at`; `UNIQUE(food_id, source, external_key)`). `fetch_queue` gains **`leased_at timestamptz`** + a 30s reaper (single-drainer = FR-022 advisory lock). `food_sources` gains `UNIQUE(food_id, id)`; nutrients/portions/field-provenance/category-assignment use composite **`(food_id, source_id)` FKs**, `ON DELETE NO ACTION`. `source_call_log` is pruned beyond the trailing 60-min window. There are **no** SQS queues, no token-bucket state, and no `user_fetch_quota`/`global_fetch_quota` tables.

**Canonical behaviour (D-AUTORESOLVE / D-UNRESOLVED-TTL / D-LIFECYCLE / D-DEMAND / D-FAIRNESS / D-SC005).** Auto-resolve = 1 normalized-name survivor → `RESOLVED`, >1 → `UNRESOLVED` (persist to `food_candidates`), 0 → `NOT_FOUND` (no nutrient tolerance). `UNRESOLVED` is kept until a human picks; its candidate set expires in 30 days and re-fans-out. The 30-day TTL is `NOT_FOUND`-only; `FAILED→PENDING` is bounded-backoff retry. Demand = distinct-requester (`fetch_requesters` upsert, `request_count` = capped distinct-`sub` count, `PRIORITY_CAP=1`); one demand-weighted `fetch_queue` with drain-time demotion; no per-user quota and no `429` (near-ceiling flood-shed = `503`). SC-005 splits into read/serve throughput vs first-time NEW-food resolution rate (~500–900/hr, bounded by SC-002; new **SC-014**).

**Finding dispositions for this artifact.**

- **PRF-003-A1 / PRF-003-A4** (`fetch_status='failed'` / `'stale'` coverage) — **superseded**: the lifecycle is the `food.status` enum + the explicit legal transition set (D-LIFECYCLE); `FAILED→PENDING` retry and SWR-on-`RESOLVED` replace the old `failed`/`stale` framing.
- **PRF-003-A2** (atomic token bucket) — **superseded**: the limiter is the rolling-60-min atomic count+record over `source_call_log`, made safe by the single-drainer advisory lock (D-LEASE rationale).
- **PRF-003-A3** (SQS `maxReceiveCount` DLQ) — **superseded**: no SQS; Postgres-as-queue with the **`leased_at`** lease + reaper.
- **PRF-003-A9** (REQ-IF-005 EventBridge events) — canonical EventBridge `DetailType`s are **`IngestionScheduled`** and **`FoodFetchCompleted`**; `FoodRequested`/`FoodBatchRequested` are in-process markers; `FetchFailed` is retained.
- **PRF-003-A7 / PRF-003-P11 / PRF-003-A13** (cache-hit latency probe; `foods` `fdc_id` indexes) — re-frame to **local-store** reads; the `fdc_id` PK/index is replaced by the internal ULID `id` (+ `food_candidates`, composite provenance FKs). The remaining typographic/traceability findings (A5/A6/A8/A10/A11) are carried by the live per-artifact reviews.
