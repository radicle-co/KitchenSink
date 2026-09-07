# Sync & Verify Report: Notification Service

> Feature: `014-notification-service` | Date: 2026-08-05
> Layers checked: 5/5 applicable | Skipped: L5, L6, L9, L10 (no implementation code), L8 (no `contracts/`)
> Phase: revalidation `pending` · feature_mode `v-model` · gate risk `high` (routing: block)
> Mode: full scan, READ-ONLY. No artifact modified by this run.

## Summary

| Severity    | Found | Resolved 2026-08-05 | Remaining |
| ----------- | ----- | ------------------- | --------- |
| ❌ CRITICAL | 5     | 5                   | 0         |
| ⚠️ WARNING  | 8     | 8                   | 0         |
| ℹ️ INFO     | 1     | 1                   | 0         |
| ✅ CLEAN    | 1 layer with no drift (L7) | | |

**Verdict at scan time:** ❌ **CRITICAL DRIFT** — structural drift count (14) exceeded
`sync_verify.drift_budget.structural` (default `0`). No item was cosmetic, so none was
auto-resolvable (`sync_verify.auto_resolve.cosmetic` unset → `false`); every fix below
was applied under explicit owner approval.

**Verdict after resolution:** ✅ **RESOLVED — pending revalidation.** All 14 items were
applied as an approved batch on 2026-08-05. Two of them required owner decisions rather
than edits, both recorded:

| Decision                     | Outcome                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Q-002** group membership   | The **identity service** owns groups and 014 builds them (`group` + `group_membership` in `packages/services/identity`, `/api/v1/groups/*`). Explicitly **not** Clerk Organizations. |
| **FR-008** ordering authority | **SQS FIFO**, `MessageGroupId = recipient.id`. The routing consumer assigns a monotonic per-recipient `sequence` at dequeue; live push and replay both read it, so they cannot disagree. |

Both decisions **expanded** scope. Consequences recorded rather than absorbed silently:
`tasks.md` grew from 20 to 33 tasks, and the `v-model/` chain now predates a third of
the delivered scope and must be regenerated before `T-020` (see `review.md` →
Outstanding).

### Why this run disagrees with the previous one

