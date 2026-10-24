# Metrics: Meal Planning — Story-Level

**Branch**: `006-meal-planning`
**Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md), [tasks.md](../tasks.md)
**Distinction from [research/metrics-roi.md](../research/metrics-roi.md)**: this file tracks story-level product signals;
that one tracks portfolio-level ROI.

> **Reconciliation note.** Metric ids are stable — MET-006-001..014 keep their meanings where the story survived. Three
> changes: metrics for endpoints that no longer exist are re-pointed at the ones that do (there is no
> `GET /nutrition` and no "handoff completed" event in Phase 1); the premium metrics are marked **Phase 2, not
> instrumented**; and new metrics are added for the states that were previously unmeasured — orphaned entries, partial
> nutrition, dependency degradation and template reuse. Those four are the operational signals that tell us whether the
> design's honesty about degraded states is actually working.

---

## Metric Notation

Each metric maps to a story and traces to FR/SC ids. **Phase 2** metrics are specified but not instrumented in the first
release.

---

## Story-Level Metrics

### US-006-001: Create Plan

**FRs**: FR-022, FR-029, FR-037

| Metric ID   | Metric                     | Target | Source        | Signal                                                             |
| ----------- | -------------------------- | ------ | ------------- | ------------------------------------------------------------------ |
| MET-006-001 | Plan creation success rate | ≥ 98%  | API telemetry | `POST /api/v1/meal-plans` 2xx rate                                 |
| MET-006-002 | Time to first created plan | TBD    | UX event      | `meal_plan_created`, elapsed from first planner open               |
| MET-006-015 | Validation rejection rate  | ≤ 5%   | API telemetry | 422 rate on create — a spike means the range/slot UI is misleading |

---

### US-006-002: Assign Meals to Slots

**FRs**: FR-023, FR-030, FR-031, FR-032, FR-033, FR-034

| Metric ID   | Metric                            | Target    | Source        | Signal                                                                                                               |
| ----------- | --------------------------------- | --------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| MET-006-003 | Assignment success rate           | ≥ 98%     | API telemetry | `POST /entries` 2xx rate                                                                                             |
| MET-006-004 | Assignment completion reliability | ≥ 95%     | UX telemetry  | assignment started vs. confirmed — **web drag, web keyboard and mobile tap reported separately**                     |
| MET-006-016 | Interactions per assignment       | ≤ 3 (p90) | UX telemetry  | SC-006-002; reported per platform                                                                                    |
| MET-006-017 | Idempotent replay rate            | (observe) | API telemetry | share of `POST /entries` served from the idempotency ledger — measures how often the mobile network actually retries |

MET-006-004 is split by interaction because a single blended number would hide a broken interaction on one platform —
which is exactly the class of divergence `recipeAccessPolicy`'s D7 defect note warns about.

---

### US-006-003: View Nutrition Summary

**FRs**: FR-024, FR-033, NFR-004, NFR-006

| Metric ID   | Metric                              | Target                          | Source        | Signal                                                                                                                                                             |
| ----------- | ----------------------------------- | ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MET-006-005 | Nutrition availability on plan load | ≥ 99%                           | API telemetry | share of `GET /api/v1/meal-plans/{id}` responses carrying totals _(re-pointed: there is no separate `/nutrition` endpoint — nutrition is inline in the plan read)_ |
| MET-006-006 | Nutrition panel engagement          | TBD                             | UX event      | `nutrition_summary_viewed`                                                                                                                                         |
| MET-006-018 | Partial-estimate exposure rate      | ≤ 10% of plan loads             | UX event      | `nutrition_partial_estimate_shown` — high means recipe nutrition coverage is poor upstream, not that 006 is broken                                                 |
| MET-006-019 | Recipe-gateway degradation rate     | ≤ 0.5% of plan loads            | Service       | gateway `availability != 'available'` — the operational signal for the 006↔001 dependency                                                                          |
| MET-006-020 | 30-day plan read latency            | p95 ≤ 500 ms                    | Service + k6  | SC-006-003, NFR-006                                                                                                                                                |
| MET-006-021 | Downstream calls per plan read      | ≤ 2, independent of entry count | Service       | proves the batch projection is doing its job and no N+1 regressed                                                                                                  |

---

### US-006-005: Home Widget and Navigation

**FRs**: FR-035

