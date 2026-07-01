# Sync Report: 003-usda-food-data

## Run #4 | Date: 2026-06-28 | Phase: pre-implement (post source-agnostic stabilization)

**Verdict**: ✅ **CLEAN** — all prior drift is resolved or superseded; the artifact chain is reconciled to the source-agnostic stabilization baseline ([`decision-register.md`](./decision-register.md) + [`.stabilization/inputs/autoresolutions.md`](./.stabilization/inputs/autoresolutions.md)). This is a **design-baseline-only** pass — `.forge-status.yml` `implement` = `not-started`; Layers 5 (tasks ↔ code) and 6 (spec ↔ code) remain N/A (zero implementation code).

**What changed since Run #3.** `spec.md`, `plan.md`, `tasks.md`, and the 12 v-model artifacts were re-baselined to the source-agnostic / golden-record model and then stabilized; `research/`, `product-spec/`, and the report artifacts were reconciled to match. The canonical `D-*` decisions were applied verbatim across layers.

| Prior drift                                                                                                    | Status in Run #4                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D-001** (Run #1, L2): product-spec Redis sorted-set / `ZINCRBY` keyed by `fdcId` vs spec High/Low SQS queues | ✅ **Superseded** — both mechanisms are gone. Demand is **distinct-requester** in Postgres (`fetch_requesters` upsert + capped `request_count`, `PRIORITY_CAP=1`); a single demand-weighted `fetch_queue` with drain-time demotion replaces High/Low queues; no SQS, no Redis sorted set, no DLQ (tombstone rows). |
| **D-002 / DRIFT-102** (FR-036 collision): WebSocket vs Clerk verification                                      | ✅ **Resolved** — auth FR family is canonical; the stale WebSocket `FR-036` reference is gone.                                                                                                                                                                                                                     |
| **D-003** (Run #1, L4): phantom task ranges T-044–T-052                                                        | ✅ **Resolved** — `tasks.md` regenerated; ranges reconciled.                                                                                                                                                                                                                                                       |
| **DRIFT-101** (Run #2/#3): auth not propagated                                                                 | ✅ **Preserved & reaffirmed** — the US-0 / FR-035..053 Clerk slice remains fully traced. Stabilization keeps it intact: **`FoodAuthGuard`** (networkless Clerk verify, fail-closed, scopes from `public_metadata`); the forgeable **`x-debug-sub`** path is removed.                                               |

**Naming/terminology reconciliation now consistent cluster-wide (per the canonical glossary):**

- Completion event = **`FoodFetchCompleted`** / `publishFoodFetchCompleted` (matches plan §4 + the deployed CDK rule); `FoodDataReceived`/`FoodDataEvent` purged.
- Canonical model is **13 tables** including the added **`food_candidates`** (backs `UNRESOLVED` / **US-2a**, re-parented under US-2).
- Status enum **`PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`** (no `stale`); queue row status **`pending | in_flight | tombstone`** with the **`leased_at`** lease column + reaper.
- Rolling-window ledger is **`source_call_log`** (not `usda_call_log`); `source_sync_metadata` (not `usda_sync_metadata`); golden record keyed by ULID **`id`** with **`external_key`** (USDA's `fdcId` adapter-only).
- Throughput restated: **SC-005** = read/serve throughput (local reads, no source call); **SC-014** = first-time NEW-food resolution rate (~500–900/hr, source-budget-bounded). The flat "≥5,000 foods/hr" claim is retired.
- Notification keyword **`food.resolution.completed`** (not `food.backfill.completed`); cache-hit framing replaced by local-store-serve framing.

**Auth-naming clarification (forward-fix of the Run #3 shorthand).** Run #3's "FoodAuthGuard = NestJS AuthMiddleware" was shorthand; the canonical name in the **food service** is **`FoodAuthGuard`** (a NestJS guard). `AuthMiddleware` is the **identity service's** component and is not reused here.

**Remaining (not drift — readiness items):** stabilized artifacts are not yet peer-reviewed/approved (`review.md` Revision 3 awaiting confirmation); the one **Open-for-user** item (food-substitution FR, decision-register §6) stays warning-tracked.

> Runs #3, #2, and #1 preserved below for history.

---

## Run #3 | Date: 2026-06-19 | Phase: pre-implement (post auth re-plan + v-model regen)

**Verdict**: ✅ **RESOLVED** — DRIFT-101 (Run #2 CRITICAL) is closed.

The Clerk auth slice (US-0, FR-035–FR-053) now has full, traced coverage across every layer:

| Layer             | Auth coverage                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| spec.md           | ✅ 19/19 (FR-035–FR-053 + red-team hardening)                                                                                     |
| plan.md §2A       | ✅ 19/19 (FoodAuthGuard = NestJS AuthMiddleware on ECS/Fargate)                                                                   |
| tasks.md Phase 7  | ✅ 19/19 (T-033, T-046–T-056; 8 Test-first)                                                                                       |
| v-model V&V chain | ✅ 18/18 — REQ-IF-008/REQ-037..044 → SYS-013/ARCH-012 → MOD-012/013 → UTP-012/ITP-012/STP-013/ATP-008 → HAZ-036/037, fully traced |
| product-spec      | ✅ Epic 0 + US-0 (backward drift closed)                                                                                          |

**Remaining (not drift — readiness items):** the auth v-model artifacts are **not peer-reviewed**;
`release-audit-report.md` needs regeneration (its REQ-035 row still says "shared API Gateway
authorizer"); and the auth tests are **unexecuted**. Implement is gated on the peer-review pass.

DRIFT-102 (FR-036 collision) — resolved: the new FR-036 (Clerk verification) is consistently
referenced; the old WebSocket FR-036 reference is gone. DRIFT-103 (config `project_tech_stack`
Auth0→Clerk) and DRIFT-104 (`.forge-status.yml` `feature_mode: v-model` added for v3 schema) —
both resolved 2026-06-19. All sync-verify drift for 003 is now closed.

> Runs #2 and #1 preserved below for history.

---

## Run #2 | Date: 2026-06-18 | Phase: pre-implement (post Clerk-auth spec change)

**Trigger**: `spec.md` gained Clerk auth protection this session (US-0, FR-035 revised + FR-036–FR-042, SC-010, SC-011, `AuthenticatedCaller` entity). All downstream artifacts predate it.

**Layers Checked**: 1, 2, 3, 4, 7 (Layer 5/6 skipped — pre-implement)

| Severity | Count | Description                                                                           |
| -------- | ----- | ------------------------------------------------------------------------------------- |
| CRITICAL | 1     | Auth requirements not propagated to plan/tasks/v-model                                |
| WARNING  | 3     | Config tech-stack stale (Auth0); FR-036 number collision; status-file schema mismatch |
| INFO     | 1     | Pre-impl — zero implementation code                                                   |

**Verdict**: `MIXED` — 1 CRITICAL blocker for planning/implement.

### DRIFT-101 — Auth requirements not propagated downstream — ❌ CRITICAL

`spec.md` added US-0 (P1), FR-035 (revised) + **FR-036–FR-042**, SC-010, SC-011, and the `AuthenticatedCaller` entity on 2026-06-18. Reference counts in downstream artifacts:

| Artifact                                  | FR-036–042 | US-0 / AuthenticatedCaller | `azp`/`CLERK_JWT_KEY` |
| ----------------------------------------- | :--------: | :------------------------: | :-------------------: |
| product-spec/product-spec.md              |     0      |             0              |           0           |
| plan.md                                   |     0      |             0              |           0           |
| tasks.md                                  |     0      |             0              |    1 (incidental)     |
| v-model/requirements.md                   |     0      |             0              |           0           |
| v-model/system-design.md                  |     0      |             0              |           0           |
| v-model/architecture-design.md            |     0      |             0              |           0           |
| v-model/module-design.md                  |     0      |             0              |           0           |
| v-model/{unit,integration,system}-test.md |     0      |             0              |           0           |
| v-model/acceptance-plan.md                |     0      |             0              |           0           |
| v-model/traceability-matrix.md            |     0      |             0              |           0           |
| v-model/hazard-analysis.md                |     0      |             0              |           0           |

**Impact**: the v-model chain is marked `complete` + `audited` but gives **zero V&V coverage** for the auth surface — no requirement, design, test, traceability row, or hazard (e.g. auth-bypass / USDA-budget exhaustion via unauthenticated access) for FR-035–042. Planning or implementing from these artifacts would build the food API without the specified Clerk protection. `spec.md` is the source of truth; resolve forward (plan → tasks → v-model) and backward (product-spec lacks US-0 journey).

### DRIFT-102 — `FR-036` number collision — ⚠️ WARNING

Run #1 D-002 flagged plan.md referencing `FR-036` (then undefined, meant **WebSocket**). `spec.md` now defines **FR-036 = networkless Clerk verification**. plan.md's existing `FR-036` reference now points to a different requirement than intended — must be reconciled during re-plan.

### DRIFT-103 — Config tech-stack stale — ⚠️ WARNING

`.product-forge/config.yml` `project_tech_stack` still lists **Auth0**; project is on **Clerk**. Seeds wrong context into future generation.

### DRIFT-104 — Status-file schema mismatch — ⚠️ WARNING

`.forge-status.yml` is the legacy bootstrap shape (`mode: retroactive-bootstrap`, no `feature_mode`); Product Forge v1.7.0 expects v3 (`feature_mode: …`).

### Recommended resolution (Run #2)

1. **DRIFT-101 (CRITICAL):** red-team the auth spec first (qualifies: trust-boundary + contracts), then propagate via change-request or re-run plan → tasks → v-model for the auth slice. Block implement until FR-035–042 are traced through design + tests.
2. **DRIFT-102:** renumber/reconcile the WebSocket `FR-036` reference in plan.md against the new auth FR-036.
3. **DRIFT-103/104:** config Auth0 → Clerk; migrate status file to v3 (`feature_mode: v-model`).

> Run #1 (2026-06-02) findings preserved below for history.

---

**Run**: #1 | **Date**: 2026-06-02 | **Phase**: pre-implement
**Layers Checked**: 1, 2, 3, 4, 6, 7 | **Layers Skipped**: 5 (feature is pre-implement)

---

## Summary

| Severity | Count | Description                                             |
| -------- | ----- | ------------------------------------------------------- |
| CRITICAL | 0     |                                                         |
| WARNING  | 3     | Mechanism divergence, phantom task ranges, undefined FR |
| INFO     | 1     | Pre-impl state — zero implementation code               |
| CLEAN    | 3     | Layers 1, 6 (downgraded), 7                             |

**Verdict**: `WARNING` — 3 forward-drift items detected. All are resolvable artifact edits; no blockers for implementation.

---

## Per-Layer Results

### Layer 1 — research/ ↔ product-spec/

**Status**: `CLEAN`

- Research conclusions (USDA-only, no third-party APIs, event-driven queue architecture) align with product-spec vision and core principles.
- No incorrect `apps/web/` or `apps/mobile/` paths found in feature specs (research/codebase-analysis.md correctly uses `packages/apps/commise/{web,mobile}`).

### Layer 2 — product-spec/ ↔ spec.md

**Status**: `WARNING`

- US-005 mechanism in product-spec.md describes a **Redis sorted set** keyed by `fdcId` with score = duplicate-request count (`ZINCRBY`).
- spec.md US-5 describes static **High/Low SQS priority queues** (FR-014–FR-018) with no mention of the demand-weighted Redis sorted set.
- This is a forward drift: product-spec introduces a mechanism not reflected in the technical spec.

### Layer 3 — spec.md ↔ plan.md

**Status**: `WARNING`

- plan.md Open Questions references **FR-036** ("Required for P3 (FR-036), deferred or in-scope for initial release?").
- spec.md defines FR-001 through FR-035 only; FR-036 is undefined.

### Layer 4 — plan.md ↔ tasks.md

**Status**: `WARNING`

- tasks.md Dependency Graph declares task ranges **T-044–T-048** (Monitoring) and **T-049–T-052** (WebSocket).
- Actual task headings in tasks.md are T-001 through T-043 only; T-044–T-052 do not exist.
- Summary table says "Total tasks: 43" (consistent with T-001–T-043) but still lists the phantom ranges.

### Layer 5 — tasks.md ↔ Code

**Status**: `SKIPPED` — feature is pre-implement (zero completed tasks).

### Layer 6 — spec.md ↔ Code

**Status**: `INFO` (downgraded from CRITICAL per pre-impl directive)

- No implementation code exists for any FR or task. Expected pre-impl state.

### Layer 7 — Cross-link integrity

**Status**: `CLEAN`

- All markdown cross-links verified:
    - `../001-commise-recipe-app/spec.md` → exists
    - `../002-user-auth/spec.md` → exists
    - `../006-meal-planning/spec.md` → exists
    - `../007-grocery-lists/spec.md` → exists
    - `../009-nutrition-planning/spec.md` → exists
    - `../../docs/architecture/usda/05-event-driven-queue-based.md` → exists
- No broken internal or external links detected.

---

## Drift Details

| ID    | Layer | Severity | Source                    | Target                 | Evidence                                                                                                                                                                                                                                                                                          |
| ----- | ----- | -------- | ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001 | L2    | WARNING  | product-spec.md US-005    | spec.md US-5           | product-spec: "consumer maintains a Redis sorted set keyed by fdcId with score = duplicate-request count (ZINCRBY)"; spec.md: "FR-014: EventBridge MUST route FoodRequested events to the High Priority SQS queue and FoodBatchRequested/IngestionScheduled events to the Low Priority SQS queue" |
| D-002 | L3    | WARNING  | plan.md §9 Open Questions | spec.md FR definitions | plan.md line 294: "WebSocket notifications: Required for P3 (FR-036), deferred or in-scope for initial release?" — FR-036 is absent from spec.md (FR-001–FR-035 defined)                                                                                                                          |
| D-003 | L4    | WARNING  | tasks.md Dependency Graph | tasks.md headings      | Graph shows "MONITORING (T-044–T-048)" and "WEBSOCKET (T-049–T-052)"; grep of `^### T-` confirms only 43 headings (T-001–T-043), so T-044–T-052 are phantom                                                                                                                                       |
| D-004 | L6    | INFO     | spec.md                   | Codebase               | No `usda`, `foods`, or `fdcId` implementation found in `packages/` or `src/` — expected pre-impl state                                                                                                                                                                                            |

---

## Sync History

| Run | Date       | Verdict | Critical | Warning | Info | Clean |
| --- | ---------- | ------- | -------- | ------- | ---- | ----- |
| #1  | 2026-06-02 | WARNING | 0        | 3       | 1    | 3     |

---

## Recommendations

1. **D-001**: Add the Redis sorted set demand-weighted priority mechanism to spec.md US-5 (or remove from product-spec if static queues are the intended design).
2. **D-002**: Define FR-036 in spec.md (auth scope for WebSocket) or remove the reference from plan.md Open Questions.
3. **D-003**: Reconcile tasks.md dependency graph: either add tasks T-044–T-052 or update the graph to match actual T-001–T-043 range.
