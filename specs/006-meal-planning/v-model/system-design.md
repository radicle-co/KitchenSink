# System Design: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09 | **Regenerated**: 2026-08-02
**Status**: Draft
**Source**: [`v-model/requirements.md`](./requirements.md), [`plan.md`](../plan.md)

> **Regeneration note.** The May decomposition had eight system components, four of which do not survive contact with
> the shipped platform: a nutrition engine built on a USDA adapter and a cache, and three premium AI services with no
> provider and no enforceable entitlement. The reconciled system is smaller and its dependency graph is much flatter —
> which is the point. SYS ids are preserved where the component survives.

## Overview

Meal Planning is one NestJS service plus one product feature package, decomposed into **six** system components: plan
lifecycle, entry assignment, nutrition rollup, templates, the outbound recipe gateway, and the client planner surface.
Nutrition is a **pure fold** over recipe-level values fetched in one bounded batch call, so there is no computation
subsystem, no cache and no async recalculation path. The three premium AI components are retained as ids only, marked
Phase 2.

## ID Schema

- **System Component**: `SYS-NNN` — sequential; never renumbered.
- **Parent Requirements**: comma-separated `REQ-NNN` list (many-to-many).

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                        | Description                                                                                                                                                                                                                                                                     | Parent Requirements                                                                                                    | Type      | Phase |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------- | ----- |
| SYS-001 | Meal Plan Manager           | Creates, reads, updates and deletes plans. Owns date-range and meal-slot validation (≤ 90 days, ≥ 1 slot), owner scoping, keyset pagination, and cascade delete of entries.                                                                                                     | REQ-001, REQ-002, REQ-009, REQ-010, REQ-CN-002, REQ-CN-005                                                             | Subsystem | 1     |
| SYS-002 | Entry Assignment Service    | Assigns, moves and removes entries within a plan. Validates the target cell against the plan's range and slot set, verifies recipe readability through SYS-007, and enforces idempotent creation.                                                                               | REQ-003, REQ-014, REQ-015, REQ-CN-002                                                                                  | Module    | 1     |
| SYS-003 | Nutrition Rollup            | **Revised.** Folds `recipeNutrition × servings` into per-day and whole-plan totals, propagating a completeness flag. A **pure function** over data already fetched by SYS-007 — no persistence, no cache, no queue, no food-service call.                                       | REQ-004, REQ-005, REQ-009, REQ-014, REQ-CN-004                                                                         | Module    | 1     |
| SYS-004 | AI Meal Suggestion Service  | **PHASE 2 — DEFERRED.** No provider (005) and no enforceable entitlement (010).                                                                                                                                                                                                 | REQ-006, REQ-CN-001                                                                                                    | Service   | **2** |
| SYS-005 | Meal Plan Auto-Generator    | **PHASE 2 — DEFERRED.**                                                                                                                                                                                                                                                         | REQ-007, REQ-CN-001                                                                                                    | Service   | **2** |
| SYS-006 | Food Waste Optimizer        | **PHASE 2 — DEFERRED.**                                                                                                                                                                                                                                                         | REQ-008, REQ-CN-001                                                                                                    | Service   | **2** |
| SYS-007 | Recipe Gateway              | **Narrowed.** The single outbound door to the recipe service: readability checks and batch nutrition, with a bounded transport timeout, total-function failure handling, boundary normalization and a three-state availability discriminant. Formerly a four-adapter subsystem. | REQ-IF-001, REQ-IF-008, REQ-010, REQ-014                                                                               | Module    | 1     |
| SYS-008 | Quality & Compliance Layer  | Cross-cutting: strict TypeScript, JSDoc + pattern-named module headers, accessible names, non-colour-only state, the test matrix, error-class conventions, and the no-cache/no-queue constraint.                                                                                | REQ-NF-001..009                                                                                                        | Utility   | 1     |
| SYS-009 | Template Service            | **New.** Saves a plan as a template keyed by relative day offset, applies a template to a new start date, and produces the skip report.                                                                                                                                         | REQ-012, REQ-013, REQ-015, REQ-024, REQ-CN-002                                                                         | Module    | 1     |
| SYS-010 | Planner Client Surface      | **New.** The web + mobile planner: shared headless orchestration and pure render components, the Home widget, and the localization surface. Absent from the May decomposition, which modelled only the backend.                                                                 | REQ-003, REQ-014, REQ-016, REQ-017, REQ-018, REQ-019, REQ-023, REQ-025, REQ-NF-003, REQ-NF-004, REQ-NF-007, REQ-IF-007 | Subsystem | 1     |
| SYS-011 | Downstream Projection       | **New.** The versioned read shape 007/009 consume. Explicitly does **not** aggregate ingredients.                                                                                                                                                                               | REQ-IF-005, REQ-IF-006, REQ-011                                                                                        | Module    | 1     |
| SYS-012 | Account Erasure Participant | **New.** Erases a user's plans, entries and templates on account erasure, joining the existing mechanism rather than adding a second.                                                                                                                                           | REQ-020                                                                                                                | Module    | 1     |

