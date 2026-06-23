# Metrics: Source-Agnostic Food Data Integration — Story-Level

**Branch**: `003-usda-food-data`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)
**Distinction from research/metrics-roi.md**: That file covers portfolio-level ROI and system SLO framing. This file is story-level — per-user-story measurable outcomes for product teams.

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._
_Updated 2026-06-22: re-baselined to the source-agnostic model. The `fdcId` cache-hit-rate / p99-by-`fdcId` KPIs are replaced by source-agnostic outcomes keyed on the internal `id`: add-by-name → RESOLVED time, ingredient resolution accuracy (% resolved without manual disambiguation), UNRESOLVED rate, golden-record field completeness, per-source rate-budget adherence (USDA ≤1,000/hr), `fetch_queue` depth, and NOT_FOUND/FAILED rates. `fdcId`/USDA terms are confined to adapter-boundary mentions._

---

## Metric Notation

Each metric is tied to a Must Have user story. "Measurable" means a queryable signal (API telemetry, queue metrics, DB query, or UX event) with a defined target and window. Lifecycle status is `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`; reads and metrics key on the internal food `id`, never a source-native key.

---

## Story-Level Metrics

### US-0: Authenticated & Authorized Access (with fairness by demotion)

**Story**: As any caller, I must present a valid Clerk token to reach any endpoint; insufficient scope is `403`; no single account can exhaust the shared per-source budget or starve others (dynamic queue demotion, no per-user quota, no `429`).

**FRs**: FR-035, FR-036, FR-040, FR-043, FR-044, FR-051, FR-052

| Metric ID  | Metric                                      | Target                | Source              | Signal                                                                  |
| ---------- | ------------------------------------------- | --------------------- | ------------------- | ----------------------------------------------------------------------- |
| MET-US0-01 | Unauthenticated-rejection completeness      | 100%                  | API logs + tests    | every `/v1/foods/*` route + WS `$connect` returns `401` (SC-010)        |
| MET-US0-02 | Token-verification latency (incl. flood)    | p95 <= 10ms           | API telemetry       | verify-time histogram under invalid-token flood (SC-011)                |
| MET-US0-03 | Demotion fairness (no starvation, no `429`) | 0 starvation; 0 `429` | Queue + API metrics | a `sub` with >50 pending demoted to back; others keep draining (SC-012) |

---

### US-001: Single Food Read (Resolved Hit)

**Story**: As a recipe author, I can read a locally-`RESOLVED` food's golden record instantly by `id`, with no external source call.

