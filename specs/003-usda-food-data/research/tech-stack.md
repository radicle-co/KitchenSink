# Tech Stack Rationale

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [research.md](../research.md), [spec.md](../spec.md)

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._
_Updated 2026-06-28: reconciled to the source-agnostic stabilization baseline (`source_call_log`, `FoodFetchCompleted`, local-store-read framing, distinct-requester demand)._

---

## Overview

Feature 003 chooses a queue-centric AWS architecture that treats USDA rate limiting as a first-class system constraint. The selected stack optimizes predictable request-path latency and operational resilience over synchronous freshness.

---

## API Layer: Local-Store-First Food Endpoints

### Choice

API reads from PostgreSQL (optional Redis) and never calls USDA directly on request path.

### Rationale

- Required by FR-001 and FR-009.
- Guarantees low, predictable latency for local-store reads (`RESOLVED` golden records).
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
- Lean launch supports PostgreSQL-only path (A-002), including the `fetch_queue` and `source_call_log` rolling-window tables.
- Redis is a deferred variant for lower p95 reads at scale (ARCH-007); the rolling-window rate limiter remains Postgres-backed by default.

### Trade-offs

| Trade-off                           | Mitigated By                                  |
| ----------------------------------- | --------------------------------------------- |
| Redis operational overhead          | Defer Redis; add only when threshold exceeded |
| PostgreSQL-only higher read latency | Use indexing + targeted Redis-variant rollout |

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

Postgres-as-queue architecture: a single demand-weighted `fetch_queue` table drained by a single-instance Fargate consumer worker (held under an advisory lock — the single-drainer invariant, FR-022), woken via `LISTEN/NOTIFY`. The demand path is a direct `INSERT … ON CONFLICT (food_id, sub)` into `fetch_requesters` + capped distinct-requester `request_count` (`PRIORITY_CAP=1`) + `pg_notify`; EventBridge is used only for scheduled producers and the `FoodFetchCompleted` completion event. There is no SQS, no consumer Lambda, and no DLQ — terminal failures are recorded as tombstone rows. A reaper reverts `in_flight` rows whose `leased_at` is older than the 30s lease back to `pending`.

### Rationale

- Matches selected architecture in plan.
- A single demand-weighted `fetch_queue` with drain-time demotion handles user-facing add-by-name misses vs low-priority background refresh without separate High/Low queues, and without any `drain_priority_tier` column or `enqueueLowPriority` method.
- Idempotent upsert + tombstone rows compose retry semantics and terminal-failure capture without dead-letter infrastructure.

### Trade-offs

| Trade-off                           | Mitigated By                                |
| ----------------------------------- | ------------------------------------------- |
| Queue-ordering and retry complexity | Idempotent upsert + pending dedupe strategy |
| Operational tuning burden           | CloudWatch metrics and alarms from day one  |

---

## Rate Limiting: Rolling 60-minute window (source_call_log)

### Choice

A rolling 60-minute window backed by a `source_call_log` table: ≤1,000 calls per trailing hour, pausing at 900 (90%), enforced in the consumer before each source call. The single-drainer advisory lock (FR-022) makes the read-committed count-and-record effectively serial, which is what makes "zero 429 in any window" safe. Rows older than the trailing 60-min window are pruned on a periodic sweep. Postgres-backed is the lean-launch default; a Redis variant is deferred (ARCH-007).

### Rationale

- Direct mapping to USDA external limit and FR-019..FR-022.
- A rolling window enforces ≤1,000/trailing-hour strictly; a 1,000-cap token bucket refilling 1,000/hr could emit ~2,000 across a rolling hour and breach the cap.
- Allows deterministic “skip + requeue” behavior when the window is at capacity.

### Trade-offs

| Trade-off                                                | Mitigated By                              |
| -------------------------------------------------------- | ----------------------------------------- |
| Under-utilization risk with conservative pause threshold | Batch endpoint usage (FR-023, SC-014)     |
| Window-query cost on the hot path                        | Single-consumer + indexed source_call_log |

---

## USDA Integration Mode

### Choice

These are the USDA adapter's upstream endpoints, used **inside the adapter boundary** only (where `fdcId` = the source's `external_key`):

- Single fetch by external key: `GET /v1/food/{fdcId}`
- Batch fetch by external key: `POST /v1/foods` up to 20 IDs

### Rationale

- Required by FR-023.
- Batch mode amortizes token consumption and boosts the change-driven refresh / external-key resolution throughput. Note that add-by-**name** search is one non-batchable call per new food, so it does **not** benefit from batching (see SC-014).

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
| RQ-6/RQ-7 (integration pipeline)  | Optional ingredient linkage path with async resolution       |
| RQ-8 (UX lookup patterns)         | Search-as-you-type + disambiguation + pending status         |