**Retired**: the May `SYS-003` cache responsibility and `SYS-007`'s USDA, Clerk-adapter and AI-adapter roles. Clerk
verification is not a 006 component — it is the shared `@kitchensink/clerk-verify` package consumed by middleware.

## Dependency View (IEEE 1016 §5.2)

| Source  | Target                      | Relationship | Failure impact                                                                                               |
| ------- | --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| SYS-002 | SYS-001                     | Reads        | Cannot resolve the parent plan; assignment rejected with a not-found response.                               |
| SYS-002 | SYS-007                     | Calls        | **Degrades, does not fail.** Readability unverifiable → assignment is rejected conservatively (fail-closed). |
| SYS-003 | SYS-001, SYS-002            | Reads        | No entries → no totals. A plan with no entries legitimately reports no totals.                               |
| SYS-003 | SYS-007                     | Calls        | **Degrades, does not fail.** Nutrition renders "unavailable"; the plan and its entries still render.         |
| SYS-009 | SYS-001, SYS-002            | Writes       | Template application is transactional; a partial failure leaves no half-built plan.                          |
| SYS-009 | SYS-007                     | Calls        | An unreadable recipe becomes a **skip** with a reported reason, not a failure.                               |
| SYS-010 | SYS-001, 002, 003, 009      | Calls (HTTP) | Client-side query errors render per-surface error states; the shell still renders.                           |
| SYS-011 | SYS-001, SYS-002            | Reads        | Projection unavailable; no downstream consumer exists yet.                                                   |
| SYS-012 | SYS-001                     | Deletes      | Erasure retry is driven by the existing sweeper; an incomplete erasure is re-driven, never silently dropped. |
| all     | `@kitchensink/clerk-verify` | Verifies     | Token verification failure → `401`. Networkless, so it does not add an availability dependency.              |

### Dependency diagram

```text
                       ┌──────────────────────────────┐
                       │ SYS-010 Planner Client        │  web + mobile
                       │  (shared hook + pure render)  │
                       └───────────────┬───────────────┘
                                       │ HTTPS (Bearer)
                       ┌───────────────▼───────────────┐
                       │  AuthMiddleware (clerk-verify) │  networkless
                       └───────────────┬───────────────┘
        ┌──────────────────┬───────────┼────────────┬──────────────────┐
   ┌────▼─────┐      ┌─────▼─────┐ ┌───▼─────┐ ┌────▼──────┐    ┌──────▼──────┐
   │ SYS-001  │◄─────┤ SYS-002   │ │ SYS-009 │ │ SYS-011   │    │ SYS-012     │
   │ Plans    │      │ Entries   │ │Templates│ │Projection │    │ Erasure     │
   └────┬─────┘      └─────┬─────┘ └───┬─────┘ └───────────┘    └─────────────┘
        │                  │           │
        │            ┌─────▼───────────▼─────┐
        │            │ SYS-007 RecipeGateway │──► recipe-service (001)
        │            │  total fn, 3-state    │     readability + nutrition-batch
        │            └───────────┬───────────┘
        │                        │
        │                  ┌─────▼──────┐
        └─────────────────►│ SYS-003    │   PURE fold — no I/O, no cache, no queue
                           │ Nutrition  │
                           └────────────┘

  PostgreSQL (kitchensink_meal_plans)  ◄── SYS-001/002/009/011/012

  Phase 2, not built: SYS-004, SYS-005, SYS-006 (blocked on 005 + 010)
```

Three properties of this graph are deliberate and worth stating, because the May graph had none of them:

1. **One outbound edge.** Every cross-service call goes through SYS-007. There is no second door.
2. **The nutrition component has no dependencies.** SYS-003 is a pure function; it receives data and returns totals.
   That is what makes it exhaustively unit-testable and why no cache is needed.