The prior run (#1, 2026-06-02) reported **0 CRITICAL / 0 WARNING** and marked L2
PASSED. Every CRITICAL below was already true on that date. That report is also
internally inconsistent: `sync-report.md` recorded `WARNING 0` while
`sync-report.json` recorded `"warning": 1` for the same run. Treat run #1 as
unreliable rather than as evidence the feature regressed since June.

## Layer Results

### Layer 1: research/ ↔ product-spec/ — ⚠️ 1 finding

`research/codebase-analysis.md` is a 2026-05-10 snapshot that the repository has
since invalidated (DRIFT-007). Forward check otherwise clean: the 003 backfill
requirement and the Q-008 ordering resolution are both reflected in the product spec.

### Layer 2: product-spec/ ↔ spec.md — ❌ 1 critical, ⚠️ 1 warning

Story identity does not survive the bridge (DRIFT-001); one spec story has no
product-spec origin (DRIFT-006). Content coverage is otherwise complete — every
product-spec Must Have has a spec.md counterpart, only under a different number.

### Layer 3: spec.md ↔ plan.md — ❌ 2 critical, ⚠️ 2 warnings

The plan does not cover the feature's hardest guarantee (ordering, DRIFT-002),
never makes the decision spec.md explicitly delegates to it (group membership,
DRIFT-003), sets no budget for two NFRs (DRIFT-010), and has no data model
despite requiring durable retention (DRIFT-012).

### Layer 4: plan.md ↔ tasks.md — ❌ 1 critical, ⚠️ 1 warning

Two of the six producers the plan names as mandatory for M8 have no task at all
(DRIFT-004); three further plan commitments have no task (DRIFT-008).
Backward check clean — no orphan tasks; every task cites an FR or US.

### Layer 5: tasks.md ↔ Code — ⏭ SKIPPED

0 of 20 tasks are checked and no implementation exists. Nothing to reconcile.

### Layer 6: spec.md ↔ Code — ⏭ SKIPPED

No implementation exists.

### Layer 7: Cross-link Integrity — ✅ CLEAN

34 markdown files scanned, every relative link target resolves, 0 broken links.

### Layer 8: FE ↔ BE Contract Drift — ⏭ SKIPPED

No `contracts/openapi.yaml` or `contracts/asyncapi.yaml` in the feature directory.
`sync_verify.contract_differ` is unset (`none`), so the executable `oasdiff` path
would not have run regardless.

### Layer 9: Doc ↔ Code Reconciliation — ⏭ SKIPPED

No implementation code and no `traceability.yml`.

### Layer 10: Constitution ↔ Code — ⏭ SKIPPED

`.specify/memory/constitution.md` v1.3.0 is present, but there is no code to check
it against. Noted for the release gate: the constitution's **Release Readiness Gate
(Non-Negotiable)** requires all Test Case IDs mapped, all scenarios executed or
waived, and `waivers.md` present. Mapping ✅ (31/31 REQ rows) and `waivers.md` ✅
(no waivers) already hold; **execution is the sole outstanding condition** (186/186
scenarios untested).

## All Drift Items

### DRIFT-001: `US-NNN` ids denote different stories in product-spec and spec.md

| Field                | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| **Layer**            | 2: product-spec/ ↔ spec.md                                                  |
| **Direction**        | Forward                                                                     |
| **Severity**         | CRITICAL                                                                    |
| **Category**         | structural                                                                  |
| **Source artifact**  | `product-spec/product-spec.md` (MoSCoW Story Map)                           |
| **Target artifact**  | `spec.md` (User Scenarios)                                                  |

**Evidence** — `spec.md` merged product-spec `US-001` (publish) and `US-002`
(single-user routing) into a single `US-001`, shifting every subsequent id by one:

| product-spec              | spec.md / tasks.md / v-model |
| ------------------------- | ---------------------------- |
| US-001 publish            | US-001 (merged)              |
| US-002 single-user route  | US-001 (merged)              |
| US-003 group routing      | **US-002**                   |
| US-004 global routing     | **US-003**                   |
| US-005 client dispatch    | **US-004**                   |
| US-006 catch-up           | **US-005**                   |
| US-007 counters           | **US-006**                   |
| US-008 authenticated sub  | **US-007**                   |
| US-009 schema validation  | **US-008**                   |
| —                         | **US-009** registry (new, see DRIFT-006) |
| US-010 idempotency        | US-010                       |
| US-011 quotas             | US-011                       |

**Expected:** one stable meaning per `US-NNN` across artifacts (`docs/schema.md` §8:
"IDs are stable across artifacts").
**Actual:** `US-003` means "Group recipient routing" in product-spec and
"Global Broadcast" in spec.md.

**Consequential defect:** `plan.md` claims *"Must Have stories addressed: US-001 …
US-007."* Under product-spec numbering that set ends at "Operational counters"
(all Must Have). Under spec.md numbering `US-007` is "Authenticated Subscription",
a **P2/Should Have**. The plan's own scope statement resolves differently depending
on which artifact the reader trusts.

**Proposed resolution:** Renumber the `product-spec/product-spec.md` story map to
match `spec.md`, and add an explicit mapping table to that file recording the merge
of old US-001+US-002. `spec.md` is the correct anchor: `tasks.md` and all 31
`REQ-NNN` rows in `v-model/` already key off it. Then restate `plan.md`'s Must Have
line as `US-001..US-006` (spec.md numbering).

**Auto-resolvable:** false

---

### DRIFT-002: FR-008 / FR-009 (per-recipient FIFO ordering) have zero plan coverage

| Field               | Value                        |
| ------------------- | ---------------------------- |
| **Layer**           | 3: spec.md ↔ plan.md         |
| **Direction**       | Forward                      |
| **Severity**        | CRITICAL                     |
| **Category**        | structural                   |
| **Source artifact** | `spec.md` FR-008, FR-009, Clarifications §2026-05-10 |
| **Target artifact** | `plan.md`                    |

**Evidence** — `spec.md` FR-008: *"The system MUST guarantee per-recipient FIFO
ordering for `recipient.kind ∈ { user, group }`."* Product-spec Q-008 (resolved,
research-backed) further states: *"the transport must support a
partition-key-per-recipient model (e.g., SQS FIFO `MessageGroupId = recipient.id`,
Kafka partition by recipient, or per-recipient WebSocket channel with monotonic
sequence)."*

`plan.md` contains **zero** occurrences of `FIFO`, `ordering`, `partition`, or
`MessageGroupId`.

**Expected:** an ordering/partitioning section in `plan.md` naming the mechanism
and showing FIFO survives the ingest-queue → realtime-push → replay boundary.
**Actual:** missing. The plan selects a three-path hybrid architecture without
addressing how a total per-recipient order is preserved across paths.