| Metric ID   | Metric                         | Target | Source       | Signal                                                                                                                          |
| ----------- | ------------------------------ | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| MET-006-022 | Widget render success rate     | ≥ 99%  | UX telemetry | widget rendered vs. error-boundary caught                                                                                       |
| MET-006-023 | Widget → planner click-through | TBD    | UX event     | `home_meal_plan_widget_clicked` over widget impressions                                                                         |
| MET-006-024 | Roadmap placeholder residue    | **0**  | CI           | SC-006-005 — no `meal-plan` entry in `ROADMAP_WIDGET_SPECS`, no app skeleton; enforced by the existing exhaustiveness typecheck |

---

### US-006-004: Complete the Planning Workflow

**FRs/SC**: FR-036, SC-006-001

| Metric ID   | Metric                               | Target   | Source                      | Signal                                                                                                                  |
| ----------- | ------------------------------------ | -------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| MET-006-007 | 7-day plan → grocery projection time | < 10 min | timed usability + telemetry | create → projection elapsed                                                                                             |
| MET-006-008 | Grocery projection request rate      | TBD      | event funnel                | `grocery_projection_requested` per completed plan _(re-pointed: "handoff completed" is not observable until 007 ships)_ |

---

### US-006-007: Plan Templates

**FRs**: FR-028

| Metric ID   | Metric                   | Target | Source        | Signal                                                                                       |
| ----------- | ------------------------ | ------ | ------------- | -------------------------------------------------------------------------------------------- |
| MET-006-025 | Template save rate       | TBD    | UX event      | `meal_plan_template_saved` per active planner                                                |
| MET-006-026 | Template reuse rate      | TBD    | UX event      | share of plans created via `template_applied` — the anti-churn hypothesis from the ROI model |
| MET-006-027 | Template apply skip rate | ≤ 15%  | API telemetry | entries skipped / entries in template — high means templates are decaying as recipes change  |
| MET-006-028 | Apply success rate       | ≥ 98%  | API telemetry | `POST /meal-plan-templates/{id}/apply` 2xx                                                   |

---

### US-006-006: Premium AI — **Phase 2, not instrumented**

**FRs**: FR-025, FR-026, FR-027 · **Blocked on**: feature 005 and feature 010 (spec C-006-009)

| Metric ID   | Metric                            | Target | Status                       |
| ----------- | --------------------------------- | ------ | ---------------------------- |
| MET-006-009 | Suggestion request success rate   | ≥ 95%  | Phase 2 — no endpoint exists |
| MET-006-010 | Suggestion accept rate            | TBD    | Phase 2                      |
| MET-006-011 | Auto-generation completion rate   | ≥ 90%  | Phase 2                      |
| MET-006-012 | Post-generation edit rate         | TBD    | Phase 2                      |
| MET-006-013 | Optimization request success rate | ≥ 90%  | Phase 2                      |
| MET-006-014 | Suggested swap apply rate         | TBD    | Phase 2                      |

These ids are retained rather than deleted so 010's entitlement work and 005's provider work have stable anchors.

---

## Summary Coverage Table

| Story      | FR / SC coverage                               | Metrics | Phase |
| ---------- | ---------------------------------------------- | ------- | ----- |
| US-006-001 | FR-022, FR-029, FR-037                         | 3       | 1     |
| US-006-002 | FR-023, FR-030, FR-031, FR-032, FR-033, FR-034 | 4       | 1     |
| US-006-003 | FR-024, FR-033, NFR-004, NFR-006, SC-006-003   | 7       | 1     |
| US-006-005 | FR-035, SC-006-005                             | 3       | 1     |
| US-006-004 | FR-036, SC-006-001                             | 2       | 1     |
| US-006-007 | FR-028                                         | 4       | 1     |
| US-006-006 | FR-025, FR-026, FR-027                         | 6       | **2** |

---

## Signal Freeze

- **Hard targets from `spec.md`**: SC-006-001 (workflow time), SC-006-002 (≤ 3 interactions), SC-006-003 (p95 ≤ 500 ms),
  SC-006-004 (100% state test coverage), SC-006-005 (zero placeholder residue). The May version had exactly one; the
  reconciled spec has five, and **three of them are checked in CI** rather than in a usability session.
- **TBD** metrics require product analytics calibration and are **not** hard requirements. They remain unset rather than
  invented — an invented retention target is worse than an absent one, because it gets cited as though it were agreed.
- **Degraded-state metrics** (MET-006-018, -019, -027) are deliberately included. A feature that renders partial and
  orphaned states honestly needs to know how often users see them; otherwise the honesty is untested in production.
