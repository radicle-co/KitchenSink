# Feature Specification: USDA Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-04-14
**Status**: Draft
**Input**: User description: "Integrate USDA FoodData Central as the primary food/nutrition database backing Commise recipes ... for rate-limited async data fetching." _(Verbatim original ask framed the queue as **SQS + Lambda**; that framing was **superseded** during planning — the locked architecture is a **Postgres `fetch_queue` (LISTEN/NOTIFY) + Fargate worker**, with the same "event-driven, rate-limited" intent. See plan §1/§4.)_

## Dependencies

| Spec                                                        | Relationship                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Downstream** — 001 FR-007 requires this spec's food/nutrition data for recipe ingredients                                                                         |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — provides the shared Clerk instance and verification config (`CLERK_JWT_KEY`, authorized parties) that FR-035 uses to authenticate food data requests |
| [006-meal-planning](../006-meal-planning/spec.md)           | **Downstream** — meal plan nutritional summaries (FR-024) depend on food data                                                                                       |
| [007-grocery-lists](../007-grocery-lists/spec.md)           | **Downstream** — ingredient identity and unit normalization for grocery aggregation                                                                                 |
| [009-nutrition-planning](../009-nutrition-planning/spec.md) | **Downstream** — nutritional calculations (SC-010) depend on food data accuracy                                                                                     |

## Clarifications

### Session 2026-04-14

- Q: Are the `/foods/*` API endpoints authenticated or public? → A: Authenticated — the same Clerk session token as the Commise app. The service verifies the Clerk token itself (networkless); it does not use an Auth0/Cognito authorizer. See the 2026-06-18 clarification session for the full Clerk-based auth-protection design.
- Q: What versioning strategy for our own food data API? → A: URL prefix versioning — `/v1/foods/{fdcId}`.
- Q: What is the availability target for the food data API layer? → A: 99.9% uptime (~8.7 hours downtime/year).
- Q: What is the canonical distinction between "Food" and "Ingredient"? → A: Food = USDA nutritional record. Ingredient = recipe component that MAY link to a Food via `fdcId`. All foods can be ingredients, but not all ingredients are foods (e.g., spices, oils may lack USDA matches). The link is optional.
- Q: Should we add a formal out-of-scope section? → A: No — implicit boundaries in A-008 and FR-009 are sufficient.

### Session 2026-06-18 (Auth protection — Clerk)

- Q: How are the food data services protected, given Commise uses Clerk (not Auth0)? → A: Every food data endpoint (single/batch lookup, search, status, and the WebSocket `$connect`) requires a valid **Clerk session token**. The service verifies the token **itself, networklessly**, using the public `CLERK_JWT_KEY` and enforcing the `azp` (authorized-parties) claim against `CLERK_AUTHORIZED_PARTIES` — the same Clerk instance the rest of Commise uses. No Auth0/Cognito authorizer, no IdP round trip on the request path.
- Q: Where is the token verified for the food read API? → A: **In-process**, by a NestJS `AuthMiddleware` running on ECS/Fargate behind a public ALB (the same topology as the identity service), using the shared `ClerkAuthService` (`@clerk/backend` `verifyToken`). There is **no API Gateway and no Lambda authorizer for the HTTP API**; verified `sub`/claims are populated on `req.user`. The only REQUEST Lambda authorizer / `$context.authorizer` surface is the **deferred WebSocket** `$connect` (US-9). Identity is taken **only** from the verified token — never from a client-supplied header (no `x-authorizer-context` trust), mirroring the identity service's PR #39 decision.
- Q: What is the authorization model? → A: Food data is shared reference data, so **any authenticated Commise user may read** it; there are no per-record ownership checks. Operational/admin endpoints (manual re-fetch, stale-refresh triggers), if exposed, additionally require an elevated scope/permission read from the token's `public_metadata`.
- Q: Why is auth launch-blocking rather than an enhancement? → A: The API is internet-facing and every endpoint can drive rate-limited USDA calls. Unauthenticated access is a denial-of-wallet / availability risk against the 1,000 req/hr budget (A-001, SC-002), so auth must gate all business logic and fail closed.

### Session 2026-06-20 (Rate-limiting / fairness model + data lifecycle)

- Q: Should fairness be enforced by a per-user enqueue quota with `429` rejection (the original FR-043)? → A: **No.** Drop the per-`sub` quota and the `429`. The food service only calls USDA on a cache miss, so fairness/abuse is handled two ways instead: (1) the consumer worker **never exceeds 1,000 req/hr** — it pauses draining the `fetch_queue` when usage reaches ~**90%** of the hourly budget until the window resets; (2) **fairness by demotion, not rejection** — when a single `sub` has **more than 50 items currently pending in the queue**, that requester's queued items are ranked to the **back** of the priority order so they cannot starve other users. No authenticated request is rejected for a personal quota (work-conserving: a heavy user only consumes spare capacity).
- Q: When `GET /v1/foods/{fdcId}` finds a `stale` record (older than the 30-day threshold), what does it return? → A: **Serve the stale data immediately as `200`** (with a staleness indicator) **and trigger a background re-fetch** (stale-while-revalidate). The read never blocks; data self-heals on access in addition to the scheduled sweep (FR-032).
- Q: For `POST /v1/foods/batch` mixing cached and uncached ids, what response shape? → A: **Per-item partial** — return the cached foods inline and per-id `pending` entries for the misses (which are enqueued), in one response. The caller gets available data immediately and polls only the pending ids.
- Q: Can a `404 not_found` tombstone (FR-025) ever be re-fetched? → A: **Yes, on TTL expiry** (default 30 days). After the tombstone TTL lapses a later request may re-attempt (USDA may have since added the food); the re-attempt counts against the normal budget so it cannot be used to bypass the rate limit.
- Q: Is the USDA rate limiter a continuous token bucket, a fixed clock-hour window, or a rolling window? → A: A **rolling 60-minute window** — at most **1,000 USDA calls in any trailing 60 minutes**, with the worker pausing at **90% (900)**. This **replaces the token-bucket model** (a 1,000-capacity bucket refilling at 1,000/hr can emit up to ~2,000 calls across a rolling hour, breaching the hard cap; a rolling window enforces ≤1,000 strictly). The window is tracked by recent USDA-call timestamps (lean: a Postgres call log pruned to 60 min; deferred Redis variant: a sorted set).
- Q: When a demoted requester's pending count drops below 50, are their queued items re-promoted? → A: **Yes, dynamically.** Queue priority is computed **at drain time** from the requester's current pending count, so items auto-return to normal priority once the `sub` falls below 50 (the scorer reads live state, not a frozen flag).
- Q: If a `stale` record's background re-fetch keeps failing (USDA down for days), what does the read return? → A: **Serve the stale data indefinitely** (with the staleness indicator); reads never depend on USDA health. The background re-fetch keeps retrying; there is no max-staleness cutoff that withholds data.

## User Scenarios & Testing _(mandatory)_

<!--
  Architecture reference: docs/architecture/usda/05-event-driven-queue-based.md
  Integration reference: specs/001-commise-recipe-app/spec.md (FR-007, ingredients, meal plans, grocery lists)

  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
-->

### User Story 0 - Authenticated & Authorized Access to the Food Data API (Priority: P1)

Every request to the food data service — single lookup, batch lookup, search, status polling, and WebSocket connection — must come from an authenticated Commise user. The service verifies the caller's **Clerk session token** itself, networklessly, against the same Clerk instance the rest of Commise uses. Unauthenticated, expired, malformed, or wrong-instance/wrong-party tokens are rejected with `401` **before** any business logic runs or any fetch is queued. There is no anonymous or public access to food data, and no unauthenticated path can drive USDA API consumption.

**Why this priority**: The food data API is internet-facing (a NestJS service on ECS/Fargate behind a public ALB) and every endpoint can trigger work — DB reads, queue enqueues, and ultimately rate-limited USDA calls. Without auth, anonymous callers could exhaust the 1,000 req/hr USDA budget (a denial-of-wallet / availability attack against A-001 and SC-002) and read the service freely. Auth protection is therefore a launch-blocking, cross-cutting requirement that gates User Stories 1 through 10.

**Independent Test**: Can be fully tested by calling each endpoint (and the WebSocket `$connect`) with: (a) no token → `401`; (b) a valid Clerk session token → `200`/`202` as appropriate; (c) an expired token → `401`; (d) a token whose `azp` is not in the authorized list, or signed for a different Clerk instance → `401`. Verify that no fetch is queued and no USDA call is made for any rejected request.

**Acceptance Scenarios**:

1. **Given** no `Authorization` header, **When** any `/v1/foods/*` endpoint is called, **Then** the service returns `401 Unauthorized`, enqueues no fetch, and makes no USDA call.
2. **Given** a valid Clerk session token presented as a Bearer token, **When** `GET /v1/foods/{fdcId}` is called, **Then** the request is authenticated, the caller identity is the verified Clerk `sub`, and normal `200`/`202`/`404` handling applies.
3. **Given** an expired or malformed token, **When** any endpoint is called, **Then** the service returns `401`.
4. **Given** a well-formed Clerk token issued for a different Clerk instance, or whose `azp` is not in `CLERK_AUTHORIZED_PARTIES`, **When** any endpoint is called, **Then** the service returns `401` (verification fails on the key or `azp` check).
5. **Given** the service verifies tokens networklessly via the public `CLERK_JWT_KEY`, **When** a request is authenticated, **Then** no outbound call to Clerk (or any IdP) is made on the request path.
6. **Given** a client supplies a forged identity header (e.g., `x-authorizer-context` or `x-user-id`) with no/invalid token, **When** any endpoint is called, **Then** the service returns `401` — identity is taken only from the verified token, never from a client-supplied header.
7. **Given** a WebSocket `$connect` without a valid Clerk token, **When** the connection is attempted, **Then** it is rejected (`401`/`403`) before the connection is established.
8. **Given** an authenticated WebSocket connection, **When** a `FoodDataReceived` notification is pushed, **Then** it is delivered only to connections whose authenticated `sub` requested that food (resolved via the requester subscription set, FR-041).
9. **Given** an authenticated user with more than 50 items already pending in the `fetch_queue`, **When** they trigger another cache-miss lookup, **Then** the request is still **accepted** (`202`, no `429`) but the requester's queued items are ranked to the **back** of the priority order, so they cannot starve other users while still draining on spare capacity (FR-043).
10. **Given** an authenticated user whose token lacks the required operational scope, **When** they call an admin/operational endpoint (e.g. manual re-fetch), **Then** the service returns `403 Forbidden` (authenticated but unauthorized), distinct from the `401` unauthenticated case (FR-039, FR-051).
11. **Given** a backend consumer service (e.g. 006 meal-planning) with no end-user session token, **When** it calls `/v1/foods/*`, **Then** it authenticates with a Clerk machine (M2M) token in the authorized-parties allowlist and is accepted — server-to-server calls are not forced to `401` (FR-047).
12. **Given** a batch request exceeding the maximum allowed `fdcId` count, **When** it is submitted, **Then** the service returns `400 Bad Request` and enqueues nothing (FR-045).

---

### User Story 1 - Single Food Lookup (Cache Hit) (Priority: P1)

A user is creating or viewing a recipe in Commise and the system needs nutritional data for an ingredient. The ingredient's food data already exists in the local data store (PostgreSQL) because it was previously fetched from USDA. The system returns the food's caloric and macronutrient information instantly without any external API call.

**Why this priority**: This is the happy path that covers the majority of requests once the local data store has warmed up. It fulfills FR-007 from the Commise spec ("System MUST back ingredient data with a real food/nutrition database"). Without this, no recipe can display nutritional information.

**Independent Test**: Can be fully tested by seeding the local database with 5 known USDA foods, requesting each by `fdcId`, and verifying the system returns complete nutritional data (calories, protein, carbs, fat) with sub-50ms latency. No USDA API call should be made.

**Acceptance Scenarios**:

1. **Given** a food with `fdcId = 170567` exists in PostgreSQL with `fetch_status = 'fetched'`, **When** the API receives `GET /v1/foods/170567`, **Then** it returns `200 OK` with complete food data including `fdcId`, `description`, calories, protein, carbs, and fat, within 50ms.
2. **Given** a food exists in the local store (PostgreSQL), **When** the API receives a lookup request, **Then** the system never calls the USDA FoodData Central API.
3. **Given** a food exists in PostgreSQL, **When** the API receives a lookup request, **Then** the system reads from PostgreSQL (optionally an in-process LRU) and returns the data within 50ms. _(A Redis read-through cache is a **deferred post-launch variant**, not part of the lean-launch build.)_
4. **Given** a food has `fetch_status = 'not_found'` (tombstoned), **When** the API receives a lookup request, **Then** it returns `404 Not Found` with a message indicating the food does not exist in USDA, without queuing any fetch.

---

### User Story 2 - Single Food Lookup (Cache Miss / Async Backfill) (Priority: P1)

A user requests nutritional data for an ingredient that has never been fetched from USDA before. The system immediately acknowledges the request and returns a `202 Accepted` response with a "pending" status. In the background, the system queues a fetch request, the rate-limited consumer retrieves the data from USDA, and the food becomes available for subsequent requests.

**Why this priority**: This is the core async pattern that distinguishes the event-driven architecture. Without it, any food not already in the local store would be a dead end. It enables the system to grow its data organically from user demand.

**Independent Test**: Can be fully tested by requesting a valid `fdcId` that does not exist in the local store, verifying a `202 Accepted` response is returned immediately, waiting for background processing, then re-requesting the same `fdcId` and receiving `200 OK` with full data.

**Acceptance Scenarios**:

1. **Given** a food with `fdcId = 99999` does not exist in the local store, **When** the API receives `GET /v1/foods/99999`, **Then** it returns `202 Accepted` with `{"status": "pending", "fdcId": 99999, "estimatedWaitSeconds": 30}` within 100ms.
2. **Given** a `202 Accepted` was returned for `fdcId = 99999`, **When** the Fargate consumer worker drains the `fetch_queue` row, **Then** it fetches the food from USDA, stores it in PostgreSQL with `fetch_status = 'fetched'`, caches it in Redis (if present), and marks the `fetch_queue` row fetched (removing it from the pending set).
3. **Given** the consumer has successfully fetched `fdcId = 99999`, **When** the API subsequently receives `GET /v1/foods/99999`, **Then** it returns `200 OK` with complete food data.
4. **Given** a food is already pending (queued but not yet fetched), **When** a second request arrives for the same `fdcId`, **Then** the system returns `202 Accepted` without creating a duplicate `fetch_queue` row (deduplication via `ON CONFLICT`).
5. **Given** the USDA API returns `404` for a requested `fdcId`, **When** the Fargate consumer worker processes the `fetch_queue` row, **Then** it writes a tombstone record with `fetch_status = 'not_found'` and sets the `fetch_queue` row `status='tombstone'` (no further retries).

---

### User Story 3 - Rate-Limited USDA API Consumption (Priority: P1)

The system enforces the USDA FoodData Central rate limit of 1,000 requests per hour using a rolling 60-minute window — at most 1,000 USDA calls in any trailing 60 minutes (a hard guarantee). The Fargate consumer worker counts the calls in the trailing 60 minutes before every USDA API call and pauses processing when the count reaches 900 (90%), resuming as older calls age out of the window. If USDA returns a `429 Too Many Requests` despite the limiter, the consumer treats the window as full and backs off (pauses draining) as a failsafe.

**Why this priority**: Rate limit compliance is a hard operational constraint. Violating it risks having the USDA API key banned, which would break the entire data pipeline. The rolling-window limiter is the mechanism that makes the architecture viable.

**Independent Test**: Can be fully tested by configuring the rolling-window limiter to a low cap (e.g., 5 calls per trailing window), submitting 10 fetch requests, and verifying that exactly 5 USDA API calls are made before processing pauses, with the remaining 5 processed after earlier calls age out of the window.

**Acceptance Scenarios**:

1. **Given** the trailing-60-min USDA call count is below 900, **When** the consumer attempts to process a `fetch_queue` row, **Then** the new call is recorded atomically against the rolling window and the USDA API call proceeds.
2. **Given** the trailing-60-min USDA call count has reached 900 (90%), **When** the consumer considers the next `fetch_queue` row, **Then** it pauses draining (leaving the row eligible per the lease re-eligibility/backoff gate of FR-018) and does not call the USDA API until earlier calls age out of the window.
3. **Given** a USDA call would be the 1,001st in the trailing 60 minutes, **When** the consumer attempts it, **Then** the call is not made and the `fetch_queue` row stays `pending`, and the consumer resumes once enough earlier calls age out that the count drops back below the threshold.
4. **Given** the USDA API returns `429 Too Many Requests`, **When** the consumer receives this response, **Then** it treats the rolling window as full and backs off, leaves the `fetch_queue` row `pending` (it will retry after the backoff gate), and stops draining further rows for now.
5. **Given** the rolling-window limiter state (recent USDA-call timestamps) is stored as a Postgres call log (lean launch) or a Redis sorted set (deferred variant), **When** the consumer performs a check-and-record operation — counting calls in the trailing 60 minutes and recording the new call in one atomic operation — **Then** the operation is atomic (no race conditions even under concurrent access).

---

### User Story 4 - Bulk Ingredient Lookup for Recipe Import (Priority: P1)