**Why CRITICAL:** this is the feature's hardest correctness property and the one a
hybrid architecture most easily breaks — a message delivered live and the same
message replayed from the store are two independent paths with no stated sequencing
authority. `SC-002` gates launch on zero out-of-order deliveries across 10 runs.

**Proposed resolution:** Add "Ordering & Partitioning" to `plan.md`: the partition
key, the sequence-number authority, and the rule that reconciles live delivery
against replay. Then add an implementing task before `T-009`.

**Auto-resolvable:** false

---

### DRIFT-003: spec.md delegates the group-membership lookup to plan.md; plan.md never defines it, and tasks.md closes the question by fiat

| Field               | Value                                      |
| ------------------- | ------------------------------------------ |
| **Layer**           | 3: spec.md ↔ plan.md (with a Layer-4 consequence) |
| **Direction**       | Forward                                    |
| **Severity**        | CRITICAL                                   |
| **Category**        | structural                                 |
| **Source artifact** | `spec.md` A-002; `product-spec.md` Q-002   |
| **Target artifact** | `plan.md`, `tasks.md` T-005                |

**Evidence**

- `spec.md` A-002: *"Group membership source-of-truth is **not** owned by this
  feature … until then, group routing relies on **a placeholder lookup defined in
  `plan.md`**."*
- `plan.md`: **zero** occurrences of "group membership", "placeholder", or "Q-002".
  The placeholder it is required to define does not exist.
- `product-spec.md` Q-002 remains **open**: *"Decision needed before US-003 can be
  implemented."* `review.md` still lists it as open question #1.
- `tasks.md` T-005 nevertheless states: *"expand group members at delivery time
  **via 002 group membership API**"* — asserting an interface that feature 002 does
  not specify and that the shipped identity service does not expose.

**Expected:** `plan.md` resolves Q-002 (consume from 002 / own a membership store /
require producer-side expansion) and defines the placeholder.
**Actual:** the decision is absent from the plan and silently made in the task
graph — the lowest-visibility artifact — against a non-existent API.

**Blast radius:** US-002 / FR-006 / FR-022 / REQ-006 and scenarios `SCN-006-*` are
unimplementable as written. Note that `research/codebase-analysis.md` already flagged
this: *"Group membership semantics are not yet specced in 002."*

**Proposed resolution:** Decide Q-002 at the revalidation gate. Record it in
`plan.md`, then rewrite T-005 to match. If option (c) producer-side expansion is
chosen, `recipient.kind = "group"` may be deferrable out of the launch cut — which
would materially shrink this feature.

**Auto-resolvable:** false

---

### DRIFT-004: Plan's mandatory M8 producer set includes 012 and 013; the task graph covers neither

| Field               | Value                                     |
| ------------------- | ----------------------------------------- |
| **Layer**           | 4: plan.md ↔ tasks.md                     |
| **Direction**       | Forward                                   |
| **Severity**        | CRITICAL                                  |
| **Category**        | structural                                |
| **Source artifact** | `plan.md` "M8 required integration subset" |
| **Target artifact** | `tasks.md`                                |

**Evidence** — `plan.md`: *"Minimum must-wire in M8 execution backlog: `003`, `005`,
`008`, `009`, `012`, `013`."* `tasks.md` provides `T-017` (003) and `T-018`
(005 / 008 / 009). No task references 012 or 013.

**Expected:** ≥1 integration task per mandatory producer.
**Actual:** 4 of 6 covered; 012 (creator-profile moderation notices) and 013
(cooking-school publish/enroll milestones) have no task.

**Escalated by the 2026-08-05 scope decision:** the owner elected to keep full M8
scope, so this is a live gap rather than an accepted deferral.

**Proposed resolution:** Add integration tasks for 012 and 013 mirroring T-018.
Record in `plan.md` that both remain blocked on those features existing in code —
neither is implemented today (see the pre-flight note under "Standing risk").

**Auto-resolvable:** false

---

### DRIFT-005: `verify-report.md` measures a task graph that does not exist, and one of its findings is already stale

| Field               | Value                                  |
| ------------------- | -------------------------------------- |
| **Layer**           | Supplementary (verify-report ↔ tasks.md / v-model) |
| **Direction**       | Backward                               |
| **Severity**        | CRITICAL                               |
| **Category**        | structural                             |
| **Source artifact** | `verify-report.md` (2026-05-12)        |
| **Target artifact** | `tasks.md`, `v-model/traceability-matrix.md` |

