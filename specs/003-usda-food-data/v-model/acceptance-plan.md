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
- **Then** the response is `202 Accepted`; a `FoodRequested` event is observable on EventBridge within 5 seconds

---

#### Tier 2 — REQ-012: FoodBatchRequested event published for multiple unknown fdcIds

**AT-012-A** — Batch recipe submission triggers a single batch event

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-012-A1**

- **Given** a recipe submission identifies `fdcIds` [99991, 99992, 99993] as unknown locally
- **When** the recipe is submitted
- **Then** a single `FoodBatchRequested` event containing all three IDs is published to EventBridge; no individual `FoodRequested` events are published for those IDs

---

#### Tier 2 — REQ-013: Deduplication via pending-fetch mechanism

**AT-013-A** — Concurrent lookups for the same unknown food produce one fetch

**Technique**: Fault Injection / Concurrency

##### Tier 3 — BDD Scenarios

**ATS-013-A1**

- **Given** no record exists locally for `fdcId = 11119`
- **When** five authenticated clients concurrently send `GET /v1/foods/11119`
- **Then** all five receive `202 Accepted`; exactly one `FoodRequested` event is published to EventBridge (deduplication enforced)

---

#### Tier 2 — REQ-014: EventBridge routes FoodRequested to High Priority queue; batch events to Low Priority queue

**AT-014-A** — Priority routing is observable via queue depth metrics

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-014-A1**

- **Given** a `FoodRequested` event is published to EventBridge
- **When** the EventBridge rule evaluates the event
- **Then** the message appears in the High Priority SQS queue; it does not appear in the Low Priority queue

**ATS-014-A2**

- **Given** a `FoodBatchRequested` event is published to EventBridge
- **When** the EventBridge rule evaluates the event
- **Then** the message appears in the Low Priority SQS queue; it does not appear in the High Priority queue

---

#### Tier 2 — REQ-015: Consumer polls High Priority queue first; Low Priority only when High is empty

**AT-015-A** — High Priority messages are processed before Low Priority messages

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-015-A1**

- **Given** both the High Priority and Low Priority queues contain messages
- **When** the consumer Lambda processes a batch
- **Then** all High Priority messages are consumed before any Low Priority message is processed

---

#### Tier 2 — REQ-016: SQS queues have max receive count of 3 before DLQ routing

**AT-016-A** — Failed messages route to DLQ after 3 receive attempts

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-016-A1**

- **Given** a message in the High Priority queue causes the consumer to throw an unhandled error on every attempt
- **When** the consumer processes the message three times
- **Then** the message is moved to the DLQ; it is no longer visible in the High Priority queue

---

#### Tier 2 — REQ-019: Token bucket rate limiter — 1,000 tokens capacity, 16.67 tokens/minute refill

**AT-019-A** — Rate limiter prevents more than 1,000 USDA API calls per hour

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-019-A1**

- **Given** the token bucket starts at full capacity (1,000 tokens)
- **When** the consumer processes 1,000 single-food fetch messages in rapid succession
- **Then** exactly 1,000 USDA API calls are made; the 1,001st message is deferred (visibility timeout extended); no `429` response is received from USDA

---

#### Tier 2 — REQ-021: Consumer defers message when token bucket is empty

**AT-021-A** — Token exhaustion causes message deferral, not USDA API call

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-021-A1**

- **Given** the token bucket has 0 tokens
- **When** the consumer attempts to process a `FoodRequested` message
- **Then** no USDA API call is made; the SQS message visibility timeout is extended; the message remains in the queue for retry after refill

---

#### Tier 2 — REQ-023: Consumer uses single-food GET and batch POST endpoints correctly

**AT-023-A** — Consumer selects the correct USDA endpoint based on message type

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-023-A1**

- **Given** a `FoodRequested` message contains a single `fdcId`
- **When** the consumer processes the message
- **Then** the consumer calls `GET /v1/food/{fdcId}` on the USDA API; 1 token is consumed

**ATS-023-A2**

- **Given** a `FoodBatchRequested` message contains 15 `fdcIds`
- **When** the consumer processes the message
- **Then** the consumer calls `POST /v1/foods` with all 15 IDs in a single request; 1 token is consumed

---

#### Tier 2 — REQ-024: Successful USDA fetch upserts food, caches it, removes from pending, deletes SQS message, emits FoodDataReceived

**AT-024-A** — Full success path produces correct side effects

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-024-A1**

