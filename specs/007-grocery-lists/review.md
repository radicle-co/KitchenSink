# Product Forge Revalidation Log: Feature 007

**Branch**: `007-grocery-lists`
**Created**: 2026-05-09
**Last Updated**: 2026-05-10
**Status**: Product decisions approved — implementation prerequisites remain; V-Model/test artifacts remain pre-implementation blocked
**Mode**: Retroactive bootstrap

## Milestone Assignment

- **Milestone**: `M3` Rohan
- **Public launch**: Beta
- **Source of truth**: ../v1-launch-plan.md
- **Last updated**: 2026-08-02

---

## Purpose

This file records the iterative revalidation cycle for the Product Forge layer of feature 007. Each revision captures user feedback, the corrections applied, and an explicit approval marker.

This feature was **retroactively bootstrapped** — the SpecKit + V-Model artifacts already existed before Product Forge was layered on. Revalidation here therefore focuses on:

1. Whether the synthesized `research/` and `product-spec/` artifacts faithfully reflect the existing `spec.md`, `plan.md`, `tasks.md`, `research/research.md`, and `v-model/requirements.md`.
2. Whether the new artifacts surface any gaps, contradictions, or stale assumptions in the upstream artifacts.
3. Whether the Must Have / Should Have / Could Have decomposition in `product-spec/product-spec.md` matches grocery-list product priorities (generation, pantry, store setup, ordering).

---

## Revision Log

### Revision 0 — Initial Bootstrap (2026-05-09)

**Author**: Sisyphus (Product Forge bootstrap)
**Trigger**: User-requested retroactive bootstrap for feature 007.

**Artifacts produced**:

- [research/competitors.md](./research/competitors.md)
- [research/ux-patterns.md](./research/ux-patterns.md)
- [research/codebase-analysis.md](./research/codebase-analysis.md)
- [research/tech-stack.md](./research/tech-stack.md)
- [research/metrics-roi.md](./research/metrics-roi.md)
- [product-spec/product-spec.md](./product-spec/product-spec.md)
- [product-spec/user-journey.md](./product-spec/user-journey.md)
- [product-spec/wireframes/](./product-spec/wireframes/)
- [product-spec/metrics.md](./product-spec/metrics.md)

**Synthesis sources**:

| Bootstrapped File    | Primary Source(s)                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| competitors.md       | `research/research.md` (RQ-1, competitor sections) + user-provided competitor set (AnyList, Out of Milk, Bring, Apple Reminders) |
| ux-patterns.md       | `research/research.md` (RQ-1 UX patterns), `spec.md` acceptance scenarios, user-provided UX pattern list                         |
| codebase-analysis.md | `plan.md`, root `package.json`, `AGENTS.md`, `tasks.md`                                                                          |
| tech-stack.md        | `plan.md`, `research/research.md` (RQ-2..RQ-9), `spec.md` dependencies                                                           |
| metrics-roi.md       | `spec.md` (NFR/SC), `v-model/requirements.md`, `plan.md`                                                                         |
| product-spec.md      | `spec.md` user stories + FR-028..FR-031, `plan.md`, `tasks.md`, `v-model/requirements.md`                                        |
| user-journey.md      | `spec.md` acceptance scenarios, `product-spec.md` personas/stories                                                               |
| wireframes/          | `spec.md` FRs + acceptance scenarios, `plan.md`, user-required wireframe set                                                     |
| metrics.md           | `product-spec.md`, `spec.md`, `v-model/requirements.md`                                                                          |

---

### Revision 1 — Pre-Handoff Blocker Resolution (2026-05-10)

**Author**: Sisyphus (product owner pass)
**Trigger**: Engineering handoff blocked by open questions in plan.md, missing mobile tasks, missing dedicated page and cross-link specs, and unresolved partner API status.

**Changes applied**:

