# Metrics: Notification Service — Story-Level

**Branch**: `014-notification-service`
**Date**: 2026-05-13
**Status**: Bootstrapped from [product-spec.md](./product-spec.md)
**Distinction from research metrics**: this file tracks product execution signals; it is not implementation or release evidence.

---

## Story-Level Metrics

### Publish API and Delivery

| Metric ID   | Metric                                   |   Target | Source                      |
| ----------- | ---------------------------------------- | -------: | --------------------------- |
| MET-014-001 | Publish API success rate                 | >= 99.9% | API telemetry               |
| MET-014-002 | Publish p95 latency                      | <= 250ms | API telemetry               |
| MET-014-003 | Duplicate delivery from idempotent retry |        0 | delivery audit              |
| MET-014-004 | Unauthorized publish attempts blocked    |     100% | security tests + audit logs |

### Recipient Experience

| Metric ID   | Metric                                  |   Target | Source                  |
| ----------- | --------------------------------------- | -------: | ----------------------- |
| MET-014-005 | Live delivery p95 for connected clients |    <= 2s | client/server telemetry |
| MET-014-006 | Replay retrieval success rate           | >= 99.5% | API telemetry           |
| MET-014-007 | Deep-link resolution success            |   >= 98% | client telemetry        |
| MET-014-008 | Stale/expired message display incidents |        0 | QA + support incidents  |

### Operations and Governance

| Metric ID   | Metric                                         |                                    Target | Source                 |
| ----------- | ---------------------------------------------- | ----------------------------------------: | ---------------------- |
| MET-014-009 | Delivery failure observability coverage        | 100% of failure classes have logs/metrics | observability review   |
| MET-014-010 | Global broadcast audit completeness            |                                      100% | admin audit log        |
| MET-014-011 | Producer contract compatibility test pass rate |                                      100% | integration test suite |
| MET-014-012 | Notification owner drift incidents             |                                         0 | governance review      |

### Dual ingress (added 2026-08-10)

The event path introduced two signals nothing above measures. MET-014-009 claims 100% coverage of failure
classes, and an event-path rejection is a failure class that produces no response to anyone — so without
MET-014-013 that claim is not measurable.

| Metric ID   | Metric                                                    | Target | Source                            |
| ----------- | --------------------------------------------------------- | -----: | --------------------------------- |
| MET-014-013 | Event-path rejections dead-lettered with a reason code    |   100% | DLQ records vs rejection counters |
| MET-014-014 | Event-path rejections silently dropped                    |      0 | DLQ depth vs adapter reject count |
| MET-014-015 | Non-allowlisted `source` envelopes delivered              |      0 | security tests + delivery audit   |
| MET-014-016 | Ingress parity: paired per-rule tests agreeing on outcome |   100% | integration test suite            |
| MET-014-017 | Duplicate delivery from transport redelivery              |      0 | delivery audit vs replayed events |

MET-014-015 is the only metric here whose target is a security property rather than a quality one: a single
non-zero reading means a notification was addressed to a user by an unauthorized principal.
