# Feature Specification: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-04-14
**Status**: Draft — **re-baselined 2026-06-21 to the source-agnostic food data model** (see Clarifications Session 2026-06-21). This spec supersedes the USDA-coupled Phase 1–2 design: a food is now keyed by an internal `id`, USDA is one pluggable source adapter among many, foods are assembled into a cross-source golden record, and users add foods **by name** through a `PENDING → (UNRESOLVED) → RESOLVED` lifecycle. All `fdcId` / `fetch_status` / denormalized-nutrient-column references from the prior design are removed except inside the USDA adapter boundary.
**Input**: User description: "Integrate USDA FoodData Central as the primary food/nutrition database backing Commise recipes ... for rate-limited async data fetching." _(Verbatim original ask framed the queue as **SQS + Lambda**; that framing was **superseded** during planning — the locked architecture is a **Postgres `fetch_queue` (LISTEN/NOTIFY) + Fargate worker**, with the same "event-driven, rate-limited" intent. See plan §1/§4.)_ _(Re-baseline note 2026-06-21: the original "USDA as the schema" framing is also superseded — USDA is now an **adapter**, not the canonical model; see `docs/brainstorms/2026-06-21-source-agnostic-food-data-model-requirements.md`.)_

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
- Q: What versioning strategy for our own food data API? → A: URL prefix versioning — `/v1/foods/{id}`. _(Re-baseline 2026-06-21: the path param is the internal `id`, not a source id.)_
- Q: What is the availability target for the food data API layer? → A: 99.9% uptime (~8.7 hours downtime/year).
- Q: What is the canonical distinction between "Food" and "Ingredient"? → A: Food = a canonical, source-agnostic nutritional record keyed by an internal `id`. Ingredient = recipe component that MAY link to a Food via that Food's `id`. All foods can be ingredients, but not all ingredients are foods (e.g., spices, oils may have no source match). The link is optional. _(Re-baseline 2026-06-21: the link is `id`-based, not `fdcId`-based.)_
- Q: Should we add a formal out-of-scope section? → A: No — implicit boundaries in A-008 and FR-009 are sufficient.

### Session 2026-06-18 (Auth protection — Clerk)

- Q: How are the food data services protected, given Commise uses Clerk (not Auth0)? → A: Every food data endpoint (create-by-name, single read, search, candidates, resolve, and the WebSocket `$connect`) requires a valid **Clerk session token**. The service verifies the token **itself, networklessly**, using the public `CLERK_JWT_KEY` and enforcing the `azp` (authorized-parties) claim against `CLERK_AUTHORIZED_PARTIES` — the same Clerk instance the rest of Commise uses. No Auth0/Cognito authorizer, no IdP round trip on the request path.
- Q: Where is the token verified for the food read API? → A: **In-process**, by a NestJS `AuthMiddleware` running on ECS/Fargate behind a public ALB (the same topology as the identity service), using the shared `ClerkAuthService` (`@clerk/backend` `verifyToken`). There is **no API Gateway and no Lambda authorizer for the HTTP API**; verified `sub`/claims are populated on `req.user`. The only REQUEST Lambda authorizer / `$context.authorizer` surface is the **deferred WebSocket** `$connect` (US-9). Identity is taken **only** from the verified token — never from a client-supplied header (no `x-authorizer-context` trust), mirroring the identity service's PR #39 decision.
- Q: What is the authorization model? → A: Food data is shared reference data, so **any authenticated Commise user may read** it; there are no per-record ownership checks. Operational/admin endpoints (manual re-fetch, refresh triggers), if exposed, additionally require an elevated scope/permission read from the token's `public_metadata`.
- Q: Why is auth launch-blocking rather than an enhancement? → A: The API is internet-facing and every endpoint can drive rate-limited source calls. Unauthenticated access is a denial-of-wallet / availability risk against the per-source budget (A-001, SC-002), so auth must gate all business logic and fail closed.

### Session 2026-06-20 (Rate-limiting / fairness model + data lifecycle)

- Q: Should fairness be enforced by a per-user enqueue quota with `429` rejection (the original FR-043)? → A: **No.** Drop the per-`sub` quota and the `429`. The food service only calls an external source on a cache miss, so fairness/abuse is handled two ways instead: (1) the consumer worker **never exceeds the source's hourly budget** (USDA: 1,000 req/hr) — it pauses draining the `fetch_queue` when usage reaches ~**90%** of the hourly budget until the window resets; (2) **fairness by demotion, not rejection** — when a single `sub` has **more than 50 items currently pending in the queue**, that requester's queued items are ranked to the **back** of the priority order so they cannot starve other users. No authenticated request is rejected for a personal quota (work-conserving: a heavy user only consumes spare capacity).
- Q: When `GET /v1/foods/{id}` finds a record that needs revalidation, does the read block? → A: **No — the read never blocks.** A populated food serves its stored values immediately. _(Re-baseline 2026-06-21: the old "serve stale by age" rule is replaced by change-driven refresh; see Session 2026-06-21. Our store is the source of truth once populated; a background refresh updates a field only when its originating external item changed upstream.)_
- Q: Can a `NOT_FOUND` tombstone ever be re-fetched? → A: **Yes, on TTL expiry** (default 30 days). After the tombstone TTL lapses a later add may re-attempt (a source may have since added the food); the re-attempt counts against the normal budget so it cannot be used to bypass the rate limit.
- Q: Is the source rate limiter a continuous token bucket, a fixed clock-hour window, or a rolling window? → A: A **rolling 60-minute window** — at most **1,000 USDA calls in any trailing 60 minutes**, with the worker pausing at **90% (900)**. This **replaces the token-bucket model** (a 1,000-capacity bucket refilling at 1,000/hr can emit up to ~2,000 calls across a rolling hour, breaching the hard cap; a rolling window enforces ≤1,000 strictly). The window is tracked by recent source-call timestamps (lean: a Postgres call log pruned to 60 min, **per source**; deferred Redis variant: a sorted set).
- Q: When a demoted requester's pending count drops below 50, are their queued items re-promoted? → A: **Yes, dynamically.** Queue priority is computed **at drain time** from the requester's current pending count, so items auto-return to normal priority once the `sub` falls below 50 (the scorer reads live state, not a frozen flag).

### Session 2026-06-21 (Source-agnostic re-baseline)

This session records why the spec changed shape. The reviewed requirements doc is `docs/brainstorms/2026-06-21-source-agnostic-food-data-model-requirements.md` (Key Decisions, R1–R25, lifecycle, data model, Acceptance Examples are the source of truth for the new shape). The Phase 1–2 USDA-coupled design is superseded; this is a clean replacement, not an additive migration (no data to migrate).

- Q: What is a food's identity? → A: An internal surrogate `id` (ULID-valued, named `id`, never `ulid` and never a source id). A source's native key (USDA `fdcId`, a barcode/GTIN) is an **attribute** held in a crosswalk, never a primary or foreign key. This is the one expensive-to-undo decision, so it is made now. (R1)
- Q: Where may USDA-specific terms appear? → A: **Only** inside the USDA adapter/client that handles raw USDA responses; the adapter maps `fdcId → external_key` inbound. The canonical schema, DAOs, public API, DTOs, types, and env vars use source-agnostic names. The most common failure mode — letting the first source define the schema — is explicitly rejected. (R2)
- Q: How is provenance stored? → A: At the **value's grain**, not as a payload and not as EAV. Multi-valued tables (`food_nutrients`, `food_portions`) carry a `source_id` reference **column**; scalar `food.*` fields get a thin `food_field_provenance(food_id, field, source_id)` side-table keyed by a controlled `field` enum. **No verbatim source payloads are retained**, and there is no golden-record recompute pipeline. (R5, R6)
- Q: How are foods assembled across sources? → A: A worker fans out by name across all pluggable source adapters, fetches from each that has the item, normalizes, then **merges into one golden record**. Merge rules: presence beats absence; identity/short fields (`name`, `brand`) take the **higher-priority source** (NOT longest — USDA is default highest priority until an explicit ranking is configured); free-text (`description`, `ingredients`) longer-wins; nutrients are normalized to a common basis (per-100g) before blending, and conflicting nutrient values take the higher-priority source. (R8, R14)
- Q: How do users add a food they don't have? → A: **By name** (the primary path into external sources), not by a source id. `POST /v1/foods` creates the canonical row + `id` up front (deduped on a normalized-name key guarded by a short lock so concurrent adds collapse to one row) and returns `202` + `id`. The `id` is the queue key, the poll handle, and the eventual canonical identity. (R10)
- Q: What is the lifecycle status enum? → A: `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`. `UNRESOLVED` = multiple candidates need the user to pick. `FAILED` = a source fetch errored (timeout / 5xx / rate-limit) after bounded retries with backoff. `NOT_FOUND` = no source has it (terminal tombstone with TTL). This replaces the old `fetch_status` enum (`pending`/`fetched`/`not_found`/`stale`). (R11, R13)
- Q: How is refresh triggered? → A: **Change-driven**, not by age. Once a food is populated, our stored values stand. A background refresh updates a field only when the external source item it was pulled from has changed upstream — it does not blindly re-blend. A user's manual resolution is therefore protected automatically (it is just a stored value; only its originating external item changing can move it). This replaces stale-while-revalidate-by-age. (R23)
- Q: What input-safety guarantees apply at the source boundary? → A: Each source adapter validates and sanitizes the values it maps (type/range checks, length caps, text sanitization) before they enter the canonical store; outbound source fetches use HTTPS with certificate validation, and a response that fails validation is rejected, not stored. (R24, R25)
- Q: How is persistence and source-pluggability structured? → A: All persistence goes through a DAO/repository layer; each source is an adapter implementing a common interface (search-by-name, fetch-by-key, map-to-canonical). No source-specific structure leaks past the adapter boundary into services, DAOs, or the API; adding a source is additive and never touches the canonical schema. USDA is the only wired adapter today, but the multi-source machinery is built now. (R21, R22)

## User Scenarios & Testing _(mandatory)_

<!--
  Architecture reference: docs/architecture/usda/05-event-driven-queue-based.md
  Re-baseline reference: docs/brainstorms/2026-06-21-source-agnostic-food-data-model-requirements.md
  Integration reference: specs/001-commise-recipe-app/spec.md (FR-007, ingredients, meal plans, grocery lists)

  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
-->

### User Story 0 - Authenticated & Authorized Access to the Food Data API (Priority: P1)

Every request to the food data service — create-by-name, single read, search, candidates, resolve, status polling, and WebSocket connection — must come from an authenticated Commise user. The service verifies the caller's **Clerk session token** itself, networklessly, against the same Clerk instance the rest of Commise uses. Unauthenticated, expired, malformed, or wrong-instance/wrong-party tokens are rejected with `401` **before** any business logic runs or any fetch is queued. There is no anonymous or public access to food data, and no unauthenticated path can drive external source consumption.

