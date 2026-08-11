# Feature Specification: Notification Service

**Feature Branch**: `014-notification-service`
**Created**: 2026-05-10
**Status**: Draft
**Input**: User description: "A generic in-app notification service that owns publish/receive routing across all KitchenSink features. Producers publish messages addressed to a single user, a group, or globally; clients receive matching messages and dispatch behavior by `messageType` keyword. Transport (push/pull/webhook/hybrid) is an implementation choice."

## Dependencies

| Spec                                                        | Relationship                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required + extended** — Subscriber authentication and authenticated identity for recipient resolution use the shared auth mechanism owned by 002. 002 is shipped; this feature additionally **adds a group model to the identity service** (see A-002), so the groups API is new surface delivered under 014, not a dependency to wait on.                                                                                                                                  |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Downstream (launch consumer)** — 003 FR-041 (withdrawn as specified 2026-08-10) is satisfied by publishing through this service. The notification is published by the **recipe service** (T-044), because `FetchQueueDao.resolve` deletes `fetch_requesters` in the transaction that completes the food. The keyword is `food.resolution.completed` per 003's decision register. There is no `003 US-005` and no `FR-NOTIF`; the earlier citation to them was void (T-048). |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Downstream** — recipe lifecycle notifications owned by 001 contract updates will be published through this service.                                                                                                                                                                                                                                                                                                                                                         |
| [005-ai-integration](../005-ai-integration/spec.md)         | **Downstream** — AI-generated content disclosure events owned by 005 contract updates will use this service.                                                                                                                                                                                                                                                                                                                                                                  |
| [008-cooking-mode](../008-cooking-mode/spec.md)             | **Downstream** — timer alert events owned by 008 contract updates will use this service.                                                                                                                                                                                                                                                                                                                                                                                      |
| [009-nutrition-planning](../009-nutrition-planning/spec.md) | **Downstream** — compliance-gap events owned by 009 contract updates will use this service.                                                                                                                                                                                                                                                                                                                                                                                   |

Resolves `specs/cross-feature-consistency-report.md` §5.3 / **WA-004** (no owner for notification delivery).

## Clarifications

### Session 2026-05-10

- Q: Should there be a central registry of allowed `messageType` keywords? → A: **Yes** — central, version-controlled registry. Unknown keywords still tolerated client-side, but flagged by operational counters and eligible for publish rejection once the registry is enforced.
- Q: What ordering guarantee should the service commit to? → A: **Per-recipient FIFO** for `user` and `group` recipients; **best-effort** for `global` broadcasts. Backed by industry practice (Ably, AWS SNS FIFO, Knock, Kafka partition-per-key patterns).
- Q: Are launch transports limited to in-app? → A: **Yes** — email and mobile push are explicitly out of scope for this release.
- Q: Does this service own the meaning of any specific `messageType`? → A: **No** — producers own their own keyword namespaces and document them in their own feature specs. This service only owns transport, routing, and the registry mechanics.

## User Scenarios & Testing _(mandatory)_

<!--
  This is an infrastructure/cross-cutting feature. User stories are framed from the
  perspective of (a) producer features, (b) end-user clients receiving notifications,
  and (c) the Operations Engineer. Each story is independently testable.

  Personas use canonical IDs from specs/cross-feature-consistency-report.md.
-->

### User Story 1 — Service Publishes a User-Addressed Notification (Priority: P1)

A backend producer feature (e.g., 003) needs to tell **P4 Sam** that an asynchronous backend job that Sam triggered has completed. The producer authenticates against the notification service and publishes an envelope addressed to Sam's user id. The publish call returns success when the message is durably accepted, regardless of whether any of Sam's clients (web, mobile, multi-tab) is currently connected. Every active client of Sam — and only Sam — eventually observes the message, in publish order relative to other messages addressed to Sam.

**Why this priority**: This is the minimum viable contract. Without it, no producer feature can use the service at all, and the cross-feature gap (WA-004) is not closed.

**Independent Test**: Stand up the publish API and a single subscriber identity. Publish two messages addressed to that user. Verify both arrive at every connected client of that user, in publish order, and at no other user's client.

**Acceptance Scenarios**:

1. **Given** an authenticated producer and an authenticated subscriber for user U, **When** the producer publishes `{ recipient: { kind: "user", id: U }, messageType: "x.test", payload: {...}, occurredAt: T }`, **Then** the publish call returns success and U's connected client receives the matching delivery envelope.
2. **Given** the producer publishes two messages addressed to U in sequence (T1 then T2), **When** U's client receives them, **Then** the client observes them in T1-before-T2 order.
3. **Given** a second authenticated subscriber for user V, **When** a message addressed to U is published, **Then** V's client does **not** receive it.

---

### User Story 2 — Group Recipient Routing (Priority: P1)

A producer addresses a message to a group (e.g., a household sharing a recipe collection). Every user that is a member of the group at delivery time receives the message on each of their active clients. Per-recipient FIFO order applies independently to each member.

**Why this priority**: Group-addressed notifications are required by anticipated 001 / 006 collaboration flows; deferring this would push collaboration features to invent their own fan-out.

**Independent Test**: Create a group with two member users. Publish one group-addressed message. Verify both members' clients receive the message; verify a non-member's client does not.

**Acceptance Scenarios**:

1. **Given** group G with members {U, V}, **When** a producer publishes a message with `recipient = { kind: "group", id: G }`, **Then** clients of U and V both receive the delivery envelope.
2. **Given** group G with no members, **When** a producer publishes to G, **Then** the publish call still returns success and operational counters reflect zero deliveries (no error).
3. **Given** user W is not a member of G, **When** a message addressed to G is published, **Then** W's client does not receive it.

