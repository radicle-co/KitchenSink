# Metrics and ROI: Cooking Mode

**Branch**: `008-cooking-mode` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md)

---

## Overview

This document captures success metrics and ROI hypotheses for cooking mode at the feature level. It combines requirement-derived quality gates with user-outcome indicators specific to in-kitchen execution.

---

## 1. Requirement-Derived Quality Metrics

| Requirement           | Metric                        | Target                                               | Measurement                                 |
| --------------------- | ----------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| FR-032 / REQ-001      | Step readability compliance   | 100% of production screens meet typography baseline  | Visual regression + manual spot checks      |
| FR-033 / REQ-002/003  | Navigation reliability        | >= 99.5% successful step transitions                 | Client telemetry (`step_next`, `step_prev`) |
| FR-034 / REQ-004..006 | Timer completion fidelity     | >= 99% timers alert within acceptable drift window   | Timer event telemetry + QA replay           |
| FR-035 / REQ-007      | Wake-lock continuity          | >= 98% sessions maintain awake state while active    | Session lifecycle metrics                   |
| REQ-011               | Offline continuity after load | >= 99% of sessions continue during connectivity loss | Simulated offline E2E runs                  |

---

## 2. Non-Functional Compliance Metrics

| Requirement          | Metric                    | Target                                       | Measurement                 |
| -------------------- | ------------------------- | -------------------------------------------- | --------------------------- |
| NFR-001 / REQ-NF-001 | Strict TS compliance      | 100%                                         | CI typecheck                |
| NFR-002 / REQ-NF-002 | JSDoc coverage on exports | 100% of new cooking-mode exports             | Lint/static audit           |
| NFR-003 / REQ-NF-004 | Accessible control naming | 100% interactive controls queryable          | Playwright/Detox assertions |
| NFR-004 / REQ-NF-005 | Non-color state signaling | 100% status states include text/icon pairing | Design QA checklist         |
| SC-007 / REQ-NF-003  | 3-foot readability        | Pass in formal validation sessions           | Device lab usability test   |

---

## 3. Product Outcome Metrics (Feature Adoption)

| Metric ID  | Metric                           | Initial target                              | Signal                                         |
| ---------- | -------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| MET-CM-001 | Recipe-to-cook-mode entry rate   | >= 30% of recipe detail views               | `enter_cooking_mode` / `view_recipe_detail`    |
| MET-CM-002 | Cooking session completion rate  | >= 70% of started sessions reach last step  | `cook_session_complete` / `cook_session_start` |
| MET-CM-003 | Timer usage rate                 | >= 40% of sessions start at least one timer | `timer_started` events                         |
| MET-CM-004 | Resume prompt acceptance rate    | Monitored (no hard gate initially)          | `resume_session_accepted`                      |
| MET-CM-005 | Error/abandon due to UX friction | <= 5% session exits tagged as friction      | `cook_session_exit` reason taxonomy            |

---

## 4. ROI Hypothesis

Cooking mode should increase retained weekly engagement by making Commise useful during the highest-intent moment: active cooking.

### Hypothesized value drivers

1. **Session depth increase**: Guided steps + timers reduce drop-off mid-recipe.
2. **Trust increase**: Reliable alerts and wake lock create confidence in repeated usage.
3. **Differentiation**: Accessibility-first kitchen UX improves product preference versus static recipe viewers.

### ROI indicators to monitor

- Week-4 retention delta between users who used cooking mode vs users who did not.
- Increase in repeat-cook events per user.
- Decrease in session abandonment at mid-recipe steps.

---

## 5. Warning-Scope Metrics (Non-canonical)

These are tracked only if revalidation promotes them to canonical requirements:

- Ingredient checkoff usage rate.
- Cook-time scaling usage and correction rate.
- Voice command success rate by command type.

Until then, they are exploratory and non-blocking.
