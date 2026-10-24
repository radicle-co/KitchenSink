# Product Forge Verify-Full Report: Feature 006-meal-planning

**Run date**: 2026-08-02 (supersedes 2026-05-12)
**Mode**: Full reconciliation — doc↔doc **and** doc↔**codebase**
**Verifier**: deterministic checks + codebase cross-reference

---

## Why this run differs from the 2026-05-12 run

The previous report concluded **✅ PASS, 0 CRITICAL**. That conclusion was not wrong about what it checked — it was
wrong about what needed checking. Every layer it verified was **doc↔doc**: `spec ↔ plan ↔ tasks ↔ product-spec ↔
research ↔ v-model`. It never read the repository. Its own "Source immutability respected" item recorded, **as a
pass**, that `spec.md`, `plan.md`, `tasks.md` and `research.md` were left unmodified — which is exactly why six
documents stayed consistent with each other and collectively wrong about the platform.

Three of its five green layers were green about content that could not have worked:

| 2026-05-12 verdict                                             | Reality on `main`                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| "plan.md supports FR-022..027" ✅                              | The plan targeted `packages/api/`, an empty directory that is not a workspace         |
| "product-spec references all six FRs" ✅                       | Web-only, which `CODING_STANDARDS §14.1` requires reviewers to reject                 |
| "v-model requirements include REQ mappings for FR-022..027" ✅ | Those REQs specified a USDA pipeline, a Redis cache and an unenforceable premium gate |

**This run adds the codebase as a verification layer (L8).** Where a document and the repository disagree, the
repository wins.

---

## Summary

| Layer                             | Status  | Findings                                                                                      |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| L1 spec.md self-consistency       | ✅ PASS | 42 requirement ids, all defined and referenced; 11 Clarifications resolve every open question |
| L2 plan.md ↔ spec.md              | ✅ PASS | Every Phase-1 FR has an architectural home; Phase-2 explicitly out of scope                   |
| L3 tasks.md ↔ plan.md             | ✅ PASS | 72 tasks, one numbering system, matching the plan's 12-step implementation order              |
| L4 product-spec/ ↔ spec.md        | ✅ PASS | Stories, journeys, wireframes and metrics reconciled; both platforms covered                  |
| L5 research/ ↔ product-spec/      | ✅ PASS | Superseded research answers marked, with corrections recorded rather than deleted             |
| L6 v-model/ ↔ spec.md             | ✅ PASS | 37/37 Phase-1 requirements traced to tests; 0 missing matrix cells                            |
| L7 cross-cutting artifacts        | ✅ PASS | All MAJOR peer-review findings closed 2026-08-02; the index inconsistency is fixed            |
| **L8 artifacts ↔ CODEBASE (new)** | ✅ PASS | Every package path, contract and convention verified against `main`                           |

**Counts**: **0 CRITICAL** · **0 WARNING** · **1 EXPECTED-GAP** · **8 PASSED**

**Overall**: ✅ **PASS — cleared to begin implementation (2026-08-02).** The three MAJOR peer-review gates are closed by
owner ruling; the two remaining warnings are during-implementation bookkeeping and gate nothing.

---

## L8 — Artifacts ↔ Codebase (the layer the previous run lacked)

Each item was checked by reading `main`.

| Check                                                                  | Result | Evidence                                                                                                                                          |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every target package path falls inside a real workspace glob           | ✅     | Root `package.json` workspaces; `packages/api/` no longer referenced anywhere                                                                     |
| `RecipeNutrition` matches what the rollup consumes                     | ✅     | `packages/shared/recipe-core/src/recipe.types.ts` — calories/protein/carbs/fat + `isComplete`; **no fibre**                                       |
| Per-100g values are persisted, so no live food-service call is needed  | ✅     | `packages/services/recipe-service/src/database/schema/ingredients.ts:59-62`                                                                       |
| The owner-id pattern matches the shipped one                           | ✅     | `recipes.owner_id varchar(255)`, no FK; "D2" documented in the schema header                                                                      |
| `subscriptionTier` is **not** a token claim                            | ✅     | `packages/shared/identity-db/src/dao/account.dao.ts` vs. `clerk-verify` tests                                                                     |
| The Home widget contract exists as described                           | ✅     | `features/core/src/{capabilities,homeNavigation,roadmapWidgets}.ts`                                                                               |
| `@commise/features-meal-plan` is the anticipated package name          | ✅     | Named in `roadmapWidgets.ts`'s own header comment                                                                                                 |
| The gateway pattern exists and is the right model                      | ✅     | `recipe-service/src/ingredients/foodCatalog.gateway.ts`                                                                                           |
| ALB priorities 100/200/300 taken; per-PR bands allocated by slot index | ✅     | `packages/infra/alb/src/listenerPriority.ts` _(re-verified 2026-08-16 — the per-service resolvers this row cited were replaced by one allocator)_ |
| **No Redis or ElastiCache exists anywhere in the platform**            | ✅     | Search across all infra and service packages: zero hits                                                                                           |
| Backend test-file conventions match                                    | ✅     | `__tests__/integration/**/*.integration.test.ts`, `tests/e2e/*.e2e.test.ts`                                                                       |
| The k6 harness exists where the plan says                              | ✅     | `packages/tools/loadtest/`                                                                                                                        |
| The i18n path exists where the plan says                               | ✅     | `packages/apps/commise/i18n/src/dictionary.ts`                                                                                                    |

**No document now asserts anything about the platform that the platform contradicts.**

---

## WARNING Findings

### W-003 — ✅ CLOSED: the three MAJOR peer-review findings

