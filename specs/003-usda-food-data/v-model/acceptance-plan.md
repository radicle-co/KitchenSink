# Acceptance Test Plan: USDA Food Data

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/003-usda-food-data/v-model/requirements.md`, `specs/003-usda-food-data/v-model/system-test.md`

---

## Overview

This plan maps BDD acceptance scenarios to every REQ-\* requirement in the USDA Food Data Integration feature. Each scenario is written from the perspective of an authenticated Commise client interacting with the public API surface, not from the perspective of internal components. Internal component behavior is covered by the System Test Plan (`system-test.md`).

Acceptance tests verify that the system satisfies user-observable contracts: correct HTTP status codes, correct response bodies, correct async backfill behavior, correct search results, and correct authentication enforcement. Non-functional acceptance criteria (latency, rate-limit compliance, data fidelity) are verified through targeted load probes and metric assertions.

Coverage is complete: every P1 and P2 functional, non-functional, and interface requirement has at least one acceptance test case and one BDD scenario. P3 requirements (optional enhancements) are noted but excluded from the shippable exit gate.

---

## ID Schema

| Identifier               | Pattern      | Meaning                                                                    |
| ------------------------ | ------------ | -------------------------------------------------------------------------- |
| Acceptance Test Case     | `AT-NNN-X`   | NNN = three-digit requirement group number; X = letter suffix (A, B, C...) |
| Acceptance Test Scenario | `ATS-NNN-X#` | Nested under parent AT; # = numeric suffix (1, 2, 3...)                    |

Examples:

- `AT-001-A` — first acceptance test case for the REQ-001 group
- `ATS-001-A1` — first BDD scenario within AT-001-A

---

## Acceptance Test Cases (Tier 1-3 Structure)

---

### Tier 1 — Feature/Epic: Food Lookup (Local-Store Serving)

**User Goal**: As a Commise client, I want to look up a food by its USDA FDC ID and receive either complete nutrition data or a clear async-pending response, so that I can display accurate nutritional information in recipes.

---

#### Tier 2 — REQ-001: Local-store-only serving; USDA API never called in request path

**AT-001-A** — Local store is the exclusive data source for food lookups

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-001-A1**

- **Given** a food record exists locally with `fdcId = 12345` and `fetch_status = 'fetched'`
- **When** an authenticated client sends `GET /v1/foods/12345`
- **Then** the response is `200 OK` with a complete nutrition payload; no USDA API call is made during the request lifecycle

**ATS-001-A2**

- **Given** a food record exists in the Redis cache for `fdcId = 12345` with `fetch_status = 'fetched'`
- **When** an authenticated client sends `GET /v1/foods/12345`
- **Then** the response is `200 OK` with a complete nutrition payload served from cache; no USDA API call is made

---

#### Tier 2 — REQ-002: 200 OK with complete food data when food exists locally as 'fetched'

**AT-002-A** — Complete nutrition payload on cache hit

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-002-A1**

- **Given** a food record exists locally with `fdcId = 11111`, `fetch_status = 'fetched'`, and all required nutrient fields populated
- **When** an authenticated client sends `GET /v1/foods/11111`
- **Then** the response is `200 OK`; the body contains `fdcId`, `description`, `calories`, `protein`, `carbs`, `fat`, and all available micronutrients; no field is null or missing

---

#### Tier 2 — REQ-003: 202 Accepted with pending body when food is unknown and not already pending

**AT-003-A** — Async backfill triggered for unknown food

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-003-A1**

- **Given** no record exists locally for `fdcId = 22222` and it is not in the pending set
- **When** an authenticated client sends `GET /v1/foods/22222`
- **Then** the response is `202 Accepted`; the body is `{"status": "pending", "fdcId": 22222, "estimatedWaitSeconds": <positive integer>}`; a backfill is triggered asynchronously

---

#### Tier 2 — REQ-004: 202 Accepted without re-queuing when food is already pending (deduplication)

**AT-004-A** — Duplicate lookup does not re-queue

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-004-A1**

- **Given** a food record exists locally with `fdcId = 33333` and `fetch_status = 'pending'`
- **When** an authenticated client sends `GET /v1/foods/33333`
- **Then** the response is `202 Accepted` with `{"status": "pending", "fdcId": 33333, "estimatedWaitSeconds": <positive integer>}`; no duplicate fetch is enqueued

---

#### Tier 2 — REQ-005: 404 Not Found for tombstoned foods ('not_found' status)

**AT-005-A** — Tombstoned food returns 404 without re-queuing

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-005-A1**

- **Given** a food record exists locally with `fdcId = 44444` and `fetch_status = 'not_found'`
- **When** an authenticated client sends `GET /v1/foods/44444`
- **Then** the response is `404 Not Found`; no backfill is triggered

---

#### Tier 2 — REQ-006: 400 Bad Request for invalid fdcId format

**AT-006-A** — Input validation rejects non-positive and non-numeric fdcId values

**Technique**: Boundary Value Analysis

##### Tier 3 — BDD Scenarios

**ATS-006-A1**

- **Given** the API is running
- **When** an authenticated client sends `GET /v1/foods/0`
- **Then** the response is `400 Bad Request`; no downstream processing occurs

**ATS-006-A2**

- **Given** the API is running
- **When** an authenticated client sends `GET /v1/foods/-1`
- **Then** the response is `400 Bad Request`

**ATS-006-A3**

- **Given** the API is running
- **When** an authenticated client sends `GET /v1/foods/abc`
- **Then** the response is `400 Bad Request`

**ATS-006-A4**

- **Given** the API is running
- **When** an authenticated client sends `GET /v1/foods/1.5`
- **Then** the response is `400 Bad Request`

---

### Tier 1 — Feature/Epic: Food Status Polling

**User Goal**: As a Commise client, I want to poll the status of a pending food fetch so that I know when nutrition data becomes available without holding an open connection.

---

#### Tier 2 — REQ-007 / REQ-033: GET /v1/foods/{fdcId}/status endpoint

**AT-007-A** — Status endpoint returns current fetch_status and full data when fetched

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-007-A1**

- **Given** a food record exists locally with `fdcId = 55555` and `fetch_status = 'fetched'`
- **When** an authenticated client sends `GET /v1/foods/55555/status`
- **Then** the response is `200 OK`; the body contains `{"fdcId": 55555, "status": "fetched"}` plus the full nutrition payload

**ATS-007-A2**