- **Given** a `FoodRequested` message exists for `fdcId = 12399` and the USDA API returns `200 OK` with nutrition data
- **When** the consumer processes the message
- **Then** the food is stored locally with `fetch_status = 'fetched'`; the SQS message is deleted; a `FoodDataReceived` event is emitted; a subsequent `GET /v1/foods/12399` returns `200 OK` with the nutrition data

---

#### Tier 2 — REQ-025: USDA 404 writes tombstone and deletes SQS message; no retry

**AT-025-A** — Confirmed non-existent food is tombstoned

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-025-A1**

- **Given** a `FoodRequested` message exists for `fdcId = 99999` and the USDA API returns `404 Not Found`
- **When** the consumer processes the message
- **Then** the food is stored locally with `fetch_status = 'not_found'`; the SQS message is deleted; no retry occurs; a subsequent `GET /v1/foods/99999` returns `404 Not Found`

---

#### Tier 2 — REQ-026: USDA 429 resets token bucket to 0 and stops processing

**AT-026-A** — Rate-limit signal triggers immediate back-off

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-026-A1**

- **Given** the consumer is processing a batch of messages and the USDA API returns `429 Too Many Requests`
- **When** the consumer receives the 429 response
- **Then** the token bucket is reset to 0; the current SQS message is left undeleted; no further messages in the batch are processed; no additional USDA API calls are made

---

#### Tier 2 — REQ-027: USDA 5xx leaves SQS message undeleted; routes to DLQ after 3 failures

**AT-027-A** — Transient USDA errors are retried via SQS native retry

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-027-A1**

- **Given** a `FoodRequested` message exists and the USDA API returns `500 Internal Server Error` on every attempt
- **When** the consumer processes the message three times
- **Then** the message is moved to the DLQ; the food record is not written with `fetch_status = 'fetched'`

---

#### Tier 2 — REQ-031 / REQ-032: Stale food detection and re-queue via scheduled EventBridge rule

**AT-031-A** — Stale foods are re-queued for background refresh

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-031-A1**

- **Given** a food record exists locally with `fetched_at` older than the configured staleness threshold (default 30 days)
- **When** the EventBridge scheduled rule fires
- **Then** the food is re-queued on the Low Priority SQS queue via an `IngestionScheduled` event; after the consumer processes it, `fetched_at` is updated to the current time

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
- **Then** p95 response time is under 50ms as measured at the API Gateway level

---

#### Tier 2 — REQ-NF-012: System never exceeds 1,000 USDA API requests per hour

**AT-NF012-A** — Rate-limit compliance under sustained load

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF012-A1**

- **Given** the consumer is processing a sustained stream of `FoodRequested` messages over a 60-minute window
- **When** CloudWatch metrics are reviewed at the end of the window
- **Then** the total USDA API call count is at most 1,000; zero `429` responses are recorded in CloudWatch

---

#### Tier 2 — REQ-NF-013: Background fetch completes within 60 seconds at p95 (queue depth < 100)

**AT-NF013-A** — End-to-end async backfill latency

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF013-A1**

- **Given** the High Priority queue depth is under 100 messages
- **When** an authenticated client triggers a cache miss for a new `fdcId` and polls `GET /v1/foods/{fdcId}/status` every 5 seconds
- **Then** the status transitions from `pending` to `fetched` within 60 seconds at p95 across 20 test runs

---

#### Tier 2 — REQ-NF-016: Zero data loss from queue processing failures; DLQ captures all failed messages

**AT-NF016-A** — DLQ captures all messages that exhaust retries

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-NF016-A1**

- **Given** 10 messages are injected into the High Priority queue and the consumer is configured to fail on every attempt
- **When** each message exhausts its 3 retry attempts
- **Then** all 10 messages appear in the DLQ; none are silently dropped; CloudWatch DLQ alarm fires

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