**Why this priority**: The food data API is internet-facing (a NestJS service on ECS/Fargate behind a public ALB) and every endpoint can trigger work — DB reads, queue enqueues, and ultimately rate-limited external source calls. Without auth, anonymous callers could exhaust the per-source budget (USDA: 1,000 req/hr — a denial-of-wallet / availability attack against A-001 and SC-002) and read the service freely. Auth protection is therefore a launch-blocking, cross-cutting requirement that gates User Stories 1 through 10.

**Independent Test**: Can be fully tested by calling each endpoint (and the WebSocket `$connect`) with: (a) no token → `401`; (b) a valid Clerk session token → `200`/`202` as appropriate; (c) an expired token → `401`; (d) a token whose `azp` is not in the authorized list, or signed for a different Clerk instance → `401`. Verify that no fetch is queued and no source call is made for any rejected request.

**Acceptance Scenarios**:

1. **Given** no `Authorization` header, **When** any `/v1/foods/*` endpoint is called, **Then** the service returns `401 Unauthorized`, enqueues no fetch, and makes no source call.
2. **Given** a valid Clerk session token presented as a Bearer token, **When** `GET /v1/foods/{id}` is called, **Then** the request is authenticated, the caller identity is the verified Clerk `sub`, and normal `200`/`202`/`404` handling applies.
3. **Given** an expired or malformed token, **When** any endpoint is called, **Then** the service returns `401`.
4. **Given** a well-formed Clerk token issued for a different Clerk instance, or whose `azp` is not in `CLERK_AUTHORIZED_PARTIES`, **When** any endpoint is called, **Then** the service returns `401` (verification fails on the key or `azp` check).
5. **Given** the service verifies tokens networklessly via the public `CLERK_JWT_KEY`, **When** a request is authenticated, **Then** no outbound call to Clerk (or any IdP) is made on the request path.
6. **Given** a client supplies a forged identity header (e.g., `x-authorizer-context` or `x-user-id`) with no/invalid token, **When** any endpoint is called, **Then** the service returns `401` — identity is taken only from the verified token, never from a client-supplied header.
7. **Given** a WebSocket `$connect` without a valid Clerk token, **When** the connection is attempted, **Then** it is rejected (`401`/`403`) before the connection is established.
8. **Given** an authenticated WebSocket connection, **When** a `FoodDataReceived` notification is pushed, **Then** it is delivered only to connections whose authenticated `sub` requested that food `id` (resolved via the requester subscription set, FR-041).
9. **Given** an authenticated user with more than 50 items already pending in the `fetch_queue`, **When** they trigger another cache-miss add, **Then** the request is still **accepted** (`202`, no `429`) but the requester's queued items are ranked to the **back** of the priority order, so they cannot starve other users while still draining on spare capacity (FR-043).
10. **Given** an authenticated user whose token lacks the required operational scope, **When** they call an admin/operational endpoint (e.g. manual re-fetch), **Then** the service returns `403 Forbidden` (authenticated but unauthorized), distinct from the `401` unauthenticated case (FR-039, FR-051).
11. **Given** a backend consumer service (e.g. 006 meal-planning) with no end-user session token, **When** it calls `/v1/foods/*`, **Then** it authenticates with a Clerk machine (M2M) token in the authorized-parties allowlist and is accepted — server-to-server calls are not forced to `401` (FR-047).
12. **Given** a batch resolve/lookup request exceeding the maximum allowed `id` count, **When** it is submitted, **Then** the service returns `400 Bad Request` and enqueues nothing (FR-045).

---

### User Story 1 - Single Food Read (Resolved Hit) (Priority: P1)

A user is creating or viewing a recipe in Commise and the system needs nutritional data for an ingredient. The ingredient's food already exists in the local data store (PostgreSQL) in the `RESOLVED` state because it was previously assembled from one or more sources. The system returns the food's golden-record caloric and macronutrient information instantly, by `id`, without any external source call.

**Why this priority**: This is the happy path that covers the majority of requests once the local store has warmed up. It fulfills FR-007 from the Commise spec ("System MUST back ingredient data with a real food/nutrition database"). Without this, no recipe can display nutritional information.

**Independent Test**: Can be fully tested by seeding the local database with 5 known `RESOLVED` foods, requesting each by `id`, and verifying the system returns complete golden-record nutritional data (calories, protein, carbs, fat) with sub-50ms latency. No external source call should be made.

**Acceptance Scenarios**:

1. **Given** a food with a known `id` exists in PostgreSQL with `status = 'RESOLVED'`, **When** the API receives `GET /v1/foods/{id}`, **Then** it returns `200 OK` with complete golden-record food data including `id`, `name`/`description`, calories, protein, carbs, and fat, within 50ms.
2. **Given** a food exists locally (PostgreSQL), **When** the API receives a read request, **Then** the system never calls any external source.
3. **Given** a food exists in PostgreSQL, **When** the API receives a read request, **Then** the system reads from PostgreSQL (optionally an in-process LRU) and returns the data within 50ms. _(A Redis read-through cache is a **deferred post-launch variant**, not part of the lean-launch build.)_
4. **Given** a food is a `NOT_FOUND` tombstone (no source has it) or `FAILED`, **When** the API receives a read request, **Then** it returns `404 Not Found` with the lifecycle `status` still retrievable (so a client holding the `id` can see _why_ it is not `200`), without queuing any fetch.

---

### User Story 2 - Add Food By Name (Cache Miss / Async Resolution) (Priority: P1)

A user wants nutritional data for a food we don't have yet. They add it **by name**. The system immediately creates the canonical row and its `id` (empty), returns `202 Accepted` with that `id`, and enqueues a sync. In the background, the worker fans out across all source adapters by name, fetches from each source that has the item, and assembles a golden record — moving the food to `RESOLVED` (confident single merge) or `UNRESOLVED` (multiple candidates need the user to pick).

**Why this priority**: This is the core async pattern that distinguishes the event-driven architecture, and add-by-name is the primary path into external sources. Without it, any food not already in the local store would be a dead end. It enables the system to grow its data organically from user demand.

**Independent Test**: Can be fully tested by `POST /v1/foods` with a name we don't have, verifying a `202 Accepted` + `id` is returned immediately, waiting for background processing, then `GET /v1/foods/{id}` returning `200 OK` (when the merge is confident) with full golden-record data.

**Acceptance Scenarios**:

1. **Given** no food exists for the name "broccoli", **When** the API receives `POST /v1/foods` with `{"name": "broccoli"}`, **Then** it creates the canonical row + `id`, enqueues a sync, and returns `202 Accepted` with `{"status": "PENDING", "id": "<ulid>", "estimatedWaitSeconds": 30}` within 100ms.
2. **Given** a `202 Accepted` + `id` was returned, **When** the Fargate consumer worker drains the `fetch_queue` row keyed on that `id`, **Then** it fans out across all source adapters by name, fetches from each source that has the item, assembles the golden record, stores it in PostgreSQL, sets `status = 'RESOLVED'` (confident single merge), and marks the `fetch_queue` row fetched (removing it from the pending set).
3. **Given** the worker assembled a confident golden record for the `id`, **When** the API subsequently receives `GET /v1/foods/{id}`, **Then** it returns `200 OK` with complete golden-record food data.
4. **Given** an add for a name that is already in flight (row created and queued but not yet resolved), **When** a second concurrent add arrives for the same normalized name, **Then** the system collapses it to the same `id` and returns `202 Accepted` without creating a duplicate canonical row or a duplicate `fetch_queue` row (normalized-name dedup key + short lock, plus `ON CONFLICT` on the queue).
5. **Given** the fan-out finds the item in no source, **When** the worker finishes, **Then** it sets `status = 'NOT_FOUND'` (terminal tombstone with TTL) and sets the `fetch_queue` row `status='tombstone'` (no further retries within the TTL).
6. **Given** the fan-out returns multiple candidates that cannot be confidently collapsed, **When** the worker finishes, **Then** it sets `status = 'UNRESOLVED'` and surfaces the candidate list for the user to pick (US-2a / FR-018).

---

### User Story 2a - Disambiguate Candidates and Resolve (Priority: P1)

When add-by-name yields multiple candidates across sources that the system cannot confidently collapse, the food becomes `UNRESOLVED`. The user fetches the candidate list, picks the candidate(s) that match what they meant, and submits the pick. The system validates each chosen candidate belongs to that food's own candidate set, drives the merge into the golden record, and moves the food to `RESOLVED`.

**Why this priority**: Cross-source matching never has to be perfect because a human is the final arbiter; this human-in-the-loop step is what makes the pre-merge dedup safe. Without it, ambiguous adds would dead-end and no merged record could form.

**Independent Test**: Can be fully tested by forcing an add into `UNRESOLVED` (multiple candidates), calling `GET /v1/foods/{id}/candidates` and verifying the list, then `PATCH /v1/foods/{id}` with a valid candidate selection and verifying the food transitions to `RESOLVED` with a golden record assembled from the pick. Verify a `PATCH` referencing a candidate that does NOT belong to that food is rejected.

**Acceptance Scenarios**:

1. **Given** a food with `status = 'UNRESOLVED'`, **When** the client calls `GET /v1/foods/{id}/candidates`, **Then** it returns the candidate list (each candidate carries its source and that source's item key) for the user to choose from.
2. **Given** an `UNRESOLVED` food and a candidate from its own candidate set, **When** the client calls `PATCH /v1/foods/{id}` with that selection, **Then** the system validates the candidate belongs to this food, merges it into the golden record, and moves the food to `RESOLVED`.
3. **Given** an `UNRESOLVED` food, **When** the client `PATCH`es with a candidate that does NOT belong to this food's candidate set, **Then** the request is rejected (`400`/`409`) and the food's `status` is unchanged.
4. **Given** a `RESOLVED` food whose `name` came from USDA by source priority and whose `fat` came from another source, **When** the merge completes, **Then** each value records its originating source (via `food_field_provenance` for scalar fields and `source_id` on `food_nutrients`), and the user's manual pick is stored as ordinary provenance.

---

### User Story 3 - Rate-Limited Source API Consumption (Priority: P1)

The system enforces each external source's rate limit using a per-source rolling 60-minute window. For USDA that is 1,000 requests per hour — at most 1,000 USDA calls in any trailing 60 minutes (a hard guarantee). The Fargate consumer worker counts the source's calls in the trailing 60 minutes before every source API call and pauses processing for that source when the count reaches 90% of its budget (USDA: 900), resuming as older calls age out of the window. If a source returns a `429 Too Many Requests` despite the limiter, the consumer treats that source's window as full and backs off (pauses draining) as a failsafe.

**Why this priority**: Rate limit compliance is a hard operational constraint. Violating USDA's limit risks having the API key banned, which would break that source. The per-source rolling-window limiter is the mechanism that makes the architecture viable as more sources are added.

**Independent Test**: Can be fully tested by configuring the USDA rolling-window limiter to a low cap (e.g., 5 calls per trailing window), submitting 10 adds that resolve via USDA, and verifying that exactly 5 USDA API calls are made before processing pauses, with the remaining 5 processed after earlier calls age out of the window.

**Acceptance Scenarios**:

1. **Given** the trailing-60-min USDA call count is below 900, **When** the consumer attempts a USDA fetch for a `fetch_queue` row, **Then** the new call is recorded atomically against USDA's rolling window and the USDA API call proceeds.
2. **Given** the trailing-60-min USDA call count has reached 900 (90%), **When** the consumer considers the next row needing a USDA fetch, **Then** it pauses USDA draining (leaving the row eligible per the lease re-eligibility/backoff gate of FR-018) and does not call USDA until earlier calls age out of the window.
3. **Given** a USDA call would be the 1,001st in the trailing 60 minutes, **When** the consumer attempts it, **Then** the call is not made and the `fetch_queue` row stays `pending`, and the consumer resumes once enough earlier calls age out that the count drops back below the threshold.
4. **Given** a source returns `429 Too Many Requests`, **When** the consumer receives this response, **Then** it treats that source's rolling window as full and backs off, leaves the `fetch_queue` row `pending` (it will retry after the backoff gate), and stops draining further rows needing that source for now.
5. **Given** the per-source rolling-window limiter state (recent source-call timestamps) is stored as a Postgres call log (lean launch) or a Redis sorted set (deferred variant), **When** the consumer performs a check-and-record operation — counting that source's calls in the trailing 60 minutes and recording the new call in one atomic operation — **Then** the operation is atomic (no race conditions even under concurrent access).

---

### User Story 4 - Bulk Ingredient Resolution for Recipe Import (Priority: P1)

A user imports or creates a recipe with multiple ingredients. The system resolves as many ingredients as possible from the local store immediately (by `id` or by name match), and enqueues the remaining unknown ingredient names for background add-by-name resolution. Each unknown name creates one canonical row + `id` and one `fetch_queue` row; the worker fans out and merges per food. The USDA adapter may internally batch its own source calls (≤20 source keys per USDA batch call) when it has resolved which source items to fetch — counting as 1 call against USDA's rolling window — but batching is an adapter-internal detail, not part of the canonical API.

**Why this priority**: Recipe creation and import are core Commise workflows (FR-001, FR-008). Recipes typically contain 5-20 ingredients, making batch resolution essential for acceptable UX. Without batch support, a 20-ingredient recipe would generate excessive per-source calls and slow the import.

**Independent Test**: Can be fully tested by creating a recipe with 15 ingredients where 10 resolve locally and 5 are unknown. Verify the response includes full golden-record data (with `id`s) for the 10 known ingredients and a `pending` entry (with an `id`) for each of the 5 unknown ones. Verify the USDA adapter coalesces its own source fetches where possible rather than issuing one ungrouped USDA call per item.

**Acceptance Scenarios**:

1. **Given** a recipe submission with 15 ingredients where 10 resolve locally and 5 do not, **When** the API processes the request, **Then** it returns the 10 resolved foods (with `id`s and full golden-record data) and 5 entries with `{"status": "PENDING", "id": "<ulid>"}`.
2. **Given** 5 unknown ingredient names are identified during recipe processing, **When** the system enqueues, **Then** it creates 5 canonical rows + `id`s and enqueues 5 `fetch_queue` rows keyed on those `id`s (deduped via `ON CONFLICT`), not one undifferentiated blob.
3. **Given** the USDA adapter has resolved which USDA source items back several queued foods, **When** it fetches from USDA, **Then** it MAY use the USDA batch endpoint (≤20 source keys/call), counting as exactly 1 call against USDA's rolling window — an adapter-internal optimization invisible to the canonical API.
4. **Given** 3 of 5 unknown names are already in flight (rows created and queued), **When** the API processes the recipe, **Then** it collapses them to their existing `id`s and only the 2 truly new names create new rows (normalized-name dedup applied).
5. **Given** a fan-out where some foods resolve and one finds no source, **When** the worker processes the batch, **Then** it sets the resolvable foods to `RESOLVED` (or `UNRESOLVED` if ambiguous) and the no-source food to `NOT_FOUND` (tombstone).

---

### User Story 5 - Demand-Weighted Queue Priority and Failure Recovery (Priority: P1)

The system enqueues add-by-name resolutions into a durable Postgres-backed `fetch_queue` table, keyed on the food `id` (created up front). The consumer drains items ordered by `request_count DESC, first_requested ASC` — items requested more times jump ahead of single-request items, with FIFO as the tie-breaker. Duplicate enqueues for the same `id` increment a counter rather than creating new rows (single-statement dedup via `ON CONFLICT DO UPDATE`). The consumer is event-driven via Postgres `LISTEN/NOTIFY` and rate-limited per source by a rolling-window limiter (USDA: 1000 req/hr). Source `5xx` / timeout / rate-limit errors → pending row with exponential backoff and attempt counter; after bounded retries the food lands in `FAILED` (`status='tombstone'` on the queue row, operational DLQ-equivalent, fully auditable via SQL). A fan-out where no source has the item → `NOT_FOUND` tombstone (no retry).

**Why this priority**: A viral recipe driving 50 users to add the same missing food must naturally rise above a one-off single add; conversely, no user request should be silently dropped. Demand-weighted ordering achieves both with no manual escalation policy and no cross-system state drift (the queue, the counter, and the status all live in one Postgres row).

**Independent Test**: Can be fully tested by enqueuing 50 duplicate adds resolving to food `id=A` (single row, `request_count=50`) and 5 distinct single adds resolving to `id=B..F` (5 rows, `request_count=1` each). Verify the consumer processes `A` first, then `B..F` in `first_requested` order. Separately, inject an `id` whose source fan-out triggers a source `5xx` and verify it cycles `pending → in_flight → pending` with `attempts++` and backoff gate, landing the food in `FAILED` (`status='tombstone'`) after the retry budget.

**Acceptance Scenarios**:

1. **Given** `id=A` exists in `fetch_queue` with `request_count=50` and `id=B` with `request_count=1`, **When** the consumer selects the next item, **Then** it processes `A` before `B`.
2. **Given** two rows tie at `request_count=1`, **When** the consumer selects, **Then** the row with the earlier `first_requested` timestamp is processed first (FIFO tie-break).
3. **Given** the API handler receives another add resolving to `id=X` already in the queue, **When** it enqueues, **Then** the existing row's `request_count` increments by 1 and no duplicate row is created.
4. **Given** the consumer is idle, **When** a `pg_notify('fetch_queued', ...)` event fires, **Then** the consumer wakes within 100ms and begins draining the queue (subject to the per-source rolling-window limiter).
5. **Given** a source returns `503 Service Unavailable` during fan-out, **When** the consumer processes the row, **Then** it sets `status='pending'`, `attempts=attempts+1`, and `last_requested=now()+backoff(attempts)`. After the retry budget the food is set to `FAILED` and the row sets `status='tombstone'`.
6. **Given** a fan-out finds the item in no source, **When** the consumer processes the result, **Then** it sets the food to `NOT_FOUND` and the row `status='tombstone'` immediately (no retry, no DLQ — the tombstone row IS the audit record).
7. **Given** a tombstoned row, **When** an operator queries `SELECT * FROM fetch_queue WHERE status='tombstone'`, **Then** the row is returned with full `attempts`, `last_error`, and `last_requested` for investigation.

---

### User Story 6 - Food Search by Name (Priority: P2)

A user types an ingredient name (e.g., "chicken breast") while creating a recipe, and the system returns matching foods from the local PostgreSQL store as canonical `id`s. Search supports name / substring / partial match using PostgreSQL's `pg_trgm` extension for fuzzy matching, so typos like "avacado" still match "avocado." Lookup by barcode or a source's `external_key` (via the `food_sources` crosswalk) is also supported. Search operates over the local store only — it does not trigger external source calls.

**Why this priority**: Ingredient search is the primary interface between Commise's recipe creation UI and the food data layer. However, it operates entirely on local data and doesn't involve the queue/async pattern — it's a read-only feature that improves incrementally as the local store grows.

**Independent Test**: Can be fully tested by seeding 100 foods into PostgreSQL, searching for known foods by exact name and by misspelled name, verifying relevant `id`s are returned ranked by relevance within 200ms, and looking up a known food by its barcode / a source's `external_key`.

**Acceptance Scenarios**:

1. **Given** 100 foods exist in PostgreSQL, **When** a user searches for "chicken breast", **Then** foods whose `name`/`description` contains "chicken breast" are returned as `id`s, ranked by relevance.
2. **Given** a food with name "Avocado, raw" exists locally, **When** a user searches for "avacado", **Then** the fuzzy search returns the avocado result's `id`.
3. **Given** no foods matching a query exist locally, **When** the user searches, **Then** the system returns an empty result set (it does NOT query any external source for search; to bring a missing food in, the user adds it by name via `POST /v1/foods`).
4. **Given** 10,000 foods in the local store, **When** a search query is executed, **Then** results are returned within 200ms.
5. **Given** a food backed by a known barcode / a source's `external_key`, **When** the user looks it up by that key, **Then** the system resolves it to the food's canonical `id` via the `food_sources` crosswalk.

---

### User Story 7 - Change-Driven Data Refresh (Priority: P2)

A scheduled trigger periodically re-checks `RESOLVED` foods against their backing sources. Our stored record is the source of truth once populated: the refresh updates a field **only** when the external source item it was pulled from has changed upstream — it does not blindly re-blend. Unchanged fields, including any the user manually resolved, are left intact. This keeps data reasonably current without overwriting human decisions or churning unchanged values.

**Why this priority**: Data freshness is important for accuracy (SC-010 in Commise spec: "Nutritional calculations accurate to within 5% of source database values") but is not blocking for launch. The system works with the stored golden record; refresh is an optimization.

**Independent Test**: Can be fully tested by seeding a `RESOLVED` food whose `protein` came from source item X and `fat` from source item Y, triggering the scheduled refresh where X is unchanged upstream but Y changed, and verifying `protein` is left intact while `fat` is re-pulled and updated with new provenance.

**Acceptance Scenarios**:

1. **Given** a `RESOLVED` food backed by source items, **When** the scheduled refresh runs and one backing source item changed upstream, **Then** only the fields pulled from that changed item are re-pulled and updated; all other fields (and the food's golden record otherwise) are left intact.
2. **Given** a `RESOLVED` food whose backing source items are all unchanged upstream, **When** the scheduled refresh runs, **Then** no field is updated and no value is overwritten.
3. **Given** a field the user manually resolved (US-2a), **When** the refresh runs and that field's originating external item is unchanged, **Then** the user's value is preserved (it is just a stored value; only its originating external item changing can move it).
4. **Given** a backing source item changed upstream, **When** the refresh re-pulls the affected field, **Then** the new value passes the adapter's input validation (FR-024) before it is stored, and its `source_id` provenance is updated to the re-fetched item.

---

### User Story 8 - Resolution Status Polling (Priority: P2)

A client that received a `202 Accepted` + `id` from add-by-name can poll the read endpoint (or a dedicated status endpoint) to check progress. `GET /v1/foods/{id}` returns `202` while `PENDING` or `UNRESOLVED`, `200` once `RESOLVED` (with the full golden record), and `404` when `NOT_FOUND` or `FAILED` — with the lifecycle `status` always retrievable so a client holding an `id` can see _why_ it is not `200`.

**Why this priority**: Polling is the simplest client notification mechanism and is the recommended launch approach (Option A from the architecture doc). WebSocket notifications are optional and deferred to P3.

**Independent Test**: Can be fully tested by adding a food that returns `202` + `id`, polling `GET /v1/foods/{id}` at intervals, and verifying the status transitions from `PENDING` to `RESOLVED` (or `UNRESOLVED`) within 60 seconds.

**Acceptance Scenarios**:

1. **Given** a food with `status = 'PENDING'`, **When** the client calls `GET /v1/foods/{id}` (or `GET /v1/foods/{id}/status`), **Then** it returns `202` with `{"id": "<ulid>", "status": "PENDING", "estimatedWaitSeconds": 20}`.
2. **Given** a food with `status = 'UNRESOLVED'`, **When** the client polls, **Then** it returns `202` with `{"id": "<ulid>", "status": "UNRESOLVED"}` and the client follows up via `GET /v1/foods/{id}/candidates` (US-2a).
3. **Given** a food with `status = 'RESOLVED'`, **When** the client polls `GET /v1/foods/{id}`, **Then** it returns `200` with the full golden-record food data.
4. **Given** a food with `status = 'NOT_FOUND'` or `status = 'FAILED'`, **When** the client polls, **Then** `GET /v1/foods/{id}` returns `404`, while the `status` remains retrievable (so the held `id` is recognized, not treated as bogus); a `FAILED` status message suggests trying again later.

---

### User Story 9 - WebSocket Real-Time Notifications (Priority: P3)

When a food resolution completes asynchronously, the system pushes a real-time notification to connected clients via API Gateway WebSocket API. This eliminates the need for client polling and provides instant UI updates when food data becomes available.

**Why this priority**: WebSocket is an optional UX enhancement. The system is fully functional with polling (US-8). WebSocket should only be added if UX testing shows the polling experience is unacceptable.

**Independent Test**: Can be fully tested by establishing a WebSocket connection, adding a food that returns `202` + `id`, and verifying that a `{"type": "food_ready", "id": "<ulid>"}` message is pushed to the WebSocket within 60 seconds of the food being resolved.

**Acceptance Scenarios**:

1. **Given** a client has an active WebSocket connection, **When** the consumer resolves a food the client requested, **Then** a `FoodDataReceived` event triggers a push notification to the client's connection: `{"type": "food_ready", "id": "<ulid>"}`.
2. **Given** a client has no active WebSocket connection, **When** a food resolution completes, **Then** no notification is sent (client must use polling as fallback).
3. **Given** a WebSocket connection is established, **When** the connection is idle for more than 10 minutes, **Then** the server closes the connection gracefully and the client can reconnect.

---

### User Story 10 - Monitoring and Observability Dashboard (Priority: P3)

Operations teams can monitor the health of the food data pipeline via CloudWatch dashboards and alarms. Key metrics include `fetch_queue` pending-row depth, per-source trailing-60-min call counts, resolution latency (p50/p95/p99), cache hit rate, tombstone-row accumulation, `UNRESOLVED` backlog, and per-source success rate.

**Why this priority**: Observability is critical for production operations but is not required for the data pipeline to function. It can be layered on after the core system is working.

**Independent Test**: Can be fully tested by generating 100 add-by-name requests, then verifying CloudWatch metrics are populated: queue depth, per-source trailing-60-min call counts, resolution latency, and cache hit rate are all visible on the dashboard.

**Acceptance Scenarios**:

1. **Given** the system is processing food adds, **When** an operator views the CloudWatch dashboard, **Then** they see real-time metrics for `fetch_queue` pending-row depth, tombstone-row count, `UNRESOLVED` backlog, per-source trailing-60-min call counts, and Fargate consumer worker error rate.
2. **Given** a `fetch_queue` row transitions to `status='tombstone'` (food `FAILED` or `NOT_FOUND`), **When** CloudWatch evaluates the alarm, **Then** the tombstone-row alarm fires immediately.
3. **Given** pending `fetch_queue` rows have a `first_requested` older than 5 minutes, **When** CloudWatch evaluates the alarm, **Then** a queue-age alarm fires.
4. **Given** the consumer resolves a food, **When** the custom metric is emitted, **Then** `food_resolution_latency_seconds` is recorded and visible in the latency distribution dashboard.

---

### Edge Cases

- What happens when a user calls `GET /v1/foods/{id}` with an `id` that is not a valid ULID? (System returns `400 Bad Request` immediately, no queuing.)
- What happens when a user calls `POST /v1/foods` with an empty or whitespace-only name? (System returns `400 Bad Request`; no row is created and nothing is enqueued.)
- What happens when an external source is down for an extended period (hours/days)? (Pending rows accumulate durably in the `fetch_queue` table — subject to the FR-016 retry/backoff budget and FR-046 depth ceiling — and resolution resumes automatically when the source recovers. A food whose every source errored after the retry budget lands in `FAILED` and is re-fetchable.)
- What happens when Redis is unavailable? (Full architecture: consumer pauses processing (fail-closed) to avoid uncontrolled source API usage; the NestJS read API falls back to PostgreSQL for reads. Lean launch: not applicable — no Redis dependency.)
- What happens when a per-source rolling-window limiter's state is lost (Redis restart or PostgreSQL call-log truncation)? (That source's call log is empty, so its trailing-60-min count starts at 0 and up to its hourly cap of calls could fire before the window refills with fresh timestamps. This is bounded and safe-ish, but can briefly exceed the true rolling-hour count right after the loss before converging to steady-state.)
- What happens when hundreds of users add the same new food name simultaneously (thundering herd)? (The normalized-name dedup key + short lock collapses concurrent adds to one canonical row + `id`; `ON CONFLICT` ensures only 1 `fetch_queue` row exists per `id`; only one fan-out is performed regardless of demand.)
- What happens when the Fargate consumer worker crashes mid-processing? (The `in_flight` lease expires after 30s and the row reverts to `pending` (FR-018); the food will be re-resolved on the next drain. No data loss.)
- What happens when a source returns a food but omits certain nutrient fields? (The adapter maps only the fields present; absence is represented by missing `food_nutrients` rows. The merge applies "presence beats absence," so another source can supply a missing nutrient. The API response indicates which fields are available and from which source.)
- What happens when two sources supply conflicting values for the same nutrient? (Both are normalized to per-100g; the higher-priority source's value wins — USDA is the default highest priority until an explicit ranking is configured — and `food_nutrients.source_id` records which source won, FR-014.)
- What happens when an adapter receives a value that fails validation (wrong type, out of range, over length)? (The adapter rejects that value before it enters the canonical store, FR-024; a response that fails validation is not stored, FR-025. The food can still resolve from the remaining valid values or other sources.)
- What happens when PostgreSQL is unavailable? (The Fargate consumer worker cannot drain — the `fetch_queue` rows are durable Postgres rows, so they are unaffected once the DB recovers. The NestJS read API cannot serve any food data. This is a full outage of the food data layer.)
- How does the system handle a food that was previously tombstoned (`NOT_FOUND`) but later becomes available in a source? (The `NOT_FOUND` tombstone carries a TTL (default 30 days); after the TTL a fresh add re-enqueues the food and re-runs the fan-out.)
- How does the system handle an `UNRESOLVED` food that nobody ever picks? (Deferred to planning — either a TTL/expiry or it stays until a human acts; see Outstanding Questions in the requirements doc.)
- How does the system handle recipe ingredients that have no source match (e.g., certain spices, oils, or proprietary blends)? (The food `id` link on the Commise Ingredient is optional. Ingredients without a linked Food simply have no nutritional data from this system; nutritional summaries for recipes exclude unlinked ingredients or display them as "nutrition unavailable.")
- What happens when a Clerk session token expires mid-session, or there is clock skew between client and service? (The request is rejected with `401`; the client refreshes the session via Clerk and retries. Small skew is tolerated by the verifier's standard leeway.)
- What happens when a token is valid but signed for a different Clerk instance, or its `azp` is not in the allowlist? (Verification fails on the key or `azp` check → `401`. This prevents tokens from another Commise environment/instance from being accepted.)
- What happens under an anonymous request flood (denial-of-wallet attempt)? (Because authentication precedes any enqueue or source call, unauthenticated traffic is rejected at the edge and cannot consume a source's rate-limit budget — protecting A-001 and SC-002.)
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

**Identity & Source-Agnostic Naming**

- **FR-IDN-1**: A food's primary key MUST be an internal `id` (ULID-valued, named `id`, reusing the platform's ULID convention as in the identity service). No source-native identifier MUST EVER be a primary or foreign key in the canonical schema. (R1)
- **FR-IDN-2**: `fdcId` and all USDA-specific terms MUST appear only inside the USDA adapter/client that handles raw USDA responses; the adapter MUST map `fdcId → external_key` inbound. The canonical schema, DAOs, public API, DTOs, types, and env vars MUST use source-agnostic names. (R2)
- **FR-IDN-3**: Source-neutral replacements MUST be used for the prior USDA-named artifacts: source-neutral sync metadata and per-source call logging, a `source` enum, and a simplified food `kind` (`generic | branded`) instead of a USDA data-type enum. (R3)

**Food Read (Read Path)**

- **FR-001**: System MUST serve food data from the local store (PostgreSQL; a Redis cache is a deferred post-launch variant) without calling any external source. The NestJS read API (on ECS/Fargate behind the ALB) MUST NOT call any external source in the request path.
- **FR-002**: `GET /v1/foods/{id}` MUST return `200 OK` with the complete golden-record food data (`id`, `name`/`description`, normalized nutrients including calories, protein, carbs, fat, available micronutrients, and per-field provenance) **only** when the food's `status = 'RESOLVED'`. (R17)
- **FR-003**: `GET /v1/foods/{id}` MUST return `202 Accepted` with `{"status": <PENDING|UNRESOLVED>, "id": <id>, "estimatedWaitSeconds": <seconds>}` when the food is `PENDING` or `UNRESOLVED`. (R17)
- **FR-004**: `GET /v1/foods/{id}` MUST return `404 Not Found` when the food is `NOT_FOUND`, `FAILED`, or no such row exists; for an existing row the lifecycle `status` MUST remain retrievable so a client holding the `id` can see _why_ it is not `200`. (R17)
- **FR-005**: `POST /v1/foods` (create by name) MUST create the canonical row + `id` if no entry exists for that food, enqueue a sync if not already queued, and return `202 Accepted` with `{"status": "PENDING", "id": <ulid>}`. "The same food" MUST be keyed on a normalized name (lowercased, trimmed) guarded by a short lock, so concurrent adds of the same name collapse to one row (making the idempotency guarantee real). (R10)
- **FR-006**: System MUST validate the `id` path param is a well-formed ULID and return `400 Bad Request` for malformed inputs; `POST /v1/foods` MUST reject empty/whitespace-only names with `400`. No invalid input MUST reach the `fetch_queue`.
- **FR-007**: System MUST provide a `GET /v1/foods/{id}/status` endpoint returning the current lifecycle `status` and, when `RESOLVED`, the full golden-record food data. (Equivalent status is also exposed by `GET /v1/foods/{id}` per FR-002–FR-004.)

**Candidates & Resolution (Disambiguation)**

- **FR-RES-1**: `GET /v1/foods/{id}/candidates` MUST return the candidate list for an `UNRESOLVED` food; each candidate MUST carry its source and that source's item key. (R18)
- **FR-RES-2**: `PATCH /v1/foods/{id}` MUST resolve an `UNRESOLVED` food from the user's candidate selection — each chosen candidate validated to belong to that food's own candidate set — driving the merge into the golden record and moving the food to `RESOLVED`. A selection referencing a candidate not in the food's candidate set MUST be rejected (`400`/`409`) with the food's `status` unchanged. (R16, R19)
- **FR-RES-3**: Before surfacing candidates the worker MUST dedupe/merge across sources as far as is confident; residual ambiguity MUST be left for the user (`UNRESOLVED`). The matching algorithm need not be perfect because the user is the final arbiter. (R15)

**Food Search**

- **FR-008**: System MUST provide a `GET /v1/foods/search?query=...` endpoint that searches the local PostgreSQL store using name / substring / partial / full-text or trigram-based fuzzy matching (`pg_trgm`) and returns canonical `id`s. Lookup by barcode or a source's `external_key` (via the `food_sources` crosswalk) MUST also be supported. (R20)
- **FR-009**: System MUST NOT call any external source for search queries. Search operates exclusively on locally-stored food data; bringing in a missing food is done by adding it by name (FR-005).
- **FR-010**: Search results MUST be ranked by relevance and returned within 200ms for a local store of up to 50,000 foods.

**Async Resolution (Write Path)**

- **FR-011**: On `POST /v1/foods` for a name with no existing canonical row (and not already in flight), the system MUST create the row + `id` and enqueue the fetch into the durable Postgres `fetch_queue` via the idempotent `INSERT … ON CONFLICT` statement (FR-014) paired with `pg_notify('fetch_queued', id)` to wake the consumer (FR-017). **EventBridge is reserved for scheduled producers** (change-driven refresh, FR-032) and the `FoodDataReceived` completion event (FR-034) — it is not on the demand-path enqueue.
- **FR-012**: On a multi-food add (a recipe submission/import identifying multiple unknown ingredient names), the system MUST create one canonical row + `id` per unknown name and enqueue each `id` into `fetch_queue` (deduped via `ON CONFLICT`, FR-014) so the consumer drains and fans out per food. The request is bounded by FR-045 (≤100 names/request).
- **FR-013**: System MUST deduplicate adds at two grains: (a) concurrent adds for the same normalized name collapse to one canonical row + `id` via a normalized-name dedup key + short lock (FR-005); (b) duplicate enqueues for the same `id` collapse via PostgreSQL `INSERT ... ON CONFLICT` on `fetch_queue` (lean launch — the default build); a Redis Set is a deferred full-architecture variant.

**Queue Management**

- **FR-014**: On enqueue, the API handler MUST use a single idempotent statement keyed on the food `id`: `INSERT INTO fetch_queue (food_id) VALUES ($1) ON CONFLICT (food_id) DO UPDATE SET request_count = fetch_queue.request_count + 1, last_requested = now() WHERE fetch_queue.status = 'pending'`. This achieves dedup, demand counting, and timestamping in one round-trip.
- **FR-015**: The consumer MUST select the next item via `SELECT food_id FROM fetch_queue WHERE status='pending' AND last_requested <= now() ORDER BY request_count DESC, first_requested ASC FOR UPDATE SKIP LOCKED LIMIT 1`. This produces literal demand-weighted ordering with FIFO tie-break and naturally honors per-row backoff gates.
- **FR-016**: The consumer MUST retry transient source failures (source 5xx, network timeout, 429) up to 5 cumulative attempts. Retries MUST be tracked via the `attempts` column with exponential backoff applied to `last_requested` (e.g., `last_requested = now() + interval '2^attempts seconds'`). After 5 attempts the food MUST be set to `FAILED` and the row to `status='tombstone'` with `last_error` populated for operator review.
- **FR-017**: The consumer MUST be triggered by Postgres `LISTEN/NOTIFY` on the channel `fetch_queued`. The enqueue statement MUST be paired with `pg_notify('fetch_queued', food_id)`. Consumer wake-to-process latency MUST be ≤ 100ms (subject to the per-source rate-limit rolling-window limiter).
- **FR-018**: The consumer MUST enforce each source's rate limit via a per-source rolling-60-min-window limiter (USDA: 1000 req/hr). When a source's trailing-60-min count is at its cap, the consumer MUST sleep on that source until the oldest call ages out of the window rather than dropping work. Stale `in_flight` rows older than 30s MUST be reverted to `pending` (lease timeout) to recover from consumer crashes.

**Multi-Source Fan-Out & Golden-Record Merge**

- **FR-MRG-1**: The worker MUST fan out across all wired source adapters by name, fetch from each source that has the item, normalize the results, and assemble a single golden record. The outcome MUST set the food `status`: `RESOLVED` (confident single merge), `UNRESOLVED` (multiple candidates need a human), `NOT_FOUND` (no source has it), or `FAILED` (a source fetch errored after bounded retries). (R11)
- **FR-MRG-2**: Merge MUST be field-level and applied after candidates are normalized. **Presence beats absence.** For identity/short fields (`name`, `brand`), the **higher-priority source** wins — NOT the longest value (USDA is the default highest priority until an explicit ranking is configured). For free-text fields (`description`, `ingredients`), the **longer** value wins. (R14)
- **FR-MRG-3**: Nutrient values MUST be normalized to a common basis (per-100g) before any cross-source blend; when two sources supply different values for the same nutrient, the **higher-priority source** wins, and `food_nutrients.source_id` records which source's value was kept. (R8, R14)
- **FR-MRG-4**: USDA MUST be the only wired adapter today, but the fan-out, merge, candidate, and provenance machinery MUST be built now so that adding a source is additive and never touches the canonical schema. (R22; golden-record-now decision)

**Source Adapters & Input Safety**

- **FR-ADP-1**: Each source MUST be implemented as an adapter behind a common interface (search-by-name, fetch-by-key, map-to-canonical). No source-specific structure MUST leak past the adapter boundary into services, DAOs, or the API. (R21, R22)
- **FR-ADP-2**: Each source adapter MUST validate and sanitize the values it maps — type/range checks, length caps, text sanitization — before they enter the canonical store. (R24)
- **FR-ADP-3**: Outbound fetches to external sources MUST use HTTPS with certificate validation; a response that fails validation MUST be rejected, not stored. (R25)

**Rate Limiting (Per-Source Rolling 60-Minute Window)**

- **FR-019**: System MUST enforce a per-source rolling 60-minute window rate limiter. For USDA this caps calls at **≤1,000 in any trailing 60 minutes**; the consumer worker MUST self-throttle so the system **never exceeds USDA's 1,000 req/hr**: when USDA's trailing-60-min count reaches **90% (900)**, the worker MUST **pause draining work that needs USDA** and resume only as older calls age out of the window (the count drops back below the threshold), rather than risk breaching the cap (pending rows simply wait; callers continue to poll). Each additional wired source gets its own window sized to that source's limit.
- **FR-020**: The per-source rolling-window check-and-record operation MUST be atomic: counting that source's calls in the trailing 60 minutes and recording the new call MUST happen in one atomic operation. In the lean launch variant (default), this is a PostgreSQL call-log (keyed by `source`) count+insert in a transaction (e.g. `INSERT ... WHERE (SELECT count(...) WHERE source = $1 ...) < cap RETURNING`). In the deferred Redis variant, this is a per-source sorted-set Lua script (`ZADD` timestamp / `ZCOUNT` last 60 min).
- **FR-021**: When a source's trailing-60-min call count is at that source's cap, the consumer MUST NOT call that source. It MUST leave the `fetch_queue` row eligible (releasing any `in_flight` lease so it reverts to `pending`) and wait for earlier calls to age out of the window rather than advancing.
- **FR-022**: The Fargate consumer worker MUST run as a single instance at any time (exactly one consumer), enforced via a Postgres advisory lock (one Fargate task holds the lock; others stand by).

**USDA Adapter (Source Boundary)**

- **FR-023**: The USDA adapter MUST use `GET /v1/food/{fdcId}` for single-item fetches and `POST /v1/foods` with up to 20 `fdcIds` for batch fetches against USDA's API, counting as 1 call against USDA's rolling window per API call regardless of batch size. `fdcId` exists only at this boundary and is mapped to `external_key` inbound. Batching is an adapter-internal optimization, not part of the canonical API.
- **FR-024**: On USDA `200 OK`, the adapter MUST map the response into the canonical model (`fdcId → external_key`, USDA nutrients → `food_nutrients` with per-100g basis, USDA portions → `food_portions`), validate/sanitize the mapped values (FR-ADP-2), and hand the canonical candidate to the merge. On a confident merge the food is upserted with `status = 'RESOLVED'`, the `food_sources` crosswalk row is recorded (`UNIQUE(source, external_key)`), the row is removed from the pending set, the `fetch_queue` row is resolved, and a `FoodDataReceived` event is emitted.
- **FR-025**: When a source has no matching item, that source contributes nothing to the fan-out. When **no** wired source has the item, the food MUST be set to `NOT_FOUND` and the `fetch_queue` row to `status='tombstone'`. No immediate retry. The `NOT_FOUND` tombstone carries a **configurable TTL (default 30 days)**: an add after the TTL has lapsed MAY re-attempt the fan-out (in case a source has since added the food), and that re-attempt counts against the normal per-source rolling-window budgets (FR-019) so it cannot be used to bypass any rate limit. Within the TTL, a `NOT_FOUND` food returns `404` without re-enqueueing.
- **FR-026**: On a source `429 Too Many Requests`, the consumer MUST back off — treating that source's rolling window as full — leave the `fetch_queue` row `pending` (it will retry after the backoff gate), and stop draining further rows needing that source for now.
- **FR-027**: On a source `5xx` error (or network timeout), the consumer MUST set the `fetch_queue` row `status='pending'`, increment `attempts`, and apply exponential backoff to `last_requested` per FR-016. After 5 cumulative attempts the food MUST be set to `FAILED` and the row to `status='tombstone'` with `last_error` populated (the tombstone row is the operational DLQ-equivalent; there is no SQS DLQ). A `FAILED` food is itself re-fetchable.

**Data Persistence (Normalized, Provenance-Bearing)**

- **FR-028**: The canonical schema MUST be normalized and provenance-bearing:
    - `food` — golden scalar fields (`id` PK, `name`, `description`, `kind` (`generic|branded`), brand attributes, barcode), the normalized-name dedup key, lifecycle `status` (`PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED`), `created_at`, `updated_at`.
    - `food_sources` — the crosswalk, one row per (food, source): `food_id`, `source`, `external_key` (that source's PK for the item), fetch state, with `UNIQUE(source, external_key)`. **No verbatim source payload is retained.** (R4)
    - `nutrient` — the nutrient dictionary: `name`, `unit`, and a stable external code (e.g. an INFOODS tagname) where available. Units live here, never on the value row.
    - `food_nutrients` — `(food_id, nutrient_id, amount, basis, source_id)`; per-value provenance is the `source_id` column. (R8)
    - `food_portions` — household measures / serving sizes with gram weight and `source_id`. (R9)
    - `food_field_provenance` — `(food_id, field, source_id)` for scalar `food.*` fields only; `field` is a controlled enum. (R5)
    - `food_category` — classification, linked to `food` (many-to-many).
      No EAV (no single mega `(food_id, field_name, value, source)` table); values always stay in typed columns.
- **FR-029**: System MUST index the canonical tables for the access paths: `food.id` (B-tree primary), `food.status` (for lifecycle filtering / refresh eligibility), the normalized-name dedup key (unique, for FR-005 idempotency), `food_sources (source, external_key)` (unique, for crosswalk/barcode lookup), `food_nutrients (food_id)`, and full-text/trigram on `food.name`/`food.description` (GIN index for search). "Which fields came from source X for this food" MUST be answerable by a single query across the value tables and `food_field_provenance` (R7).
- **FR-030** _(deferred post-launch variant)_: If a Redis cache is introduced, entries MUST use key format `food:{id}` with a TTL of 24 hours and `allkeys-lfu` eviction policy. Not part of the lean-launch build.

**Change-Driven Refresh**

- **FR-031**: Our stored record MUST be the source of truth once a food is `RESOLVED`. A background refresh MUST update a field **only** when the external source item it was pulled from has changed upstream; unchanged fields — including any the user manually resolved — MUST be left intact. The refresh MUST NOT blindly re-blend, and there MUST be no max-staleness cutoff that withholds an already-held record (reads never block on source health). (R23)
- **FR-032**: A scheduled rule (e.g. an EventBridge `IngestionScheduled` event) MUST trigger periodic change-driven refresh checks. Detecting "the external item changed upstream" relies on the adapter re-fetching that item and comparing (e.g. a per-item fetched-at / version / hash), not on stored raw payload. Affected fields MUST be re-enqueued/re-pulled as low-priority work (deduped via `ON CONFLICT` per FR-014); re-pulled values MUST pass adapter validation (FR-ADP-2) and update their `source_id` provenance.

**Notification**

- **FR-033**: System MUST support client polling via `GET /v1/foods/{id}` and `GET /v1/foods/{id}/status` as the primary notification mechanism for async food availability.
- **FR-034**: System MAY support WebSocket push notifications via API Gateway WebSocket API as an optional enhancement. When implemented, the consumer MUST emit `FoodDataReceived` events (carrying the food `id`) that trigger a push to connected clients.

**Authentication & Authorization**

- **FR-035**: All food data endpoints (`POST /v1/foods`, `GET /v1/foods/{id}`, `GET /v1/foods/{id}/status`, `GET /v1/foods/{id}/candidates`, `PATCH /v1/foods/{id}`, `GET /v1/foods/search`, batch resolve, and the WebSocket `$connect`) MUST require a valid **Clerk session token** presented as a Bearer credential. Requests without a valid token MUST receive `401 Unauthorized` and MUST NOT reach business logic, create a canonical row, enqueue a fetch, or trigger any external source call.
- **FR-036**: The service MUST verify the Clerk session token **itself, networklessly**, using the public Clerk JWT verification key (`CLERK_JWT_KEY`) for the same Clerk instance the rest of Commise uses (provided via 002). It MUST NOT call Clerk or any external IdP on the request path, and MUST NOT use an Auth0/Cognito authorizer.
- **FR-037**: Token verification MUST enforce authorized parties: the token's `azp` claim MUST match one of the configured `CLERK_AUTHORIZED_PARTIES`. Tokens failing signature, expiry (`exp`), not-before (`nbf`), or `azp` validation MUST be rejected with `401`.
- **FR-038**: The authenticated caller's identity MUST be derived **solely** from the cryptographically-verified token (Clerk `sub`). The service MUST NOT trust any client-suppliable identity header (e.g., `x-authorizer-context`, `x-user-id`); such headers MUST be ignored. (Mirrors the identity service's PR #39 decision: a client-forgeable identity header is a bypass.)
- **FR-039**: All authenticated Commise users MUST be authorized to read food data — foods are shared reference data, not user-owned, so no per-record ownership checks apply. Any operational or administrative endpoint (e.g., manual re-fetch or refresh triggers, if exposed) MUST additionally require an elevated scope/permission read from the verified token's `public_metadata`.
- **FR-040**: Authentication MUST **fail closed**: any error in token verification — missing/invalid `CLERK_JWT_KEY` config, malformed token, or a verification exception — MUST result in `401`, never in an unauthenticated request proceeding.
- **FR-041**: The WebSocket API (US-9) MUST authenticate the Clerk token at `$connect` and reject unauthenticated connections before establishment. To make per-recipient delivery implementable despite fetch deduplication (FR-013/FR-014 collapse a food to one row/one event), the system MUST persist an authenticated **subscription set** mapping each requester `sub` → the food `id`s it requested (recorded at request time and/or `$connect`). On a `FoodDataReceived` event, the notifier MUST resolve recipients from that set and MUST NOT broadcast the completion signal to connections that did not request the `id`. _(Closes RT F-012.)_
- **FR-042**: The service MUST read `CLERK_JWT_KEY` (public PEM verification key) and `CLERK_AUTHORIZED_PARTIES` (allowlist of permitted `azp` values) from configuration; both are non-secret. No Clerk secret key or client secret is required for request authentication. (Each external source's API key, e.g. the USDA key, remains a secret stored in Secrets Manager per A-009.)

**Authentication & Authorization — Red Team hardening (RT-003-usda-food-data-2026-06-19)**

- **FR-043** _(fairness by demotion, not rejection — closes RT F-001; revised 2026-06-20)_: Authentication alone MUST NOT be treated as rate limiting, **but the system MUST NOT reject authenticated cache-miss requests with a per-user quota** — there is **no `429` for exceeding a personal limit**. Fairness is enforced by **queue demotion**: when a single authenticated `sub` (end-user or service principal) has **more than 50 items currently pending in the `fetch_queue`**, that requester's queued and subsequent items MUST be ranked to the **back** of the priority order (lowest priority, below FR-015 demand ordering) so a heavy requester cannot starve other users. Demotion MUST be **dynamic**: priority is computed **at drain time** from the requester's current pending count, so a `sub`'s items automatically return to normal priority once their pending count falls back below 50 (the queue scorer reads live state, not a frozen flag). This is **work-conserving** — a demoted requester still drains using spare capacity. Together with the worker self-throttle (FR-019) and the queue-depth backstop (FR-046, `503`), this guarantees no single `sub` can monopolize a shared per-source budget (USDA: 1,000 req/hr), with **no legitimate request rejected**. (The rolling-window limiter protects each source from the system; demotion + the 90% pause protect users from each other.)
- **FR-044** _(demand counting by distinct requester — closes RT F-011)_: The demand-weighted priority (`request_count`, FR-015) MUST count **distinct authenticated `sub`s** per food `id` (via the requester subscription set), not raw request volume. A single `sub`'s repeated adds for the same `id` MUST NOT increment priority more than once, the priority contribution MUST be capped, and queue ordering MUST apply aging so no `id` can be pinned to the front indefinitely. This prevents priority-inversion starvation of genuine single-request items.
- **FR-045** _(max batch size + partial response — closes RT F-013)_: Batch operations (recipe-import name sets per FR-012, and any `POST /v1/foods/batch` resolve) MUST enforce a hard maximum of **100 names/`id`s per request** (binding). Requests over the limit MUST be rejected with `400 Bad Request` and MUST NOT create rows or enqueue any fetch. For an accepted batch mixing resolved and unresolved foods, the response MUST be a **per-item partial result**: resolved foods are returned inline (with `id`s) and each unresolved name is returned as a `PENDING` entry (its row created and fetch enqueued), in a single response body — the caller gets available data immediately and polls only the pending `id`s (no all-or-nothing withholding). Enqueued misses are subject to the same demotion fairness (FR-043), not a per-user quota. The USDA adapter's internal cap of 20 source keys per USDA batch call (FR-023) is an adapter detail, not the client-facing limit.
- **FR-046** _(queue backpressure + enforced circuit breaker — closes RT F-014)_: The system MUST enforce a maximum `fetch_queue` depth of **10,000 entries** (configurable). When the queue depth reaches that ceiling, or when a source's circuit breaker is **open** (e.g. during a source outage), new enqueue attempts MUST fail closed with `503 Service Unavailable` rather than growing the queue unbounded. The circuit breaker is a normative requirement, not an operational footnote; recovery MUST avoid a thundering-herd burst (e.g. jittered drain).
- **FR-047** _(service-to-service auth — closes RT F-006)_: Server-initiated callers that have no end-user session token — downstream services (001 recipes, 006 meal-planning, 007 grocery, 009 nutrition) and internal jobs (recipe import per FR-012, change-driven refresh per FR-032) — MUST authenticate via a **Clerk machine (M2M) token** whose `azp`/authorized party is in `CLERK_AUTHORIZED_PARTIES`, or a designated internal service principal. The spec MUST classify each endpoint as user-token, service-token, or both. This remains networkless Clerk verification (consistent with FR-036/FR-042); it does NOT introduce a Clerk secret key on the request path.
- **FR-048** _(async producer authorization — closes RT F-005)_: Only named, least-privilege IAM principals MAY publish `FoodRequested`/`IngestionScheduled` events to EventBridge or insert into `fetch_queue`. The consumer MUST validate event provenance. US-0's guarantee ("no unauthenticated path may drive external source consumption") MUST hold for async/internal producers, not only the synchronous HTTP edge.
- **FR-049** _(WebSocket auth mechanics — closes RT F-008)_: The WebSocket auth contract MUST specify: (a) how the token is presented at `$connect` (query parameter or `Sec-WebSocket-Protocol` subprotocol, since browsers cannot set an `Authorization` header on WebSocket); (b) behavior on **mid-connection token expiry** (`exp` passes during a long-lived connection) — the connection MUST be closed (or require re-auth on next message); (c) the reconnect/re-auth flow after the 10-minute idle close (US-9); (d) a single, pinned `$connect` rejection status (`403`, per API Gateway WebSocket authorizers).
- **FR-050** _(authorizer fail-closed hardening — closes RT F-003)_: For the HTTP read API (`/v1/foods/*`), auth is the in-process NestJS `AuthMiddleware` (A-011); it has **no authorizer result cache**, so there is no cache to poison — the middleware MUST verify every request and MUST be wired ahead of **every route** (no route may bypass it), and a denied request MUST return `401`/`403`, never a default-open response. The API Gateway REQUEST-authorizer caching rules apply **only** to the deferred WebSocket `$connect` (US-9): there, authorizer result caching MUST be disabled (TTL = 0) or keyed solely on the verified token (never on a client-controlled value), the authorizer MUST be attached to **every WebSocket route AND method** (including `$connect` and `$default`), and a denied authorization MUST return `401`/`403`, never a default-open Gateway response.
- **FR-051** _(response-status precedence + 403 — closes RT F-007, F-010)_: The service MUST apply a normative response precedence: **authentication (`401`) → authorization scope (`403`) → input validation (`400`) → business logic (`404`/`202`/`200`)**. Authenticated-but-insufficient-scope requests (FR-039) MUST receive `403 Forbidden`. FR-002/FR-003/FR-004/FR-005/FR-006 are subject to this ordering (their `200`/`202`/`404`/`400` outcomes occur only after `401`/`403` checks pass).
- **FR-052** _(auth-layer DoS protection — closes RT F-015)_: The auth layer MUST bound verification concurrency and apply a per-source `401`-rate cap (load-shed) so that a flood of well-formed-but-invalid tokens (each forcing a CPU-bound signature verification before the fail-closed `401`) cannot saturate the verifier and breach SC-009 availability. SC-011's ≤10ms p95 MUST be validated under an invalid-token flood, not only the happy path.
- **FR-053** _(auth is a first-class architecture component — closes RT F-002)_: The Clerk verification + authorization layer MUST be represented as a **named component** in the architecture and module designs, positioned in front of every food data entry point (HTTP routes and WebSocket `$connect`), with traceability rows binding FR-035–FR-052 to it. The auth design MUST NOT exist only as spec prose unmapped to any module (the failure this requirement prevents: an implementer following the architecture ships an unauthenticated service that still "traces" to the design).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript code in the food data workspace MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. All interfaces for canonical food entities, source adapters, fetch-queue rows, and API responses MUST use strict typing with `interface` for data shapes and `type` for unions/aliases. (Constitution Principle I)
- **NFR-002**: All exported functions, classes, interfaces, type aliases, and interface fields MUST carry JSDoc block comments. Worker handlers, API route handlers, source adapters, merge logic, rolling-window limiter operations, and fetch-queue processors MUST include `@param`, `@returns`, and `@throws` tags. (Principle II)
- **NFR-003**: All imports within the food data workspace MUST use aliased paths (`@kitchensink/*`) with `.js`/`.jsx` extensions. No `helpers/` directories. (Principle III)
- **NFR-004**: If any UI components are created for food data display (e.g., nutritional info cards, pending/unresolved indicators, candidate pickers), they MUST expose accessible names queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-005**: Color MUST NOT be the sole conveyor of food lifecycle status (`PENDING`, `UNRESOLVED`, `RESOLVED`, `NOT_FOUND`, `FAILED`). Each status MUST be paired with a text label or icon. (Principle VII)
- **NFR-006**: All new workspaces (`@kitchensink/food-service`, `@kitchensink/usda-client`, `@kitchensink/food-service-client`, `@kitchensink/clerk-verify`) MUST be registered in the root `package.json` workspaces array (the `packages/clients/*` ones as explicit paths) and MUST extend `@kitchensink/typescript`, `@kitchensink/eslint`, `@kitchensink/prettier`, and `@kitchensink/vitest` shared configs. Turbo task dependencies MUST be declared. (Principle V)
- **NFR-007**: All code MUST pass `turbo run typecheck`, `turbo run lint`, and `turbo run format:check` with zero errors before merge. (Principle VI)
- **NFR-008**: Tests MUST conform to the testing pyramid: >= 70% unit, <= 20% integration, <= 10% E2E. Each test file MUST open with a block comment mapping requirement IDs (FR-xxx) to test case descriptions. (Principle IV)
- **NFR-009**: Custom errors (e.g., `SourceApiError`, `RateLimitWindowFullError`, `FoodNotFoundError`, `CandidateMismatchError`) MUST extend `Error` and MUST expose a type guard (`isXxxError(e: unknown): e is XxxError`). (Principle I)
- **NFR-010**: Dates in all food data interfaces MUST be ISO 8601 strings, never `Date` objects. (Principle I)

### Key Entities

- **Food**: The canonical, source-agnostic golden record. A "Food" is keyed by an internal `id` (ULID-valued, named `id`) — distinct from a Commise "Ingredient," which is a recipe component that MAY link to a Food via that Food's `id`. All foods can be ingredients, but not all ingredients are foods (e.g., spices, oils may have no source match; the `id` link is optional on the Ingredient side). Key attributes: `id` (primary key), `name`, `description`, `kind` (`generic | branded`), brand attributes, `barcode`, the normalized-name dedup key, `status` (`PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`), `createdAt`, `updatedAt`. Scalar-field provenance lives in `food_field_provenance`; nutrients and portions live in their own tables. Stored in PostgreSQL; optionally cached in Redis. Fulfills Commise FR-007 ("back ingredient data with a real food/nutrition database").

- **FoodSource (crosswalk)**: One row per (food, source) backing a food. Key attributes: `foodId`, `source` (a `source` enum value, e.g. `usda`), `externalKey` (that source's PK for the item — for USDA this is the value the adapter mapped from `fdcId`), and fetch state. Constraint: `UNIQUE(source, externalKey)`. **No verbatim source payload is retained.** Used for barcode/external-key lookup (FR-008) and as the provenance anchor referenced by `source_id` columns.

- **Nutrient (dictionary)**: The nutrient dictionary — one row per nutrient with `name`, `unit`, and a stable external code (e.g. an INFOODS tagname) where available. Units live here, never on a value row.

- **FoodNutrient (value)**: A normalized nutrient value for a food: `(foodId, nutrientId, amount, basis, sourceId)`. `basis` records the measurement basis (per-100g vs per-serving); all values are normalized to per-100g before any cross-source blend. `sourceId` is the per-value provenance (which `food_sources` row the value came from).

- **FoodPortion**: A household measure / serving size for a food, with gram weight and `sourceId` provenance. A separate normalized table, not columns on `food`.

- **FoodFieldProvenance**: `(foodId, field, sourceId)` for scalar `food.*` fields only; `field` is a controlled enum. Answers "which source supplied this scalar field." Together with `food_nutrients.source_id` and `food_portions.source_id`, makes "which fields came from source X" a single-query answer (FR-029).

- **Candidate**: A normalized, per-source candidate produced during fan-out for an `UNRESOLVED` food, each carrying its `source` and that source's item key. The user's `PATCH` selection (US-2a) must reference a candidate from the food's own candidate set; the chosen candidate(s) drive the merge into the golden record.

- **FetchRequest**: Represents an intent to resolve a food from external sources. Key attributes: food `id`, `requestedAt` (ISO 8601), `requestSource` (user-add | recipe-import | change-refresh), `priority` (high | low). Manifests as a `fetch_queue` row (see `FetchQueueRow`). Lifecycle: created by the NestJS read API on add-by-name (canonical row + `id` created up front) -> persisted as a `fetch_queue` row (idempotent `INSERT … ON CONFLICT`, FR-014) -> drained by the Fargate consumer worker -> resolved (golden record assembled, or food tombstoned `NOT_FOUND`/`FAILED`).

- **RateLimitWindow** (per source; formerly TokenBucketState): The rolling-window rate limiter's current state for a single source — the set of recent source-call timestamps over the trailing 60 minutes. Key attributes: `source`, `recentCallTimestamps` (ISO 8601 timestamps of that source's calls in the trailing 60 minutes), derived `trailingCount` (number of calls in the window, capped at the source's limit; USDA cap = 1,000). Stored as a per-source Postgres call log (e.g. a `source_call_log` table of timestamped rows keyed by `source`, pruned/filtered to the trailing 60 min) in the lean launch variant, or a per-source Redis sorted set in the deferred variant. All check-and-record mutations are atomic. (FR-019, FR-020)

- **FetchQueueRow**: A single durable row in the Postgres `fetch_queue` table — the unit of work in the demand fetch queue (Postgres-as-queue; **not** an SQS message), keyed on the food `id`. Key attributes: `food_id` (unique — `ON CONFLICT` target for dedup), `request_count` (demand counter for weighting, FR-015/FR-044), `status` (`pending` | `in_flight` | `tombstone`), `attempts` (cumulative retry count, FR-016), `last_error` (populated on tombstone for operator review), `first_requested` (FIFO tie-break) and `last_requested` (backoff gate) ISO 8601 timestamps, `priority` (high | low). Drained one-at-a-time by the Fargate consumer worker via `SELECT … FOR UPDATE SKIP LOCKED` ordered by `request_count DESC, first_requested ASC`. The per-source adapter fetches and any source-internal batching (e.g. the USDA ≤20-keys/call batch) are drain details, not properties of the row.

- **FoodDataEvent**: An EventBridge event in the food data lifecycle. EventBridge is used **only** for scheduled producers and the completion signal — **not** for the demand-path enqueue (that is a direct `fetch_queue` `INSERT … ON CONFLICT` + `pg_notify('fetch_queued')`, FR-011/FR-014/FR-017). Types: `IngestionScheduled` (scheduled rule -> change-driven refresh producer that enqueues low-priority `fetch_queue` rows, FR-032), `FoodDataReceived` (Fargate consumer worker -> WebSocket/notifications on successful resolution, carrying the food `id`, FR-034), `FetchFailed` (Fargate consumer worker -> CloudWatch/SNS on `FAILED`/`NOT_FOUND` tombstone). `FoodRequested` denotes the synchronous demand-path enqueue performed in-process by the read API directly against `fetch_queue` (no EventBridge, no queue topic).

- **AuthenticatedCaller**: The verified principal behind a request. Derived per-request from the validated Clerk session token — never persisted by this service and never sourced from a client-supplied header. Key attributes: `sub` (Clerk user identifier), `azp` (authorized party / originating Commise client, checked against `CLERK_AUTHORIZED_PARTIES`), and `scopes`/`permissions` (read from the token's `public_metadata`, used only to gate operational/admin endpoints per FR-039). Produced by the NestJS `AuthMiddleware` (in-process, on ECS/Fargate behind the ALB) and surfaced to handlers via `req.user`. For the deferred WebSocket notifier (US-9), the equivalent principal is produced by the API Gateway WebSocket `$connect` REQUEST authorizer and surfaced via the trusted `$context.authorizer`; that `$context.authorizer` path applies only to the WebSocket `$connect`, not to the HTTP read API.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Food reads for locally-`RESOLVED` items MUST return within 50ms at p95 latency.
- **SC-002**: The system MUST make ≤1,000 USDA API calls in ANY rolling 60-minute window (and ≤ each additional source's limit, per source). Per-source rolling-window compliance MUST be verifiable via CloudWatch metrics — no rolling-hour window ever exceeds a source's cap and zero `429` responses occur under normal operation.
- **SC-003**: Background food resolutions (from `202 Accepted` to `RESOLVED` available) MUST complete within 60 seconds at p95 when the `fetch_queue` pending-row depth is under 100 rows (excluding `UNRESOLVED` foods awaiting a human pick).
- **SC-004**: Cache hit rate (reads served from the local store without any source call) MUST exceed 80% once the local store contains 5,000+ unique `RESOLVED` foods (measured over a rolling 24-hour window).
- **SC-005**: The fan-out/merge pipeline MUST achieve an effective resolution throughput of at least 5,000 foods per hour, using each source's batch capability where available (e.g. the USDA adapter's ≤20-keys/call batch averaging 5+ keys per call).
- **SC-006**: Zero data loss from queue processing failures. All persistently failing foods MUST be tombstoned (`FAILED`/`NOT_FOUND`, `status='tombstone'`) after the FR-016 retry budget (5 cumulative attempts for `FAILED`). The tombstone-row count MUST be trackable via CloudWatch alarm (the durable `fetch_queue` row is the audit record; there is no DLQ).
- **SC-007**: Food search queries against a local store of up to 50,000 foods MUST return results (canonical `id`s) within 200ms at p95.
- **SC-008**: Stored nutrient values MUST be faithful to their source after the documented normalization (per-100g basis conversion is permitted and recorded via `basis`); no lossy rounding or transformation at ingestion beyond basis normalization. This supports Commise SC-010 ("Nutritional calculations accurate to within 5% of source database values").
- **SC-009**: The food data API (`/v1/foods/*` endpoints) targets 99.9% availability measured monthly, excluding scheduled maintenance windows communicated 48 hours in advance. Availability is defined as successful responses (2xx/3xx/4xx) divided by total requests; only 5xx responses and timeouts count as downtime. **Lean-launch caveat (per A-002/A-013):** the API tier is stateless (multi-task ECS/Fargate, multi-AZ-capable), but the reused shared database is **single-AZ (`multiAz: false`)**, which caps DB availability below 99.9% during an AZ outage or DB maintenance. For lean launch this single-AZ posture is an **accepted risk**; the 99.9% guarantee is contingent on the **multi-AZ upgrade** of the shared `kitchensink-data-{stage}` instance (deferred — see Assumptions A-013). Until then, SC-009 is the _target_, not a contractual SLA.
- **SC-010**: 100% of food data endpoints — every `/v1/foods/*` route and the WebSocket `$connect` — MUST reject unauthenticated, expired, malformed, and wrong-`azp`/wrong-instance requests with `401`, verified by automated tests covering each endpoint. No rejected request may create a canonical row, enqueue a fetch, or trigger any external source call.
- **SC-011**: Clerk session-token verification MUST add no more than 10ms at p95 to request latency (networkless, no IdP round trip), keeping cache-hit reads within the 50ms SC-001 budget. This MUST hold under an **invalid-token flood** (well-formed but unverifiable tokens forcing full signature checks), not only the happy path — verifying the auth layer sheds load rather than saturating (FR-052).
- **SC-012**: No single authenticated `sub` may starve others. A test in which one account floods cache-miss adds (>50 pending) MUST show that account's items **demoted to the back** of the `fetch_queue` while other users' requests continue to be served, with **no request rejected by a per-user quota**, and the system MUST never exceed USDA's 1,000 req/hr (the worker pauses at ~90%). (Auth proves identity; demotion + the 90% pause prove fairness — FR-043/FR-019.)
- **SC-013**: Identity/provenance integrity — for any `RESOLVED` food, every stored scalar field, nutrient, and portion MUST carry a resolvable `source_id`/`field`-provenance reference into `food_sources`, and "which fields came from source X" MUST be answerable by a single query (FR-029). No canonical row, DAO, public DTO, or API field outside the USDA adapter may expose `fdcId` or any source-native identifier (verified by a test asserting the absence of source-coupled identifiers in the public surface).

## Assumptions

- **A-001**: Each external source's rate limit is a hard constraint. For USDA, the FoodData Central limit of 1,000 requests per hour per API key cannot be increased through paid tiers or support requests within the project timeline. Additional sources each bring their own limit, enforced by a per-source rolling window (FR-019).
- **A-002**: The lean launch variant (no Redis, `db.t4g.micro` PostgreSQL) is the default starting configuration. Redis is added when performance thresholds warrant it (p95 read latency > 100ms sustained, or read volume > 50K/day).
- **A-003**: Eventual consistency is acceptable for food data. Users tolerate a 10-60 second delay for first-time add-by-name resolutions in exchange for never blocking on an external source call.
- **A-004**: The USDA API remains publicly available with a free tier and the current `POST /v1/foods` batch endpoint supporting up to 20 IDs per request. USDA is the only wired source adapter at launch; the multi-source machinery is built now but a second concrete live source is out of scope (see Scope Boundaries in the requirements doc).
- **A-005**: This feature deploys as an AWS-hosted backend service in `us-east-1`. The **read API** (`/v1/foods/*`) is a NestJS service on ECS/Fargate fronted by the single shared internet-facing per-stage ALB (owned by the global infra) via a host-based listener rule — not its own ALB — same topology as the identity service; the async resolution pipeline uses the durable Postgres `fetch_queue` table (Postgres-as-queue with `LISTEN/NOTIFY`) drained by a single Fargate consumer worker — **no SQS** — with EventBridge only for scheduled producers (change-driven refresh) and the `FoodDataReceived` completion event, on the shared RDS. It serves both the web and mobile Commise clients via the shared ALB. The only API Gateway surface is the deferred WebSocket notifier (US-9). **No new RDS or cluster is provisioned** — the food tables live in a separate logical database `kitchensink_food` on the existing shared instance `kitchensink-data-{stage}` (the global DataStack provisions that database + its role/secret).
- **A-006**: This feature adds **four** packages to the KitchenSink monorepo, all following Constitution Principle V workspace rules: `@kitchensink/food-service` (`packages/services/food-service` — the deployable service + its CDK, hosting the canonical model, DAOs, fan-out/merge, and the source-adapter interface), `@kitchensink/usda-client` (`packages/clients/usda` — the **USDA source adapter**, the only place `fdcId` and USDA terms appear), `@kitchensink/food-service-client` (`packages/clients/food-service` — our API client), and `@kitchensink/clerk-verify` (`packages/shared/clerk-verify` — shared Clerk verification). `packages/clients/*` packages are added to the root `workspaces` array as explicit paths (grouping folder, not a glob).
- **A-007**: Client-side polling (not WebSocket) is the launch notification mechanism. WebSocket (US-9) is deferred until UX testing validates the need.
- **A-008**: The canonical food schema is purpose-built for this feature. Integration with Commise's `ingredients` entity (linking recipe ingredients to a Food's `id`) is a downstream concern handled by the Commise recipe management feature, not by this specification.
- **A-009**: Each external source's API key (e.g. the USDA API key) is stored in AWS Secrets Manager and rotated per AWS best practices; keys are never exposed in client-facing responses or logged. All food data API endpoints share the Commise application's authentication boundary by verifying the same **Clerk** session token (via the public `CLERK_JWT_KEY` and `CLERK_AUTHORIZED_PARTIES`, provided by 002); no separate auth mechanism, user store, or Auth0/Cognito authorizer is introduced. Source API keys are the only secrets this feature requires.
- **A-011**: Clerk token verification for the food **read** API (`/v1/foods/*`) is implemented **in-process** by a NestJS `AuthMiddleware` running on ECS/Fargate behind a public ALB — the **same topology as the identity service** — using the shared `ClerkAuthService` (`@clerk/backend` `verifyToken`, networkless) to validate signature, expiry, and `azp` via the public `CLERK_JWT_KEY`. There is **no API Gateway and no Lambda authorizer for the HTTP API**; the verified `sub`/claims are populated on `req.user` and surfaced to handlers in-process. The **only** Lambda-authorizer / `$context.authorizer` surface is the **deferred WebSocket** notifier (US-9): an API Gateway WebSocket API whose `$connect` REQUEST authorizer performs the same networkless Clerk verification and passes the verified claims via API Gateway's trusted `$context.authorizer` (set by API Gateway, not the client). Identity is taken **only** from the verified token — never from a client-supplied header (no `x-authorizer-context` trust), mirroring the identity service's PR #39 decision (FR-038).
- **A-010**: All food data API endpoints use URL prefix versioning (`/v1/foods/*`). Breaking changes require a new version prefix (`/v2/foods/*`). **A "breaking change" includes response-contract and auth-semantic changes** (e.g. introducing `401`/`403` as new possible responses to an existing endpoint), not only route-shape changes — such changes MUST be coordinated as a cutover with existing consumers rather than slipped silently under the same `/v1/` prefix (RT F-009). The FR-035 endpoint enumeration MUST stay reconciled with the full implemented endpoint set (e.g. `POST /v1/foods`, `/v1/foods/{id}/candidates`, `PATCH /v1/foods/{id}`, `/v1/foods/search`); every exposed endpoint has a defined auth status. The USDA FoodData Central API's own `/v1/` prefix is independent and unrelated to our versioning, and is confined to the USDA adapter.
- **A-012**: Two Clerk token classes authenticate this service: **user session tokens** (interactive web/mobile callers) and **machine (M2M) tokens** (server-to-server callers — downstream services 001/006/007/009 and internal jobs). Both are verified networklessly via `CLERK_JWT_KEY` with `azp` enforcement; neither requires a Clerk secret key on the request path. Endpoints are classified user-token, service-token, or both (FR-047). The `AuthenticatedCaller` principal therefore carries either a human `sub` or a service identity.
- **A-013** _(availability posture)_: Lean launch reuses the shared single-AZ database instance (`multiAz: false`), so SC-009's 99.9% is a **target with an accepted single-AZ risk**, not a contractual SLA. Promoting `kitchensink-data-{stage}` to multi-AZ (a global-DataStack change) is the documented upgrade that makes 99.9% defensible; it is **deferred to the GA/scale phase** and tracked as a deferred task (T-061). The stateless API tier already runs multi-task across AZs, so the API itself is not the availability bottleneck.
- **A-014** _(source-agnostic identity, re-baseline 2026-06-21)_: A food's identity is the internal `id`; no source-native identifier is ever a key. `fdcId` and USDA terms are confined to the USDA adapter (`@kitchensink/usda-client`) and mapped to a generic `external_key` inbound. The merge/provenance/candidate machinery (golden record) is built now even though USDA is the only wired source, because the id/crosswalk foundation is the costly-to-change part. This is a clean replacement of the Phase 1–2 schema and API — **no data to migrate**.