A user imports or creates a recipe with multiple ingredients. The system resolves as many ingredients as possible from the local store immediately, and queues the remaining unknown ingredients for background fetching via the USDA batch endpoint. The batch endpoint accepts up to 20 `fdcIds` per request, counting as only 1 call against the rolling-window rate limiter per batch call — maximizing throughput.

**Why this priority**: Recipe creation and import are core Commise workflows (FR-001, FR-008). Recipes typically contain 5-20 ingredients, making batch resolution essential for acceptable UX. Without batch support, a 20-ingredient recipe would count as 20 calls against the rolling window instead of 1.

**Independent Test**: Can be fully tested by creating a recipe with 15 ingredients where 10 are locally cached and 5 are unknown. Verify the response includes full data for the 10 known ingredients and "pending" status for the 5 unknown ones. Verify the consumer makes exactly 1 USDA batch API call (not 5 individual calls), counting as 1 call against the rolling window.

**Acceptance Scenarios**:

1. **Given** a recipe submission with 15 ingredients where 10 exist locally and 5 do not, **When** the API processes the request, **Then** it returns the 10 resolved foods with full nutritional data and 5 foods with `status: "pending"`.
2. **Given** 5 unknown `fdcIds` are identified during recipe processing, **When** the system queues a fetch, **Then** it publishes a single `FoodBatchRequested` event containing all 5 IDs (not 5 separate events).
3. **Given** the consumer receives a batch message with 5 `fdcIds`, **When** it calls the USDA API, **Then** it uses `POST /v1/foods` with all 5 IDs in one request, counting as exactly 1 call against the rolling window.
4. **Given** 3 of 5 unknown `fdcIds` are already in the pending set, **When** the API processes the recipe, **Then** it publishes a `FoodBatchRequested` event containing only the 2 truly new IDs (deduplication applied).
5. **Given** a batch USDA response contains 4 successful results and 1 `404`, **When** the consumer processes the response, **Then** it stores 4 foods as `'fetched'` and 1 as `'not_found'` (tombstone).

---

### User Story 5 - Demand-Weighted Queue Priority and Failure Recovery (Priority: P1)

The system enqueues missing-ingredient lookups into a durable Postgres-backed `fetch_queue` table. The consumer drains items ordered by `request_count DESC, first_requested ASC` — items requested more times jump ahead of single-request items, with FIFO as the tie-breaker. Duplicate enqueues for the same `fdc_id` increment a counter rather than creating new rows (single-statement dedup via `ON CONFLICT DO UPDATE`). The consumer is event-driven via Postgres `LISTEN/NOTIFY` and rate-limited by a rolling-window limiter sized to the USDA 1000 req/hr cap. USDA `5xx` errors → pending row with exponential backoff and attempt counter; after 5 attempts → `status='tombstone'` (operational DLQ-equivalent, fully auditable via SQL). `404` errors → immediate tombstone (no retry).

**Why this priority**: A viral recipe driving 50 users to request the same missing ingredient must naturally rise above a one-off single lookup; conversely, no user request should be silently dropped. Demand-weighted ordering achieves both with no manual escalation policy and no cross-system state drift (the queue, the counter, and the status all live in one Postgres row).

**Independent Test**: Can be fully tested by enqueuing 50 duplicate requests for `fdc_id=A` (single row, `request_count=50`) and 5 distinct single requests for `fdc_id=B..F` (5 rows, `request_count=1` each). Verify the consumer processes `A` first, then `B..F` in `first_requested` order. Separately, inject an `fdc_id` that triggers USDA `5xx` and verify it cycles `pending → in_flight → pending` with `attempts++` and backoff gate, landing in `status='tombstone'` after 5 attempts.

**Acceptance Scenarios**:

1. **Given** `fdc_id=A` exists in `fetch_queue` with `request_count=50` and `fdc_id=B` with `request_count=1`, **When** the consumer selects the next item, **Then** it processes `A` before `B`.
2. **Given** two rows tie at `request_count=1`, **When** the consumer selects, **Then** the row with the earlier `first_requested` timestamp is processed first (FIFO tie-break).
3. **Given** the API handler receives a cache miss for `fdc_id=X` already in the queue, **When** it enqueues, **Then** the existing row's `request_count` increments by 1 and no duplicate row is created.
4. **Given** the consumer is idle, **When** a `pg_notify('fetch_queued', ...)` event fires, **Then** the consumer wakes within 100ms and begins draining the queue (subject to the USDA rolling-window limiter).
5. **Given** the USDA API returns `503 Service Unavailable`, **When** the consumer processes the row, **Then** it sets `status='pending'`, `attempts=attempts+1`, and `last_requested=now()+backoff(attempts)`. After 5 cumulative attempts the row sets `status='tombstone'`.
6. **Given** the USDA API returns `404 Not Found` for an `fdc_id`, **When** the consumer processes the response, **Then** it sets `status='tombstone'` immediately (no retry, no DLQ message — the tombstone row IS the audit record).
7. **Given** a tombstoned row, **When** an operator queries `SELECT * FROM fetch_queue WHERE status='tombstone'`, **Then** the row is returned with full `attempts`, `last_error`, and `last_requested` for investigation.

---

### User Story 6 - Food Search by Name (Priority: P2)

A user types an ingredient name (e.g., "chicken breast") while creating a recipe, and the system returns matching foods from the local PostgreSQL store. Search uses PostgreSQL's `pg_trgm` extension for fuzzy matching, so typos like "avacado" still match "avocado." Only locally-fetched foods are searchable — search does not trigger USDA API calls.

**Why this priority**: Ingredient search is the primary interface between Commise's recipe creation UI and the food data layer. However, it operates entirely on local data and doesn't involve the queue/async pattern — it's a read-only feature that improves incrementally as the local store grows.

**Independent Test**: Can be fully tested by seeding 100 foods into PostgreSQL, searching for known foods by exact name and by misspelled name, and verifying relevant results are returned ranked by relevance within 200ms.

**Acceptance Scenarios**:

1. **Given** 100 foods exist in PostgreSQL, **When** a user searches for "chicken breast", **Then** foods with "chicken breast" in the description are returned, ranked by relevance.
2. **Given** a food with description "Avocado, raw" exists locally, **When** a user searches for "avacado", **Then** the fuzzy search returns the avocado result.
3. **Given** no foods matching a query exist locally, **When** the user searches, **Then** the system returns an empty result set (it does NOT query the USDA API for search).
4. **Given** 10,000 foods in the local store, **When** a search query is executed, **Then** results are returned within 200ms.

---

### User Story 7 - Stale Data Refresh (Priority: P2)

A scheduled EventBridge rule periodically identifies foods in the local store whose data is older than a configurable threshold (default: 30 days). These stale foods are re-enqueued as low-priority `fetch_queue` rows for background re-fetching from USDA. This ensures nutritional data stays reasonably current without manual intervention.

**Why this priority**: Data freshness is important for accuracy (SC-010 in Commise spec: "Nutritional calculations accurate to within 5% of source database values") but is not blocking for launch. The system works with stale data; refresh is an optimization.

**Independent Test**: Can be fully tested by seeding 10 foods with `fetched_at` older than 30 days, triggering the scheduled refresh, and verifying all 10 are re-enqueued as low-priority `fetch_queue` rows and re-fetched with updated data.

**Acceptance Scenarios**:

1. **Given** a food was last fetched 31 days ago, **When** the scheduled stale-data check runs, **Then** the food is re-enqueued as a low-priority `fetch_queue` row (triggered by the `IngestionScheduled` EventBridge event).
2. **Given** a food was last fetched 5 days ago, **When** the scheduled stale-data check runs, **Then** the food is NOT re-enqueued.
3. **Given** 500 stale foods are identified, **When** they are re-enqueued, **Then** the consumer drains them under the USDA batch endpoint in groups of up to 20 `fdcIds` per call (25 USDA batch calls total). The batching is an internal USDA-call detail; each food is one `fetch_queue` row.
4. **Given** the consumer re-fetches a stale food, **When** USDA returns updated data, **Then** the food record is upserted with the new data and `fetched_at` is updated.

---

### User Story 8 - Fetch Status Polling (Priority: P2)

A client that received a `202 Accepted` response for a food lookup can poll a dedicated status endpoint to check whether the food data has become available. The endpoint returns the current `fetch_status` (`pending`, `fetched`, `failed`, `not_found`, `stale`) and, once fetched, redirects or includes the full food data.

**Why this priority**: Polling is the simplest client notification mechanism and is the recommended launch approach (Option A from the architecture doc). WebSocket notifications are optional and deferred to P3.

**Independent Test**: Can be fully tested by requesting a food that returns `202`, polling the status endpoint at intervals, and verifying the status transitions from `pending` to `fetched` within 60 seconds.

**Acceptance Scenarios**:

