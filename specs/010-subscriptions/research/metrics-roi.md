# Metrics and ROI: Subscriptions & Monetization

**Branch**: `010-subscriptions` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [tasks.md](../tasks.md), [v-model/requirements.md](../v-model/requirements.md), [plan.md](../plan.md)

---

## Overview

This document captures portfolio-level monetization and operational outcomes for feature 010. Story-level product metrics remain in `product-spec/metrics.md`.

---

## 1. Requirements-Driven Metric Anchors

| Requirement         | Intent                     | Portfolio Signal                                  |
| ------------------- | -------------------------- | ------------------------------------------------- |
| `FR-040`            | Valuable free baseline     | Free-tier engagement depth and retention          |
| `FR-041`            | Premium value unlocks      | Premium activation and premium feature adoption   |
| `FR-042`            | Effective upgrade prompts  | Prompt-to-checkout and prompt-to-conversion rates |
| `FR-043`            | Safe downgrade lifecycle   | Post-cancel retention and reactivation rates      |
| `NFR-003`/`NFR-004` | Accessible monetization UI | Accessible prompt interaction success             |

---

## 2. Growth and Conversion Metrics

### SC-aligned outcomes from `spec.md`

- **SC-005**: 80% of free-tier users engage with at least 3 core features in week 1.
- **SC-006**: 5% premium conversion of active free-tier users within 3 months.

### Supporting KPI set

| KPI ID     | Metric                                      | Target | Source                        |
| ---------- | ------------------------------------------- | ------ | ----------------------------- |
| ROI-010-01 | Upgrade prompt view-to-click rate           | >= 20% | UI telemetry                  |
| ROI-010-02 | Checkout start rate from prompt CTA         | >= 12% | API + frontend telemetry      |
| ROI-010-03 | Checkout completion rate once started       | >= 60% | Stripe + backend events       |
| ROI-010-04 | Trial-to-paid conversion (if trial enabled) | >= 35% | subscription lifecycle events |
| ROI-010-05 | 30-day premium retention                    | >= 70% | account subscription state    |

---

## 3. Operational SLOs (Billing Reliability)

| SLO                                     | Target                                                  | Measurement                                                 |
| --------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Webhook processing success              | >= 99.9% non-transient success after retries            | webhook event processing logs                               |
| Duplicate webhook side effects          | 0 duplicate state mutations per event ID                | `stripe_webhook_events` idempotency table audits (ADR-0018) |
| Entitlement propagation delay           | <= 60s from billing event to account state sync         | event timestamp delta                                       |
| `PREMIUM_REQUIRED` contract consistency | 100% of gated denials include stable code + upgrade URL | API integration tests                                       |

---

## 4. Dunning and Churn Recovery Metrics

| KPI ID     | Metric                                            | Target |
| ---------- | ------------------------------------------------- | ------ |
| ROI-010-06 | Recovery rate from `past_due` within grace period | >= 25% |
| ROI-010-07 | Cancellation save rate (retention offer accepted) | >= 10% |
| ROI-010-08 | Reactivation rate within 60 days of downgrade     | >= 15% |

These metrics align with plan support for payment failure and cancellation lifecycle handling.

---

## 5. Data Retention and Trust Metrics (`FR-043`)

| KPI ID     | Metric                                                     | Target | Rationale                                     |
| ---------- | ---------------------------------------------------------- | ------ | --------------------------------------------- |
| ROI-010-09 | Post-cancel data integrity incidents                       | 0      | Lapse must not destroy user data              |
| ROI-010-10 | User-reported billing confusion tickets / 1k active users  | < 5    | Clarity of downgrade and gating communication |
| ROI-010-11 | Successful regain of premium capabilities after re-upgrade | 100%   | Trust in reversible subscription lifecycle    |

---

## 6. Cost and Unit Economics Signals

Track:

- billing infrastructure operating costs (webhook processing, storage overhead)
- payment provider fees as percent of subscription revenue
- support burden for billing issues per 1k subscribers

### Indicative targets

- Billing-support contacts < 8 per 1k paying users/month
- Revenue leakage from failed payment handling < 2%

---

## 7. Instrumentation Recommendations

Minimum event taxonomy:

- `upgrade_prompt_viewed`
- `upgrade_prompt_cta_clicked`
- `checkout_session_created`
- `checkout_completed`
- `subscription_state_changed`
- `payment_failed`
- `subscription_canceled`
- `subscription_reactivated`
- `restore_purchase_attempted`

All events should include: `userId`, `plan_before`, `plan_after`, `feature_context`, timestamp, and channel (`web`/`mobile`).

---

## 8. Risks

1. If store billing channels are introduced later without unified entitlement telemetry, conversion and churn analysis can fragment.
2. If upgrade prompts are too frequent, short-term CTR may rise while long-term retention drops.
3. If downgrade messaging is unclear, trust erosion can offset monetization gains.