3. **Every external-dependency failure degrades rather than propagates.** The gateway is a total function; a recipe
   service outage costs nutrition, not the planner.

## Data View (IEEE 1016 §5.3)

| Store                               | Owner            | Contents                                                                 | Notes                                                     |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `meal_plans`                        | SYS-001          | owner ULID, name, start/end date, slot set                               | `CHECK` on range, span ≤ 90 days, slot membership         |
| `meal_plan_entries`                 | SYS-002          | plan id (FK, cascade), recipe id (**no FK**), date, slot, servings, note | `CHECK` on servings 1–99, slot value, note length         |
| `meal_plan_templates` / `…_entries` | SYS-009          | owner ULID, name, span, slot set; entries by **day offset**              | Offsets, never dates — what makes a template re-appliable |
| `meal_plan_idempotency_keys`        | SYS-002, SYS-009 | (owner, endpoint, key) → first response                                  | Scoped by owner so one user's key cannot replay another's |
| _(none)_                            | SYS-003          | —                                                                        | **Nutrition is never persisted** (REQ-CN-004)             |

No object store, no queue, no cache, no search index (REQ-NF-009).

## Interface View (IEEE 1016 §5.4)

| Interface                  | Provider            | Consumer                 | Contract                                                                          |
| -------------------------- | ------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| Meal-plan REST API         | SYS-001/002/009/011 | SYS-010, 007, 009        | OpenAPI written before handlers; one error envelope `{code,message,details?}`     |
| Batch nutrition projection | 001                 | SYS-007                  | `POST /api/v1/recipes/nutrition-batch` — additive, bounded, `null` for unreadable |
| Recipe read                | 001                 | SYS-007                  | Existing `GET /api/v1/recipes/{id}`                                               |
| Home widget descriptor     | SYS-010             | `@commise/features-core` | Loader-based registration, capability-gated                                       |
| Grocery projection         | SYS-011             | 007, 009                 | Versioned `v1`; entries only                                                      |
| Account erasure            | existing            | SYS-012                  | The mechanism 001 C-007 established                                               |

## Traceability — REQ → SYS

| REQ                    | SYS                                |
| ---------------------- | ---------------------------------- |
| REQ-001, 002, 009, 010 | SYS-001                            |
| REQ-003                | SYS-002, SYS-010                   |
| REQ-004, 005           | SYS-003                            |
| REQ-006, 007, 008      | SYS-004, 005, 006 _(Phase 2)_      |
| REQ-011                | SYS-011                            |
| REQ-012, 013           | SYS-009                            |
| REQ-014                | SYS-002, SYS-003, SYS-007, SYS-010 |
| REQ-015                | SYS-002, SYS-009                   |
| REQ-016, 017, 018, 019 | SYS-010                            |
| REQ-020                | SYS-012                            |
| REQ-021, 022           | SYS-002, SYS-010                   |
| REQ-NF-001..010        | SYS-008                            |
| REQ-IF-001, IF-008     | SYS-007                            |
| REQ-IF-002             | _[DEPRECATED] — no component_      |
| REQ-IF-003             | AuthMiddleware (shared pkg)        |
| REQ-IF-004             | SYS-004 _(Phase 2)_                |
| REQ-IF-005, IF-006     | SYS-011                            |
| REQ-IF-007             | SYS-010                            |
| REQ-CN-002             | SYS-001, 002, 009                  |
| REQ-CN-003, CN-004     | SYS-001, 002, 003                  |
| REQ-CN-005             | SYS-001, 002                       |
| REQ-CN-006, CN-007     | SYS-008 _(absence, audited)_       |
| REQ-CN-008, CN-009     | SYS-002                            |
| REQ-CN-010             | SYS-001, SYS-002                   |
| REQ-CN-011, CN-012     | SYS-002                            |

**Forward coverage (REQ → SYS)**: 46 / 46 Phase-1 requirements mapped (100%). 5 Phase-2 requirements map to deferred
components. REQ-IF-002 is intentionally unmapped — it is withdrawn (`[DEPRECATED]`), and mapping a component to it
would fabricate a food-service dependency that does not exist; its live obligation is REQ-CN-007, which maps above.

REQ-CN-006 and REQ-CN-007 map to SYS-008 as **absence** properties: there is no component to point at precisely
because the requirement is that no such surface or call exists. They are audited at T067 rather than exercised.