Resolved by owner ruling on 2026-08-02. `PRF-006-11` — residual accepted; plan span carries no separate latency target.
`PRF-006-12` — premise invalid; the same owner owns 006 **and** the recipe service, so no cross-party gate exists.
`PRF-006-13` — resolved; see W-005. `PRF-006-16` (endpoint path) closed alongside them. See
[`v-model/peer-review.md`](./v-model/peer-review.md).

### W-004 — ✅ CLOSED: scenario counts enumerated

Resolved 2026-08-02 by enumerating every id rather than deferring to implementation. Every published figure was wrong:
**357** scenarios (was 341) and **81** component tests (was 63 — 40 web / 41 mobile, not 34/29). The release audit also
double-counted 19 tests by listing Playwright/Maestro/k6 alongside the System total that already contains them. All
eight documents carrying a derived figure are corrected; the counts may now be cited as planned-coverage evidence.

### W-005 — ✅ CLOSED: the cross-feature FR index

`cross-feature-FR-index.md` listed `006-FR-025/026/027` as `Active` references from 010. Applied 2026-08-02: the three
rows now read `Deferred`; a **Status Values** section defines the column (previously every row said `Active`, so it
carried no information); a **Deferral Notes** entry records the reason and the mutual 006 ↔ 010 dependency; and
**Review Rule 5** now requires a deferral to flip its rows in the same change set — the durable fix.

### W-006 — ✅ CLOSED: cost derived from a stated configuration

Resolved 2026-08-02. `plan.md` now **decides the task sizing** — `cpu: 512`, `memoryLimitMiB: 1024`, `desiredCount: 1`,
matching the shipped recipe and food API tasks — so the ≈ $8.25/mo per-PR figure follows from a stated configuration
plus a measured comparable of identical shape, rather than from analogy alone. The service adds no NAT consumer,
bucket, queue or cache, so compute is essentially the whole bill.

**Residual (recorded, not a gap)**: this is still not billing data for _this_ service. Confirm from Cost Explorer after
the first preview deploy (T070).

---

## EXPECTED-GAP

### G-001 — No implementation exists

72 tasks defined, 0 complete; 438 planned tests, 0 executed. Expected at planning hand-off. Under `§7.1` the feature is
**INCOMPLETE by definition** — the correct status.

---

## Resolved since 2026-05-12

| Previous finding                                                   | Status                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **W-001** — templates/recurrence not explicit FRs                  | **CLOSED** — templates are FR-028; recurrence explicitly out of scope (C-006-008) |
| **W-002** — family sizing and leftovers inferred                   | **CLOSED** — family sizing is FR-030; leftovers out of scope                      |
| **W-003 (old)** — only one numeric success criterion               | **CLOSED** — five now, three machine-checked                                      |
| _(unreported)_ backend paths pointed at a non-workspace            | **CLOSED** — every path verified against the workspace globs                      |
| _(unreported)_ zero mobile coverage                                | **CLOSED** — 29 component tests, 6 Maestro flows, paired tasks                    |
| _(unreported)_ tests scheduled after implementation                | **CLOSED** — 24 test-first pairs                                                  |
| _(unreported)_ nutrition designed against a non-existent USDA path | **CLOSED** — recipe-level rollup via one batch call                               |
| _(unreported)_ Redis cache on a platform with no Redis             | **CLOSED** — removed; REQ-NF-009 + STS-008-A5 prevent reintroduction              |
| _(unreported)_ premium gate reading a claim that does not exist    | **CLOSED** — Phase-2 deferral with the blocker named                              |

The six previously-**unreported** items are precisely what a doc↔doc verifier structurally cannot see. That is the
argument for keeping L8 in every future run.

---

## PASSED Verifications (detail)

**V-1 — FR coverage.** All 21 Phase-1 FRs and 3 deferred FRs appear in `product-spec/`, the v-model requirement set and
`tasks.md`. Deferred ones carry no tasks, by decision.

**V-2 — Success criteria.** SC-006-001..005 each have a named verification; three are CI-checked.

**V-3 — NFR coverage.** NFR-001..007 map to REQ-NF-001..009 and to CI gates STP-008-A/B.

**V-4 — Artifact inventory.** 49 files, every one regenerated or verified current on 2026-08-02.

**V-5 — Traceability.** 0 missing matrix cells (was 41); 0 orphan tests; 26/26 active hazards mitigated.

**V-6 — Cross-platform.** Every user-facing story, journey, wireframe, state and task covers both platforms; 0 waivers.

**V-7 — Standards conformance.** File naming, folder structure, error convention, date representation,
no-boolean-flag-props, localization and the library-first gate all checked against `docs/CODING_STANDARDS.md` and
`CLAUDE.md`.

**V-8 — Peer-review integrity.** The nine per-artifact reviews now carry real findings. The May set recorded 0 findings
each on the same day the consolidated review recorded 3 CRITICALs — including one whose own header recorded "0
acceptance test cases" while its findings table read 0.

---

## Recommendations Before Implementation

1. ✅ Done — the three MAJOR gates are closed (W-003).
2. ✅ Done — the index is corrected, with a new review rule to stop it recurring (W-005).
3. ✅ Done — the batch projection is an internally-owned prerequisite (T001–T003) and its path is settled on
   `POST /api/v1/recipes/nutrition-batch`.
4. **Still standing**: re-run this report **with L8** after any future spec change. A doc↔doc pass is not a verification
   — that is the lesson of the 2026-05-12 run.

**No warnings remain open.** T068–T070 are retained in `tasks.md` as post-deploy confirmations (re-reconcile counts
against real test files once they exist; confirm cost from billing data), not as unresolved findings.
