# Sync-Verify Report: 001-commise-recipe-app

---

## Run #3 — 2026-07-15 (post-implementation reconciliation)

**Phase**: 6 Implement (in-progress) · **feature_mode**: standard
**Layers checked**: 5, 6 (materially changed since run #2); 1–4, 7 carried forward; 8–10 spot-checked
**Verdict**: **DRIFT DETECTED** (no longer CRITICAL — the run #2 blocker is cleared)

### Summary

| Severity    | Count | Δ vs run #2                          |
| ----------- | ----- | ------------------------------------ |
| ❌ CRITICAL | 1     | DRIFT-002 **RESOLVED**; DRIFT-007 new |
| ⚠️ WARNING  | 3     | +DRIFT-008 (task-mark lag, now RESOLVED) |
| ℹ️ INFO     | 3     | unchanged                            |
| ✅ CLEAN    | 2     | Layer 5 forward, Layer 7             |

**Auto-resolutions applied (2026-07-15):** DRIFT-008 — flipped 8 verified-complete task marks (`T061, T062, T063, T064, T095, T123, T124, T125`) in `tasks.md` from `[ ]`→`[x]` (124→132 done). This is a Layer-5-backward reconciliation of documentation to shipped reality; no source code was changed. Each flip was gated on a per-task file inspection; three stub scaffolds (`T130, T131, T136`) were explicitly **not** flipped.

### Headline: DRIFT-002 is RESOLVED

Run #2's OPEN-CRITICAL was "core recipe data model and CRUD entirely absent." It has landed:

| Package | Src files | Test files |
| --- | --- | --- |
| `packages/services/recipe-service` | 84 | 42 |
| `packages/shared/recipe-core` | 2 | 1 |
| `packages/apps/commise/features/recipes` | 70 | 43 |
| `packages/clients/recipe-service` | 7 | 3 |
| `packages/services/recipe-workers` | 6 | 4 |

US-1 (create/manage) core CRUD, versioning, conflict resolution, photos, and US-2 recipe clone/visibility are implemented on **both** web and mobile. The "implement under 001 directly" HITL decision (2026-06-02) has been executed.

### DRIFT-007 (CRITICAL, Layer 6 — forward): US-000 Home widget-surface host not implemented

- **Story**: US-000 Post-Login Home Screen (Priority **P1**, Must Have) / FR-046.
- **Evidence**: `packages/apps/commise/{web,mobile}/src/components/home/` do **not exist**; no `curateHomeWidgets` / `appShell` / `addFeature` composition root wired in either app. Tasks **T104-web, T104-mobile** and their test tasks (T104-test-web/mobile, T104-e2e-web/mobile) are open.
- **Nuance**: the widget **building blocks** (`RecipeWidgetCard`, `RecentRecipeItem`, `RecipeWidgetEmptyState`, `RecipeWidgetSkeleton`) exist in `features/recipes` and were styled this session — but the **surface that composes and renders them** (the actual Home screen) is absent. US-000's central deliverable is not shippable yet.
- **Direction**: forward (spec requires, code missing). **Not** auto-resolvable.
- **Status**: OPEN. Consistent with the standing "don't progress the rest of 001 yet" constraint — reported, not actioned.

### DRIFT-008 (WARNING, Layer 5 — backward): tasks.md checkboxes under-report shipped code — **RESOLVED 2026-07-15**

The `.forge-status.yml` `task_log` was reconciled for the 2026-07-13/14/15 sessions, but the `tasks.md` `[ ]`/`[x]` marks lagged the code. A per-task verification pass (each open task's target files inspected, not just the mark) confirmed **8 tasks had complete, non-stub code but were still `[ ]`**. These were flipped to `[x]` (124/190 → **132/190**):

| Task | Evidence of completion |
| --- | --- |
| **T061** | `web/src/middleware.ts` present; `<ClerkProvider>` in `app/[locale]/layout.tsx` |
| **T062** | `@clerk/expo` ClerkProvider wired in mobile App |
| **T063** | `@commise/ui` palette/tokens present and consumed on both platforms |
| **T064** | `clients/recipe-service/src/hooks.ts` + `client.ts` (TanStack Query) with client tests; consumed by both apps |
| **T095** | `client.ts` reads `NEXT_PUBLIC_API_URL`/`EXPO_PUBLIC_API_URL` from env |
| **T123** | `recipes.dal.ts` `softDelete()` sets `deleted_at`; reads filter `isNull(deletedAt)`; controller `@Delete` wired |
| **T124** | `search.dal.ts` `buildWhere()` line 341 `deleted_at IS NULL` |
| **T125** | `collections/dal/collections.dal.ts:140` joins `isNull(recipes.deletedAt)` |

**The dangerous direction (a `[x]` with no code) was NOT found** — but the verification pass *did* catch would-be false flips and correctly **left them open** because the code is a scaffolded **stub**, not a completion:

- **T130** — `versions.service.ts` still archives to S3 **inline** (`@sideEffect ... PUTs archive objects to S3`); the task is to *replace* that with an async `recipe_version_pending_archives` enqueue. Not done.
- **T131** — `version-archive-worker.ts` exists but line 51 is `// TODO(Phase 4+): query the recipe, its version row...`. Stub.
- **T136** — `account-erasure-worker.ts` exists but line 39 is `// TODO(Phase 4+): ... delete the owner's rows in FK-safe order`. Stub.

Genuinely-open (code matches the open mark — no drift): **T126** soft-delete integration test (absent), **T127/T128** collection clone/pull service+controller (only `sourceCollectionId` schema field exists), **T130/T131/T132/T133/T138** async version-archive path (stubs + missing infra/tests), **T134/T135/T136/T137** erasure service+controller+worker-body+test (only `account.module.ts` shell + worker stub), **T104** Home host (see DRIFT-007), **T064-test** hook-level MSW tests (client tests exist but not hook-level), and the frontend test-tier tasks (T105-T115, T083/T084/T086/T087).

### Carried forward from run #2 (unchanged — no doc edits since)

- **DRIFT-003** (WARNING, L3): spec.md FRs (FR-003/004/006/009/014a, SC-001/005) not referenced in plan.md.
- **DRIFT-004** (WARNING, L2): product-spec Must Have stories don't fully cover FR-003/004/009 visibility constraints.
- **DRIFT-006** (INFO, L1), **DRIFT-005** (INFO, L6), **DRIFT-001** (RESCOPED, L5 — now largely subsumed by DRIFT-002's resolution).

### Layers 8–10 (spot-check)

- **L8 contract drift**: `contracts/api.openapi.yaml` present; recipe-service implements the CRUD/collections/versions routes and `@kitchensink/recipe-service-client` consumes them. No deterministic differ configured (`contract_differ: none`) — prose check only; T053 (align OpenAPI examples to impl) is open, so treat as **not-yet-verified**, not clean.
- **L9 doc↔code**: the 5 landed packages trace to tasks; no significant orphan modules found (this session's cross-cutting fixes — native-auth wiring, recipe CORS, Tailwind `@source`, fetch bind — are attributed in the `task_log`).
- **L10 constitution**: `.specify/memory/constitution.md` exists; no new MUST-level violation surfaced in the changed layers (full constitution pass deferred to Phase 6B code-review).

---

## Run #2 — 2026-06-02 (post-HITL delegation analysis)

**Date**: 2026-06-02 (Run #2 — post-HITL delegation analysis)
**Phase**: unknown (no `.forge-status.yml`)
**Layers checked**: 1–7 (all)
**Layers skipped**: none

## Verdict

**MIXED — open work tracked under 001**: Most of 001's capabilities are correctly **delegated** to sub-features 002–014 and progressing under their own roadmaps. **Core recipe scaffolding** (US-0 home, US-1 create/manage, US-2 share/clone, FR-001..FR-006) is **not owned by any sub-feature** and per HITL resolution (2026-06-02) will be **implemented under 001 directly** rather than spawning a new sub-feature. DRIFT-002 remains OPEN-CRITICAL until that work lands; tracked as the active implementation queue for 001.

## Summary

| Severity    | Count       |
| ----------- | ----------- |
| ❌ CRITICAL | 1           |
| ⚠️ WARNING  | 2           |
| ℹ️ INFO     | 3           |
| ✅ CLEAN    | 1 (Layer 7) |
| 🔧 RESCOPED | 1           |

## Delegation Coverage Matrix

| 001 capability                                | Owner sub-feature        | Confidence |
| --------------------------------------------- | ------------------------ | ---------- |
| US-0 — Post-Login Home Screen                 | **ORPHAN (001 itself)**  | high       |
| US-1 — Create/Manage Personal Recipes         | **ORPHAN (001 itself)**  | high       |
| US-2 — Share/Copy/Clone Recipes               | **ORPHAN (001 itself)**  | high       |
| FR-001..006 — recipe CRUD, visibility, search | **ORPHAN (001 itself)**  | high       |
| FR-007 — food/nutrition database              | 003-usda-food-data       | high       |
| FR-045 — authentication                       | 002-user-auth            | high       |
| Recipe importing                              | 004-recipe-importing     | high       |
| AI-assisted features                          | 005-ai-integration       | high       |
| Meal planning                                 | 006-meal-planning        | high       |
| Grocery lists                                 | 007-grocery-lists        | high       |
| Cooking mode                                  | 008-cooking-mode         | high       |
| Nutrition planning                            | 009-nutrition-planning   | high       |
| Subscriptions / monetization                  | 010-subscriptions        | high       |
| Recipe digitization (OCR, family circles)     | 011-recipe-digitization  | high       |
| Public creator profiles                       | 012-creator-profiles     | high       |
| Cooking school (video learning)               | 013-cooking-school       | high       |
| Notifications                                 | 014-notification-service | high       |

## Per-Layer Results

### Layer 1: research/ ↔ product-spec/ — ℹ️ 1 INFO

- DRIFT-006: NFR framing differs between `research/metrics-roi.md` and `product-spec/metrics.md`. Acceptable refactor.

### Layer 2: product-spec/ ↔ spec.md — ⚠️ 1 WARNING

- DRIFT-004: Product-spec Must Have stories don't fully cover FR-003/004/009 visibility constraints.

### Layer 3: spec.md ↔ plan.md — ⚠️ 1 WARNING

- DRIFT-003: spec.md FRs (FR-003, FR-004, FR-006, FR-009, FR-014a, SC-001, SC-005) not referenced in plan.md.

### Layer 4: plan.md ↔ tasks.md — ✅ no findings

### Layer 5: tasks.md ↔ Code — 🔧 RESCOPED

- DRIFT-001: Originally CRITICAL ("182 pending tasks, 0 implementation"). Post-HITL delegation analysis: ~150 tasks are correctly delegated to sub-features 002–014 (with their own active implementations). Only ~30 orphan tasks remain — core recipe CRUD under `packages/services/recipe-service`, `packages/shared/recipe-core`, `packages/services/recipe-workers/src/photo-processor`. **Severity reduced to RESCOPED**.

### Layer 6: spec.md ↔ Code — ❌ 1 CRITICAL + ℹ️ 1 INFO

- **DRIFT-002 (CRITICAL — OPEN, accepted)**: All 3 Must Have user stories (US-0, US-1, US-2, all P1) have **no implementation evidence**. Branch diff contains only auth/identity files from 002-user-auth. No code under `packages/services/recipe-service/` or `packages/shared/recipe-core/`. Core recipe data model and CRUD entirely absent.

    **HITL resolution (2026-06-02)**: Option 2 selected — **implement under 001 directly**. Meta-feature 001 will dual-purpose as both planning home and implementation owner for the recipe domain. No new sub-feature spawned. DRIFT-002 remains OPEN-CRITICAL as the active work-in-progress signal for 001 until core recipe scaffolding lands under `packages/services/recipe-service/`, `packages/shared/recipe-core/`, and `packages/services/recipe-workers/src/photo-processor/` (or equivalent paths under `packages/apps/commise/`). Next sync-verify run should re-evaluate Layer 5 once any 001 `[x]` tasks materialize.

- DRIFT-005 (INFO): FR-045 (auth) dependency satisfied by 002-user-auth files in branch diff.

### Layer 7: Cross-link integrity — ✅ CLEAN

- 232 internal cross-links verified.

## Sync History

| Run | Date                   | Layers | CRITICAL | WARNING | INFO | Verdict        |
| --- | ---------------------- | ------ | -------- | ------- | ---- | -------------- |
| #1  | 2026-06-02 00:47       | 1–7    | 2        | 3       | 2    | CRITICAL DRIFT |
| #2  | 2026-06-02 (post-HITL) | 1–7    | 1        | 2       | 3    | MIXED          |