---

### User Story 3 — Global Broadcast (Priority: P1)

The Operations Engineer (canonical internal persona) publishes a system-wide notification (e.g., maintenance window). Every authenticated client across the application receives it. Ordering for global broadcasts is best-effort; producers must not rely on global broadcasts to express state transitions.

**Why this priority**: Global broadcasts are the only operationally safe channel for system messages and are required by the Operations Engineer persona at launch.

**Independent Test**: With three subscribers across two users, publish one global message. Verify all three clients receive it. Verify ordering is not relied upon in the test (no FIFO assertion on global).

**Acceptance Scenarios**:

1. **Given** N authenticated clients across multiple users, **When** a global message is published, **Then** all N clients receive the delivery envelope.
2. **Given** a global message and a user-addressed message published concurrently, **When** clients receive them, **Then** the relative order between the global and the user-addressed message is **not** guaranteed.
3. **Given** publishing a global broadcast, **When** the publish completes, **Then** an operational counter for global broadcasts is incremented (visibility into a privileged action).

---

### User Story 4 — Client Dispatches by `messageType` (Priority: P1)

A connected client receives a delivery envelope and invokes a handler keyed off the envelope's `messageType` keyword. Unknown `messageType` values do not crash the client; they are logged and ignored.

**Why this priority**: Client dispatch by keyword is the contract the entire client integration story rests on. It also defines the forward-compatibility model: producers can add new types without breaking older clients.

**Independent Test**: Register handler for `messageType = "x.known"`. Publish one message with that type and one with `messageType = "x.unknown"`. Verify the known handler ran exactly once, the unknown message produced a log entry, and the client did not crash.

**Acceptance Scenarios**:

1. **Given** a client with a handler registered for `messageType = M`, **When** a message of type M is delivered, **Then** the handler is invoked exactly once with the delivery envelope.
2. **Given** a client without a handler for `messageType = M'`, **When** a message of type M' is delivered, **Then** the client logs a structured warning and continues running.

---

### User Story 5 — Catch-Up After Disconnect (Priority: P1)

A client that was offline when a message was published can still receive (or pull) messages addressed to it within a defined retention window once it reconnects. Per-recipient FIFO ordering is preserved across the disconnect boundary.

**Why this priority**: Mobile clients reconnect constantly. Without catch-up, every reconnect would silently drop messages — every consumer feature would have to invent its own reconciliation, defeating the point of a shared service.

**Independent Test**: Subscribe a client, disconnect it, publish a user-addressed message, wait less than the retention window, reconnect the client. Verify the message is delivered post-reconnect and arrives in publish order relative to any messages published during the offline window.

**Acceptance Scenarios**:

1. **Given** a subscriber for user U is disconnected at T0, **When** a message addressed to U is published at T1 (T1 > T0, within the retention window), **Then** when U's client reconnects at T2, the client receives the message.
2. **Given** two messages addressed to U are published at T1 and T2 while U is offline, **When** U's client reconnects, **Then** the client observes them in T1-before-T2 order.
3. **Given** a message addressed to U was published more than the retention window before reconnect, **When** U's client reconnects, **Then** the message is **not** redelivered and operational counters reflect an undelivered-after-retention event.

---

### User Story 6 — Operational Counters (Priority: P1)

The Operations Engineer can observe at minimum: publish rate per producer feature, delivered-message count, undelivered-after-retention count, and current active subscriber count. Counters are the minimum signal needed to confirm in production that the service is alive and that producers are not silently failing.

**Why this priority**: Without counters, an outage in this service could be invisible to operators and to producer features (whose `publish()` calls would all return success). This is required at launch.

**Independent Test**: Publish N messages from one producer to mixed recipients with one subscriber online. Verify the four counters move by the expected deltas.

**Acceptance Scenarios**:

1. **Given** producer F publishes K messages, **When** the producer-feature publish counter is queried, **Then** it reflects ≥ K for producer F.
2. **Given** S subscribers are currently connected, **When** the active subscriber gauge is queried, **Then** it reports S.
3. **Given** a message was not delivered before its retention window expired, **When** the undelivered-after-retention counter is queried, **Then** it reflects that event.

---

### User Story 7 — Authenticated Subscription (Priority: P2)

Clients must be authenticated via the shared auth mechanism (002) before they can subscribe. Recipient resolution uses the **authenticated identity**, not any client-supplied identity claim. A client cannot subscribe to messages addressed to a user other than the authenticated identity.

**Why this priority**: Without identity-bound subscription, any client could request another user's notifications. Required before any production rollout, but separable from the publish-side P1 stories.

**Independent Test**: Authenticate as user U, attempt to subscribe to messages addressed to user V. Verify the subscription is rejected.

**Acceptance Scenarios**:

1. **Given** an unauthenticated client, **When** it attempts to subscribe, **Then** the subscription is rejected.
2. **Given** an authenticated client for user U, **When** it attempts to subscribe to messages addressed to user V (V ≠ U), **Then** the request is rejected.
3. **Given** an authenticated client for user U, **When** a message addressed to U is published, **Then** the client receives it without requiring U to claim the user id at subscribe time.

---

### User Story 8 — Envelope Schema Validation (Priority: P2)

Publishes that violate the envelope schema (missing `recipient`, missing `messageType`, malformed `recipient.kind`, missing `occurredAt`, etc.) are rejected with a structured error **before** being durably stored. Validation is at the envelope level only — `payload` is opaque.

**Why this priority**: Catches integration bugs at the producer boundary instead of corrupting the queue. Should-have, not must-have at MVP, because the producers are internal and can be debugged out-of-band initially.

