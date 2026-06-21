# Tech Stack Rationale

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [research.md](../research.md), [spec.md](../spec.md)

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._

---

## Overview

Feature 003 chooses a queue-centric AWS architecture that treats USDA rate limiting as a first-class system constraint. The selected stack optimizes predictable request-path latency and operational resilience over synchronous freshness.

---

## API Layer: Local-Store-First Food Endpoints

### Choice

API reads from PostgreSQL (optional Redis) and never calls USDA directly on request path.

### Rationale

- Required by FR-001 and FR-009.
- Guarantees low, predictable latency for cache-hit reads.
- Isolates client experience from external API outages.

### Trade-offs

| Trade-off                            | Mitigated By                                      |
| ------------------------------------ | ------------------------------------------------- |
| Eventual consistency on first lookup | Pending-status contract + polling                 |
| Extra infrastructure complexity      | Deterministic queue/event model and observability |

---

## Persistence: PostgreSQL + Optional Redis

### Choice

PostgreSQL as durable source of truth; Redis optional accelerator for full architecture.

### Rationale

- PostgreSQL supports status lifecycle, JSON nutrients, and indexed search.
- Lean launch supports PostgreSQL-only path (A-002), including the `fetch_queue` and `usda_call_log` rolling-window tables.
- Redis is a deferred accelerator for lower p95 reads at scale; the rolling-window rate limiter remains Postgres-backed by default.

### Trade-offs

| Trade-off                           | Mitigated By                                  |
| ----------------------------------- | --------------------------------------------- |
| Redis operational overhead          | Defer Redis; add only when threshold exceeded |
| PostgreSQL-only higher read latency | Use indexing + targeted cache layer rollout   |

---

## Search: PostgreSQL FTS + pg_trgm

### Choice

Local fuzzy search using PostgreSQL full-text + trigram matching.

### Rationale

- Explicit FR requirement (FR-008, FR-010).
- Keeps search completely local (FR-009).
- Supports search-as-you-type with typo tolerance.

---

## Async Pipeline: Postgres fetch_queue (LISTEN/NOTIFY) + Fargate worker

### Choice

Postgres-as-queue architecture: a single demand-weighted `fetch_queue` table drained by a single-instance Fargate consumer worker (held under an advisory lock), woken via `LISTEN/NOTIFY`. The demand path is a direct `INSERT … ON CONFLICT` + `pg_notify`; EventBridge is used only for scheduled producers and the `FoodDataReceived` event. There is no SQS, no consumer Lambda, and no DLQ — terminal failures are recorded as tombstone rows.

### Rationale

- Matches selected architecture in plan.
- Single fetch_queue with dynamic demotion handles user-facing misses vs bulk/stale jobs without separate High/Low queues.
- Idempotent upsert + tombstone rows compose retry semantics and terminal-failure capture without dead-letter infrastructure.

### Trade-offs

| Trade-off                           | Mitigated By                                |
| ----------------------------------- | ------------------------------------------- |
| Queue-ordering and retry complexity | Idempotent upsert + pending dedupe strategy |
| Operational tuning burden           | CloudWatch metrics and alarms from day one  |

---

## Rate Limiting: Rolling 60-minute window (usda_call_log)

### Choice

A rolling 60-minute window backed by a `usda_call_log` table: ≤1,000 calls per trailing hour, pausing at 900 (90%), enforced in the consumer before each USDA call. Postgres-backed is the lean-launch default; a Redis variant is deferred.

### Rationale

- Direct mapping to USDA external limit and FR-019..FR-022.
- A rolling window enforces ≤1,000/trailing-hour strictly; a 1,000-cap token bucket refilling 1,000/hr could emit ~2,000 across a rolling hour and breach the cap.
- Allows deterministic “skip + requeue” behavior when the window is at capacity.

### Trade-offs

| Trade-off                                                | Mitigated By                            |
| -------------------------------------------------------- | --------------------------------------- |
| Under-utilization risk with conservative pause threshold | Batch endpoint usage (FR-023, SC-005)   |
| Window-query cost on the hot path                        | Single-consumer + indexed usda_call_log |

---

## USDA Integration Mode

### Choice

- Single fetch: `GET /v1/food/{fdcId}`
- Batch fetch: `POST /v1/foods` up to 20 IDs

### Rationale

- Required by FR-023.
- Batch mode amortizes token consumption and boosts throughput.

---

## Observability Stack

### Choice

CloudWatch metrics, alarms, and dashboard-first operations with tombstone-rate and queue-age alerts.

### Rationale

- Required for SC-006/SC-009 operational confidence.
- Supports P3 observability user story without changing core architecture.

---

## Research Question Mapping

| Research Question                 | Stack Decision                                               |
| --------------------------------- | ------------------------------------------------------------ |
| RQ-1 (data types)                 | Preserve USDA data type distinctions in UI and persistence   |
| RQ-2 (API/rate limits)            | Postgres-as-queue + rolling-window limiter mandatory         |
| RQ-3 (alternative APIs)           | USDA-first; no paid API dependency at launch                 |
| RQ-4 (TypeScript implementations) | Typed client + explicit error taxonomy                       |
| RQ-5 (Fargate worker patterns)    | Single demand-weighted fetch_queue + tombstone + retry model |
| RQ-6/RQ-7 (integration pipeline)  | Optional ingredient linkage path with async backfill         |
| RQ-8 (UX lookup patterns)         | Search-as-you-type + disambiguation + pending status         |
