# SLIs / SLOs — feature 001-commise-recipe-app

> Produced by Product Forge Phase 9 (release-readiness), 2026-07-16.
> Source of truth for targets: `spec.md` §Success Criteria + §NFR.

## SLIs and targets

| SLI                       | Definition                                 | Target (SLO)         | Window         | Source      |               Instrumented today?                |
| ------------------------- | ------------------------------------------ | -------------------- | -------------- | ----------- | :----------------------------------------------: |
| API latency               | p95 of recipe-service request latency      | **≤ 500 ms**         | rolling 30d    | SC-009      |           ❌ not yet — see action item           |
| API availability          | 1 − (5xx / total)                          | ≥ 99.5%              | rolling 30d    | derived NFR |                    ❌ not yet                    |
| Concurrency headroom      | sustained concurrent users at target p95   | 10,000               | load-test gate | SC-009      | ⚠️ k6 SC-009 scripted, CI-gated (not a live SLI) |
| Version-archive freshness | oldest pending archive age                 | < 1 h                | live           | FR-007b-i   |   ✅ `OldestPendingArchiveAgeSeconds` + alarm    |
| Version-archive backlog   | pending archive count                      | < 100                | live           | FR-007b-i   |        ✅ `PendingArchiveBacklog` + alarm        |
| Erasure timeliness        | oldest erasure job age                     | < 1 h (stuck signal) | live           | GDPR        |     ✅ `OldestErasureJobAgeSeconds` + alarm      |
| Erasure integrity         | archive orphans deleted under erased owner | 0                    | live           | GDPR        |        ✅ `ArchiveOrphansDeleted` + alarm        |

## Error budget

- **API availability SLO 99.5% / 30d** ⇒ error budget ≈ **3h 39m/month** of unavailability (or equivalent 5xx volume).
- **Compliance SLIs (erasure) are not budgeted** — the target is **zero**. A single stuck erasure job (>1h) or a single orphan-delete event is an incident, page immediately (P1). There is no "acceptable rate" of a GDPR-erasure miss.
- Archive freshness/backlog carry an operational budget only (P2): brief backlog during a traffic spike is tolerable as long as the age alarm stays clear.

## Gaps (drive the action items in release-readiness.md)

1. **API latency + error SLIs are not emitted in prod.** The k6 SC-009 load test proves the target is _achievable_ in CI, but no live CloudWatch/Sentry metric or alarm asserts p95 ≤ 500ms or the 5xx rate against real traffic. **MUST** instrument before SC-009 can be claimed as an operating SLO (not just a load-test pass). Cheapest path: alarm on the shared ALB target group's `TargetResponseTime` (p95) + `HTTPCode_Target_5XX_Count` for the recipe-service target group — no app change required.
2. The worker-path SLIs (archive + erasure) are fully instrumented and alarmed; they need only an **SNS subscription** to reach a human.