| REQ        | Pre-condition                                                                         | Success Condition                                                                                                                  | Acceptance Test Technique     |
| ---------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| REQ-001    | Food exists locally with `fetch_status = 'fetched'`                                   | `200 OK` returned; zero outbound calls to `api.nal.usda.gov` during request                                                        | Interface Contract Testing    |
| REQ-002    | Food exists locally with `fetch_status = 'fetched'` and all nutrient fields populated | Response body contains `fdcId`, `description`, `calories`, `protein`, `carbs`, `fat`, and micronutrients                           | Equivalence Partitioning      |
| REQ-003    | No local record for requested `fdcId`; not in pending set                             | `202 Accepted` with `{"status":"pending","fdcId":<id>,"estimatedWaitSeconds":<n>}`; backfill triggered                             | Equivalence Partitioning      |
| REQ-004    | Food exists locally with `fetch_status = 'pending'`                                   | `202 Accepted`; no duplicate event published                                                                                       | Equivalence Partitioning      |
| REQ-005    | Food exists locally with `fetch_status = 'not_found'`                                 | `404 Not Found`; no backfill triggered                                                                                             | Equivalence Partitioning      |
| REQ-006    | API receives `fdcId` that is zero, negative, non-numeric, or non-integer              | `400 Bad Request`; no downstream processing                                                                                        | Boundary Value Analysis       |
| REQ-007    | Food exists locally in any `fetch_status`                                             | Status endpoint returns correct `fetch_status` and full data when `fetched`                                                        | Equivalence Partitioning      |
| REQ-008    | Local store contains foods matching query string                                      | `200 OK` with relevance-ranked array of matching food records                                                                      | Equivalence Partitioning      |
| REQ-009    | Search query issued against local store                                               | Zero USDA API calls made during search request lifecycle                                                                           | Interface Contract Testing    |
| REQ-010    | Local store contains 50,000 food records with GIN index                               | p95 search response time under 200ms across 100 requests                                                                           | Performance Measurement       |
| REQ-011    | Cache miss for single `fdcId`                                                         | `FoodRequested` event observable on EventBridge within 5 seconds                                                                   | Interface Contract Testing    |
| REQ-012    | Recipe submission with multiple unknown `fdcIds`                                      | Single `FoodBatchRequested` event containing all unknown IDs                                                                       | Interface Contract Testing    |
| REQ-013    | Concurrent lookups for same unknown `fdcId`                                           | Exactly one `FoodRequested` event published; all callers receive `202 Accepted`                                                    | Concurrency / Fault Injection |
| REQ-014    | `FoodRequested` and `FoodBatchRequested` events published to EventBridge              | `FoodRequested` routes to High Priority queue; batch events route to Low Priority queue                                            | Interface Contract Testing    |
| REQ-015    | Both queues contain messages                                                          | Consumer processes all High Priority messages before any Low Priority message                                                      | Equivalence Partitioning      |
| REQ-016    | Consumer fails on every attempt for a given message                                   | Message moves to DLQ after exactly 3 receive attempts                                                                              | Fault Injection               |
| REQ-019    | Token bucket at full capacity; 1,001 messages queued                                  | Exactly 1,000 USDA API calls made; 1,001st message deferred; zero `429` responses                                                  | Performance Measurement       |
| REQ-021    | Token bucket at 0 tokens                                                              | No USDA API call made; message visibility timeout extended                                                                         | Fault Injection               |
| REQ-023    | Single-food and batch messages queued                                                 | Single-food uses `GET /v1/food/{fdcId}`; batch uses `POST /v1/foods`; 1 token consumed per call                                    | Interface Contract Testing    |
| REQ-024    | USDA returns `200 OK` for requested food                                              | Food upserted with `fetch_status = 'fetched'`; SQS message deleted; `FoodDataReceived` emitted; subsequent lookup returns `200 OK` | Interface Contract Testing    |
| REQ-025    | USDA returns `404 Not Found` for requested food                                       | Tombstone written with `fetch_status = 'not_found'`; SQS message deleted; no retry                                                 | Fault Injection               |
| REQ-026    | USDA returns `429 Too Many Requests`                                                  | Token bucket reset to 0; current message left undeleted; no further USDA calls in batch                                            | Fault Injection               |
| REQ-027    | USDA returns `5xx` on every attempt                                                   | Message moves to DLQ after 3 SQS retry cycles                                                                                      | Fault Injection               |
| REQ-031    | Food record with `fetched_at` older than staleness threshold                          | Food re-queued on Low Priority queue; `fetched_at` updated after re-fetch                                                          | Equivalence Partitioning      |
| REQ-032    | EventBridge scheduled rule fires                                                      | Stale foods identified and re-queued via `IngestionScheduled` events                                                               | Equivalence Partitioning      |
| REQ-033    | Food in any `fetch_status`                                                            | `GET /v1/foods/{fdcId}/status` returns correct status and data                                                                     | Equivalence Partitioning      |
| REQ-035    | Request sent without Authorization header                                             | `401 Unauthorized` returned; no downstream processing                                                                              | Interface Contract Testing    |
| REQ-IF-001 | Client sends `GET /v1/foods/{fdcId}`                                                  | Correct response per `fetch_status`; URL versioning (`/v1/`) honored                                                               | Interface Contract Testing    |
| REQ-IF-002 | Client sends `GET /v1/foods/{fdcId}/status`                                           | Response matches documented schema                                                                                                 | Interface Contract Testing    |
| REQ-IF-003 | Client sends `GET /v1/foods/search?query=<string>`                                    | Relevance-ranked array returned from local store                                                                                   | Interface Contract Testing    |
| REQ-IF-004 | Consumer processes single and batch fetch messages                                    | Correct USDA endpoint called per message type                                                                                      | Interface Contract Testing    |
| REQ-IF-007 | Request sent to any `/v1/foods/*` endpoint                                            | Clerk auth middleware enforced; no separate auth mechanism present                                                                 | Interface Contract Testing    |
| REQ-NF-007 | Feature branch code complete                                                          | `turbo run typecheck lint format:check` exits 0 with zero errors                                                                   | Static Analysis               |
| REQ-NF-011 | Local store contains cached foods                                                     | p95 cache-hit lookup latency under 50ms                                                                                            | Performance Measurement       |
| REQ-NF-012 | Consumer processing sustained message stream for 60 minutes                           | Total USDA API calls at most 1,000; zero `429` responses in CloudWatch                                                             | Performance Measurement       |
| REQ-NF-013 | High Priority queue depth under 100 messages                                          | `pending` to `fetched` transition within 60 seconds at p95                                                                         | Performance Measurement       |
| REQ-NF-016 | Consumer configured to fail on every attempt for 10 messages                          | All 10 messages appear in DLQ; none silently dropped                                                                               | Fault Injection               |
| REQ-NF-018 | USDA returns known food record with documented nutrient values                        | Stored and served values match USDA source exactly                                                                                 | Equivalence Partitioning      |