**Evidence**

- `verify-report.md` reports `CODE_TASKS_COVERAGE = 0/66`, then `0/53`, over ids
  *"`T001`–`T066` … 53 defined entries"*, and cites *"Phase 7, `T057`–`T066`"*,
  *"`T001`–`T009`"*, `T057`, `T058`, `T059`, `T062`, `T063`.
- `tasks.md` defines **20** tasks, ids `T-001`…`T-020`. There is no `T057`, no
  Phase 7, and no task numbered above `T-020`.
- `verify-report.md` W-003 claims *"Matrix A rows show `❌ MISSING`"* in
  `v-model/traceability-matrix.md`. That file now contains **0** occurrences of
  `MISSING`; all 31 `REQ-NNN` rows carry a mapped `ATP`/`SCN` reference.

**Expected:** the M8 exit gate measures this feature's actual artifacts.
**Actual:** two of its three CRITICAL/WARNING findings reference tasks that do not
exist, and its metrics table is fiction.

**Note:** its C-001 (release audit blocked, 186/186 scenarios untested) **is**
accurate and remains the true blocker.

**Proposed resolution:** Do not repair `verify-report.md` in place — it is
regenerated by Phase 7. Mark it superseded now so no one treats it as current, and
regenerate after implementation. `phases.verify.status` was already set to `pending`
with this recorded during the 2026-08-05 status migration.

**Auto-resolvable:** false

---

### DRIFT-006: spec.md US-009 (`messageType` registry enforcement) has no product-spec story

| Field | Value |
| ----- | ----- |
| **Layer** | 2: product-spec/ ↔ spec.md (backward check) |
| **Severity** | WARNING · **Category** structural |
| **Source** | `spec.md` US-009 | **Target** | `product-spec.md` MoSCoW map |

**Evidence:** `spec.md` carries US-009 "`messageType` Registry Enforcement" (P2)
with three acceptance scenarios, and `plan.md`/`tasks.md` (T-014)/`v-model`
(REQ-016, REQ-017) all implement it. The product-spec story map goes US-009 "schema
validation" → US-010 "dedup key" with no registry story. The capability entered via
the Q-005 resolution, which was recorded as an open-question answer but never
promoted into the story map.

**Proposed resolution:** Add the registry story to the product-spec Should Have tier
(it is a real, deliberate scope decision, not creep) — folded into the DRIFT-001
renumbering pass.

**Auto-resolvable:** false

---

### DRIFT-007: `research/codebase-analysis.md` is materially false against today's repository

| Field | Value |
| ----- | ----- |
| **Layer** | 1: research/ ↔ product-spec/ |
| **Severity** | WARNING · **Category** structural |
| **Source** | `research/codebase-analysis.md` (2026-05-10 snapshot) | **Target** | working tree |

**Evidence — three claims that no longer hold:**

1. *"no folders exist yet for any of the cited references"* — `packages/services/`
   now holds `recipe-service`, `food-service`, `recipe-workers`, `identity`,
   `identity-webhooks`; `packages/shared/` holds `recipe-core`, `identity-core`,
   `identity-db`, `clerk-verify`.
2. *"No existing in-app notification UI primitive on the client"* — **false.** Both
   clients already ship a notifications control in the home chrome:
   `packages/apps/commise/web/src/components/home/chrome/HomeTopBar.tsx:114` and the
   mobile counterpart, labelled from `i18n/messages.ts` (`chrome.notifications`).
   It is a deliberately inert button; the source comment at `:112` reads *"No count
   badge — there is no notifications service in v1, and a fabricated number is
   exactly what this surface refuses to show."*
3. *"003 uses SQS for its own backfill queue; that is not a notification bus"* —
   still accurate, retained.

**Impact:** finding (2) is the important one. A shipped, user-visible affordance is
waiting on this exact feature, and **no artifact in 014 mentions it** — not the
product spec's in-app-surface epic, not `spec.md`, not `plan.md`, and no task wires
the bell to a feed or a count. 014 currently plans a transport with no client
attachment point, while the client attachment point already exists in both apps.

**Proposed resolution:** Refresh the snapshot, and add the bell as a named
integration surface in `product-spec.md` Epic 4 ("In-app surface"), with tasks in
both web and mobile. Per the repo's cross-platform rule, both ship in the same release.

**Auto-resolvable:** false

---

