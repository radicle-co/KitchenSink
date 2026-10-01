# Metrics and ROI: Meal Planning

**Branch**: `006-meal-planning` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [plan.md](../plan.md), [tasks.md](../tasks.md), [v-model/requirements.md](../v-model/requirements.md)

---

## Overview

This document captures portfolio-level metrics and ROI hypotheses for feature 006. Story-level product metrics live in `../product-spec/metrics.md`.

---

## 1. Operational SLOs (Constitution-Derived NFRs)

### NFR-001: Strict TypeScript / No Unbounded `any`

| SLO                                                | Target | Measurement              |
| -------------------------------------------------- | ------ | ------------------------ |
| Strict typecheck compliance for touched workspaces | 100%   | `npm run typecheck` pass |
| Unapproved `any` usage in production code          | 0      | ESLint + review          |

---

### NFR-002: Exported API Documentation

| SLO                                      | Target | Measurement                       |
| ---------------------------------------- | ------ | --------------------------------- |
| Exported functions/interfaces with JSDoc | 100%   | lint/doc audit of changed modules |

---

### NFR-003: Accessibility Queryability

| SLO                                                  | Target                       | Measurement                                      |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| Interactive planner controls queryable by role/label | 100% of critical UI controls | Playwright assertions (`getByRole`/`getByLabel`) |

---

### NFR-004: Non-Color-Only State

| SLO                                                | Target                       | Measurement                                            |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| Planner state indicators with icon/text redundancy | 100% of stateful UI elements | design QA + automated visual assertions where possible |

---

## 2. Outcome Metrics from Spec

Reconciled 2026-08-02: the spec now carries **five** numeric success criteria, not one. `SC-008` was renumbered
`SC-006-001` for namespace consistency; the target is unchanged.

| ID             | Metric                                                                    | Target                                     | Measurement                                        |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| **SC-006-001** | End-to-end workflow time (create plan → assignments → grocery projection) | < 10 minutes for a 7-day plan              | controlled usability sessions + telemetry          |
| **SC-006-002** | Interactions to assign a recipe from an open plan                         | ≤ 3, on **both** web and mobile            | interaction-count instrumentation + usability runs |
| **SC-006-003** | 30-day plan read with full nutrition                                      | p95 ≤ 500 ms server-side, bounded fan-out  | k6 profile in `packages/tools/loadtest`            |
| **SC-006-004** | Planner UI states with a passing component test on both platforms         | 100%; every story has Playwright + Maestro | CI test report                                     |
| **SC-006-005** | Home `meal-plan` roadmap placeholder fully retired                        | 0 residual specs/skeletons                 | the existing exhaustiveness typecheck              |

SC-006-003 and SC-006-005 are notable because they are **machine-checkable in CI** rather than requiring a usability
session — the strongest kind of success criterion.

---

## 3. Product Metrics (Portfolio-Level)

Derived operational/business hypotheses; thresholds still require a product instrumentation decision.

| Metric                                                              | Initial Target | Rationale                                 | Phase                          |
| ------------------------------------------------------------------- | -------------- | ----------------------------------------- | ------------------------------ |
| Planner activation rate (users creating a first plan within 7 days) | TBD            | Measures feature adoption                 | 1                              |
| Weekly active planners                                              | TBD            | Retention linkage for recurring behaviour | 1                              |
| Template reuse rate (plans created from a template)                 | TBD            | Validates FR-028 — the anti-churn feature | 1                              |
| Home widget → planner click-through                                 | TBD            | Validates FR-035's placement on Home      | 1                              |
| Nutrition-summary view rate                                         | TBD            | Validates FR-024 utility                  | 1                              |
| Grocery projection consumption rate                                 | TBD            | End-to-end value realization              | 1 (needs 007 to be meaningful) |
| Premium AI usage rate among premium users (FR-025..027)             | TBD            | Validates premium value                   | **2 — deferred**               |

---

## 4. ROI Hypothesis

Feature 006 should improve:

1. **Retention** — planning creates a recurring weekly habit, and templates (FR-028) lower the cost of repeating it.
   This is the primary hypothesis, and the only one Phase 1 can test.
2. **Cross-feature stickiness** — stronger coupling between recipes (001), grocery (007) and nutrition planning (009).
   006 is the upstream both downstream features read.
3. **Premium conversion** — AI suggestions, auto-generation and waste optimization are high-intent paid capabilities.
   **Untestable in Phase 1**: FR-025/026/027 are deferred pending 005 and 010, so no premium conversion signal exists
   for this feature yet. Any ROI case built on this line is a projection, not a measurement.

### Cost side of the ROI

006 introduces a Fargate service. Per ADR-0008 the account carries a $300 monthly budget guardrail, so the cost is a
tracked line, not a rounding error: ≈ **$8/mo per open PR preview** (matching the food service's measured figure), plus
the base sandbox and prod tasks. Non-prod runs `FARGATE_SPOT` and `gp3`. There is **no** cache cluster, **no** queue and
**no** worker Lambda — the reconciliation removed all three, which is a real cost reduction against the May design.

---

## 5. Instrumentation Readiness

Minimum telemetry events. Phase-2 events are listed but not instrumented in Phase 1.

**Phase 1**

- `meal_plan_created`, `meal_plan_deleted`
- `meal_slot_assigned`, `meal_slot_entry_moved`, `meal_slot_entry_removed`
- `meal_plan_template_saved`, `meal_plan_template_applied` (with skipped-entry counts)
- `nutrition_summary_viewed`, `nutrition_partial_estimate_shown`
- `meal_plan_entry_orphaned_shown`
- `home_meal_plan_widget_clicked`
- `grocery_projection_requested`

**Phase 2 (deferred)** — `ai_suggestions_requested`, `ai_plan_generated`, `waste_optimization_requested`

Event schema is not yet defined; it should be settled with the tracking plan before the first of these ships. Note that
`nutrition_partial_estimate_shown` and `meal_plan_entry_orphaned_shown` are deliberately included: they measure how
often users see a degraded state, which is the operational signal for whether the recipe gateway and orphan handling are
behaving.

---

## 6. Traceability Snapshot

| Source requirement        | Coverage in this document                          |
| ------------------------- | -------------------------------------------------- |
| NFR-001..004              | Operational SLO section 1                          |
| NFR-005 (test mandate)    | SC-006-004, section 2                              |
| NFR-006 (latency)         | SC-006-003, section 2                              |
| NFR-007 (parity)          | SC-006-002 and SC-006-004, section 2               |
| SC-006-001..005           | Outcome metrics, section 2                         |
| FR-024, FR-028, FR-035    | Product metrics, section 3                         |
| FR-025/026/027            | Product metrics + ROI, sections 3–4 — **deferred** |
| ADR-0008 (cost guardrail) | ROI cost side, section 4                           |

## Notes

- The May 2026 WARNING ("only one explicit numeric success criterion") is **resolved**: the spec now carries five, three
  of which are checkable in CI.
- Thresholds marked TBD remain deliberately unset rather than invented. An invented retention target is worse than an
  absent one, because it gets cited.