---

## Feature Test Summary Matrix

| Requirement          | BDD Scenario Count                 | Test Method                   | Pass Criteria                                                              |
| -------------------- | ---------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| REQ-001              | 2                                  | Interface Contract Testing    | Zero USDA API calls observed in request path across all scenarios          |
| REQ-002              | 1                                  | Equivalence Partitioning      | All required nutrient fields present and non-null in `200 OK` response     |
| REQ-003              | 1                                  | Equivalence Partitioning      | `202 Accepted` with correct pending body; backfill event published         |
| REQ-004              | 1                                  | Equivalence Partitioning      | `202 Accepted`; exactly one event in EventBridge (no duplicate)            |
| REQ-005              | 1                                  | Equivalence Partitioning      | `404 Not Found`; no event published                                        |
| REQ-006              | 4                                  | Boundary Value Analysis       | `400 Bad Request` for all invalid input variants                           |
| REQ-007 / REQ-033    | 3                                  | Equivalence Partitioning      | Status endpoint returns correct schema for each `fetch_status` partition   |
| REQ-008              | 2                                  | Equivalence Partitioning      | Ranked results returned; empty array for no-match query                    |
| REQ-009              | 1                                  | Interface Contract Testing    | Zero USDA API calls during search request                                  |
| REQ-010              | 1                                  | Performance Measurement       | p95 search latency under 200ms at 50,000 records                           |
| REQ-011              | 1                                  | Interface Contract Testing    | `FoodRequested` event observable within 5 seconds of cache miss            |
| REQ-012              | 1                                  | Interface Contract Testing    | Single `FoodBatchRequested` event with all unknown IDs                     |
| REQ-013              | 1                                  | Concurrency / Fault Injection | Exactly one event published under concurrent lookups                       |
| REQ-014              | 2                                  | Interface Contract Testing    | Correct queue routing for each event type                                  |
| REQ-015              | 1                                  | Equivalence Partitioning      | High Priority messages fully drained before Low Priority processing begins |
| REQ-016              | 1                                  | Fault Injection               | Message in DLQ after 3 failed receive attempts                             |
| REQ-019              | 1                                  | Performance Measurement       | At most 1,000 USDA calls in 60 minutes; zero `429` responses               |
| REQ-021              | 1                                  | Fault Injection               | No USDA call when token bucket empty; message deferred                     |
| REQ-023              | 2                                  | Interface Contract Testing    | Correct USDA endpoint per message type; 1 token consumed per call          |
| REQ-024              | 1                                  | Interface Contract Testing    | All five success-path side effects confirmed                               |
| REQ-025              | 1                                  | Fault Injection               | Tombstone written; SQS message deleted; no retry                           |
| REQ-026              | 1                                  | Fault Injection               | Token bucket reset; message undeleted; no further USDA calls               |
| REQ-027              | 1                                  | Fault Injection               | Message in DLQ after 3 SQS retry cycles                                    |
| REQ-031 / REQ-032    | 1                                  | Equivalence Partitioning      | Stale food re-queued and refreshed; `fetched_at` updated                   |
| REQ-035 / REQ-IF-007 | 3                                  | Interface Contract Testing    | `401 Unauthorized` for all unauthenticated endpoint variants               |
| REQ-IF-001           | Covered by REQ-001 through REQ-006 | Interface Contract Testing    | Correct response per `fetch_status`; `/v1/` prefix honored                 |
| REQ-IF-002           | Covered by REQ-007                 | Interface Contract Testing    | Status response matches documented schema                                  |
| REQ-IF-003           | Covered by REQ-008                 | Interface Contract Testing    | Ranked array from local store                                              |
| REQ-IF-004           | Covered by REQ-023                 | Interface Contract Testing    | Correct USDA endpoint per message type                                     |
| REQ-NF-007           | 1                                  | Static Analysis               | `turbo run typecheck lint format:check` exits 0                            |
| REQ-NF-011           | 1                                  | Performance Measurement       | p95 cache-hit latency under 50ms                                           |
| REQ-NF-012           | 1                                  | Performance Measurement       | At most 1,000 USDA calls/hour; zero `429` in CloudWatch                    |
| REQ-NF-013           | 1                                  | Performance Measurement       | `pending` to `fetched` within 60 seconds at p95                            |
| REQ-NF-016           | 1                                  | Fault Injection               | All failed messages captured in DLQ; none silently dropped                 |
| REQ-NF-018           | 1                                  | Equivalence Partitioning      | Stored nutrient values match USDA source exactly                           |