**FRs**: [FR-001](../spec.md#requirements-_mandatory_), [FR-002](../spec.md#requirements-_mandatory_), [FR-004](../spec.md#requirements-_mandatory_)

| Metric ID    | Metric                              | Target  | Source         | Signal                                                   |
| ------------ | ----------------------------------- | ------- | -------------- | -------------------------------------------------------- |
| MET-US001-01 | p95 RESOLVED read latency (by `id`) | <= 50ms | API telemetry  | `GET /v1/foods/{id}` request histogram (SC-001)          |
| MET-US001-02 | Local-read isolation compliance     | 100%    | Trace sampling | zero external source calls in request-path traces        |
| MET-US001-03 | Tombstone short-circuit correctness | 100%    | API logs       | no requeue on `NOT_FOUND`/`FAILED` reads; `404` + status |

---

### US-002: Add Food By Name (Async Resolution)

**Story**: As a recipe author, I add a food **by name**, get an immediate `202` + `id`, and the food resolves in the background (or becomes `UNRESOLVED` for me to disambiguate).

**FRs**: FR-003, FR-005, FR-011, FR-013, FR-MRG-1

| Metric ID    | Metric                                        | Target                       | Source                   | Signal                                                                  |
| ------------ | --------------------------------------------- | ---------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| MET-US002-01 | Add-by-name accept latency                    | <= 100ms                     | API telemetry            | time to `202 PENDING` + `id` response                                   |
| MET-US002-02 | Add-by-name → RESOLVED time (queue depth<100) | p95 <= 60s                   | Status + queue telemetry | `202` timestamp to first `RESOLVED` (excl. `UNRESOLVED` waits) (SC-003) |
| MET-US002-03 | Normalized-name dedup efficiency              | >= 95% duplicate suppression | Queue metrics            | distinct `id`s created / concurrent same-name adds                      |

---

### US-002a: Disambiguate Candidates and Resolve

**Story**: As a user, when an add is ambiguous I pick the matching candidate and the food becomes `RESOLVED` from my pick.

**FRs**: FR-RES-1, FR-RES-2, FR-RES-3

| Metric ID     | Metric                                   | Target | Source             | Signal                                                                          |
| ------------- | ---------------------------------------- | ------ | ------------------ | ------------------------------------------------------------------------------- |
| MET-US002a-01 | Ingredient resolution accuracy           | >= 90% | Resolution metrics | foods reaching `RESOLVED` without manual disambiguation / total (30-day cohort) |
| MET-US002a-02 | UNRESOLVED rate                          | <= 10% | Lifecycle metrics  | foods entering `UNRESOLVED` / total add-by-name resolutions                     |
| MET-US002a-03 | Candidate-selection validity enforcement | 100%   | API logs + tests   | `PATCH` with a candidate not in the food's set rejected (`400`/`409`)           |

---

### US-003: Per-Source Rate-Limit-Safe Consumer

**Story**: As operations, the consumer stays within each source's budget (USDA: 1,000 req/hr) under load.

**FRs**: FR-019, FR-020, FR-021, FR-022, FR-026, FR-027

| Metric ID    | Metric                                     | Target                 | Source                       | Signal                                                           |
| ------------ | ------------------------------------------ | ---------------------- | ---------------------------- | ---------------------------------------------------------------- |
| MET-US003-01 | Per-source rolling-window adherence (USDA) | 100% windows compliant | CloudWatch + source_call_log | calls in any trailing 60 min <= source cap (USDA 1,000) (SC-002) |
| MET-US003-02 | Unexpected source `429` rate (normal op.)  | 0                      | Error metrics                | source `429` count under normal operation                        |
| MET-US003-03 | Single-consumer invariant                  | exactly 1              | Worker metrics               | one Fargate worker holds the Postgres advisory lock              |

---

### US-004: Bulk Ingredient Resolution (Recipe Import)

**Story**: As a recipe author, unknown ingredient names from an import each create one `id` and resolve via fan-out; the response returns resolved foods inline and pending `id`s per item.

**FRs**: FR-012, FR-045, FR-MRG-1

| Metric ID    | Metric                                | Target              | Source                 | Signal                                                                  |
| ------------ | ------------------------------------- | ------------------- | ---------------------- | ----------------------------------------------------------------------- |
| MET-US004-01 | Per-item partial-response correctness | 100%                | API logs + tests       | resolved foods inline + each miss returned as `PENDING` + `id` (FR-045) |
| MET-US004-02 | Effective fan-out/merge throughput    | >= 5,000 foods/hour | Queue + worker metrics | foods resolved per hour (USDA adapter batch ≤20 keys/call) (SC-005)     |
| MET-US004-03 | Batch-size limit enforcement          | 100%                | API logs + tests       | requests > 100 names/`id`s rejected `400`, nothing enqueued (FR-045)    |

---

### US-005: Demand-Weighted Queue + Failure Recovery

**Story**: As operations, the most-demanded misses rise to the front, no request is silently dropped, and failures are recoverable and auditable.

**FRs**: FR-014, FR-015, FR-016, FR-017, FR-018

| Metric ID    | Metric                                    | Target                                  | Source               | Signal                                                            |
| ------------ | ----------------------------------------- | --------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| MET-US005-01 | High-demand starvation incidents          | 0                                       | Queue-age dashboards | aging-applied order; no `id` pinned/starved (FR-044)              |
| MET-US005-02 | Tombstone capture correctness             | 100% after max retries                  | Postgres/CloudWatch  | `FAILED` after 5 attempts → row `status='tombstone'` (SC-006)     |
| MET-US005-03 | NOT_FOUND / FAILED rate                   | NOT_FOUND <= 5%; FAILED <= 1%           | Lifecycle metrics    | terminal-tombstone foods / total resolutions                      |
| MET-US005-04 | Queue depth (steady-state) + backpressure | depth <= ceiling (10,000); `503` at cap | Queue metrics        | `fetch_queue` pending-row depth; enqueue `503` when full (FR-046) |

---

## Cross-Story Quality & Availability Metrics

These span stories and anchor the source-agnostic data-quality and availability SLOs.

| Metric ID    | Metric                                     | Target                                            | Source             | Signal                                                                                                |
| ------------ | ------------------------------------------ | ------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| MET-XQ-01    | Golden-record field completeness           | >= 95% of RESOLVED foods have calories + 4 macros | DB query           | `food_nutrients` coverage per `RESOLVED` food (SC-008)                                                |
| MET-XQ-02    | Provenance integrity                       | 100%                                              | DB query + tests   | every scalar/nutrient/portion on a `RESOLVED` food resolves a `source_id`/`field` provenance (SC-013) |
| MET-XQ-03    | Source-coupling absence (adapter boundary) | 100%                                              | Static + API tests | no `fdcId`/source-native id in any canonical row, DAO, DTO, or API field (SC-013)                     |
| MET-AVAIL-01 | Food data API availability                 | 99.9% monthly                                     | CloudWatch         | 2xx/3xx/4xx over total; only 5xx/timeouts count as downtime (SC-009)                                  |

---

## Summary Coverage Table

| Story   | Metrics Count | Primary SLO Anchor       |
| ------- | ------------: | ------------------------ |
| US-0    |             3 | SC-010 / SC-011 / SC-012 |
| US-001  |             3 | SC-001                   |
| US-002  |             3 | SC-003                   |
| US-002a |             3 | SC-008 (accuracy)        |
| US-003  |             3 | SC-002                   |
| US-004  |             3 | SC-005                   |
| US-005  |             4 | SC-006                   |
| Cross   |             4 | SC-008 / SC-009 / SC-013 |

---

## Signalfreeze

If metric definitions change, update this file and `research/metrics-roi.md` together to keep product-level and system-level metrics aligned.