**Independent Test**: Publish ten malformed envelopes (missing required field, wrong type for `recipient.kind`, etc.). Verify each is rejected with a structured error and none appear in storage or downstream counters as a successful publish.

**Acceptance Scenarios**:

1. **Given** an envelope missing `messageType`, **When** the producer publishes it, **Then** the call is rejected with a structured validation error.
2. **Given** an envelope with `recipient.kind = "user"` and no `recipient.id`, **When** the producer publishes it, **Then** the call is rejected with a structured validation error.
3. **Given** an envelope with an opaque `payload` of any JSON shape, **When** the envelope is otherwise valid, **Then** the publish succeeds.

---

### User Story 9 — `messageType` Registry Enforcement (Priority: P2)

Each producer feature registers its `messageType` keywords (and a short description) in a shared, version-controlled registry. Publishes of registered types succeed normally; publishes of unregistered types are tolerated initially but counted, and once the registry is marked enforced, unregistered types are rejected at publish.

**Why this priority**: Closes the discoverability and collision-avoidance problem (Q-005 resolution) without blocking initial integration.

**Independent Test**: Register `food.backfill.completed`. Publish that type — succeeds, counter increments. Publish `food.unknown.unregistered` — tolerated initially with "unregistered" counter increment; once enforcement is on, rejected with structured error.

**Acceptance Scenarios**:

1. **Given** `messageType = M` is registered, **When** a producer publishes M, **Then** the publish succeeds and the per-type counter increments.
2. **Given** `messageType = M'` is **not** registered and enforcement is **off**, **When** a producer publishes M', **Then** the publish succeeds and an "unregistered messageType" counter increments.
3. **Given** `messageType = M'` is **not** registered and enforcement is **on**, **When** a producer publishes M', **Then** the publish is rejected with a structured error.

---

### User Story 10 — Producer-Defined Idempotency Key (Priority: P3)

Producers may attach an optional `idempotencyKey`. Duplicate publishes with the same `(producer, idempotencyKey)` inside a defined window collapse to one delivery per recipient. Consumers MUST still treat handlers as idempotent (handlers may run more than once across reconnects in degenerate cases).

**Why this priority**: Strong "exactly-once" semantics are not promised by the chosen ordering model. Idempotency keys are a producer-side affordance to deduplicate retries, not an "exactly-once" guarantee.

**Independent Test**: Publish the same envelope twice with the same `idempotencyKey` inside the dedup window. Verify the recipient client observes the message exactly once.

**Acceptance Scenarios**:

1. **Given** the same producer publishes envelope E twice with the same `idempotencyKey` within the dedup window, **When** the recipient is online, **Then** the recipient's client observes exactly one delivery.
2. **Given** the same `idempotencyKey` is reused **after** the dedup window, **Then** both publishes deliver.

---

### User Story 11 — Per-Feature Publish Quotas (Priority: P3)

