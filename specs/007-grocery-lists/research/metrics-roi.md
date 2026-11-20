# Metrics and ROI: Grocery Lists & Online Ordering

**Branch**: `007-grocery-lists` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [plan.md](../plan.md), [tasks.md](../tasks.md)

---

## Overview

This document defines portfolio-level operational metrics and ROI hypotheses for feature 007. Story-level metrics live in `product-spec/metrics.md`.

---

## 1. Operational SLOs from Spec

### SC-004: 7-day list generation performance

| Metric                                        | Target       | Measurement                              |
| --------------------------------------------- | ------------ | ---------------------------------------- |
| Grocery list generation duration (7-day plan) | <= 5 seconds | API telemetry around generation endpoint |

### SC-008: End-to-end planning-to-list workflow speed

| Metric                                    | Target       | Measurement                                |
| ----------------------------------------- | ------------ | ------------------------------------------ |
| Meal-plan-to-grocery-list completion time | < 10 minutes | UX event timing across workflow milestones |

### NFR-001..NFR-004 compliance baselines

| NFR                      | Baseline Signal                             |
| ------------------------ | ------------------------------------------- |
| NFR-001 strict TS        | CI typecheck pass rate                      |
| NFR-002 JSDoc coverage   | Lint/static documentation checks            |
| NFR-003 accessible names | Playwright role/label selectors pass        |
| NFR-004 non-color state  | UI test assertions for icon/text state cues |

---

## 2. Product Outcome Metrics

### Core Utility Metrics (FR-028 / FR-029)

- **Generated list adoption rate**: percentage of meal plans that produce at least one grocery list
- **Aggregation correctness incident rate**: user-reported or test-detected quantity merge defects
- **Pantry exclusion usage rate**: percentage of generated lists with at least one pantry-marked item
- **In-store completion efficiency proxy**: median time from first item check to final item check

### Ordering Funnel Metrics (FR-030 / FR-031)

- **Store setup initiation rate**: users who open configuration flow
- **Store setup completion rate**: initiated flows that complete successfully
- **Premium conversion assist rate**: free users encountering ordering CTA who upgrade within 7 days
- **Mapped-item ratio**: mapped items / total order-intent items
- **Order handoff completion rate**: successful checkout URL handoffs initiated from app

---

## 3. ROI Hypothesis

Primary value channels:

1. **Retention uplift** from reducing friction between planning and shopping
2. **Subscription uplift** from premium ordering utility
3. **Behavioral stickiness** from repeated weekly list generation patterns

Expected leading indicators:

- Increase in weekly active planners completing shopping workflows
- Increase in repeat grocery list generation per user per month
- Reduction in abandoned meal plans lacking execution steps

---

## 4. Risk Guardrails

| Risk                                      | Metric Guardrail                                      |
| ----------------------------------------- | ----------------------------------------------------- |
| Slow generation under realistic plan size | p95 generation latency alerting against SC-004        |
| Incorrect conversions reducing trust      | Aggregation defect rate and manual item-add overrides |
| Poor store mapping quality                | Mapped-item ratio and unresolved-item rate            |
| Premium gate friction                     | Upgrade prompt dismiss rate and post-prompt churn     |

---

## 5. Immediate Instrumentation Priorities

1. Generation pipeline timing events (start/end + ingredient volume)
2. Pantry toggle and check-off event taxonomy
3. Store setup funnel events (open, connect success/fail, retry)
4. Ordering preflight quality events (mapped/unmapped counts)
5. Accessibility test signal ingestion into CI reporting