- **Given** a food record exists locally with `fdcId = 66666` and `fetch_status = 'pending'`
- **When** an authenticated client sends `GET /v1/foods/66666/status`
- **Then** the response is `200 OK`; the body contains `{"fdcId": 66666, "status": "pending", "estimatedWaitSeconds": <positive integer>}`; no nutrition data is included

**ATS-007-A3**

- **Given** a food record exists locally with `fdcId = 77777` and `fetch_status = 'not_found'`
- **When** an authenticated client sends `GET /v1/foods/77777/status`
- **Then** the response is `200 OK`; the body contains `{"fdcId": 77777, "status": "not_found"}`

---

### Tier 1 — Feature/Epic: Food Search

**User Goal**: As a Commise client, I want to search for foods by name so that I can discover ingredients without knowing their exact FDC IDs.

---

#### Tier 2 — REQ-008: GET /v1/foods/search?query=... searches local store

**AT-008-A** — Search returns relevance-ranked results from local store

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-008-A1**

- **Given** the local store contains foods including "Chicken Breast, raw" and "Chicken Thigh, raw"
- **When** an authenticated client sends `GET /v1/foods/search?query=chicken`
- **Then** the response is `200 OK`; the body is a relevance-ranked array containing both chicken records; results are ordered by match relevance

**ATS-008-A2**

- **Given** the local store contains no foods matching "xyzzy"
- **When** an authenticated client sends `GET /v1/foods/search?query=xyzzy`
- **Then** the response is `200 OK`; the body is an empty array

---

#### Tier 2 — REQ-009: Search operates exclusively on local store; no USDA API call

**AT-009-A** — Search never triggers a USDA API call

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-009-A1**

- **Given** the local store contains foods matching "apple"
- **When** an authenticated client sends `GET /v1/foods/search?query=apple`
- **Then** the response is `200 OK` with local results; no USDA API call is made during the request lifecycle

---

#### Tier 2 — REQ-010: Search returns results within 200ms for up to 50,000 foods

**AT-010-A** — Search latency under load

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-010-A1**

- **Given** the local store contains 50,000 food records with GIN index on `description`
- **When** an authenticated client sends `GET /v1/foods/search?query=chicken`
- **Then** the response is `200 OK` and the total server-side processing time is under 200ms at p95 across 100 sequential requests

---

### Tier 1 — Feature/Epic: Async Backfill Pipeline

**User Goal**: As a Commise operator, I want unknown foods to be fetched from USDA automatically and made available within a predictable time window, so that users don't have to wait indefinitely.

---

#### Tier 2 — REQ-011: FoodRequested event published on single-food cache miss

**AT-011-A** — Cache miss triggers async backfill event

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-011-A1**

- **Given** no record exists locally for `fdcId = 88888`
- **When** an authenticated client sends `GET /v1/foods/88888`
- **Then** the response is `202 Accepted`; a `fetch_queue` row (a `FoodRequested` enqueue) is observable within 5 seconds

---

#### Tier 2 — REQ-012: FoodBatchRequested event published for multiple unknown fdcIds

**AT-012-A** — Batch recipe submission triggers a single batch event

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-012-A1**

- **Given** a recipe submission identifies `fdcIds` [99991, 99992, 99993] as unknown locally
- **When** the recipe is submitted
- **Then** a single `FoodBatchRequested` enqueue containing all three IDs is written to `fetch_queue` as low-demand rows (`request_count` 0–1); no individual `FoodRequested` rows are enqueued for those IDs

**AT-012-B** — `POST /v1/foods/batch` mixing cached and uncached ids returns a per-item partial result

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-012-B1**

- **Given** an authenticated client submits `POST /v1/foods/batch` with `fdcIds` where some exist locally (`fetched`/`stale`) and some are unknown
- **When** the request is processed (size within the FR-045 limit of 100)
- **Then** the response is a single body returning the cached/stale foods inline (stale entries carrying a staleness indicator) and each miss as a `pending` entry whose fetch is enqueued — the caller gets available data immediately and polls only the pending ids (no all-or-nothing withholding, FR-045); enqueued misses are subject to the FR-043 demotion fairness, not a per-user quota

---

#### Tier 2 — REQ-013: Deduplication via pending-fetch mechanism

**AT-013-A** — Concurrent lookups for the same unknown food produce one fetch

**Technique**: Fault Injection / Concurrency

##### Tier 3 — BDD Scenarios

**ATS-013-A1**

- **Given** no record exists locally for `fdcId = 11119`
- **When** five authenticated clients concurrently send `GET /v1/foods/11119`
- **Then** all five receive `202 Accepted`; exactly one `FoodRequested` row is enqueued to `fetch_queue` (deduplication enforced)

---

#### Tier 2 — REQ-014: Cache misses enqueue into the single demand-weighted `fetch_queue` (no high/low tier)

**AT-014-A** — Demand-weighted ordering is observable via `fetch_queue` row state

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-014-A1**

- **Given** a single-food cache miss is resolved for an `fdcId` already requested by several distinct `sub`s
- **When** the fetch is enqueued into `fetch_queue`
- **Then** the row's `request_count` reflects the capped distinct-requester count (PRIORITY_CAP=1) from `fetch_requesters`, so it sorts ahead of low-demand rows under `ORDER BY request_count DESC, first_requested ASC`; there is no `priority` column

**ATS-014-A2**

- **Given** a batch request is resolved
- **When** the fetch is enqueued into `fetch_queue`
- **Then** the batch rows carry low/zero user demand (`request_count` 0–1) and sort after high-demand rows naturally — they are written into the same single `fetch_queue`, not a separate low-priority queue

---

#### Tier 2 — REQ-015: Consumer drains the single `fetch_queue` by demand weight (highest `request_count` first)

**AT-015-A** — High-demand rows are processed before low-demand rows

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-015-A1**

- **Given** the single `fetch_queue` contains pending rows with differing `request_count` values (high-demand and low-demand)
- **When** the consumer worker processes a drain cycle
- **Then** the higher-`request_count` rows are leased and consumed before the lower-`request_count` rows, per `ORDER BY request_count DESC, first_requested ASC` (with FR-043 demotion of >50-pending `sub`s applied on top)

---

#### Tier 2 — REQ-016: `fetch_queue` rows retry up to 5 attempts with backoff before tombstoning

**AT-016-A** — Failed rows are tombstoned after exhausting their retry budget

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-016-A1**