1. **Given** a food with `fetch_status = 'pending'`, **When** the client calls `GET /v1/foods/{fdcId}/status`, **Then** it returns `{"fdcId": 12345, "status": "pending", "estimatedWaitSeconds": 20}`.
2. **Given** a food with `fetch_status = 'fetched'`, **When** the client calls `GET /v1/foods/{fdcId}/status`, **Then** it returns `{"fdcId": 12345, "status": "fetched"}` with the full food data included.
3. **Given** a food with `fetch_status = 'not_found'`, **When** the client calls `GET /v1/foods/{fdcId}/status`, **Then** it returns `{"fdcId": 12345, "status": "not_found"}`.
4. **Given** a food with `fetch_status = 'failed'`, **When** the client calls `GET /v1/foods/{fdcId}/status`, **Then** it returns `{"fdcId": 12345, "status": "failed"}` with a message suggesting the user try again later.

---

### User Story 9 - WebSocket Real-Time Notifications (Priority: P3)

When a food fetch completes asynchronously, the system pushes a real-time notification to connected clients via API Gateway WebSocket API. This eliminates the need for client polling and provides instant UI updates when food data becomes available.

**Why this priority**: WebSocket is an optional UX enhancement. The system is fully functional with polling (US-8). WebSocket should only be added if UX testing shows the polling experience is unacceptable.

**Independent Test**: Can be fully tested by establishing a WebSocket connection, requesting a food that returns `202`, and verifying that a `{"type": "food_ready", "fdcId": 12345}` message is pushed to the WebSocket within 60 seconds of the food being fetched.

**Acceptance Scenarios**:

1. **Given** a client has an active WebSocket connection, **When** the consumer successfully fetches a food the client requested, **Then** a `FoodDataReceived` event triggers a push notification to the client's connection: `{"type": "food_ready", "fdcId": 12345}`.
2. **Given** a client has no active WebSocket connection, **When** a food fetch completes, **Then** no notification is sent (client must use polling as fallback).
3. **Given** a WebSocket connection is established, **When** the connection is idle for more than 10 minutes, **Then** the server closes the connection gracefully and the client can reconnect.

---

### User Story 10 - Monitoring and Observability Dashboard (Priority: P3)

Operations teams can monitor the health of the USDA data pipeline via CloudWatch dashboards and alarms. Key metrics include `fetch_queue` pending-row depth, trailing-60-min USDA call count, fetch latency (p50/p95/p99), cache hit rate, tombstone-row accumulation, and USDA API success rate.

**Why this priority**: Observability is critical for production operations but is not required for the data pipeline to function. It can be layered on after the core system is working.

**Independent Test**: Can be fully tested by generating 100 food fetch requests, then verifying CloudWatch metrics are populated: queue depth, trailing-60-min USDA call count, fetch latency, and cache hit rate are all visible on the dashboard.

**Acceptance Scenarios**:

1. **Given** the system is processing food fetch requests, **When** an operator views the CloudWatch dashboard, **Then** they see real-time metrics for `fetch_queue` pending-row depth, tombstone-row count, trailing-60-min USDA call count, and Fargate consumer worker error rate.
2. **Given** a `fetch_queue` row transitions to `status='tombstone'`, **When** CloudWatch evaluates the alarm, **Then** the tombstone-row alarm fires immediately.
3. **Given** pending `fetch_queue` rows have a `first_requested` older than 5 minutes, **When** CloudWatch evaluates the alarm, **Then** a queue-age alarm fires.
4. **Given** the consumer successfully fetches a food, **When** the custom metric is emitted, **Then** `food_fetch_latency_seconds` is recorded and visible in the latency distribution dashboard.

---

### Edge Cases

