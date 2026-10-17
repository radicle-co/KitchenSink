# Research — Notification Service

**Branch**: `014-notification-service`
**Status**: Bootstrap

---

## Index

| Artifact          | File                                                     | Status                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codebase analysis | [codebase-analysis.md](./codebase-analysis.md)           | Drafted; **corrected 2026-08-10** — EventBridge and the Ed25519 service-principal token both already exist in the repo, which closes Q-004.                                                                                      |
| Competitors       | _intentionally deferred_                                 | Delivery-service competitor research is not required until transport/channel strategy is selected.                                                                                                                               |
| UX patterns       | _consumer-owned_                                         | Notification presentation patterns should be authored by consuming UI features; this service owns delivery semantics.                                                                                                            |
| Tech stack        | _decision-dependent_                                     | **Now authorable.** Q-001 (hybrid SQS FIFO + realtime + replay) and Q-004 (Ed25519 service-principal token) are resolved, and FR-024 fixes the producer ingresses. Only the subscriber protocol, SSE vs WebSocket, remains open. |
| Metrics / ROI     | [../product-spec/metrics.md](../product-spec/metrics.md) | Story-level execution metrics exist; portfolio ROI remains deferred until M8 planning.                                                                                                                                           |

---

## Notes

This research folder is intentionally minimal at bootstrap. The product spec captures the immediate decision context; deeper research artifacts should be filled in once the open questions in [../product-spec/product-spec.md](../product-spec/product-spec.md) are resolved and the implementation direction is chosen.

**2026-08-10.** The dual-ingress amendment did not need new research — it needed the existing snapshot to be
accurate. Two of its recorded findings were wrong, and one of them (no service-to-service auth pattern in the
repo) held Q-004 open and blocked T-003 while the answer sat in `packages/shared/recipe-core`. The lesson is
recorded here rather than only in the corrected file: a research finding of the form "X does not exist in this
repo" needs the search that produced it stated, or it cannot be re-checked.