- **Given** a `fetch_queue` row causes the consumer to throw an unhandled error on every attempt
- **When** the consumer exhausts its 5 retry attempts (with backoff, FR-016)
- **Then** the row is set to `status = 'tombstone'` (the DLQ-equivalent); it is no longer leasable from the pending set

---

#### Tier 2 — REQ-019: Rolling 60-minute window rate limiter — ≤1,000 USDA calls in any trailing 60 minutes; pause at 90% (900)

**AT-019-A** — Rate limiter prevents more than 1,000 USDA API calls in any rolling 60-minute window

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-019-A1**

- **Given** the rolling-window trailing-60-min USDA call count starts at 0
- **When** the consumer processes single-food fetch rows in rapid succession
- **Then** at most 1,000 USDA API calls are made within any trailing 60-minute window; the consumer pauses draining once the trailing count reaches 900 (90%) and resumes only as earlier calls age out of the window (deferred rows keep their lease released without completion for later retry); no `429` response is received from USDA

---

#### Tier 2 — REQ-021: Consumer defers message when the rolling window is at the cap

**AT-021-A** — Rolling-window saturation causes row deferral, not USDA API call

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-021-A1**

- **Given** the rolling-window trailing-60-min USDA call count is at the 1,000/hr cap
- **When** the consumer attempts to process a `FoodRequested` row
- **Then** no USDA API call is made; the `fetch_queue` row lease (FR-018) is released without completion; the row remains pending for retry once earlier calls age out of the window and the count drops below the threshold

---

#### Tier 2 — REQ-023: Consumer uses single-food GET and batch POST endpoints correctly

**AT-023-A** — Consumer selects the correct USDA endpoint based on message type

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-023-A1**

- **Given** a `FoodRequested` row contains a single `fdcId`
- **When** the consumer processes the row
- **Then** the consumer (via `@kitchensink/usda-client`) calls `GET /v1/food/{fdcId}` on the USDA API; 1 call is recorded against the rolling window

**ATS-023-A2**

- **Given** a `FoodBatchRequested` row contains 15 `fdcIds`
- **When** the consumer processes the row
- **Then** the consumer (via `@kitchensink/usda-client`) calls `POST /v1/foods` with all 15 IDs in a single request; 1 call is recorded against the rolling window

---

#### Tier 2 — REQ-024: Successful USDA fetch upserts food, caches it, removes from pending, completes the `fetch_queue` row, emits FoodDataReceived

**AT-024-A** — Full success path produces correct side effects

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-024-A1**

- **Given** a `FoodRequested` row exists for `fdcId = 12399` and the USDA API returns `200 OK` with nutrition data
- **When** the consumer processes the row
- **Then** the food is stored locally with `fetch_status = 'fetched'`; the `fetch_queue` row is marked `status = 'done'`; a `FoodDataReceived` event is emitted to EventBridge; a subsequent `GET /v1/foods/12399` returns `200 OK` with the nutrition data

---

#### Tier 2 — REQ-025: USDA 404 writes tombstone (no retry); re-attempt allowed after the tombstone TTL (default 30 days)

**AT-025-A** — Confirmed non-existent food is tombstoned, then re-attemptable after TTL

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-025-A1**

- **Given** a `FoodRequested` row exists for `fdcId = 99999` and the USDA API returns `404 Not Found`
- **When** the consumer processes the row
- **Then** the food is stored locally with `fetch_status = 'not_found'`; the `fetch_queue` row is set to `status = 'tombstone'`; the 404 is immediate so no retry occurs (FR-016); a subsequent `GET /v1/foods/99999` within the tombstone TTL returns `404 Not Found` without enqueueing

**ATS-025-A2**

- **Given** a tombstoned food for `fdcId = 99999` whose tombstone age now exceeds the configured TTL (default 30 days)
- **When** an authenticated client sends `GET /v1/foods/99999` after the TTL has lapsed
- **Then** the response is `202 Accepted` and a re-attempt fetch is enqueued (USDA may have since added the food); the re-attempt counts against the normal rolling-window budget so it cannot bypass the rate limit (FR-025)

---

#### Tier 2 — REQ-026: USDA 429 — consumer treats the rolling window as full and backs off

**AT-026-A** — Rate-limit signal triggers immediate back-off

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-026-A1**

- **Given** the consumer is processing a batch of rows and the USDA API returns `429 Too Many Requests`
- **When** the consumer receives the 429 response
- **Then** the consumer treats the rolling window as full and backs off (pauses draining); the current `fetch_queue` row is left `pending` (its row lease released for retry after the backoff gate); no further rows in the batch are processed; no additional USDA API calls are made

---

#### Tier 2 — REQ-027: USDA 5xx leaves the `fetch_queue` row incomplete; tombstones after exhausting retries

**AT-027-A** — Transient USDA errors are retried via row-lease retry with backoff

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-027-A1**

- **Given** a `FoodRequested` row exists and the USDA API returns `500 Internal Server Error` on every attempt
- **When** the consumer exhausts its 5 retry attempts (with backoff, FR-016)
- **Then** the row is set to `status = 'tombstone'` (the DLQ-equivalent); the food record is not written with `fetch_status = 'fetched'`

---

#### Tier 2 — REQ-031 / REQ-032: Stale food re-queue via scheduled rule and stale-while-revalidate on read

**AT-031-A** — Stale foods are re-queued for background refresh

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-031-A1**

- **Given** a food record exists locally with `fetched_at` older than the configured staleness threshold (default 30 days)
- **When** the EventBridge scheduled producer rule fires
- **Then** the food is re-enqueued as a low-demand `fetch_queue` row (`request_count` 0–1) via an `IngestionScheduled` event — it sorts after high-demand rows naturally, no separate low-priority queue; after the consumer processes it, `fetched_at` is updated to the current time

**AT-031-B** — Stale read serves the held data immediately and re-fetches in the background (stale-while-revalidate)

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-031-B1**

- **Given** a food record exists locally with `fetch_status = 'stale'` (`fetched_at` older than the 30-day threshold)
- **When** an authenticated client sends `GET /v1/foods/{fdcId}`
- **Then** the response is `200 OK` serving the held (stale) data immediately with a staleness indicator (the read never blocks and never returns `202` for a record it already holds); a background re-fetch is enqueued (stale-while-revalidate, FR-031)

**ATS-031-B2**

