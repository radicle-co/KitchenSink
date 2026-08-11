# Feature Specification: Notification Service

**Feature Branch**: `014-notification-service`
**Created**: 2026-05-10
**Status**: Draft
**Input**: User description: "A generic in-app notification service that owns publish/receive routing across all KitchenSink features. Producers publish messages addressed to a single user, a group, or globally; clients receive matching messages and dispatch behavior by `messageType` keyword. Transport (push/pull/webhook/hybrid) is an implementation choice."

## Dependencies

| Spec                                                        | Relationship                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required + extended** — Subscriber authentication and authenticated identity for recipient resolution use the shared auth mechanism owned by 002. 002 is shipped; this feature additionally **adds a group model to the identity service** (see A-002), so the groups API is new surface delivered under 014, not a dependency to wait on. |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Downstream (launch consumer)** — 003 US-005 / FR-NOTIF publishes `food.backfill.completed` and `food.fetch.failed` through this service.                                                                                                                                                                                                   |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Downstream** — recipe lifecycle notifications owned by 001 contract updates will be published through this service.                                                                                                                                                                                                                        |
| [005-ai-integration](../005-ai-integration/spec.md)         | **Downstream** — AI-generated content disclosure events owned by 005 contract updates will use this service.                                                                                                                                                                                                                                 |
| [008-cooking-mode](../008-cooking-mode/spec.md)             | **Downstream** — timer alert events owned by 008 contract updates will use this service.                                                                                                                                                                                                                                                     |
| [009-nutrition-planning](../009-nutrition-planning/spec.md) | **Downstream** — compliance-gap events owned by 009 contract updates will use this service.                                                                                                                                                                                                                                                  |

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
- **FR-019**: The system MUST support per-producer publish quotas. Publishes exceeding the configured quota MUST be rejected with a structured rate-limit error and counted in a per-producer throttled-publish counter.
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
- **FR-027** _(event-path authorization — the trust boundary)_: The HTTP path derives producer identity from
  an authenticated credential (FR-002). The EventBridge path has **no credential**, so its trust boundary MUST
  be (a) an EventBridge resource policy restricting which principals may put events on the notification bus,
  AND (b) validation of the event's `source` against an allowlist of registered producers. Both are required:
  without them the event path is an unauthenticated publish channel through which any principal with bus
  access could address a notification to any user, defeating FR-005, FR-020 and FR-021.
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

- **PublishEnvelope**: Producer-supplied input. Fields: `recipient`, `messageType`, `payload`, `occurredAt`, optional `idempotencyKey`. `payload` is opaque.
- **RecipientDescriptor**: `{ kind: "user" | "group" | "global", id?: string }`. `id` required for `user` / `group`; absent for `global`.
- **DeliveryEnvelope**: Service-output to clients. Fields: service-assigned `id`, `messageType`, `payload`, `occurredAt`, `publishedAt`. The service-assigned `id` MUST be unique and MAY encode per-recipient ordering (e.g., monotonically increasing per recipient).
- **MessageTypeRegistryEntry**: `{ messageType: string, ownerFeature: string, description: string, registeredAt: ISO-8601 }`. Lives in version control.
- **Subscriber**: An authenticated session for a single user identity. A user MAY have multiple concurrent Subscribers (multi-device, multi-tab).
- **GroupMembership**: Resolution-time mapping from `groupId` → set of user identities. Source-of-truth ownership of group membership is **out of scope** for this feature (Q-002).

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
- **SC-011**: An EventBridge envelope redelivered by the transport is delivered exactly once, proven by replaying the same event with an unchanged `idempotencyKey` (FR-026, FR-030).

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
