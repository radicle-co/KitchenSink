# Metrics: USDA Food Data Integration — Story-Level

**Branch**: `003-usda-food-data`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)
**Distinction from research/metrics-roi.md**: That file covers portfolio-level ROI and system SLO framing. This file is story-level — per-user-story measurable outcomes for product teams.

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._

---

## Metric Notation

Each metric is tied to a Must Have user story. "Measurable" means a queryable signal (API telemetry, queue metrics, DB query, or UX event) with a defined target and window.

---

## Story-Level Metrics

### US-001: Cache-Hit Single Food Lookup

**Story**: As a recipe author, I can fetch local food data instantly for known `fdcId`s.

**FRs**: [FR-001](../spec.md#requirements-_mandatory_), [FR-002](../spec.md#requirements-_mandatory_), [FR-005](../spec.md#requirements-_mandatory_), [FR-006](../spec.md#requirements-_mandatory_)

| Metric ID    | Metric                              | Target  | Source         | Signal                                 |
| ------------ | ----------------------------------- | ------- | -------------- | -------------------------------------- |
| MET-US001-01 | p95 cache-hit lookup latency        | <= 50ms | API telemetry  | `/v1/foods/{fdcId}` request histogram  |
| MET-US001-02 | Local-read isolation compliance     | 100%    | Trace sampling | zero USDA calls in request-path traces |
| MET-US001-03 | Tombstone short-circuit correctness | 100%    | API logs       | no requeue on `not_found` lookups      |

---

### US-002: Async Backfill on Miss

**Story**: As a recipe author, I get immediate pending response and eventual food availability.

**FRs**: FR-003, FR-004, FR-007, FR-011, FR-013, FR-024, FR-025

| Metric ID    | Metric                                    | Target                       | Source                   | Signal                                          |
| ------------ | ----------------------------------------- | ---------------------------- | ------------------------ | ----------------------------------------------- |
| MET-US002-01 | Pending response latency                  | <= 100ms                     | API telemetry            | time to 202 response                            |
| MET-US002-02 | Pending-to-fetched completion (queue<100) | p95 <= 60s                   | Status + queue telemetry | first pending timestamp to first fetched status |
| MET-US002-03 | Deduplication efficiency                  | >= 95% duplicate suppression | Queue metrics            | unique `fdcId` queued / duplicate requests      |

---

### US-003: Rate-Limit Safe Consumer

**Story**: As operations, consumer stays within USDA limits under load.

**FRs**: FR-019, FR-020, FR-021, FR-022, FR-026, FR-027

| Metric ID    | Metric                                 | Target               | Source                      | Signal                                          |
| ------------ | -------------------------------------- | -------------------- | --------------------------- | ----------------------------------------------- |
| MET-US003-01 | USDA hourly request cap adherence      | 100% hours compliant | CloudWatch + USDA responses | calls/hour <= 1,000                             |
| MET-US003-02 | Unexpected 429 rate (normal operation) | 0                    | Error metrics               | USDA 429 count                                  |
| MET-US003-03 | Consumer concurrency invariant         | exactly 1            | Lambda metrics              | reserved concurrency and active execution count |

---

### US-004: Batch Lookup Efficiency

**Story**: As a recipe author, unknown ingredients are fetched in batches.

**FRs**: FR-012, FR-023, FR-024

| Metric ID    | Metric                                  | Target              | Source                   | Signal                                 |
| ------------ | --------------------------------------- | ------------------- | ------------------------ | -------------------------------------- |
| MET-US004-01 | Average batch size                      | >= 5 IDs/call       | Consumer logs            | IDs per `POST /v1/foods`               |
| MET-US004-02 | Effective food fetch throughput         | >= 5,000 foods/hour | Queue + consumer metrics | fetched foods per hour                 |
| MET-US004-03 | Batch fallback rate to single-call mode | <= 20%              | Consumer telemetry       | single fetch count / total fetch calls |

---

### US-005: Queue Priority + Recovery

**Story**: As operations, high-priority requests are served first and failures are recoverable.

**FRs**: FR-014, FR-015, FR-016, FR-017, FR-018

| Metric ID    | Metric                                      | Target                           | Source                   | Signal                                       |
| ------------ | ------------------------------------------- | -------------------------------- | ------------------------ | -------------------------------------------- |
| MET-US005-01 | High-priority starvation incidents          | 0                                | Queue-age dashboards     | high-priority age alarm count                |
| MET-US005-02 | Tombstone capture correctness               | 100% after max retries           | Postgres/CloudWatch      | failed rows observed as `status='tombstone'` |
| MET-US005-03 | Queue drain recovery time after USDA outage | <= 4 hours for backlog under 10k | Queue + consumer metrics | backlog peak to normalized depth             |

---

## Summary Coverage Table

| Story  | Metrics Count | Primary SLO Anchor |
| ------ | ------------: | ------------------ |
| US-001 |             3 | SC-001             |
| US-002 |             3 | SC-003             |
| US-003 |             3 | SC-002             |
| US-004 |             3 | SC-005             |
| US-005 |             3 | SC-006             |

---

## Signalfreeze

If metric definitions change, update this file and `research/metrics-roi.md` together to keep product-level and system-level metrics aligned.