- **Given** a `stale` food record whose background re-fetch keeps failing (e.g. prolonged USDA outage)
- **When** the authenticated client repeatedly sends `GET /v1/foods/{fdcId}` across the outage
- **Then** every response is `200 OK` serving the stale data with the staleness indicator (availability over freshness — there is no max-staleness cutoff that withholds an already-held record); the background re-fetch keeps retrying (FR-031)

---

### Tier 1 — Feature/Epic: Authentication Enforcement

**User Goal**: As a Commise operator, I want all food data endpoints to require authentication so that unauthenticated clients cannot access or trigger food fetches.

---

#### Tier 2 — REQ-035 / REQ-IF-007: All /v1/foods/\* endpoints require the Clerk auth middleware; 401 for unauthenticated requests

**AT-035-A** — Unauthenticated requests are rejected by the Clerk auth middleware

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-035-A1**

- **Given** the API is running with the shared Clerk auth middleware attached
- **When** an unauthenticated client sends `GET /v1/foods/12345` (no Authorization header)
- **Then** the response is `401 Unauthorized`; no downstream processing occurs

**ATS-035-A2**

- **Given** the API is running with the shared Clerk auth middleware attached
- **When** an unauthenticated client sends `GET /v1/foods/search?query=chicken`
- **Then** the response is `401 Unauthorized`

**ATS-035-A3**

- **Given** the API is running with the shared Clerk auth middleware attached
- **When** an unauthenticated client sends `GET /v1/foods/12345/status`
- **Then** the response is `401 Unauthorized`

---

### Tier 1 — Feature/Epic (US-0): Authenticated & Authorized Access to the Food Data API

**User Goal**: As a Commise client (or a backend Commise service), I want every food data entry point to authenticate my Clerk token networklessly and authorize my request before any business logic runs, so that no unauthenticated or unfair caller can read food data or drive USDA API consumption. Maps to spec US-0 acceptance scenarios AS-1..AS-12.

**Acceptance Test Plan**: `ATP-008` — verifies the end-to-end auth contract from the client's perspective: `401` on missing/expired/wrong-instance tokens, `200`/`202`/`404` on valid tokens, no broadcast leakage on WebSocket push, per-`sub` fairness by demotion (accepted `202`, demoted to back — no `429`), `403` scope, M2M service-token acceptance, and oversized-batch `400`. (Internal verifier mechanics — networkless verify, load-shed — are covered by the System Test Plan STP-013.)

---

#### Tier 2 — REQ-037: No token → `401` at every entry point; no enqueue, no USDA call (US-0 AS-1)

**ATP-008-A** — Unauthenticated requests are rejected before any business logic, enqueue, or USDA call

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-036-A1**

- **Given** no `Authorization` header is present
- **When** a client calls each of the six food data entry points in turn — `GET /v1/foods/12345`, `GET /v1/foods/12345/status`, `GET /v1/foods/search?query=chicken`, `GET /v1/foods/12345/nutrients`, `GET /v1/foods/autocomplete?prefix=chick`, and `POST /v1/foods/batch`
- **Then** every endpoint returns `401 Unauthorized`; no fetch is enqueued and no USDA API call is made for any of them (matching STS-013-A1's six-endpoint sweep, so SC-010's "each endpoint" is discharged literally)

---

#### Tier 2 — REQ-037: Valid Clerk session token → normal `200`/`202`/`404` handling (US-0 AS-2, AS-5)

**ATP-008-B** — A valid Bearer token authenticates the caller and normal handling applies, networklessly

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-037-B1** (AS-2 — client-observable valid-token handling)

- **Given** a valid Clerk session token is presented as a Bearer credential and `fdcId = 12345` exists locally as `fetched`
- **When** the client sends `GET /v1/foods/12345`
- **Then** the response is `200 OK`; the caller identity carried into the response (e.g. the request-scoped `sub` echoed in audit/log correlation, or the per-`sub` rate-limit bucket charged) is the verified Clerk `sub`

**ATS-037-B2** (AS-5 — networkless verification, measured at the network boundary)

- **Given** the API is deployed in a network-isolation harness whose egress policy **denies all outbound traffic to every Clerk/IdP host** (the Clerk frontend/instance domains and any IdP JWKS endpoint are blackholed), and a valid Clerk session token is presented as a Bearer credential for `fdcId = 12345` (existing locally as `fetched`)
- **When** the client sends `GET /v1/foods/12345` and the harness records all outbound connection attempts crossing the service network boundary for the duration of the request
- **Then** the response is still `200 OK` (the egress deny does **not** change the outcome, proving no request-path IdP dependency); **and** the harness observes **zero** outbound connection attempts to any Clerk/IdP host during request verification — making the networkless guarantee measurable at the network boundary, not merely asserted. _(The internal verifier mechanics — `@clerk/backend` `verifyToken` against the non-secret `CLERK_JWT_KEY` — are exercised at system level by STP-013-A / STS-013-A3; this acceptance scenario discharges the FR-036 networkless guarantee from a controllable external vantage.)_

---

#### Tier 2 — REQ-037: Expired or malformed token → `401` (US-0 AS-3)

**ATP-008-C** — Expired and malformed tokens are rejected fail-closed

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-038-C1**

- **Given** a token whose `exp` is in the past (and, separately, a malformed/garbage Bearer string)
- **When** the client calls `GET /v1/foods/12345`
- **Then** each request returns `401 Unauthorized`; no fetch is enqueued and no USDA call is made

---

#### Tier 2 — REQ-037: Wrong-`azp` or wrong-instance token → `401` (US-0 AS-4, AS-6)

**ATP-008-D** — Tokens failing the `azp` allowlist, the instance signature, or supplying a forged identity header are rejected

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-039-D1**

- **Given** a well-formed Clerk token whose `azp` is not in `CLERK_AUTHORIZED_PARTIES` (and, separately, a token signed for a different Clerk instance, and a request with no valid token but a forged `x-authorizer-context`/`x-user-id` header)
- **When** the client calls `GET /v1/foods/12345`
- **Then** each request returns `401 Unauthorized`; identity is taken only from the verified token, never from a client-supplied header; no fetch is enqueued and no USDA call is made

---

#### Tier 2 — REQ-043: WebSocket `$connect` requires a token; pushes are not broadcast (US-0 AS-7, AS-8)

**ATP-008-E** — WebSocket auth at `$connect` and per-recipient push targeting

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-040-E1**

- **Given** a WebSocket `$connect` is attempted without a valid Clerk token
- **When** the connection is initiated
- **Then** it is rejected with `403` before the connection is established

**ATS-040-E2**