### DRIFT-008: three plan commitments have no corresponding task

| Field | Value |
| ----- | ----- |
| **Layer** | 4: plan.md ↔ tasks.md | **Severity** | WARNING · **Category** structural |

**Evidence** — `plan.md` commitments with zero task coverage in `tasks.md`:

1. *"Counter-based canary checks: publish volume, delivery success,
   undelivered-after-retention, active subscribers"* (Rollout controls) — `T-011`
   creates the counters but nothing consumes them as a canary gate.
2. *"GR-011 ownership proven by removal of producer-local delivery implementations
   in integrated features"* (Exit Evidence) — no task removes anything from any
   producer.
3. *"Progressive enablement by feature behind environment flags"* (Rollout Phase C)
   — no task creates the flags.

**Proposed resolution:** Add three tasks, or downgrade the plan statements to
non-binding intent. Item 2 is load-bearing for the GR-011 governance claim.

**Auto-resolvable:** false

---

### DRIFT-009: `review.md`'s GR-007 conformance evidence is false

| Field | Value |
| ----- | ----- |
| **Layer** | Supplementary (review.md ↔ tasks.md) | **Severity** | WARNING · **Category** structural |

**Evidence** — `review.md` Governance Conformance table, GR-007 row, Evidence
column: *"Tasks explicitly require `@kitchensink/recipe-core`; duplicate local types
prohibited."* `tasks.md` contains **0** occurrences of `recipe-core`. `T-002`
instead creates a new package `@kitchensink/notification-types`.

**Assessment:** the *package choice* is defensible — notification envelopes are not
recipe-core domain entities, and `@kitchensink/notification-types` satisfies NFR-008's
`@kitchensink/{group}-{name}` convention. The defect is the **evidence claim**: a
governance table asserting a conformance mechanism that no artifact implements.
A reviewer trusting this row would believe GR-007 is enforced when nothing enforces it.

**Proposed resolution:** Correct the row to state how GR-007 is actually satisfied
(no recipe-core entity is duplicated; notification types are a new bounded
namespace), or add the recipe-core constraint to `T-002` if any shared entity is in
fact reused.

**Auto-resolvable:** false

---

### DRIFT-010: NFR-001 and NFR-003 have no plan coverage

| Field | Value |
| ----- | ----- |
| **Layer** | 3: spec.md ↔ plan.md | **Severity** | WARNING · **Category** structural |

**Evidence** — NFR-001 (≥99.9% publish-API availability) and NFR-003 (p95
publish→delivery ≤2s under nominal load) have no corresponding budget, measurement
point, or mechanism in `plan.md`. The plan asserts the realtime path is *"aligned
with timer-alert latency constraints from 008 references"* without stating a number.
NFR-002/004/005/006/007/008 are covered.

**Proposed resolution:** Add an NFR budget table to `plan.md` naming the measurement
point for each (the 2s budget must state whether it is measured publish-accept →
client-receive, and what "nominal load" is). `SC-004` and the k6 tier depend on it.

**Auto-resolvable:** false

---

### DRIFT-011: the previous sync run's two output files disagree with each other

| Field | Value |
| ----- | ----- |
| **Layer** | Supplementary | **Severity** | INFO · **Category** structural |

**Evidence** — run #1 (2026-06-02): `sync-report.md` summary table records
`WARNING 0`; `sync-report.json` `summary` records `"warning": 1`. Both record
`critical: 0` while DRIFT-001 through DRIFT-005 were already present in the
artifacts on that date. `sync-report.json` also lists `layers_run: [L1,L2,L3,L4,L7]`
while the markdown header says *"L1–L4, L6–L7"*.

**Proposed resolution:** Both files are overwritten by this run; no repair needed.
Recorded so the history table is not read as a regression from clean to critical.

**Auto-resolvable:** false

---

### DRIFT-012: durable retention is required and specified down to the ORM, but no data model exists

| Field | Value |
| ----- | ----- |
| **Layer** | 3: spec.md ↔ plan.md | **Severity** | WARNING · **Category** structural |

**Evidence** — `spec.md` FR-012 requires retention *"≥ 24 hours"*; `tasks.md` T-009
specifies *"durable message store with per-recipient FIFO ordering and 24h retention
(**Drizzle ORM + PostgreSQL**)"*. `plan.md` has **no Data Model section** — no
tables, no keys, no retention/eviction strategy, no index for the replay query.