- What happens when a user requests a food with an `fdcId` that is not numeric or is outside the valid range? (System returns `400 Bad Request` immediately, no queuing.)
- What happens when the USDA API is down for an extended period (hours/days)? (Pending rows accumulate durably in the `fetch_queue` table — subject to the FR-016 retry/backoff budget and FR-046 depth ceiling — and processing resumes automatically when USDA recovers.)
- What happens when Redis is unavailable? (Full architecture: consumer pauses processing (fail-closed) to avoid uncontrolled USDA API usage; the NestJS read API falls back to PostgreSQL for reads. Lean launch: not applicable — no Redis dependency.)
- What happens when the rolling-window limiter state is lost (Redis restart or PostgreSQL call-log truncation)? (The call log is empty, so the trailing-60-min count starts at 0 and up to 1,000 API calls could fire before the window refills with fresh timestamps. This is bounded and safe-ish, but can briefly exceed the true rolling-hour count right after the loss before converging to steady-state.)
- What happens when hundreds of users request the same new food simultaneously (thundering herd)? (Pending-fetch deduplication via `ON CONFLICT` ensures only 1 `fetch_queue` row exists per `fdcId`; only 1 USDA API call is made regardless of demand.)
- What happens when the Fargate consumer worker crashes mid-processing? (The `in_flight` lease expires after 30s and the row reverts to `pending` (FR-018); the food will be re-fetched on the next drain. No data loss.)
- What happens when a food exists in USDA but the batch endpoint returns it without certain nutrient fields? (System stores whatever data USDA provides; missing fields are stored as `null`; the API response indicates which fields are available.)
- What happens when PostgreSQL is unavailable? (The Fargate consumer worker cannot drain — the `fetch_queue` rows are durable Postgres rows, so they are unaffected once the DB recovers. The NestJS read API cannot serve any food data. This is a full outage of the food data layer.)
- How does the system handle an `fdcId` that was previously tombstoned (`not_found`) but later becomes valid in USDA? (The stale-data refresh job can be configured to re-check tombstones after a configurable period, e.g., 90 days.)
- How does the system handle recipe ingredients that have no USDA match (e.g., certain spices, oils, or proprietary blends)? (The `fdcId` link on the Commise Ingredient is optional. Ingredients without a linked Food simply have no nutritional data from this system; nutritional summaries for recipes exclude unlinked ingredients or display them as "nutrition unavailable.")
- What happens when a Clerk session token expires mid-session, or there is clock skew between client and service? (The request is rejected with `401`; the client refreshes the session via Clerk and retries. Small skew is tolerated by the verifier's standard leeway.)
- What happens when a token is valid but signed for a different Clerk instance, or its `azp` is not in the allowlist? (Verification fails on the key or `azp` check → `401`. This prevents tokens from another Commise environment/instance from being accepted.)
- What happens under an anonymous request flood (denial-of-wallet attempt)? (Because authentication precedes any enqueue or USDA call, unauthenticated traffic is rejected at the edge and cannot consume the USDA rate-limit budget — protecting A-001 and SC-002.)
- What happens when `CLERK_JWT_KEY` is missing or misconfigured at deploy time? (The service fails closed — every request returns `401` rather than allowing unauthenticated access; the condition is surfaced by the auth `401`-rate alarm / health check rather than silently failing open.)
- What happens when a WebSocket client attempts `$connect` without a valid token? (The connection is rejected at `$connect` before establishment; the client must authenticate to subscribe to notifications.)

## Requirements _(mandatory)_

<!--
  Constitution reminders (Principles I-VII):
  - All interfaces/types MUST use strict TypeScript; no `any` outside test doubles (Principle I)
  - All exported symbols MUST carry JSDoc; braces required on all control structures (Principle II)
  - New code MUST use aliased imports with .js extensions; no `helpers/` directories (Principle III)
  - New UI elements MUST be queryable by role/label; no `data-testid` (Principles IV & VII)
  - Any new workspace MUST extend shared tooling configs and be declared in Turbo (Principle V)
  - Formatting and lint gates MUST remain green (Principle VI)
  - Interactive elements MUST have accessible names; design tokens MUST be used for color (Principle VII)
-->

### Functional Requirements

**Food Lookup (Read Path)**

- **FR-001**: System MUST serve food data from the local store (PostgreSQL; a Redis cache is a deferred post-launch variant) without calling the USDA API. The NestJS read API (on ECS/Fargate behind the ALB) MUST NOT call USDA directly in the request path.
- **FR-002**: System MUST return `200 OK` with complete food data (fdcId, description, calories, protein, carbs, fat, and available micronutrients) when the requested food exists locally with `fetch_status = 'fetched'`.
- **FR-003**: System MUST return `202 Accepted` with `{"status": "pending", "fdcId": <id>, "estimatedWaitSeconds": <seconds>}` when a requested food does not exist locally and is not already pending.
- **FR-004**: System MUST return `202 Accepted` without re-queuing when a requested food is already in the pending state (deduplication).
- **FR-005**: System MUST return `404 Not Found` for foods with `fetch_status = 'not_found'` (tombstoned records) without queuing a fetch.
- **FR-006**: System MUST validate `fdcId` format (numeric, positive integer) and return `400 Bad Request` for invalid inputs. No invalid input MUST reach the `fetch_queue`.
- **FR-007**: System MUST provide a `GET /v1/foods/{fdcId}/status` endpoint returning the current `fetch_status` and, if `fetched`, the full food data.

**Food Search**

- **FR-008**: System MUST provide a `GET /v1/foods/search?query=...` endpoint that searches the local PostgreSQL store using full-text or trigram-based fuzzy matching (`pg_trgm`).
- **FR-009**: System MUST NOT call the USDA API for search queries. Search operates exclusively on locally-stored food data.
- **FR-010**: Search results MUST be ranked by relevance and returned within 200ms for a local store of up to 50,000 foods.

**Async Backfill (Write Path)**

- **FR-011**: On a single-food cache miss (no local data and not already pending), the system MUST enqueue the fetch into the durable Postgres `fetch_queue` via the idempotent `INSERT … ON CONFLICT` statement (FR-014) paired with `pg_notify('fetch_queued', fdc_id)` to wake the consumer (FR-017). **EventBridge is reserved for scheduled producers** (stale-refresh/bulk-sync, FR-032) and the `FoodDataReceived` completion event (FR-034) — it is not on the demand-path enqueue.
- **FR-012**: On a multi-food cache miss (a recipe submission/import identifying multiple unknown `fdcIds`), the system MUST enqueue each unknown id into `fetch_queue` (deduped via `ON CONFLICT`, FR-014) so the consumer drains and batches them under the USDA batch endpoint (≤20 ids/call, FR-023). The batch is bounded by FR-045 (≤100 ids/request).
- **FR-013**: System MUST deduplicate fetch requests using a pending-fetch mechanism: PostgreSQL `INSERT ... ON CONFLICT` on `fetch_queue` (lean launch — the default build); a Redis Set (`SISMEMBER`/`SADD` on `pending_fetch`) is a deferred full-architecture variant.

**Queue Management**

- **FR-014**: On a `foods` table cache miss, the API handler MUST enqueue the lookup via a single idempotent statement: `INSERT INTO fetch_queue (fdc_id) VALUES ($1) ON CONFLICT (fdc_id) DO UPDATE SET request_count = fetch_queue.request_count + 1, last_requested = now() WHERE fetch_queue.status = 'pending'`. This achieves dedup, demand counting, and timestamping in one round-trip.
- **FR-015**: The consumer MUST select the next item via `SELECT fdc_id FROM fetch_queue WHERE status='pending' AND last_requested <= now() ORDER BY request_count DESC, first_requested ASC FOR UPDATE SKIP LOCKED LIMIT 1`. This produces literal demand-weighted ordering with FIFO tie-break and naturally honors per-row backoff gates.
- **FR-016**: The consumer MUST retry transient failures (USDA 5xx, network timeout, 429) up to 5 cumulative attempts. Retries MUST be tracked via the `attempts` column with exponential backoff applied to `last_requested` (e.g., `last_requested = now() + interval '2^attempts seconds'`). After 5 attempts, the row MUST be set to `status='tombstone'` with `last_error` populated for operator review.
- **FR-017**: The consumer MUST be triggered by Postgres `LISTEN/NOTIFY` on the channel `fetch_queued`. The enqueue statement MUST be paired with `pg_notify('fetch_queued', fdc_id)`. Consumer wake-to-process latency MUST be ≤ 100ms (subject to the USDA rate-limit rolling-window limiter).
- **FR-018**: The consumer MUST enforce the USDA 1000 req/hr rate limit via a single shared rolling-60-min-window limiter. When the trailing-60-min count is at the 1,000/hr cap, the consumer MUST sleep until the oldest call ages out of the window rather than dropping work. Stale `in_flight` rows older than 30s MUST be reverted to `pending` (lease timeout) to recover from consumer crashes.

**Rate Limiting (Rolling 60-Minute Window)**

- **FR-019**: System MUST enforce a rolling 60-minute window rate limiter that caps USDA calls at **≤1,000 in any trailing 60 minutes**. The consumer worker MUST self-throttle so the system **never exceeds 1,000 req/hr**: when the trailing-60-min call count reaches **90% (900)**, the worker MUST **pause draining the `fetch_queue`** and resume only as older calls age out of the window (the count drops back below the threshold), rather than risk breaching the cap (pending rows simply wait; callers continue to poll).
- **FR-020**: The rolling-window check-and-record operation MUST be atomic: counting the calls in the trailing 60 minutes and recording the new call MUST happen in one atomic operation. In the lean launch variant (default), this is a PostgreSQL call-log count+insert in a transaction (e.g. `INSERT ... WHERE (SELECT count(...) ...) < 1000 RETURNING`). In the deferred Redis variant, this is a sorted-set Lua script (`ZADD` timestamp / `ZCOUNT` last 60 min).
- **FR-021**: When the trailing-60-min call count is at the 1,000/hr cap, the consumer MUST NOT call the USDA API. It MUST leave the `fetch_queue` row eligible (releasing any `in_flight` lease so it reverts to `pending`) and wait for earlier calls to age out of the window rather than advancing.
- **FR-022**: The Fargate consumer worker MUST run as a single instance at any time (exactly one consumer), enforced via a Postgres advisory lock (one Fargate task holds the lock; others stand by).

**USDA API Integration**

- **FR-023**: The consumer MUST use `GET /v1/food/{fdcId}` for single-food fetches and `POST /v1/foods` with up to 20 `fdcIds` for batch fetches, counting as 1 call against the rolling window per API call regardless of batch size.
- **FR-024**: On USDA `200 OK`, the consumer MUST upsert the food into PostgreSQL with `fetch_status = 'fetched'`, cache it in Redis (if present), remove it from the pending set, mark the `fetch_queue` row fetched (resolve/delete the row), and emit a `FoodDataReceived` event.
- **FR-025**: On USDA `404 Not Found`, the consumer MUST write a tombstone record (`fetch_status = 'not_found'`) and set the `fetch_queue` row `status='tombstone'`. No immediate retry. The tombstone carries a **configurable TTL (default 30 days)**: a lookup after the TTL has lapsed MAY re-attempt the fetch (in case USDA has since added the food), and that re-attempt counts against the normal rolling-window call budget (FR-019) so it cannot be used to bypass the rate limit. Within the TTL, a tombstoned `fdcId` returns `404` without enqueueing.
- **FR-026**: On USDA `429 Too Many Requests`, the consumer MUST back off — treating the rolling window as full — leave the `fetch_queue` row `pending` (it will retry after the backoff gate), and stop draining further rows for now.
- **FR-027**: On USDA `5xx` errors (and network timeouts), the consumer MUST set the `fetch_queue` row `status='pending'`, increment `attempts`, and apply exponential backoff to `last_requested` per FR-016. After 5 cumulative attempts the row MUST be set to `status='tombstone'` with `last_error` populated (the tombstone row is the operational DLQ-equivalent; there is no SQS DLQ).

**Data Persistence**

- **FR-028**: The `foods` table MUST include: `fdc_id` (primary key), `description`, `data_type`, `nutrients` (JSONB), `fetch_status` (`'pending'` | `'fetched'` | `'failed'` | `'not_found'` | `'stale'`), `fetched_at`, `last_requested_at`, `request_count`, `created_at`, `updated_at`.
- **FR-029**: System MUST index the `foods` table on: `fdc_id` (B-tree primary), `fetch_status` + `fetched_at` (composite, for stale detection), `last_requested_at` (for LRU analysis), and full-text on `description` (GIN index for search).
- **FR-030** _(deferred post-launch variant)_: If a Redis cache is introduced, entries MUST use key format `food:{fdcId}` with a TTL of 24 hours and `allkeys-lfu` eviction policy. Not part of the lean-launch build.

**Stale Data Management**

- **FR-031**: System MUST support a configurable staleness threshold (default: 30 days). Foods with `fetched_at` older than the threshold MUST be eligible for background re-fetch. On a read of a `stale` record, the API MUST **serve the existing (stale) data immediately as `200`** (with a staleness indicator) **and enqueue a background re-fetch** (stale-while-revalidate) — the read never blocks and never returns `202` for a record it already holds, in addition to the scheduled sweep (FR-032). If the background re-fetch keeps failing (e.g., prolonged USDA outage), the API MUST **continue serving the stale data indefinitely** (availability over freshness); there is no max-staleness cutoff that withholds an already-held record, and the re-fetch keeps retrying.
- **FR-032**: An EventBridge scheduled rule MUST trigger periodic stale-data checks (the `IngestionScheduled` event). Stale foods MUST be re-enqueued as low-priority rows on the `fetch_queue` (deduped via `ON CONFLICT` per FR-014).

**Notification**

- **FR-033**: System MUST support client polling via `GET /v1/foods/{fdcId}/status` as the primary notification mechanism for async food availability.
- **FR-034**: System MAY support WebSocket push notifications via API Gateway WebSocket API as an optional enhancement. When implemented, the consumer MUST emit `FoodDataReceived` events that trigger a push to connected clients.

**Authentication & Authorization**

- **FR-035**: All food data endpoints (`GET /v1/foods/{fdcId}`, `GET /v1/foods/{fdcId}/status`, `GET /v1/foods/search`, batch lookups, and the WebSocket `$connect`) MUST require a valid **Clerk session token** presented as a Bearer credential. Requests without a valid token MUST receive `401 Unauthorized` and MUST NOT reach business logic, enqueue a fetch, or trigger a USDA API call.
- **FR-036**: The service MUST verify the Clerk session token **itself, networklessly**, using the public Clerk JWT verification key (`CLERK_JWT_KEY`) for the same Clerk instance the rest of Commise uses (provided via 002). It MUST NOT call Clerk or any external IdP on the request path, and MUST NOT use an Auth0/Cognito authorizer.
- **FR-037**: Token verification MUST enforce authorized parties: the token's `azp` claim MUST match one of the configured `CLERK_AUTHORIZED_PARTIES`. Tokens failing signature, expiry (`exp`), not-before (`nbf`), or `azp` validation MUST be rejected with `401`.
- **FR-038**: The authenticated caller's identity MUST be derived **solely** from the cryptographically-verified token (Clerk `sub`). The service MUST NOT trust any client-suppliable identity header (e.g., `x-authorizer-context`, `x-user-id`); such headers MUST be ignored. (Mirrors the identity service's PR #39 decision: a client-forgeable identity header is a bypass.)
- **FR-039**: All authenticated Commise users MUST be authorized to read food data — foods are shared reference data, not user-owned, so no per-record ownership checks apply. Any operational or administrative endpoint (e.g., manual re-fetch or stale-refresh triggers, if exposed) MUST additionally require an elevated scope/permission read from the verified token's `public_metadata`.
- **FR-040**: Authentication MUST **fail closed**: any error in token verification — missing/invalid `CLERK_JWT_KEY` config, malformed token, or a verification exception — MUST result in `401`, never in an unauthenticated request proceeding.
- **FR-041**: The WebSocket API (US-9) MUST authenticate the Clerk token at `$connect` and reject unauthenticated connections before establishment. To make per-recipient delivery implementable despite fetch deduplication (FR-013/FR-014 collapse a food to one row/one event), the system MUST persist an authenticated **subscription set** mapping each requester `sub` → the `fdcId`s it requested (recorded at request time and/or `$connect`). On a `FoodDataReceived` event, the notifier MUST resolve recipients from that set and MUST NOT broadcast the completion signal to connections that did not request the `fdcId`. _(Closes RT F-012.)_
- **FR-042**: The service MUST read `CLERK_JWT_KEY` (public PEM verification key) and `CLERK_AUTHORIZED_PARTIES` (allowlist of permitted `azp` values) from configuration; both are non-secret. No Clerk secret key or client secret is required for request authentication. (The USDA API key remains the only secret — stored in Secrets Manager per FR-related A-009.)

**Authentication & Authorization — Red Team hardening (RT-003-usda-food-data-2026-06-19)**

- **FR-043** _(fairness by demotion, not rejection — closes RT F-001; revised 2026-06-20)_: Authentication alone MUST NOT be treated as rate limiting, **but the system MUST NOT reject authenticated cache-miss requests with a per-user quota** — there is **no `429` for exceeding a personal limit**. Fairness is enforced by **queue demotion**: when a single authenticated `sub` (end-user or service principal) has **more than 50 items currently pending in the `fetch_queue`**, that requester's queued and subsequent items MUST be ranked to the **back** of the priority order (lowest priority, below FR-015 demand ordering) so a heavy requester cannot starve other users. Demotion MUST be **dynamic**: priority is computed **at drain time** from the requester's current pending count, so a `sub`'s items automatically return to normal priority once their pending count falls back below 50 (the queue scorer reads live state, not a frozen flag). This is **work-conserving** — a demoted requester still drains using spare capacity. Together with the worker self-throttle (FR-019) and the queue-depth backstop (FR-046, `503`), this guarantees no single `sub` can monopolize the shared **1,000 req/hr** USDA budget, with **no legitimate request rejected**. (The rolling-window limiter protects USDA from the system; demotion + the 90% pause protect users from each other.)
- **FR-044** _(demand counting by distinct requester — closes RT F-011)_: The demand-weighted priority (`request_count`, FR-015) MUST count **distinct authenticated `sub`s** per `fdcId` (via the requester subscription set), not raw request volume. A single `sub`'s repeated requests for the same `fdcId` MUST NOT increment priority more than once, the priority contribution MUST be capped, and queue ordering MUST apply aging so no `fdcId` can be pinned to the front indefinitely. This prevents priority-inversion starvation of genuine single-request items.
- **FR-045** _(max batch size + partial response — closes RT F-013)_: Batch lookups (`POST /v1/foods/batch`, recipe-import fetch sets per FR-012) MUST enforce a hard maximum of **100 `fdcId`s per request** (binding). Requests over the limit MUST be rejected with `400 Bad Request` and MUST NOT enqueue any fetch. For an accepted batch mixing cached and uncached ids, the response MUST be a **per-item partial result**: cached/stale foods are returned inline and each miss is returned as a `pending` entry (its fetch enqueued), in a single response body — the caller gets available data immediately and polls only the pending ids (no all-or-nothing withholding). Enqueued misses are subject to the same demotion fairness (FR-043), not a per-user quota. The USDA call cap of 20 IDs per rolling-window call (FR-023) is an internal batching detail, not the client-facing limit.
- **FR-046** _(queue backpressure + enforced circuit breaker — closes RT F-014)_: The system MUST enforce a maximum `fetch_queue` depth of **10,000 entries** (configurable). When the queue depth reaches that ceiling, or when the USDA circuit breaker is **open** (e.g. during a USDA outage), new enqueue attempts MUST fail closed with `503 Service Unavailable` rather than growing the queue unbounded. The circuit breaker is a normative requirement, not an operational footnote; recovery MUST avoid a thundering-herd burst (e.g. jittered drain).
- **FR-047** _(service-to-service auth — closes RT F-006)_: Server-initiated callers that have no end-user session token — downstream services (001 recipes, 006 meal-planning, 007 grocery, 009 nutrition) and internal jobs (recipe import per FR-012, stale-refresh per FR-032) — MUST authenticate via a **Clerk machine (M2M) token** whose `azp`/authorized party is in `CLERK_AUTHORIZED_PARTIES`, or a designated internal service principal. The spec MUST classify each endpoint as user-token, service-token, or both. This remains networkless Clerk verification (consistent with FR-036/FR-042); it does NOT introduce a Clerk secret key on the request path.
- **FR-048** _(async producer authorization — closes RT F-005)_: Only named, least-privilege IAM principals MAY publish `FoodRequested`/`FoodBatchRequested`/`IngestionScheduled` events to EventBridge or insert into `fetch_queue`. The consumer MUST validate event provenance. US-0's guarantee ("no unauthenticated path may drive USDA consumption") MUST hold for async/internal producers, not only the synchronous HTTP edge.
- **FR-049** _(WebSocket auth mechanics — closes RT F-008)_: The WebSocket auth contract MUST specify: (a) how the token is presented at `$connect` (query parameter or `Sec-WebSocket-Protocol` subprotocol, since browsers cannot set an `Authorization` header on WebSocket); (b) behavior on **mid-connection token expiry** (`exp` passes during a long-lived connection) — the connection MUST be closed (or require re-auth on next message); (c) the reconnect/re-auth flow after the 10-minute idle close (US-9); (d) a single, pinned `$connect` rejection status (`403`, per API Gateway WebSocket authorizers).
- **FR-050** _(authorizer fail-closed hardening — closes RT F-003)_: For the HTTP read API (`/v1/foods/*`), auth is the in-process NestJS `AuthMiddleware` (A-011); it has **no authorizer result cache**, so there is no cache to poison — the middleware MUST verify every request and MUST be wired ahead of **every route** (no route may bypass it), and a denied request MUST return `401`/`403`, never a default-open response. The API Gateway REQUEST-authorizer caching rules apply **only** to the deferred WebSocket `$connect` (US-9): there, authorizer result caching MUST be disabled (TTL = 0) or keyed solely on the verified token (never on a client-controlled value), the authorizer MUST be attached to **every WebSocket route AND method** (including `$connect` and `$default`), and a denied authorization MUST return `401`/`403`, never a default-open Gateway response.
- **FR-051** _(response-status precedence + 403 — closes RT F-007, F-010)_: The service MUST apply a normative response precedence: **authentication (`401`) → authorization scope (`403`) → input validation (`400`) → business logic (`404`/`202`/`200`)**. Authenticated-but-insufficient-scope requests (FR-039) MUST receive `403 Forbidden`. FR-002/FR-003/FR-005/FR-006 are subject to this ordering (their `200`/`202`/`404`/`400` outcomes occur only after `401`/`403` checks pass).
- **FR-052** _(auth-layer DoS protection — closes RT F-015)_: The auth layer MUST bound verification concurrency and apply a per-source `401`-rate cap (load-shed) so that a flood of well-formed-but-invalid tokens (each forcing a CPU-bound signature verification before the fail-closed `401`) cannot saturate the verifier and breach SC-009 availability. SC-011's ≤10ms p95 MUST be validated under an invalid-token flood, not only the happy path.
- **FR-053** _(auth is a first-class architecture component — closes RT F-002)_: The Clerk verification + authorization layer MUST be represented as a **named component** in the architecture and module designs, positioned in front of every food data entry point (HTTP routes and WebSocket `$connect`), with traceability rows binding FR-035–FR-052 to it. The auth design MUST NOT exist only as spec prose unmapped to any module (the failure this requirement prevents: an implementer following the architecture ships an unauthenticated service that still "traces" to the design).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript code in the USDA food data workspace MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. All interfaces for food data, fetch-queue rows, and API responses MUST use strict typing with `interface` for data shapes and `type` for unions/aliases. (Constitution Principle I)
- **NFR-002**: All exported functions, classes, interfaces, type aliases, and interface fields MUST carry JSDoc block comments. Worker handlers, API route handlers, rolling-window limiter operations, and fetch-queue processors MUST include `@param`, `@returns`, and `@throws` tags. (Principle II)
- **NFR-003**: All imports within the USDA food data workspace MUST use aliased paths (`@kitchensink/*`, `@kitchensink/*`, `@kitchensink/<pkg>`) with `.js`/`.jsx` extensions. No `helpers/` directories. (Principle III)
- **NFR-004**: If any UI components are created for food data display (e.g., nutritional info cards, pending-food indicators), they MUST expose accessible names queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-005**: Color MUST NOT be the sole conveyor of food fetch status (pending, fetched, failed, not_found). Each status MUST be paired with a text label or icon. (Principle VII)
- **NFR-006**: All new workspaces (`@kitchensink/food-service`, `@kitchensink/usda-client`, `@kitchensink/food-service-client`, `@kitchensink/clerk-verify`) MUST be registered in the root `package.json` workspaces array (the `packages/clients/*` ones as explicit paths) and MUST extend `@kitchensink/typescript`, `@kitchensink/eslint`, `@kitchensink/prettier`, and `@kitchensink/vitest` shared configs. Turbo task dependencies MUST be declared. (Principle V)
- **NFR-007**: All code MUST pass `turbo run typecheck`, `turbo run lint`, and `turbo run format:check` with zero errors before merge. (Principle VI)
- **NFR-008**: Tests MUST conform to the testing pyramid: >= 70% unit, <= 20% integration, <= 10% E2E. Each test file MUST open with a block comment mapping requirement IDs (FR-xxx) to test case descriptions. (Principle IV)
- **NFR-009**: Custom errors (e.g., `UsdaApiError`, `RateLimitWindowFullError`, `FoodNotFoundError`) MUST extend `Error` and MUST expose a type guard (`isXxxError(e: unknown): e is XxxError`). (Principle I)
- **NFR-010**: Dates in all food data interfaces MUST be ISO 8601 strings, never `Date` objects. (Principle I)

### Key Entities

- **Food**: Represents a single food item from the USDA FoodData Central database. A "Food" is a USDA nutritional record — distinct from a Commise "Ingredient," which is a recipe component that MAY link to a Food via `fdcId`. All foods can be ingredients, but not all ingredients are foods (e.g., spices, oils may lack USDA matches; the `fdcId` link is optional on the Ingredient side). Key attributes: `fdcId` (unique identifier), `description` (human-readable name), `dataType` (e.g., Foundation, SR Legacy, Branded), `nutrients` (structured nutritional data including calories, protein, carbs, fat, and available micronutrients), `fetchStatus` (pending | fetched | failed | not_found | stale), `fetchedAt` (ISO 8601 timestamp of last successful USDA fetch), `lastRequestedAt` (ISO 8601 timestamp of most recent user request), `requestCount` (number of times this food has been requested). Stored in PostgreSQL; optionally cached in Redis. This entity fulfills Commise FR-007 ("back ingredient data with a real food/nutrition database").

- **FetchRequest**: Represents an intent to retrieve food data from the USDA API. Key attributes: `fdcId` (or array of `fdcIds` for batch), `requestedAt` (ISO 8601), `requestSource` (user-lookup | recipe-import | stale-refresh), `priority` (high | low). Manifests as a `fetch_queue` row (see `FetchQueueRow`). Lifecycle: created by the NestJS read API on cache miss -> persisted as a `fetch_queue` row (idempotent `INSERT … ON CONFLICT`, FR-014) -> drained by the Fargate consumer worker -> resolved (food stored, or row tombstoned).

- **RateLimitWindow** (formerly TokenBucketState): Represents the rolling-window rate limiter's current state — the set of recent USDA-call timestamps over the trailing 60 minutes. Key attributes: `recentCallTimestamps` (ISO 8601 timestamps of USDA calls in the trailing 60 minutes), derived `trailingCount` (number of calls in the window, capped at 1,000). Stored as a Postgres call log (e.g. a `usda_call_log` table of timestamped rows, pruned/filtered to the trailing 60 min) in the lean launch variant, or a Redis sorted set (`ZADD` timestamp / `ZCOUNT` last 60 min) in the deferred variant. All check-and-record mutations are atomic. (FR-019, FR-020)

- **FetchQueueRow**: Represents a single durable row in the Postgres `fetch_queue` table — the unit of work in the demand fetch queue (Postgres-as-queue; this is **not** an SQS message). Key attributes: `fdc_id` (unique — `ON CONFLICT` target for dedup), `request_count` (demand counter for weighting, FR-015/FR-044), `status` (`pending` | `in_flight` | `tombstone`), `attempts` (cumulative retry count, FR-016), `last_error` (populated on tombstone for operator review), `first_requested` (FIFO tie-break) and `last_requested` (backoff gate) ISO 8601 timestamps, `priority` (high | low). Drained one-at-a-time by the Fargate consumer worker via `SELECT … FOR UPDATE SKIP LOCKED` ordered by `request_count DESC, first_requested ASC`. Batching under the USDA endpoint (≤20 ids/call) is an internal drain detail, not a property of the row.

- **FoodDataEvent**: Represents an EventBridge event in the food data lifecycle. EventBridge is used **only** for scheduled producers and the completion signal — **not** for the demand-path enqueue (that is a direct `fetch_queue` `INSERT … ON CONFLICT` + `pg_notify('fetch_queued')`, FR-011/FR-014/FR-017). Types: `IngestionScheduled` (EventBridge scheduled rule -> stale-refresh/bulk-sync producer that enqueues low-priority `fetch_queue` rows, FR-032), `FoodDataReceived` (Fargate consumer worker -> WebSocket/notifications on successful fetch, FR-034), `FetchFailed` (Fargate consumer worker -> CloudWatch/SNS on tombstone). `FoodRequested`/`FoodBatchRequested` denote the synchronous demand-path enqueue performed in-process by the read API directly against `fetch_queue` (no EventBridge, no queue topic).

- **AuthenticatedCaller**: Represents the verified principal behind a request. Derived per-request from the validated Clerk session token — never persisted by this service and never sourced from a client-supplied header. Key attributes: `sub` (Clerk user identifier), `azp` (authorized party / originating Commise client, checked against `CLERK_AUTHORIZED_PARTIES`), and `scopes`/`permissions` (read from the token's `public_metadata`, used only to gate operational/admin endpoints per FR-039). Produced by the NestJS `AuthMiddleware` (in-process, on ECS/Fargate behind the ALB) and surfaced to handlers via `req.user`. For the deferred WebSocket notifier (US-9), the equivalent principal is produced by the API Gateway WebSocket `$connect` REQUEST authorizer and surfaced via the trusted `$context.authorizer`; that `$context.authorizer` path applies only to the WebSocket `$connect`, not to the HTTP read API.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Food lookups for locally-cached items (cache hit) MUST return within 50ms at p95 latency.
- **SC-002**: The system MUST make ≤1,000 USDA API calls in ANY rolling 60-minute window. Rolling-window compliance MUST be verifiable via CloudWatch metrics — no rolling-hour window ever exceeds 1,000 calls and zero `429` responses occur under normal operation.
- **SC-003**: Background food fetches (from `202 Accepted` to data available) MUST complete within 60 seconds at p95 when the `fetch_queue` pending-row depth is under 100 rows.
- **SC-004**: Cache hit rate MUST exceed 80% once the local store contains 5,000+ unique foods (measured over a rolling 24-hour window).
- **SC-005**: The USDA batch endpoint MUST be used for multi-food fetches, achieving an effective throughput of at least 5,000 foods per hour (average batch fill rate of 5+ IDs per API call).
- **SC-006**: Zero data loss from queue processing failures. All persistently failing rows MUST be tombstoned (`status='tombstone'`) after the FR-016 retry budget (5 cumulative attempts). The tombstone-row count MUST be trackable via CloudWatch alarm (the durable `fetch_queue` row is the audit record; there is no DLQ).
- **SC-007**: Food search queries against a local store of up to 50,000 foods MUST return results within 200ms at p95.
- **SC-008**: Nutritional data stored locally MUST match USDA source values exactly (no rounding or transformation at ingestion). This supports Commise SC-010 ("Nutritional calculations accurate to within 5% of source database values").
- **SC-009**: The food data API (`/v1/foods/*` endpoints) targets 99.9% availability measured monthly, excluding scheduled maintenance windows communicated 48 hours in advance. Availability is defined as successful responses (2xx/3xx/4xx) divided by total requests; only 5xx responses and timeouts count as downtime. **Lean-launch caveat (per A-002/A-013):** the API tier is stateless (multi-task ECS/Fargate, multi-AZ-capable), but the reused shared database is **single-AZ (`multiAz: false`)**, which caps DB availability below 99.9% during an AZ outage or DB maintenance. For lean launch this single-AZ posture is an **accepted risk**; the 99.9% guarantee is contingent on the **multi-AZ upgrade** of the shared `kitchensink-data-{stage}` instance (deferred — see Assumptions A-013). Until then, SC-009 is the _target_, not a contractual SLA.
- **SC-010**: 100% of food data endpoints — every `/v1/foods/*` route and the WebSocket `$connect` — MUST reject unauthenticated, expired, malformed, and wrong-`azp`/wrong-instance requests with `401`, verified by automated tests covering each endpoint. No rejected request may enqueue a fetch or trigger a USDA API call.
- **SC-011**: Clerk session-token verification MUST add no more than 10ms at p95 to request latency (networkless, no IdP round trip), keeping cache-hit lookups within the 50ms SC-001 budget. This MUST hold under an **invalid-token flood** (well-formed but unverifiable tokens forcing full signature checks), not only the happy path — verifying the auth layer sheds load rather than saturating (FR-052).
- **SC-012**: No single authenticated `sub` may starve others. A test in which one account floods cache-miss lookups (>50 pending) MUST show that account's items **demoted to the back** of the `fetch_queue` while other users' requests continue to be served, with **no request rejected by a per-user quota**, and the system MUST never exceed 1,000 USDA req/hr (the worker pauses at ~90%). (Auth proves identity; demotion + the 90% pause prove fairness — FR-043/FR-019.)

## Assumptions

- **A-001**: The USDA FoodData Central API rate limit of 1,000 requests per hour per API key is a hard constraint that cannot be increased through paid tiers or support requests within the project timeline.
- **A-002**: The lean launch variant (no Redis, `db.t4g.micro` PostgreSQL) is the default starting configuration. Redis is added when performance thresholds warrant it (p95 read latency > 100ms sustained, or lookup volume > 50K/day).
- **A-003**: Eventual consistency is acceptable for food data. Users tolerate a 10-60 second delay for first-time food lookups in exchange for never blocking on an external API call.
- **A-004**: The USDA API remains publicly available with a free tier and the current `POST /v1/foods` batch endpoint supporting up to 20 IDs per request.
- **A-005**: This feature deploys as an AWS-hosted backend service in `us-east-1`. The **read API** (`/v1/foods/*`) is a NestJS service on ECS/Fargate behind a public ALB (same topology as the identity service); the async backfill pipeline uses the durable Postgres `fetch_queue` table (Postgres-as-queue with `LISTEN/NOTIFY`) drained by a single Fargate consumer worker — **no SQS** — with EventBridge only for scheduled producers (stale-refresh/bulk-sync) and the `FoodDataReceived` completion event, on the shared RDS. It serves both the web and mobile Commise clients via the ALB. The only API Gateway surface is the deferred WebSocket notifier (US-9). **No new RDS or cluster is provisioned** — the food tables live in a separate logical database `kitchensink_food` on the existing shared instance `kitchensink-data-{stage}` (the global DataStack provisions that database + its role/secret).
- **A-006**: This feature adds **four** packages to the KitchenSink monorepo, all following Constitution Principle V workspace rules: `@kitchensink/food-service` (`packages/services/food-service` — the deployable service + its CDK), `@kitchensink/usda-client` (`packages/clients/usda` — external USDA client), `@kitchensink/food-service-client` (`packages/clients/food-service` — our API client), and `@kitchensink/clerk-verify` (`packages/shared/clerk-verify` — shared Clerk verification). `packages/clients/*` packages are added to the root `workspaces` array as explicit paths (grouping folder, not a glob).
- **A-007**: Client-side polling (not WebSocket) is the launch notification mechanism. WebSocket (US-9) is deferred until UX testing validates the need.
- **A-008**: The `foods` table schema is purpose-built for this feature. Integration with Commise's `ingredients` entity (linking recipe ingredients to `fdcId` references) is a downstream concern handled by the Commise recipe management feature, not by this specification.
- **A-009**: The USDA API key is stored in AWS Secrets Manager and rotated per AWS best practices. The key is never exposed in client-facing responses or logged. All food data API endpoints share the Commise application's authentication boundary by verifying the same **Clerk** session token (via the public `CLERK_JWT_KEY` and `CLERK_AUTHORIZED_PARTIES`, provided by 002); no separate auth mechanism, user store, or Auth0/Cognito authorizer is introduced. The USDA API key remains the only secret this feature requires.
- **A-011**: Clerk token verification for the food **read** API (`/v1/foods/*`) is implemented **in-process** by a NestJS `AuthMiddleware` running on ECS/Fargate behind a public ALB — the **same topology as the identity service** — using the shared `ClerkAuthService` (`@clerk/backend` `verifyToken`, networkless) to validate signature, expiry, and `azp` via the public `CLERK_JWT_KEY`. There is **no API Gateway and no Lambda authorizer for the HTTP API**; the verified `sub`/claims are populated on `req.user` and surfaced to handlers in-process. The **only** Lambda-authorizer / `$context.authorizer` surface is the **deferred WebSocket** notifier (US-9): an API Gateway WebSocket API whose `$connect` REQUEST authorizer performs the same networkless Clerk verification and passes the verified claims via API Gateway's trusted `$context.authorizer` (set by API Gateway, not the client). Identity is taken **only** from the verified token — never from a client-supplied header (no `x-authorizer-context` trust), mirroring the identity service's PR #39 decision (FR-038).
- **A-010**: All food data API endpoints use URL prefix versioning (`/v1/foods/*`). Breaking changes require a new version prefix (`/v2/foods/*`). **A "breaking change" includes response-contract and auth-semantic changes** (e.g. introducing `401`/`403` as new possible responses to an existing endpoint), not only route-shape changes — such changes MUST be coordinated as a cutover with existing consumers rather than slipped silently under the same `/v1/` prefix (RT F-009). The FR-035 endpoint enumeration MUST stay reconciled with the full implemented endpoint set (e.g. `/v1/foods/batch`, `/v1/foods/{fdcId}/nutrients`, `/v1/foods/autocomplete`); every exposed endpoint has a defined auth status. The USDA FoodData Central API's own `/v1/` prefix is independent and unrelated to our versioning.
- **A-012**: Two Clerk token classes authenticate this service: **user session tokens** (interactive web/mobile callers) and **machine (M2M) tokens** (server-to-server callers — downstream services 001/006/007/009 and internal jobs). Both are verified networklessly via `CLERK_JWT_KEY` with `azp` enforcement; neither requires a Clerk secret key on the request path. Endpoints are classified user-token, service-token, or both (FR-047). The `AuthenticatedCaller` principal therefore carries either a human `sub` or a service identity.
- **A-013** _(availability posture)_: Lean launch reuses the shared single-AZ database instance (`multiAz: false`), so SC-009's 99.9% is a **target with an accepted single-AZ risk**, not a contractual SLA. Promoting `kitchensink-data-{stage}` to multi-AZ (a global-DataStack change) is the documented upgrade that makes 99.9% defensible; it is **deferred to the GA/scale phase** and tracked as a deferred task (T-061). The stateless API tier already runs multi-task across AZs, so the API itself is not the availability bottleneck.