**Total BDD Scenarios**: 43

---

## Exit Criteria

The feature is considered shippable when **all** of the following conditions are true:

### Functional Gate

- [ ] All 43 BDD acceptance scenarios pass in a staging environment connected to a real USDA FoodData Central API key
- [ ] Zero `400`, `401`, `404`, or `500` responses observed for valid authenticated requests to locally-cached foods
- [ ] Deduplication confirmed: concurrent lookups for the same unknown `fdcId` produce exactly one `FoodRequested` event
- [ ] DLQ routing confirmed: messages that exhaust 3 retry attempts appear in the DLQ within the expected window

### Performance Gate

- [ ] p95 cache-hit lookup latency is under 50ms (REQ-NF-011)
- [ ] p95 search latency is under 200ms at 50,000 local records (REQ-010)
- [ ] p95 async backfill latency is under 60 seconds with queue depth under 100 (REQ-NF-013)
- [ ] Token bucket compliance confirmed: at most 1,000 USDA API calls in any 60-minute window; zero `429` responses in CloudWatch (REQ-NF-012)

### Data Integrity Gate

- [ ] Nutritional values for at least 5 spot-checked foods match USDA source values exactly (REQ-NF-018)
- [ ] Zero messages silently dropped under fault injection; all failed messages appear in DLQ (REQ-NF-016)

### CI Gate

- [ ] `turbo run typecheck lint format:check` exits 0 with zero errors on the feature branch (REQ-NF-007)
- [ ] Test pyramid ratios met: at least 70% unit, at most 20% integration, at most 10% E2E (REQ-NF-008)

### Security Gate

- [ ] All `/v1/foods/*` endpoints return `401 Unauthorized` for unauthenticated requests (REQ-035)
- [ ] USDA API key is not present in any client-facing response body or application log (REQ-IF-006)

### Out of Scope for This Gate

- REQ-034 (WebSocket push notifications) is P3 and optional; it is excluded from the shippable exit gate
- REQ-NF-014 (80% cache hit rate) and REQ-NF-015 (batch throughput) are P2 analysis targets measured post-launch once the local store reaches 5,000+ foods; they do not block the initial ship
- REQ-NF-017 (99.9% monthly availability) is measured over a rolling calendar month and cannot be verified pre-launch; it is tracked via CloudWatch SLA dashboard post-deploy
