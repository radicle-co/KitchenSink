# Metrics: User Authentication — Story-Level

**Branch**: `002-user-auth`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)
**Distinction from research/metrics-roi.md**: That file covers portfolio-level ROI and business outcomes. This file is story-level — per-user-story measurable outcomes for product teams.

---

## Metric Notation

Each metric is tied to a Must Have user story. "Measurable" means a queryable signal (API telemetry, DB query, or UX event) with a defined target and measurement window.

---

## Story-Level Metrics

### US-001: Cross-platform Auth Entry and Callback

**Story**: As a new user, I can authenticate on web/mobile and complete callback token exchange so I can enter Commise securely.

**FRs**: [FR-001](../spec.md#fr-001), [FR-002](../spec.md#fr-002), [FR-003](../spec.md#fr-003), [FR-004](../spec.md#fr-004), [FR-005](../spec.md#fr-005)

| Metric ID    | Metric                                         | Target | Source              | Signal                                       |
| ------------ | ---------------------------------------------- | ------ | ------------------- | -------------------------------------------- |
| MET-US001-01 | Signup completion rate (start → authenticated) | >= 90% | UX telemetry        | `auth_signup_complete / auth_signup_started` |
| MET-US001-02 | Signup-to-home latency                         | < 60s  | UX timer            | Session timing event (SC-001)                |
| MET-US001-03 | Callback error rate                            | < 1%   | API/web-mobile logs | callback error responses / callback attempts |

---

### US-002: Secure Session Persistence and Refresh

**Story**: As a returning user, my tokens are securely stored and silently refreshed so I can keep using the app without repeated login interruption.

**FRs**: [FR-006](../spec.md#fr-006), [FR-007](../spec.md#fr-007), [FR-008](../spec.md#fr-008), [FR-009](../spec.md#fr-009)

| Metric ID    | Metric                               | Target   | Source                 | Signal                                         |
| ------------ | ------------------------------------ | -------- | ---------------------- | ---------------------------------------------- |
| MET-US002-01 | Transparent refresh success rate     | >= 99.9% | auth metrics           | successful refresh / refresh attempts (SC-003) |
| MET-US002-02 | Returning-user auto-auth latency     | < 3s     | UX timer               | launch-to-authenticated timing (SC-002)        |
| MET-US002-03 | Session-expired redirect correctness | 100%     | API + client telemetry | invalid refresh followed by login redirect     |

---

### US-003: Deterministic Logout

**Story**: As an authenticated user, I can logout and fully invalidate local/remote session continuity so no stale authenticated state remains.

**FRs**: [FR-010](../spec.md#fr-010), [FR-011](../spec.md#fr-011), [FR-012](../spec.md#fr-012)

| Metric ID    | Metric                               | Target | Source               | Signal                                     |
| ------------ | ------------------------------------ | ------ | -------------------- | ------------------------------------------ |
| MET-US003-01 | Logout completion success            | >= 99% | auth API telemetry   | logout success / logout attempts           |
| MET-US003-02 | Post-logout protected-request denial | 100%   | API logs             | protected calls after logout returning 401 |
| MET-US003-03 | Token revocation call success        | >= 99% | IdP integration logs | revocation success / revocation attempts   |

---

### US-004: Signup-to-Database Identity Synchronization

**Story**: As a newly registered user, my identity is synchronized to Commise User/Account records with stable canonical ID, retry protection, and reconciliation fallback.

**FRs**: [FR-013](../spec.md#fr-013), [FR-014](../spec.md#fr-014), [FR-015](../spec.md#fr-015), [FR-016](../spec.md#fr-016), [FR-017](../spec.md#fr-017)

| Metric ID    | Metric                          | Target   | Source                | Signal                                          |
| ------------ | ------------------------------- | -------- | --------------------- | ----------------------------------------------- |
| MET-US004-01 | Initial signup sync success     | >= 99%   | webhook/action logs   | successful User+Account writes / signup events  |
| MET-US004-02 | Retry-assisted recovery rate    | >= 99.5% | webhook retry metrics | eventual success after retries / retry attempts |
| MET-US004-03 | Reconciliation unresolved drift | 0        | nightly job report    | orphaned IdP users without DB record after run  |

---

### US-005: API Authorization Gate

**Story**: As a platform owner, every protected API call must pass token and claim validation so unauthorized traffic is always rejected.

**FRs**: [FR-038](../spec.md#fr-038), [FR-039](../spec.md#fr-039), [FR-040](../spec.md#fr-040)

| Metric ID    | Metric                                  | Target | Source                | Signal                                   |
| ------------ | --------------------------------------- | ------ | --------------------- | ---------------------------------------- |
| MET-US005-01 | Unauthenticated request rejection rate  | 100%   | API Gateway logs      | invalid/missing token → 401 (SC-006)     |
| MET-US005-02 | Authorizer claim-validation correctness | 100%   | authorizer logs/tests | invalid issuer/audience/signature denied |
| MET-US005-03 | Authorizer p99 latency (cached)         | < 50ms | CloudWatch metrics    | authorizer duration p99                  |

---

## Supplemental Should/Could Story Signals

- US-007 account deletion completion under 30s (SC-004)
- US-010 suspension enforcement 403 correctness (FR-042)
- US-011 MFA completion funnel (FR-029..FR-031)

These are tracked but not part of the Must Have primary release gate for this story-level metric set.