A producer feature can be rate-limited independently to protect the shared infrastructure. A misbehaving producer (e.g., a runaway loop in 005's AI integration) cannot starve the rest of the system.

**Why this priority**: Defensive — important for shared infrastructure but not strictly required to launch with a small set of trusted internal producers.

**Independent Test**: Configure a low quota for one producer. Publish above the quota. Verify excess publishes are rejected with a structured rate-limit error and operational counters reflect the throttling.

**Acceptance Scenarios**:

1. **Given** producer F has a publish quota of K/sec, **When** F publishes more than K within one second, **Then** the excess publishes are rejected with a structured rate-limit error.
2. **Given** F is being throttled, **When** an operator queries counters, **Then** a per-producer throttled-publish counter reflects the rejected calls.

---

### Edge Cases

- **Recipient does not exist**: Publishing to `recipient = { kind: "user", id: <unknown> }` succeeds at the API boundary (decoupled from identity lookup) and increments an "undeliverable, unknown recipient" counter. No exception is raised to the producer.
- **Group with zero members**: Publishing to an empty group succeeds; zero deliveries occur; counter increments.
- **Subscriber connects mid-publish**: Per-recipient FIFO order is preserved across the connection event by treating the catch-up window as the source of truth.
- **Multiple clients per user (web + mobile + extra browser tab)**: Each active client receives the message exactly once per delivery; per-recipient FIFO order is observed independently on each client.
- **Global broadcast to a sleeping global subscriber set**: Best-effort; broadcasts published while a client is offline beyond the retention window are dropped for that client.
- **`messageType` with same keyword used by two producers**: Caught by the registry (US-009); without enforcement, the keyword collision is reported via the "unregistered" counter once a producer registers it later.
- **Subscriber's group membership changes mid-flight**: Membership is resolved at delivery time, not publish time; a user removed from a group between publish and delivery does not receive the message.
- **Service restart**: In-flight publishes accepted before the restart are not lost (durability is required by US-001's "publish call returns success when the message is durably accepted"). In-flight subscriptions reconnect and use catch-up (US-005).

## Requirements _(mandatory)_

<!--
  Requirements are framed in product / behavioral terms. Specific transports,
  storage engines, and partitioning schemes are intentionally NOT prescribed
  here — those decisions belong in plan.md.
-->

### Functional Requirements

- **FR-001**: The system MUST expose a single `publish` API endpoint under `/api/v1/notifications/publish` that accepts envelopes of the form `{ recipient, messageType, payload, occurredAt, idempotencyKey? }`.
- **FR-002**: The `publish` endpoint MUST authenticate the calling producer using a service-to-service mechanism aligned with feature 002.
- **FR-003**: The `publish` endpoint MUST return success **only after** the message is durably accepted (i.e., crash-safe across a service restart).
- **FR-004**: `recipient.kind` MUST be one of `"user"`, `"group"`, `"global"`. `user` and `group` MUST carry an `id`; `global` MUST NOT carry an `id`.
- **FR-005**: The system MUST deliver messages addressed to `recipient.kind = "user"` only to the authenticated identity matching `recipient.id`.
- **FR-006**: The system MUST deliver messages addressed to `recipient.kind = "group"` to every authenticated identity that is a member of `recipient.id` at delivery time.
- **FR-007**: The system MUST deliver messages addressed to `recipient.kind = "global"` to every authenticated subscriber currently in scope of the application.
- **FR-008**: The system MUST guarantee per-recipient FIFO ordering for `recipient.kind ∈ { "user", "group" }`. Cross-recipient and cross-producer ordering MUST NOT be guaranteed.
- **FR-009**: The system MUST treat global broadcast ordering as best-effort. The product contract MUST NOT promise FIFO across global broadcasts.
- **FR-010**: The system MUST expose a subscription API under `/api/v1/notifications/subscribe` (or transport-equivalent under the same path prefix) that requires authentication. Recipient identity MUST be derived from the authenticated session, not from client-supplied claims.
- **FR-011**: The system MUST tolerate unknown `messageType` values on the client side: clients MUST log and ignore them rather than crash.
- **FR-012**: The system MUST retain undelivered messages addressed to `user` and `group` recipients for a defined retention window so that a reconnecting client can catch up. Default retention window value is an open implementation parameter (Q-003) but MUST be ≥ 24 hours.
- **FR-013**: The system MUST emit operational counters for: per-producer publish count, per-recipient-kind delivered count, undelivered-after-retention count, active subscriber gauge, and per-`messageType` publish count.
- **FR-014**: The system MUST emit a separate operational counter for global broadcast publishes, distinguishable from `user` and `group` publishes.
- **FR-015**: The system MUST validate the publish envelope schema **before** durable storage and reject malformed envelopes with a structured error.
- **FR-016**: The system MUST maintain a version-controlled registry of `messageType` keywords. Registered keywords succeed without flag; unregistered keywords increment a separate "unregistered messageType" counter.
- **FR-017**: The system MUST support an enforcement mode in which unregistered `messageType` publishes are rejected with a structured error. Enforcement state MUST be configurable per environment.
- **FR-018**: The system MUST support an optional `idempotencyKey` on the publish envelope. Duplicate publishes from the same producer with the same key inside a configured dedup window MUST collapse to one delivery per recipient.
- **FR-019**: The system MUST support per-producer publish quotas. Publishes exceeding the configured quota MUST be rejected with a structured rate-limit error and counted in a per-producer throttled-publish counter. 🟠 **OPEN-014-C — the quota has no unit.** See [Open Questions](#open-questions-owner-resolution-required).
- **FR-020**: The system MUST NOT deliver any message to an unauthenticated client.
- **FR-021**: The system MUST NOT permit a subscriber to receive messages addressed to a user identity other than the subscriber's authenticated identity.
- **FR-022**: The system MUST resolve group membership at delivery time, not at publish time.
- **FR-023**: The system MUST treat `payload` as opaque and MUST NOT validate, inspect, or transform it beyond size limits.

**Dual ingress — EventBridge and HTTP (added 2026-08-10, owner decision)**

Producers reach this service by **two paths**, because the platform's async features already emit domain
events and must not be forced to grow a second synchronous notification call inside a database transaction.
The paths differ only in how a request arrives.

- **FR-024** _(one core, two adapters)_: The system MUST accept publishes over BOTH the authenticated HTTP
  endpoint (FR-001) and an EventBridge subscription, and BOTH MUST execute the **same** validation, registry
  check, producer authorization, idempotency, durability and routing logic. A rule enforced in only one
  adapter is a defect: the ingress mechanism is an adapter over a single core, and adapters hold no business
  logic.
- **FR-025** _(envelopes, never domain events)_: The EventBridge path MUST ingest **notification envelopes
  only**, on a `detailType` reserved by this service. It MUST NOT subscribe to producers' domain events. A
  domain event carries no recipient, and deriving one would require inspecting `payload` (forbidden by
  FR-023) or calling back into the producer — reintroducing the coupling this path exists to remove.
- **FR-026** _(minimum envelope — normative wire contract)_: Every envelope, on either path, MUST carry
  `schemaVersion` (integer), `recipient` (FR-004), `messageType`, `occurredAt` (ISO-8601, producer-assigned),
  and `payload`. Two further fields are REQUIRED on the EventBridge path and optional on HTTP:
  `idempotencyKey`, because EventBridge delivery is at-least-once and redelivery would otherwise duplicate a
  user-visible notification; and `producer`, because that path has no bearer token to derive identity from
  (FR-027). An envelope missing any required field MUST be rejected — never partially routed, never defaulted.
  🟠 **OPEN-014-A — this contradicts FR-027 on producer identity.** See
  [Open Questions](#open-questions-owner-resolution-required).
- **FR-027** _(event-path authorization — the trust boundary)_: The HTTP path derives producer identity from
  an authenticated credential (FR-002). The EventBridge path has **no credential**, so its trust boundary MUST
  be (a) an EventBridge resource policy restricting which principals may put events on the notification bus,
  AND (b) validation of the event's `source` against an allowlist of registered producers. Both are required:
  without them the event path is an unauthenticated publish channel through which any principal with bus
  access could address a notification to any user, defeating FR-005, FR-020 and FR-021.
  🟠 **OPEN-014-A — this contradicts FR-026 on producer identity.** See
  [Open Questions](#open-questions-owner-resolution-required).
- **FR-028** _(event-path failure handling)_: An envelope rejected on the EventBridge path — malformed
  (FR-015), unregistered under enforcement (FR-017), quota-exceeded (FR-019), or failing FR-027 — MUST be
  dead-lettered and counted. There is no caller to receive a structured error, so a rejection that is merely
  dropped is indistinguishable from successful delivery. DLQ depth MUST be observable and alarmed.
- **FR-029** _(ordering key across both paths)_: Per-recipient FIFO (FR-008) is delivered by the SQS FIFO
  ingest queue keyed on `MessageGroupId = recipient.id`. That mechanism preserves the order envelopes are
  **enqueued** in, which equals publish order only on the HTTP path. EventBridge does not preserve ordering,
  so envelopes arriving that way MUST be ordered by the producer-assigned `occurredAt`, with a deterministic
  tiebreaker, before or as they are enqueued — otherwise the FIFO queue faithfully preserves an arrival order
  that is not publish order. If cross-path FIFO for one recipient cannot be guaranteed, FR-008 MUST be
  narrowed to say so explicitly rather than left to imply a guarantee the transport does not provide.
- **FR-030** _(idempotency key derivation)_: An `idempotencyKey` MUST be derived from durable domain state
  (e.g. a job identity plus terminal status) so it is **stable across producer retries**. A key derived from a
  transport identifier or a clock changes on retry and provides no deduplication.

**Fan-in ownership (added 2026-08-10)**

- **FR-031** _(publishers own correlation; this service does not aggregate)_: This service MUST NOT aggregate,
  batch, correlate or collapse envelopes — FR-023 forbids the payload inspection that would require, and
  "user-meaningful outcome" is knowledge only the publisher has. A publisher whose work fans out into many
  independent completions MUST correlate its own fan-out and publish **one** envelope per outcome. One
  envelope per underlying completion is a **publisher** defect, not a gap in this service.

**Producer authentication, named (added 2026-08-10)**

- **FR-032** _(concrete mechanism)_: FR-002's "mechanism aligned with feature 002" MUST resolve to the
  platform's **Ed25519 service-principal token**, verified **networklessly** against a public key (the scheme
  already deployed as `FOOD_SERVICE_PRINCIPAL_JWT_KEY`). Verification MUST perform no outbound network call,
  so any mechanism requiring a third-party API round trip per publish is disqualified.
- **FR-033** _(quota is declared, not inferred)_: The per-producer quota of FR-019 MUST be **configurable per
  registered producer**, and the value MUST be declared by that producer at registration. This service MUST
  NOT infer a bound from a producer's internals. A quota rejection MUST be alarmed rather than silent.
  🟠 **OPEN-014-C — "the value" has no unit, so a producer cannot declare one.** See
  [Open Questions](#open-questions-owner-resolution-required).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001 (Reliability)**: The publish API MUST achieve ≥ 99.9% availability (aligned with feature 003's API tier).
- **NFR-002 (Durability)**: An accepted publish MUST survive a single service-instance crash.
- **NFR-003 (Latency)**: For a connected subscriber, end-to-end publish-to-delivery latency at the 95th percentile MUST be ≤ 2 seconds under nominal load.
- **NFR-004 (Security)**: Producer authentication MUST use the shared service-to-service mechanism (alignment with 002). Subscriber authentication MUST use the user-facing auth mechanism owned by 002.
- **NFR-005 (Observability)**: Every accepted publish and every delivered message MUST be observable via structured logs and counters; counters MUST be queryable by an operator within 1 minute of the event.
- **NFR-006 (Backpressure)**: A misbehaving producer MUST NOT degrade delivery latency for unrelated producers' messages by more than 10% (basis for FR-019 quotas).
- **NFR-007 (Runtime)**: The service MUST run on Node 24.x (per monorepo `.nvmrc` and root `package.json` engines), consistent with the rest of the monorepo.
- **NFR-008 (Package naming)**: Any new packages introduced for this service MUST follow the `@kitchensink/{group}-{name}` convention.

### Key Entities

- **PublishEnvelope**: Producer-supplied input. Fields: `schemaVersion`, `recipient`, `messageType`, `payload`, `occurredAt`, plus `idempotencyKey` and `producer` — both REQUIRED on the EventBridge path, optional on HTTP. `payload` is opaque. **FR-026 is the normative field set**; this entry previously listed the pre-amendment fields and omitted `schemaVersion` and `producer` entirely. FR-001's inline shape carries the same omission and is superseded by FR-026 on both paths.
- **RecipientDescriptor**: `{ kind: "user" | "group" | "global", id?: string }`. `id` required for `user` / `group`; absent for `global`.
- **DeliveryEnvelope**: Service-output to clients. Fields: service-assigned `id`, `messageType`, `payload`, `occurredAt`, `publishedAt`. The service-assigned `id` MUST be unique and MAY encode per-recipient ordering (e.g., monotonically increasing per recipient).
- **MessageTypeRegistryEntry**: `{ messageType: string, ownerFeature: string, description: string, registeredAt: ISO-8601 }`. Lives in version control.
- **Subscriber**: An authenticated session for a single user identity. A user MAY have multiple concurrent Subscribers (multi-device, multi-tab).
- **GroupMembership**: Resolution-time mapping from `groupId` → set of user identities. Source-of-truth ownership of group membership is **out of scope** for this feature (Q-002).

## Wire Contract Ownership (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). This section applies an
existing portfolio rule to 014's contracts; it introduces **no new requirement** and mints no FR (GR-003).

**014 is the highest-stakes contract in the portfolio, because its envelope is universal.** Every producer
feature (001, 003, 004, 005, 008, 009, 013) and every client (`@commise/web`, `@commise/mobile`) touches the
same `PublishEnvelope` and `DeliveryEnvelope`. If those shapes have more than one author, they will drift in
more than one direction at once, and every consumer's `typecheck` will report agreement between
representations that were never compared. That is the failure GR-015 exists to make structurally impossible.

| Role                                    | Binding for 014                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)    | the notification service — `src/**/*.schema.ts`, beside the controller / ingress adapter it serves                                      |
| Schema package (generated, committed)   | `@kitchensink/schema-notifications` — `packages/schemas/notifications`                                                                  |
| Consuming client                        | `packages/clients/notifications`                                                                                                        |
| Consuming apps                          | `@commise/web`, `@commise/mobile` (subscribe + dispatch by `messageType`)                                                               |
| Consuming **producers**                 | every producer feature, on **both** ingress paths — they import the envelope, they do not re-declare it                                 |
| Also in scope (groups, added under 014) | `/api/v1/groups/*` lands in `@kitchensink/identity-service` (A-002), so those shapes belong to **identity's** schema package, not 014's |

### The service's obligation

- **The envelope is authored ONCE, as zod, in the notification service** at `src/**/*.schema.ts` — the
  `PublishEnvelope` (FR-026's normative field set), the `RecipientDescriptor` (FR-004), the `DeliveryEnvelope`,
  and the `MessageTypeRegistryEntry`.
- **That same zod is what performs FR-015's pre-durability validation**, via `nestjs-zod`'s `createZodDto` on
  the HTTP path. There is no second DTO that "agrees with" the schema by convention — FR-015 and the published
  contract are the same artifact, so a producer cannot be surprised by a rule it could not see.
- **FR-024's "one core, two adapters" makes this stricter, not looser: ONE zod validates BOTH paths.** The
  HTTP adapter and the EventBridge adapter both call the same schema. A separate schema per adapter is the
  literal mechanism by which "a rule enforced in only one adapter" (an FR-024 defect) happens, so the shared
  zod is how FR-024 is _made true_ rather than merely asserted.
- **`payload` stays opaque in the schema, and that is a requirement of the schema, not an omission.** FR-023
  forbids inspecting, validating or transforming it beyond size limits, so the envelope's zod models `payload`
  as unknown/opaque with a size bound only. A schema that grew per-`messageType` payload validation would put
  014 in violation of its own FR-023 — do not "improve" it that way.
- `@kitchensink/schema-notifications` is **generated and committed** — the zod, `z.infer` types,
  `contract-hash.ts`, a barrel, and a **derived** `openapi.yaml` (for `oasdiff`, docs and integrators;
  **never a codegen input**). Nothing in it is hand-edited.
- Every `*.schema.ts` imports **only `zod` and other `*.schema.ts` files** — no SQS/EventBridge SDK type, no
  Drizzle schema, no Nest symbol. This matters more here than anywhere else: the envelope schema is imported by
  **web and mobile**, so one AWS-SDK import in it would drag the server graph into both apps.

### The CLIENT's obligation — separately mandatory, and here "client" means producers too

Mandating only the service half is exactly how the client half got skipped portfolio-wide (276 + 144 lines of
redeclared wire types survived behind green builds). For 014 there are **two** classes of consumer:

- **Subscribers** (`@commise/web`, `@commise/mobile`, `packages/clients/notifications`) import the
  `DeliveryEnvelope` **type and zod** from `@kitchensink/schema-notifications` and **declare no envelope shape
  of their own** — including in feature packages (GR-015 §15-b.4). US-004's dispatch-by-`messageType` handler
  map is keyed off the imported type; a hand-written "notification" interface in the web app and another in the
  mobile app is two independent beliefs about one contract on two platforms that ship on different schedules.
- **Producers** are clients of this service and are bound identically. A producer feature **imports the
  `PublishEnvelope` and its zod** and **does not declare its own publish body** — on **either** ingress path.
  A producer that hand-writes the envelope to put an event on the bus is the same violation as a client that
  hand-writes a response type; it is worse only in that the failure surfaces as a dead-lettered envelope
  (FR-028) rather than a type error.
- **A producer's `payload` is the producer's own contract, not 014's.** Per the 2026-05-10 clarification, this
  service does not own the meaning of any `messageType`. So a producer's payload type lives in **that
  producer's** schema package and is referenced by the producer's own docs — never added to
  `@kitchensink/schema-notifications`, which would make 014 the author of knowledge it explicitly disclaims.
- Any divergent consumer shape (an in-app notification-list row model, a toast view model) is **DERIVED** from
  the `DeliveryEnvelope` with `Pick` / `Omit` / `Partial` — never independently declared. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **A new endpoint or a new envelope field is not complete until it is reachable from
  `@kitchensink/schema-notifications`.** "The mobile client will add the field" is a contract fork, not a task.

### Drift gates — inherited from GR-015 §15-c, all three required

Turbo `inputs`-driven rebuild; a **regenerate-and-diff CI gate**; and a `CONTRACT_HASH` **boot assertion**.

⚠️ **The `CONTRACT_HASH` gate and `schemaVersion` (FR-026) are different mechanisms and neither replaces the
other.** `CONTRACT_HASH` is a **build-time fingerprint** that fails a _service boot_ when a deployed service
and a pinned schema package disagree. `schemaVersion` is a **runtime field on the wire** that lets a _receiver_
handle an envelope minted by a different version. 014 needs both, precisely because a released **mobile
binary** cannot be updated in step with a backend deploy — which is the exact case §15-c cites as invisible to
the turbo and CI layers.

⚠️ **`oasdiff` sees only the HTTP path.** The EventBridge ingress exposes no URL (as _Governance Alignment_ in
`plan.md` already notes for GR-002), so a breaking change to the envelope on the bus is invisible to an
OpenAPI-diff gate. The regenerate-and-diff gate over the authored zod is what covers it — which is another
reason the two adapters must share one schema.

### ⚠️ Third-party APIs — the opposite case, do NOT converge them (GR-015 §15-d)

- **AWS EventBridge and SQS are transport, not a contract we author.** The **envelope inside** a bus event is
  ours (above). The **EventBridge event wrapper** — `source`, `detail-type`, `detail`, `account`, `resources` —
  is **AWS's** shape and MUST be **validated at the boundary** in the ingress adapter before `detail` is treated
  as an envelope. It is not put in our schema package as though we owned it. This boundary parse is
  security-relevant, not cosmetic: FR-027 makes the validated `source` a **trust decision**, so the code that
  reads `source` must first prove the wrapper is the shape it claims to be.
- **A-005's future email / mobile-push transports** (SES, APNs, FCM, Expo push) are out of scope for this
  release. When they arrive they are **third-party**: their clients **validate the raw upstream shape at the
  boundary with zod**, **may declare their own types**, and **get no OpenAPI document**. Their response shapes
  do not enter `@kitchensink/schema-notifications`.
- **Clerk** remains third-party for subscriber authentication (see 002).
- `packages/clients/usda` is the reference implementation and its `schemas.ts` must never be "converged".
  Deleting a boundary schema in the name of §15-b replaces a checked parse with unchecked trust in a remote
  party's JSON — a security regression, not a cleanup.

🟠 **OPEN — where does the `messageType` registry (FR-016) live?** It must be version-controlled (FR-016) and is
read by the service for the registry check, by producers to register a keyword, and arguably by clients for
dispatch. `@kitchensink/schema-notifications` is the obvious candidate, but that package is **generated and
never hand-edited**, while a registry entry is **authored by a producer feature** — so putting it there
requires deciding whether registry entries are authored in the notification service (like the zod, and copied
out) or in a separate hand-maintained artifact that the schema package re-exports. **Question for the owner:
which?** Neither §15 nor an existing ADR decides it, and the answer changes how a producer onboards.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A publish reaches a subscribed client end-to-end, over BOTH ingress paths, with the client dispatching by `messageType`. Verified in CI against a **synthetic reference producer owned by this feature** — not against another feature's pipeline, so this criterion never waits on a consumer's schedule. (Amended 2026-08-10: previously required feature 003 specifically, and cited `US-005` / `FR-NOTIF` requirements that do not exist in 003. Note this removes the _consumer_ coupling only — this feature still has an upstream dependency it builds itself, the identity groups model of T-023..T-025, so it is not shippable ahead of that.)
- **SC-002**: Per-recipient FIFO is observed in tests: 100 messages addressed to one user are delivered in publish order to a connected client (zero out-of-order deliveries across 10 test runs).
- **SC-003**: Catch-up window works: a client offline for ≤ retention window receives 100% of messages addressed to it during the offline interval; 0% redelivery beyond the window.
- **SC-004**: Operational counters reflect ground truth: synthetic load of K publishes results in counters reading ≥ K within 1 minute (NFR-005).
- **SC-005**: Subscription identity binding is verified: 100% of attempted cross-user subscriptions are rejected (US-007).
- **SC-006**: At least 5 distinct `messageType` keywords are registered in the central registry by launch, covering the launch consumer feature (003) plus reserved namespaces for 001 / 005 / 008 / 009.
- **SC-007**: WA-004 in `specs/cross-feature-consistency-report.md` is closed, with a citation to this feature as the owner of cross-feature notification delivery.
- **SC-008**: Both ingress paths are proven equivalent: the same envelope published over HTTP and over EventBridge produces an identical delivered message, and a rule violated on one path is rejected identically on the other. Verified by a paired test per rule (FR-024).
- **SC-009**: The event path rejects spoofing: 100% of envelopes whose `source` is not an allowlisted producer are rejected and dead-lettered, and none is ever delivered (FR-027, FR-028).
- **SC-010**: The no-aggregation contract is observable: N envelopes published for one recipient arrive as N deliveries, and this service never merges them (FR-031).
- **SC-011**: An EventBridge envelope redelivered by the transport is delivered exactly once, proven by replaying the same event with an unchanged `idempotencyKey` (FR-026, FR-030). 🟠 **OPEN-014-B — "exactly once" is a stronger claim than this feature's own transport and US-010 allow.** See [Open Questions](#open-questions-owner-resolution-required).

## Open Questions (owner resolution required)

These three are **genuinely open**: each is an internal contradiction or a missing value in this spec, and
**none is derivable** from `docs/CODING_STANDARDS.md` §15, GR-015, or any existing ADR. They are recorded here
rather than resolved, because resolving them would be inventing a requirement. **No ruling has been made on any
of them.** All three bear directly on the wire contract, so they should be settled before
`@kitchensink/schema-notifications` is generated — the envelope's zod cannot express a field whose authority or
unit is undecided.

### OPEN-014-A — FR-026 and FR-027 contradict each other on producer identity

**The conflict.** FR-026 makes `producer` a **REQUIRED envelope field** on the EventBridge path, justified as
"that path has no bearer token to derive identity from (FR-027)". FR-027 says the event path's trust boundary
**is** (a) the bus resource policy and (b) **validation of the event's `source` against an allowlist of
registered producers**. So the same request carries **two** producer identities: one **self-asserted inside the
envelope** (`producer`) and one **transport-asserted outside it** (`source`) — and FR-026's stated rationale is
contradicted by FR-027, which does derive identity without a bearer token.

**Why it cannot be deferred to implementation.** `plan.md`'s _Producer ingress_ table says event-path producer
identity comes from "validated event `source` + bus resource policy", while its envelope block keeps `producer`
REQUIRED. Downstream behaviour hangs on which one wins: the FR-016/FR-017 registry lookup, the FR-019/FR-033
quota accounting, and the FR-013 per-producer publish counter each need exactly one authoritative producer id.
If `producer` is authoritative, a principal with bus access can attribute its publishes to another producer and
spend that producer's quota. If `source` is authoritative, `producer` is redundant self-assertion.

**Questions for the owner:**

1. Which field is **authoritative** for the registry check, quota accounting, and the per-producer counter —
   `source`, or the envelope's `producer`?
2. What happens when they **disagree**? Reject and dead-letter (FR-028), or accept and ignore the envelope
   field?
3. If `source` is authoritative, should `producer` be **dropped** from the required set on the EventBridge path
   (which would amend FR-026), or retained as advisory metadata that MUST NOT be trusted?

### OPEN-014-B — SC-011 claims "delivered exactly once", which is stronger than the transport allows

**The conflict.** SC-011 says a redelivered EventBridge envelope is "delivered **exactly once**". This
feature's own artifacts say otherwise, in three places:

- **US-010** states plainly: _"Strong 'exactly-once' semantics are **not** promised by the chosen ordering
  model"_, and _"Consumers MUST still treat handlers as idempotent (handlers may run more than once across
  reconnects in degenerate cases)"_ — and calls `idempotencyKey` "a producer-side affordance to deduplicate
  retries, **not** an 'exactly-once' guarantee".
- **FR-018** is scoped to a **window**: duplicates collapse to one delivery "inside a configured dedup window",
  and US-010's own acceptance scenario 2 says the same key **after** the window **delivers twice**.
- **FR-026** justifies requiring `idempotencyKey` precisely because "EventBridge delivery is **at-least-once**".

An at-least-once transport plus a bounded dedup window yields **effectively-once within the window**, not
exactly-once. As written, SC-011 is a success criterion that the design cannot satisfy in general — and it is
the kind of claim a consumer will build on.

**Questions for the owner:**

1. Should SC-011 be **narrowed** to what FR-018 actually provides — e.g. "at most one delivery per
   `(producer, idempotencyKey)` **within the configured dedup window**, and never zero" — leaving US-010's
   at-least-once/idempotent-handler contract intact?
2. Or is exactly-once genuinely being promised, and if so **on what mechanism**, and what does that make of
   US-010 and of FR-018's window?
3. Either way: what does the **client-facing** contract say? US-010 currently obliges consumers to write
   idempotent handlers, which is incompatible with advertising exactly-once.

### OPEN-014-C — FR-019 / FR-033 specify a quota with no unit

**The gap.** FR-019 requires "per-producer publish quotas" and FR-033 requires the value to be "declared by
that producer at registration" — but **neither states a unit or a window**. The only unit anywhere in the spec
is in **US-011**'s narrative ("a publish quota of K/sec"), and a user story is not the normative requirement.
FR-033 therefore asks a producer to declare a value it has no defined dimension for, and the envelope/registry
contract cannot type it.

**Questions for the owner:**

1. What is the **unit and window** — publishes per second, per minute, per hour? A **token bucket** with a
   sustained rate plus a burst allowance (which is what NFR-006's "must not degrade unrelated producers by more
   than 10%" implies) or a fixed window?
2. Is the quota **global per producer**, or per producer **per `recipient.kind`** (a `global` broadcast fans out
   far wider than a `user`-addressed publish, so one unit may not bound both meaningfully)?
3. Does the **registration** value carry its own unit, or is the unit **fixed by the service** and the producer
   declares only a magnitude?
4. Does the quota apply **per ingress path or across both**? FR-024 says both adapters run the same rules, which
   implies one shared budget — worth confirming, since a producer using both paths could otherwise get double.

## Assumptions

- **A-001**: Subscriber transport choice (WebSocket push, client-pull, webhook, or hybrid) is deferred to `plan.md`. The product contract is mechanism-agnostic.
- **A-002** _(resolved 2026-08-05 — supersedes the original assumption)_: Group
  membership source-of-truth is the **identity service**, and this feature builds it
  there. A `group` / `group_membership` model plus `/api/v1/groups/*` is added to
  `packages/services/identity` under 014; the notification service resolves membership
  against that API at delivery time (FR-022). Groups are deliberately **not** mapped
  onto Clerk Organizations. Design in `plan.md` → _Group Model (identity service)_;
  tasks T-023 – T-025.

    The original assumption read: _"not owned by this feature … until then, group
    routing relies on a placeholder lookup defined in `plan.md`."_ No such placeholder
    was ever defined, and the task graph silently assumed a "002 group membership API"
    that does not exist (sync-report DRIFT-003).

- **A-003**: Producer authentication mechanism is aligned with feature 002 service-to-service auth. Concrete mechanism (signed JWT, IAM, or per-feature key) is decided in `plan.md`.
- **A-004**: At launch the registry of `messageType` keywords is **non-enforcing**; enforcement is enabled per-environment after the first ~quarter of production data exposes any unintended unregistered traffic.
- **A-005**: Email and mobile-push transports are out of scope for this release. A future feature may extend the service to fan out to those transports without changing the publish contract.
- **A-006**: Read/delivery receipts back to producers are out of scope. Producers observe success/failure of _publish_, not of _delivery_.
- **A-007**: A long-term inbox UI (notification history beyond the catch-up window) is out of scope for this release.
- **A-008**: All API paths owned by this feature live under `/api/v1/notifications/*`.