- **Given** two authenticated WebSocket connections, where only `sub` `A` requested `fdcId = 12345` (recorded in the requester subscription set) and `sub` `B` did not
- **When** a `FoodDataReceived` notification for `fdcId = 12345` is pushed
- **Then** the notification is delivered only to `A`'s connection; `B`'s connection receives nothing (no broadcast to connections that did not request that food)

---

#### Tier 2 — REQ-039: Per-`sub` fairness by demotion — accepted (`202`), demoted to back, no `429` (US-0 AS-9)

**ATP-008-F** — One user cannot starve the shared USDA budget for others (demotion, not rejection)

**Technique**: Boundary Value Analysis

##### Tier 3 — BDD Scenarios

**ATS-041-F1**

- **Given** an authenticated user with more than 50 items already pending in the `fetch_queue`
- **When** they trigger another cache-miss lookup for an unknown `fdcId`
- **Then** the request is still **accepted** (`202 Accepted`, **no `429`** and no rejection); the fetch is enqueued but the requester's queued items are ranked to the **back** of the priority order; concurrently, a different authenticated user's cache-miss lookup continues to be served from spare capacity (demotion protects users from each other); when the heavy user's pending count later drops below 50, their items are dynamically re-promoted to normal priority

---

#### Tier 2 — REQ-038: Insufficient operational scope → `403`, distinct from `401` (US-0 AS-10)

**ATP-008-G** — Authenticated-but-unauthorized is `403`, not `401`

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-042-G1**

- **Given** an authenticated user whose verified token `public_metadata` lacks the required operational scope
- **When** they call an admin/operational endpoint (e.g. a manual re-fetch trigger)
- **Then** the response is `403 Forbidden` (authenticated but unauthorized), distinct from the `401` unauthenticated case

---

#### Tier 2 — REQ-041: Backend service M2M token is accepted (US-0 AS-11)

**ATP-008-H** — Server-to-server callers authenticate with a Clerk M2M token, not forced to `401`

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-043-H1**

- **Given** a backend Commise service (e.g. 006 meal-planning) with no end-user session token, presenting a Clerk machine (M2M) token whose `azp` is in the authorized-parties allowlist
- **When** it calls `GET /v1/foods/{fdcId}`
- **Then** the request is accepted (the M2M token is verified networklessly); the server-to-server call is not forced to `401`

---

#### Tier 2 — REQ-040: Oversized batch → `400`, enqueues nothing (US-0 AS-12)

**ATP-008-I** — Batch hard-limit is enforced before any enqueue

**Technique**: Boundary Value Analysis

##### Tier 3 — BDD Scenarios

**ATS-044-I1**

- **Given** an authenticated client submits `POST /v1/foods/batch` with an `fdcId` count exceeding the maximum allowed (e.g. > 100)
- **When** the request is processed
- **Then** the response is `400 Bad Request`; nothing is enqueued for any id in the batch

---

### Tier 1 — Feature/Epic: Non-Functional Acceptance

**User Goal**: As a Commise operator, I want the food data system to meet its latency, rate-limit, data fidelity, and reliability targets so that the feature is safe to ship.

---

#### Tier 2 — REQ-NF-011: Cache-hit food lookups return within 50ms at p95

**AT-NF011-A** — Latency probe for cache-hit path

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF011-A1**

- **Given** the local store (or Redis cache) contains 1,000+ food records with `fetch_status = 'fetched'`
- **When** 200 sequential authenticated `GET /v1/foods/{fdcId}` requests are made for locally-cached foods
- **Then** p95 response time is under 50ms as measured at the ALB / `food-service` ingress

---

#### Tier 2 — REQ-NF-012: System never exceeds 1,000 USDA API calls in any rolling 60-minute window (SC-002)

**AT-NF012-A** — Rolling-window rate-limit compliance under sustained load

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF012-A1**

- **Given** the consumer is processing a sustained stream of `FoodRequested` messages over an extended run
- **When** CloudWatch metrics are reviewed using a sliding trailing-60-minute count across the run
- **Then** no rolling-60-min window ever exceeds 1,000 USDA API calls (SC-002); zero `429` responses are recorded in CloudWatch

---

#### Tier 2 — REQ-NF-013: Background fetch completes within 60 seconds at p95 (`fetch_queue` pending-row depth < 100)

**AT-NF013-A** — End-to-end async backfill latency

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF013-A1**

- **Given** the `fetch_queue` pending-row depth is under 100 rows
- **When** an authenticated client triggers a cache miss for a new `fdcId` and polls `GET /v1/foods/{fdcId}/status` every 5 seconds
- **Then** the status transitions from `pending` to `fetched` within 60 seconds at p95 across 20 test runs

---

#### Tier 2 — REQ-NF-016: Zero data loss from queue processing failures; tombstone rows capture all failed fetches

**AT-NF016-A** — Tombstone rows capture all fetches that exhaust retries

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-NF016-A1**

- **Given** 10 rows are injected into the `fetch_queue` and the consumer is configured to fail on every attempt
- **When** each row exhausts its 5 retry attempts (with backoff, FR-016)
- **Then** all 10 rows are set to `status = 'tombstone'` (the DLQ-equivalent); none are silently dropped; the CloudWatch tombstone-row-count alarm fires

---

#### Tier 2 — REQ-NF-018: Nutritional data stored locally matches USDA source values exactly

**AT-NF018-A** — Data fidelity check against USDA source

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-NF018-A1**

- **Given** the USDA API returns a known food record for `fdcId = 171705` (Chicken, broilers or fryers, breast, meat only, raw) with documented nutrient values
- **When** the consumer ingests the record and a client retrieves it via `GET /v1/foods/171705`
- **Then** all nutrient values in the response match the USDA source values exactly, with no rounding or transformation applied

---

#### Tier 2 — REQ-NF-007: All code passes turbo typecheck, lint, and format:check with zero errors

**AT-NF007-A** — CI gate passes before merge

**Technique**: Static Analysis

##### Tier 3 — BDD Scenarios

**ATS-NF007-A1**

- **Given** the feature branch contains all implementation code
- **When** `turbo run typecheck lint format:check` is executed in CI
- **Then** all three commands exit with code 0; zero errors or warnings are reported

---

## Acceptance Criteria per REQ

