# Metrics and ROI: Clerk User Authentication

**Branch**: `002-user-auth` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md) (NFR + SC sections), [plan.md](../plan.md)

---

## Overview

This document captures success metrics and ROI framing for feature 002. It covers three categories: **operational SLOs**, **security/reliability outcomes**, and **delivery economics**.

---

## 1. Operational SLOs

### Signup and Session Experience

| Metric                                                 | Target   | Source |
| ------------------------------------------------------ | -------- | ------ |
| Signup end-to-end completion time                      | < 60s    | SC-001 |
| Returning-user authenticated startup                   | < 3s     | SC-002 |
| Transparent refresh success rate (valid refresh token) | >= 99.9% | SC-003 |
| Profile page load latency                              | < 2s     | SC-005 |

---

### Authorization Correctness

| Metric                                            | Target           | Source                 |
| ------------------------------------------------- | ---------------- | ---------------------- |
| Unauthenticated protected API request enforcement | 100% receive 401 | SC-006 / FR-038        |
| Authorizer cached latency                         | < 50ms p99       | plan performance goals |
| API Gateway auth 401 latency                      | < 5ms p99        | plan performance goals |

---

### Lifecycle Operations

| Metric                                              | Target                         | Source |
| --------------------------------------------------- | ------------------------------ | ------ |
| Account deletion completion (user-visible workflow) | < 30s                          | SC-004 |
| Password reset email dispatch (Clerk-managed)       | < 60s                          | SC-008 |
| Suspension deny-path correctness                    | 100% blocked users receive 403 | FR-042 |

---

## 2. Reliability and Data Consistency Metrics

### Signup Sync Reliability

| Metric                                                       | Target                | Source         |
| ------------------------------------------------------------ | --------------------- | -------------- |
| Post-registration DB sync success on initial attempt         | >= 99%                | FR-013..FR-016 |
| Orphaned Clerk users unresolved beyond reconciliation window | 0                     | FR-017         |
| Reconciliation job success rate                              | >= 99.5% nightly runs | plan + FR-017  |

---

### Async Deletion Pipeline Reliability

| Metric                                           | Target | Source                         |
| ------------------------------------------------ | ------ | ------------------------------ |
| Async deletion retry eventual success before DLQ | >= 99% | FR-024 + plan backoff strategy |
| DLQ visible message count steady-state           | 0      | plan / observability tasks     |
| Time-to-repair for DLQ-auth failures             | < 24h  | operational SRE target         |

---

## 3. Engineering Quality Gates (NFR-Derived)

| Quality Gate                                                      | Target                              | Source           |
| ----------------------------------------------------------------- | ----------------------------------- | ---------------- |
| Strict typing and zero unauthorized `any` usage                   | 100% compliance                     | NFR-001          |
| Exported symbol JSDoc coverage                                    | 100%                                | NFR-002          |
| Required CI gates pass rate (`typecheck`, `lint`, `format:check`) | 100% before merge                   | NFR-007          |
| Accessibility queryability on auth UI (`getByRole`/`getByLabel`)  | 100% relevant flows                 | NFR-004          |
| Structured logging + metrics + tracing + error tracking coverage  | all backend auth flows instrumented | NFR-012..NFR-015 |

---

## 4. ROI Framing

### Value Realization

1. **Foundation unlock**: Authentication is prerequisite infrastructure for protected-domain features in downstream specs.
2. **Reduced support burden**: Managed Clerk lifecycle flows reduce bespoke password/security support requirements.
3. **Risk reduction**: Outsourcing credential handling lowers security incident exposure versus custom-auth implementation.
4. **Faster delivery**: Existing SDK ecosystem shortens path to web/mobile parity.

---

### Cost Considerations

- Direct platform cost is Clerk subscription + AWS serverless/integration workload.
- Indirect operational cost includes queue/reconciliation observability ownership.
- Alternative “custom auth” path has lower vendor fees but materially higher engineering and security maintenance cost.

---

## 5. Measurement Instrumentation Plan

| Signal Domain                   | Primary Source                        |
| ------------------------------- | ------------------------------------- |
| Auth flow timings               | client telemetry + API logs           |
| Token refresh outcomes          | auth service metrics/events           |
| 401/403 enforcement correctness | API Gateway + authorizer logs/metrics |
| Deletion retry outcomes         | SQS consumer metrics + DLQ alarms     |
| Reconciliation drift            | nightly job reports                   |

---

## 6. Open Metric Gaps

1. `spec.md` defines success criteria but does not specify canonical metric event names.
2. `plan.md` states latency/perf goals but not final dashboard schema.

These are non-blocking and should be finalized during revalidation/implementation instrumentation work.