**Secondary effect:** the Phase 5.5 migration-plan trigger is *"plan.md contains a
non-empty Data Model section"*. Because the section is absent, migration-plan
auto-classifies as `not_applicable` — so the phase designed to catch exactly this
gap is switched off **by** the gap. Recorded as a comment on
`phases.migration_plan` in `.forge-status.yml`.

**Proposed resolution:** Add a Data Model section to `plan.md` (message table,
per-recipient sequence, retention/eviction, replay index). That re-triggers Phase 5.5
naturally, and it is where DRIFT-002's sequence authority should be pinned.

**Auto-resolvable:** false

---

### DRIFT-013: `user-journey.md` Journey C promises offline retrieval of global broadcasts; `spec.md` excludes it

| Field | Value |
| ----- | ----- |
| **Layer** | 1/2: product-spec/ ↔ spec.md | **Severity** | WARNING · **Category** structural |

**Evidence** — `user-journey.md` Journey C step 4: *"Connected clients receive the
message; **disconnected clients retrieve it later if still relevant**."* But `spec.md`
FR-012 scopes retention to *"messages addressed to `user` and `group` recipients"*,
and its edge case is explicit: *"broadcasts published while a client is offline beyond
the retention window are **dropped** for that client."*

**Why it matters:** the journey describes an operational maintenance/incident
broadcast. If offline clients silently never receive it, that is a defensible
engineering choice but a significant product one — and it is currently *promised* in
one artifact and *denied* in another.

**Proposed resolution:** Opened as product-spec **Q-009** for the revalidation gate.
The story map now follows `spec.md` (live-only). Correct Journey C once confirmed.

**Auto-resolvable:** false

---

### DRIFT-014: feature `README.md` states the core artifacts do not exist

| Field | Value |
| ----- | ----- |
| **Layer** | 7-adjacent (intra-feature documentation) | **Severity** | WARNING · **Category** structural |

**Evidence** — `README.md` → Status: *"It does **not** yet contain: `spec.md` … `plan.md`
… `tasks.md` … `v-model/` artifacts."* All four have existed since the 007–014
reconciliation commit. The section describes the folder as *"Bootstrap only."*

**Impact:** the feature's front door tells a reader the planning chain is absent when
it is complete — the first thing anyone opening 014 reads is false.

**Proposed resolution:** Rewrite the Status section against the actual contents.

**Auto-resolvable:** false

## Proposed Actions

Ordered by dependency — later items assume earlier decisions:

1. **DRIFT-003** — decide Q-002 (group membership source of truth). Gates US-002 /
   FR-006 / REQ-006 and may shrink the launch cut. *Decision, not an edit.*
2. **DRIFT-002 + DRIFT-012** — add "Ordering & Partitioning" and "Data Model" to
   `plan.md`. Same decision surface: the per-recipient sequence authority.
3. **DRIFT-001 + DRIFT-006** — renumber the product-spec story map onto spec.md ids,
   add the merge-mapping table, add the registry story.
4. **DRIFT-007** — refresh the codebase snapshot; add the shipped notification bell
   (web + mobile) as a named integration surface with tasks.
5. **DRIFT-004 + DRIFT-008** — add tasks for producers 012 / 013, canary checks,
   feature flags, and producer-local delivery removal.
6. **DRIFT-010** — add the NFR budget table to `plan.md`.
7. **DRIFT-009** — correct the GR-007 evidence row in `review.md`.
8. **DRIFT-005 + DRIFT-011** — mark `verify-report.md` superseded; regenerate at
   Phase 7. No in-place repair.

## Standing risk (not drift — recorded for the gate)

Of the six producers `plan.md` makes mandatory for M8, only **003** exists in code
(`packages/services/food-service`). Features 005, 008, 009, 012, and 013 are
specification-only. `T-018` and the DRIFT-004 tasks therefore cannot complete until
those features ship, independent of any work on 014. The owner accepted this on
2026-08-05 by electing to keep full M8 scope.

## Sync History

| Run  | Date       | Layers | CRITICAL | WARNING | Verdict         |
| ---- | ---------- | ------ | -------- | ------- | --------------- |
| #1   | 2026-06-02 | 5/10   | 0        | 0 / 1 * | CONSISTENT      |
| #2   | 2026-08-05 | 5/10   | 5        | 6       | CRITICAL DRIFT  |

\* run #1's markdown and JSON disagree (DRIFT-011). Its verdict does not reflect the
artifacts as they stood; see "Why this run disagrees with the previous one".