| REQ        | Pre-condition                                                                         | Success Condition                                                                                                                                                                                                                                                                                  | Acceptance Test Technique     |
| ---------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| REQ-001    | Food exists locally with `fetch_status = 'fetched'`                                   | `200 OK` returned; zero outbound calls to `api.nal.usda.gov` during request                                                                                                                                                                                                                        | Interface Contract Testing    |
| REQ-002    | Food exists locally with `fetch_status = 'fetched'` and all nutrient fields populated | Response body contains `fdcId`, `description`, `calories`, `protein`, `carbs`, `fat`, and micronutrients                                                                                                                                                                                           | Equivalence Partitioning      |
| REQ-003    | No local record for requested `fdcId`; not in pending set                             | `202 Accepted` with `{"status":"pending","fdcId":<id>,"estimatedWaitSeconds":<n>}`; backfill triggered                                                                                                                                                                                             | Equivalence Partitioning      |
| REQ-004    | Food exists locally with `fetch_status = 'pending'`                                   | `202 Accepted`; no duplicate event published                                                                                                                                                                                                                                                       | Equivalence Partitioning      |
| REQ-005    | Food exists locally with `fetch_status = 'not_found'`                                 | `404 Not Found`; no backfill triggered                                                                                                                                                                                                                                                             | Equivalence Partitioning      |
| REQ-006    | API receives `fdcId` that is zero, negative, non-numeric, or non-integer              | `400 Bad Request`; no downstream processing                                                                                                                                                                                                                                                        | Boundary Value Analysis       |
| REQ-007    | Food exists locally in any `fetch_status`                                             | Status endpoint returns correct `fetch_status` and full data when `fetched`                                                                                                                                                                                                                        | Equivalence Partitioning      |
| REQ-008    | Local store contains foods matching query string                                      | `200 OK` with relevance-ranked array of matching food records                                                                                                                                                                                                                                      | Equivalence Partitioning      |
| REQ-009    | Search query issued against local store                                               | Zero USDA API calls made during search request lifecycle                                                                                                                                                                                                                                           | Interface Contract Testing    |
| REQ-010    | Local store contains 50,000 food records with GIN index                               | p95 search response time under 200ms across 100 requests                                                                                                                                                                                                                                           | Performance Measurement       |
| REQ-011    | Cache miss for single `fdcId`                                                         | `FoodRequested` `fetch_queue` row observable within 5 seconds                                                                                                                                                                                                                                      | Interface Contract Testing    |
| REQ-012    | Recipe submission with multiple unknown `fdcIds`                                      | Single `FoodBatchRequested` event containing all unknown IDs                                                                                                                                                                                                                                       | Interface Contract Testing    |
| REQ-013    | Concurrent lookups for same unknown `fdcId`                                           | Exactly one `FoodRequested` row enqueued to `fetch_queue`; all callers receive `202 Accepted`                                                                                                                                                                                                      | Concurrency / Fault Injection |
| REQ-014    | Single-food and batch cache misses resolved                                           | Both enqueue into the single demand-weighted `fetch_queue`; `request_count` (capped distinct-requester count) sets order, batch rows carry low demand — no high/low tier                                                                                                                           | Interface Contract Testing    |
| REQ-015    | Queue contains rows with differing demand                                             | Consumer drains higher-`request_count` rows before lower-`request_count` rows (`ORDER BY request_count DESC, first_requested ASC`)                                                                                                                                                                 | Equivalence Partitioning      |
| REQ-016    | Consumer fails on every attempt for a given `fetch_queue` row                         | Row set to `status = 'tombstone'` after exhausting ≤5 attempts with backoff (FR-016)                                                                                                                                                                                                               | Fault Injection               |
| REQ-019    | Rolling window empty; >1,000 `fetch_queue` rows pending                               | At most 1,000 USDA API calls in any trailing 60 min; consumer pauses at 900 (90%); excess rows deferred; zero `429` responses                                                                                                                                                                      | Performance Measurement       |
| REQ-021    | Rolling window at the 1,000/hr cap                                                    | No USDA API call made; `fetch_queue` row lease released without completion for retry                                                                                                                                                                                                               | Fault Injection               |
| REQ-023    | Single-food and batch `fetch_queue` rows pending                                      | Single-food uses `GET /v1/food/{fdcId}`; batch uses `POST /v1/foods`; 1 call recorded against the rolling window per call                                                                                                                                                                          | Interface Contract Testing    |
| REQ-024    | USDA returns `200 OK` for requested food                                              | Food upserted with `fetch_status = 'fetched'`; `fetch_queue` row marked `done`; `FoodDataReceived` emitted; subsequent lookup returns `200 OK`                                                                                                                                                     | Interface Contract Testing    |
| REQ-025    | USDA returns `404 Not Found` for requested food                                       | Tombstone written (`fetch_status = 'not_found'`, row `status='tombstone'`); within TTL → `404`; after the 30-day tombstone TTL a later lookup re-attempts (counts against the rolling window)                                                                                                      | Fault Injection               |
| REQ-026    | USDA returns `429 Too Many Requests`                                                  | Consumer treats rolling window as full and backs off; current row left `pending`; no further USDA calls in batch                                                                                                                                                                                   | Fault Injection               |
| REQ-027    | USDA returns `5xx` on every attempt                                                   | Row set to `status = 'tombstone'` after exhausting ≤5 row-lease retry cycles with backoff (FR-016)                                                                                                                                                                                                 | Fault Injection               |
| REQ-031    | Food record with `fetched_at` older than staleness threshold                          | Scheduled sweep re-enqueues as a low-demand row (`request_count` 0–1, sorts after high-demand rows) + `fetched_at` updated; a stale read serves held data as `200` (staleness indicator) and triggers background re-fetch (SWR); on persistent re-fetch failure, stale data is served indefinitely | Equivalence Partitioning      |
| REQ-032    | EventBridge scheduled rule fires                                                      | Stale foods identified and re-queued via `IngestionScheduled` events                                                                                                                                                                                                                               | Equivalence Partitioning      |
| REQ-033    | Food in any `fetch_status`                                                            | `GET /v1/foods/{fdcId}/status` returns correct status and data                                                                                                                                                                                                                                     | Equivalence Partitioning      |
| REQ-035    | Request sent without Authorization header                                             | `401 Unauthorized` returned; no downstream processing                                                                                                                                                                                                                                              | Interface Contract Testing    |
| REQ-IF-001 | Client sends `GET /v1/foods/{fdcId}`                                                  | Correct response per `fetch_status`; URL versioning (`/v1/`) honored                                                                                                                                                                                                                               | Interface Contract Testing    |
| REQ-IF-002 | Client sends `GET /v1/foods/{fdcId}/status`                                           | Response matches documented schema                                                                                                                                                                                                                                                                 | Interface Contract Testing    |
| REQ-IF-003 | Client sends `GET /v1/foods/search?query=<string>`                                    | Relevance-ranked array returned from local store                                                                                                                                                                                                                                                   | Interface Contract Testing    |
| REQ-IF-004 | Consumer processes single and batch fetch messages                                    | Correct USDA endpoint called per message type                                                                                                                                                                                                                                                      | Interface Contract Testing    |
| REQ-IF-007 | Request sent to any `/v1/foods/*` endpoint                                            | Clerk auth middleware enforced; no separate auth mechanism present                                                                                                                                                                                                                                 | Interface Contract Testing    |
| REQ-NF-007 | Feature branch code complete                                                          | `turbo run typecheck lint format:check` exits 0 with zero errors                                                                                                                                                                                                                                   | Static Analysis               |
| REQ-NF-011 | Local store contains cached foods                                                     | p95 cache-hit lookup latency under 50ms                                                                                                                                                                                                                                                            | Performance Measurement       |
| REQ-NF-012 | Consumer processing sustained message stream                                          | No rolling-60-min window ever exceeds 1,000 USDA API calls (SC-002); zero `429` responses in CloudWatch                                                                                                                                                                                            | Performance Measurement       |
| REQ-NF-013 | `fetch_queue` pending-row depth under 100                                             | `pending` to `fetched` transition within 60 seconds at p95                                                                                                                                                                                                                                         | Performance Measurement       |
| REQ-NF-016 | Consumer configured to fail on every attempt for 10 `fetch_queue` rows                | All 10 rows set to `status = 'tombstone'`; none silently dropped                                                                                                                                                                                                                                   | Fault Injection               |
| REQ-NF-018 | USDA returns known food record with documented nutrient values                        | Stored and served values match USDA source exactly                                                                                                                                                                                                                                                 | Equivalence Partitioning      |