| File                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.md`                      | Status updated to pre-handoff. Edge cases answered (empty plan, API outage, standalone list, deleted meal plan). Scenarios 6–8 added (dedicated page, cross-links). FR-032 and FR-033 added. SC-009 added. Assumptions rewritten to be honest about partner API status and polling decision.                                                                                                                                                                                                                                       |
| `plan.md`                      | Status updated. System context diagram updated to show both entry points (meal plan + dedicated page) and cross-link. Section 8 "Open Questions" replaced with Section 8 "Resolved Questions" covering: Walmart-first sequencing, polling over webhooks, outage behavior, dedicated page, cross-linking, pantry TTL, and recipe scaling. Section 9 implementation order updated.                                                                                                                                                   |
| `tasks.md`                     | Header updated (38 → 46 tasks). Dependency graph updated. Instacart tasks (T-016..T-018) annotated with ⚠️ blocker note requiring partner credentials. T-019 updated to reflect polling decision and honest status values including `unavailable`. Web UI phase annotated with mobile parity note. T-039 added (dedicated Shopping Lists page, web). T-040 added (meal plan / shopping list cross-links, web + mobile). T-041..T-044 added (mobile UI parity tasks). T-045..T-046 added (mobile E2E tests). Summary table updated. |
| `product-spec/product-spec.md` | Status updated. Vision updated with two new principles (lists as first-class objects, cross-linking). US-011 added (dedicated Shopping Lists page). US-012 added (cross-link navigation). US-007 annotated with honest partner API status note. US-010 explicitly deferred. Non-functional constraints updated with SC-009 and mobile parity requirement. Out of scope updated with webhook deferral.                                                                                                                              |
| `product-spec/user-journey.md` | Status updated. Journey D added (dedicated Shopping Lists page, standalone list creation). Journey E added (cross-link navigation between meal plan and grocery list). Coverage matrix updated to include FR-032 and FR-033.                                                                                                                                                                                                                                                                                                       |

---

## Resolved Questions

| #   | Question                                                  | Decision                                                                                                                                                            |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Store integration sequencing: Walmart first or Instacart? | **Walmart first.** Walmart API is publicly documented and key-based. Instacart requires a partner agreement not yet in place. Both behind feature flag.             |
| 2   | Order status mechanism: webhook or polling?               | **Polling.** Client polls `GET /api/v1/grocery-lists/:id/order-status` every 30s. Server caches 30s. Webhooks deferred until a partner agreement confirms delivery. |
| 3   | Store API outage behavior                                 | **List preserved; user shown clear error; no broken state.** 502 returned with human-readable message. Circuit breaker prevents cascading calls.                    |
| 4   | Dedicated Shopping Lists page                             | **Yes, required.** FR-032 added. `/shopping-lists` route on web; Shopping Lists tab on mobile. Reachable from main nav without visiting a meal plan.                |
| 5   | Meal plan / shopping list cross-linking                   | **Yes, required.** FR-033 added. Grocery list shows back-link to meal plan. Meal plan shows associated lists. Deleted meal plan handled gracefully.                 |
| 6   | Pantry TTL: 7 days or "always exclude"?                   | **7 days for MVP.** "Always exclude" deferred to post-MVP.                                                                                                          |
| 7   | Recipe scaling                                            | **Respect serving multiplier from 006 if available.** Default to base serving count if 006 does not yet expose a multiplier. Confirm during integration.            |

---

## Implementation Prerequisites (must close before engineering completion)

These are not blockers for engineering handoff but must be resolved before the feature ships to users.

1. **Instacart partner agreement**: T-016..T-018 cannot be completed without OAuth credentials. Track as a business dependency separate from engineering progress.
2. **Walmart API key**: T-013..T-015 require `WALMART_API_KEY`. Confirm sandbox access before integration testing.
3. **006 meal plan serving multiplier**: Confirm whether feature 006 exposes a per-recipe serving multiplier on `meal_plan_recipe` rows before T-004 (aggregator) is finalized.
4. **Store-layout aisle sorting**: Advisory grouping (current plan) vs user-editable aisle maps. Deferred to post-MVP.
5. **List sharing / collaboration**: No explicit FR. Remains a warning-level extension until FRs are added.

---

## Approval Gate

**Current state**: ✅ Approved for engineering handoff

Confirmed:

- [x] Product Forge artifacts accurately reflect current `spec.md`, `plan.md`, and `v-model/requirements.md`
- [x] All P1/P2 ordering ambiguity resolved
- [x] Partner API status is honest — no confirmed integrations implied
- [x] Mobile UI tasks added and explicitly paired with web UI tasks
- [x] Dedicated Shopping Lists page and cross-linking are specified and tasked
- [x] Order status values are honest about what requires a live integration
- [x] Remaining questions are explicit implementation prerequisites with owners/exit criteria; they do not change the approved product decisions

**Reviewer**: Product Owner (Sisyphus pass, 2026-05-10)
**Decision date**: 2026-05-10
**Outcome**: Approved — proceed to engineering handoff