---

## Feature Test Summary Matrix

| Requirement          | BDD Scenario Count                 | Test Method                      | Pass Criteria                                                                                                                                                                                                                               |
| -------------------- | ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001              | 2                                  | Interface Contract Testing       | Zero USDA API calls observed in request path across all scenarios                                                                                                                                                                           |
| REQ-002              | 1                                  | Equivalence Partitioning         | All required nutrient fields present and non-null in `200 OK` response                                                                                                                                                                      |
| REQ-003              | 1                                  | Equivalence Partitioning         | `202 Accepted` with correct pending body; backfill event published                                                                                                                                                                          |
| REQ-004              | 1                                  | Equivalence Partitioning         | `202 Accepted`; exactly one `fetch_queue` row enqueued (no duplicate)                                                                                                                                                                       |
| REQ-005              | 1                                  | Equivalence Partitioning         | `404 Not Found`; no event published                                                                                                                                                                                                         |
| REQ-006              | 4                                  | Boundary Value Analysis          | `400 Bad Request` for all invalid input variants                                                                                                                                                                                            |
| REQ-007 / REQ-033    | 3                                  | Equivalence Partitioning         | Status endpoint returns correct schema for each `fetch_status` partition                                                                                                                                                                    |
| REQ-008              | 2                                  | Equivalence Partitioning         | Ranked results returned; empty array for no-match query                                                                                                                                                                                     |
| REQ-009              | 1                                  | Interface Contract Testing       | Zero USDA API calls during search request                                                                                                                                                                                                   |
| REQ-010              | 1                                  | Performance Measurement          | p95 search latency under 200ms at 50,000 records                                                                                                                                                                                            |
| REQ-011              | 1                                  | Interface Contract Testing       | `FoodRequested` `fetch_queue` row observable within 5 seconds of cache miss                                                                                                                                                                 |
| REQ-012              | 2                                  | Interface Contract / Equivalence | Single `FoodBatchRequested` event with all unknown IDs; `POST /v1/foods/batch` returns per-item partial (cached inline + per-id `pending`)                                                                                                  |
| REQ-013              | 1                                  | Concurrency / Fault Injection    | Exactly one `fetch_queue` row enqueued under concurrent lookups                                                                                                                                                                             |
| REQ-014              | 2                                  | Interface Contract Testing       | Both request types enqueue into the single demand-weighted `fetch_queue`; `request_count` sets order, no high/low tier                                                                                                                      |
| REQ-015              | 1                                  | Equivalence Partitioning         | Higher-`request_count` rows drained before lower-`request_count` rows (`ORDER BY request_count DESC, first_requested ASC`)                                                                                                                  |
| REQ-016              | 1                                  | Fault Injection                  | Row tombstoned after exhausting ≤5 attempts with backoff (FR-016)                                                                                                                                                                           |
| REQ-019              | 1                                  | Performance Measurement          | At most 1,000 USDA calls in any trailing 60 min; consumer pauses at 900 (90%); zero `429` responses                                                                                                                                         |
| REQ-021              | 1                                  | Fault Injection                  | No USDA call when rolling window at cap; `fetch_queue` row deferred                                                                                                                                                                         |
| REQ-023              | 2                                  | Interface Contract Testing       | Correct USDA endpoint per request type; 1 call recorded against the rolling window per call                                                                                                                                                 |
| REQ-024              | 1                                  | Interface Contract Testing       | All five success-path side effects confirmed                                                                                                                                                                                                |
| REQ-025              | 2                                  | Fault Injection                  | Tombstone written (`status='tombstone'`); no retry; within TTL returns `404`; after the 30-day tombstone TTL a later lookup re-attempts (`202`, counts against the rolling-window budget)                                                   |
| REQ-026              | 1                                  | Fault Injection                  | Rolling window treated as full; `fetch_queue` row left `pending`; no further USDA calls                                                                                                                                                     |
| REQ-027              | 1                                  | Fault Injection                  | Row tombstoned after exhausting ≤5 row-lease retry cycles with backoff (FR-016)                                                                                                                                                             |
| REQ-031 / REQ-032    | 3                                  | Equivalence Partitioning         | Stale food re-queued via scheduled sweep and `fetched_at` updated; stale read serves held data `200` + background re-fetch (SWR); re-fetch failure serves stale indefinitely                                                                |
| REQ-035 / REQ-IF-007 | 3                                  | Interface Contract Testing       | `401 Unauthorized` for all unauthenticated endpoint variants                                                                                                                                                                                |
| REQ-037 (US-0)       | 5 (ATP-008-A..D; B has B1+B2)      | Interface Contract / Equivalence | `401` on no/expired/malformed/wrong-`azp`/wrong-instance token + forged header; valid token → `200`/`202`/`404`; AS-5 networkless verified via egress-deny harness (zero IdP calls at the network boundary); no enqueue/USDA call on reject |
| REQ-038 (US-0)       | 1 (ATP-008-G)                      | Equivalence Partitioning         | Insufficient operational scope → `403`, distinct from `401`                                                                                                                                                                                 |
| REQ-039 (US-0)       | 1 (ATP-008-F)                      | Boundary Value Analysis          | Per-`sub` >50 pending → accepted (`202`), items demoted to back (no `429`/no rejection); one user cannot starve others; dynamic re-promotion below 50                                                                                       |
| REQ-040 (US-0)       | 1 (ATP-008-I)                      | Boundary Value Analysis          | Oversized batch → `400`; nothing enqueued                                                                                                                                                                                                   |
| REQ-041 (US-0)       | 1 (ATP-008-H)                      | Interface Contract Testing       | Backend M2M token accepted; server-to-server not forced to `401`                                                                                                                                                                            |
| REQ-043 (US-0)       | 2 (ATP-008-E)                      | Interface Contract Testing       | `$connect` rejected (`403`) without token; `FoodDataReceived` delivered only to requesting `sub` (no broadcast)                                                                                                                             |
| REQ-IF-001           | Covered by REQ-001 through REQ-006 | Interface Contract Testing       | Correct response per `fetch_status`; `/v1/` prefix honored                                                                                                                                                                                  |
| REQ-IF-002           | Covered by REQ-007                 | Interface Contract Testing       | Status response matches documented schema                                                                                                                                                                                                   |
| REQ-IF-003           | Covered by REQ-008                 | Interface Contract Testing       | Ranked array from local store                                                                                                                                                                                                               |
| REQ-IF-004           | Covered by REQ-023                 | Interface Contract Testing       | Correct USDA endpoint per message type                                                                                                                                                                                                      |
| REQ-NF-007           | 1                                  | Static Analysis                  | `turbo run typecheck lint format:check` exits 0                                                                                                                                                                                             |
| REQ-NF-011           | 1                                  | Performance Measurement          | p95 cache-hit latency under 50ms                                                                                                                                                                                                            |
| REQ-NF-012           | 1                                  | Performance Measurement          | No rolling-60-min window exceeds 1,000 USDA calls (SC-002); zero `429` in CloudWatch                                                                                                                                                        |
| REQ-NF-013           | 1                                  | Performance Measurement          | `pending` to `fetched` within 60 seconds at p95                                                                                                                                                                                             |
| REQ-NF-016           | 1                                  | Fault Injection                  | All failed fetches captured as tombstone rows; none silently dropped                                                                                                                                                                        |
| REQ-NF-018           | 1                                  | Equivalence Partitioning         | Stored nutrient values match USDA source exactly                                                                                                                                                                                            |

**Total BDD Scenarios**: 58 _(47 base + 11 US-0 auth scenarios under ATP-008: ATS-036-A1, ATS-037-B1, ATS-037-B2, ATS-038-C1, ATS-039-D1, ATS-040-E1, ATS-040-E2, ATS-041-F1, ATS-042-G1, ATS-043-H1, ATS-044-I1)_

---

## Exit Criteria

The feature is considered shippable when **all** of the following conditions are true:

### Functional Gate

- [ ] All 47 base BDD acceptance scenarios (plus the 11 US-0 auth scenarios under ATP-008) pass in a staging environment connected to a real USDA FoodData Central API key
- [ ] Zero `400`, `401`, `404`, or `500` responses observed for valid authenticated requests to locally-cached foods
- [ ] Deduplication confirmed: concurrent lookups for the same unknown `fdcId` produce exactly one `FoodRequested` `fetch_queue` row
- [ ] Tombstone routing confirmed: `fetch_queue` rows that exhaust their ≤5 retry attempts (with backoff, FR-016) are set to `status = 'tombstone'` (the DLQ-equivalent) within the expected window

### Performance Gate

- [ ] p95 cache-hit lookup latency is under 50ms (REQ-NF-011)
- [ ] p95 search latency is under 200ms at 50,000 local records (REQ-010)
- [ ] p95 async backfill latency is under 60 seconds with `fetch_queue` pending-row depth under 100 (REQ-NF-013)
- [ ] Rolling-window compliance confirmed: no rolling 60-minute window ever exceeds 1,000 USDA API calls; consumer pauses at 900 (90%); zero `429` responses in CloudWatch (REQ-NF-012, SC-002)

### Data Integrity Gate

- [ ] Nutritional values for at least 5 spot-checked foods match USDA source values exactly (REQ-NF-018)
- [ ] Zero fetches silently dropped under fault injection; all failed fetches appear as tombstone rows (REQ-NF-016)

### CI Gate

- [ ] `turbo run typecheck lint format:check` exits 0 with zero errors on the feature branch (REQ-NF-007)
- [ ] Test pyramid ratios met: at least 70% unit, at most 20% integration, at most 10% E2E (REQ-NF-008)

### Security Gate

- [ ] All `/v1/foods/*` endpoints return `401 Unauthorized` for unauthenticated requests (REQ-035)
- [ ] US-0 auth contract green (ATP-008): every entry point + WebSocket `$connect` rejects no/expired/malformed/wrong-`azp`/wrong-instance tokens (`401`/`403`) with no enqueue or USDA call; valid token → `200`/`202`/`404`; per-`sub` >50 pending → accepted (`202`) with items demoted to the back (no `429`); insufficient scope → `403`; M2M token accepted; oversized batch → `400`; `FoodDataReceived` not broadcast (REQ-037..REQ-043)
- [ ] USDA API key is not present in any client-facing response body or application log (REQ-IF-006)

### Out of Scope for This Gate

- REQ-034 (WebSocket push notifications) is P3 and optional; it is excluded from the shippable exit gate
- REQ-NF-014 (80% cache hit rate) and REQ-NF-015 (batch throughput) are P2 analysis targets measured post-launch once the local store reaches 5,000+ foods; they do not block the initial ship
- REQ-NF-017 (99.9% monthly availability) is measured over a rolling calendar month and cannot be verified pre-launch; it is tracked via CloudWatch SLA dashboard post-deploy
