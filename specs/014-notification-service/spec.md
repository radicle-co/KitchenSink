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

### Session 2026-08-12 — retention, deduplication and producer identity (owner rulings)

These rulings **close** the three items previously recorded under _Open Questions_ and one further open item
in _Wire Contract Ownership_. Design reasoning and the rejected alternatives are in
[ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md);
this section records **what** was decided, and the FRs below make it normative.

- Q: How long is a notification retained, and what ends the retention? → A (verbatim): **"Keep the
  notification until the client indicates that it has been consumed or three days have passed."** So
  retention is `ack OR 72h, whichever first`, replacing the previous 24-hour clock (FR-012, FR-034 – FR-036).
- Q: What is the deduplication identity? → A (verbatim): **"Dedup messages based on payload so we don't have
  messages with identical payload waiting to be consumed."** Dedup is on a **canonical hash of the payload**
  (plus the fields that make it routable), and it applies **only while a notification is waiting to be
  consumed** — a payload re-sent after its predecessor was consumed is a **new** notification (FR-037,
  FR-038).
- Q: What store holds retained notifications? → A (verbatim): **"use redis"** — implemented as **ElastiCache
  Serverless for Valkey** (Redis-compatible, 100 MB metered floor, ≈ $6.13/mo idle). ⛔ The **durability
  caveat is accepted knowingly**: ElastiCache is not durable by default in either flavour, so a node
  replacement can drop retained notifications, and DynamoDB-with-TTL was flagged as both durable and cheaper
  for this shape before Redis was chosen. Recorded as a residual risk with mitigations and an escalation path
  in FR-040 and in ADR-0016 → _Durability_.
- Q (OPEN-014-A): Which producer identity is authoritative — the transport signal or the envelope's
  `producer`? → A: **BOTH are required and a mismatch is a rejection.** `producer` stays REQUIRED, on **both**
  ingress paths, and the transport signal (the HTTP token principal, or the EventBridge `source`) must resolve
  through the **producer registry** to the same name (FR-041, FR-026 amended).
- Q: Where does the registry live? → A: **authored in the notification service** as version-controlled data
  beside its zod, and **copied into the schema package by the same generator**. It is not a database table,
  and it is not assembled from the producers it constrains (FR-041).
- Q (OPEN-014-B): Is delivery exactly-once? → A: **No.** The contract is **at most one notification per
  `(producer, idempotencyKey)` within the claim window, and never zero** — effectively-once. SC-011 is
  narrowed accordingly; US-010's idempotent-handler obligation stands and is now load-bearing (FR-039).
- Q (OPEN-014-C): What is the quota's unit? → A: **A token bucket with a service-FIXED unit** — a sustained
  rate in publishes/second plus a burst allowance in publishes. The producer declares magnitudes only, one
  budget spans both ingress paths, and `global` broadcasts carry a separate service-owned bound (FR-044,
  FR-033 amended).
- Q: How is an invalid publish handled? → A: **Invalid payloads are not retried.** A signature failure and a
  shape failure are **equally invalid** and take **ONE rejection path** carrying the cause as a `reason`
  field, and a rejected event is **not recorded as a row** (FR-042).
- Q: May an identifier ever be a sentinel such as `'unknown'`? → A: **Never.** An id is REQUIRED except on
  create/upsert, where it is generated if absent (FR-043).

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

### User Story 12 — The Client Acknowledges Consumption, and Retention Ends (Priority: P1)

A client receives a notification, runs its `messageType` handler to completion, and **acknowledges** it. The
notification stops being pending: it is not delivered again on the next reconnect, and it does not wait out
the retention window. A notification that is **never** acknowledged stays pending — redelivered on every
reconnect — until **72 hours** after it was published, at which point it is dropped and counted.

**Why this priority**: Without an acknowledgement the service cannot tell "delivered" from "consumed", so
either it drops notifications the user never saw (the 24-hour-clock behaviour this replaces) or it redelivers
them forever. The owner's directive makes consumption the primary end of retention, so this is P1 with
US-001, not an enhancement to it.

**Independent Test**: Publish two notifications to user U. Deliver both. Ack **one**. Reconnect: verify only
the un-acked one is redelivered. Ack it twice in a row: verify both calls succeed. Advance a notification's
clock past 72 h without an ack: verify it is not redelivered and the undelivered-after-retention counter moved.

**Acceptance Scenarios**:

1. **Given** notification N delivered to user U, **When** U's client acks N and then reconnects, **Then** N is
   **not** redelivered.
2. **Given** N delivered but **not** acked, **When** U's client reconnects, **Then** N **is** redelivered, in
   `sequence` order relative to other pending notifications.
3. **Given** U's client acks N **twice** (a retried ack after a dropped response), **Then** both calls succeed;
   the second reports N as already settled and is **not** an error.
4. **Given** an ack naming an id that does not exist, has expired, or belongs to **another** user, **Then** the
   call succeeds and reports that id as already settled — it never reveals whether the id exists.
5. **Given** N is unacked at `publishedAt + 72h`, **Then** N is dropped, the undelivered-after-retention
   counter increments **before** the drop, and N is never redelivered.
6. **Given** U acks N on mobile, **When** U later opens a web client, **Then** N is **not** delivered there.
   (Ack is per **user**, not per device — an accepted consequence, not a defect.)

---

### User Story 13 — Two Identical Pending Payloads Collapse to One (Priority: P1)

A producer publishes an envelope; before the recipient has consumed it, the producer publishes the **same
payload** to the **same recipient** again — a retry, a duplicated bus delivery, or a re-run of the job that
produced it. The recipient sees **one** notification, not two. Once the first has been consumed, the same
payload published again is a **new** notification and is delivered.

**Why this priority**: Duplicate-suppression that depends on the producer having derived a correct
`idempotencyKey` (US-010) is a guarantee outsourced to the least-supervised party, and a producer that derives
its key from a clock deduplicates nothing while looking correct. Payload identity is derived by this service
from what it was actually sent, so it holds regardless of producer discipline.

**Independent Test**: Publish the same envelope twice, back to back, with **no** `idempotencyKey`. Verify the
recipient observes one notification and the second publish returns the **first** notification's id with a
deduplicated marker. Verify the first notification's expiry did **not** move. Then ack it, publish the same
payload a third time, and verify a **new** notification is delivered.

**Acceptance Scenarios**:

1. **Given** envelope E published to recipient R and still pending, **When** the identical payload is
   published to R again, **Then** the recipient observes **one** notification and the second publish succeeds,
   returning the original's id marked as deduplicated.
2. **Given** the two publishes differ **only** in key order inside `payload` (`{"a":1,"b":2}` vs
   `{"b":2,"a":1}`), **Then** they are treated as identical and collapse.
3. **Given** the two publishes differ in any payload value, in `messageType`, in `producer`, or in the
   recipient, **Then** they are **two** notifications.
4. **Given** a duplicate is dropped, **Then** the original's `expiresAt`, `sequence` and delivery state are
   **unchanged** — a duplicate can never extend the original's retention.
5. **Given** E has been **acked**, **When** the identical payload is published again, **Then** it is a **new**
   notification and is delivered.
6. **Given** the same payload is published to two **different** recipients, **Then** both recipients receive
   it — dedup is per recipient.

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
- **A notification no client can consume ("poison")**: A payload whose handler throws is never acked, so it is redelivered on every reconnect for the full 72 hours. This is **counted and alarmed** on the per-notification delivery-attempt count, not capped — dropping it early would discard a notification the service promised to keep, and the retention clock is already the backstop (FR-039).
- **A group notification acked by one member**: The ack settles it for **that member only**. Each member has their own pending entry over one stored envelope, so member A's ack has no effect on member B (FR-035).
- **A payload containing a number that does not survive an IEEE-754 round trip** (e.g. `10000000000000001`): rejected at ingress with a `reason` naming the offending path, because canonicalizing it would make two **different** payloads hash identically and silently collapse them (FR-037).
- **The retained-notification store loses data**: A cache failover or node replacement can drop pending notifications the producer was already told were accepted, and producers keep no copy (FR-031). This is a **known residual risk** with mitigations and an escalation path, not an edge case with a code fix — see FR-040 and ADR-0016 → _Durability_.
- **A publish arrives while its recipient's group has just been deleted**: unchanged from "recipient does not exist" — the publish succeeds at the boundary and the undeliverable counter increments; no exception reaches the producer.

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
- **FR-012** _(amended 2026-08-12 — owner ruling)_: The system MUST retain a message addressed to a `user` or `group` recipient **until the recipient's client acknowledges consumption (FR-034) OR 72 hours have elapsed since it was published, whichever happens first**. The clock is absolute and starts at publish acceptance. **Superseded**: this requirement previously specified "a defined retention window … MUST be ≥ 24 hours" with the value left open as Q-003; the value is now fixed at **72 hours** and the terminating condition is now **consumption**, not the clock alone. `global` recipients are **not** retained (FR-009 — live-only, best-effort).
- **FR-013**: The system MUST emit operational counters for: per-producer publish count, per-recipient-kind delivered count, undelivered-after-retention count, active subscriber gauge, and per-`messageType` publish count.
- **FR-014**: The system MUST emit a separate operational counter for global broadcast publishes, distinguishable from `user` and `group` publishes.
- **FR-015**: The system MUST validate the publish envelope schema **before** durable storage and reject malformed envelopes with a structured error.
- **FR-016**: The system MUST maintain a version-controlled registry of `messageType` keywords. Registered keywords succeed without flag; unregistered keywords increment a separate "unregistered messageType" counter.
- **FR-017**: The system MUST support an enforcement mode in which unregistered `messageType` publishes are rejected with a structured error. Enforcement state MUST be configurable per environment.
- **FR-018** _(clarified 2026-08-12)_: The system MUST support an optional `idempotencyKey` on the publish envelope. Duplicate publishes from the same producer with the same key inside a configured claim window MUST collapse to one notification per recipient. This is the **second** of two deduplication indexes and it is **not** the primary one — payload identity (FR-037) is always on and does not depend on a producer supplying a key. The `idempotencyKey` claim exists because it **outlives an acknowledgement**, which payload identity deliberately does not (FR-038).
- **FR-019** _(unit fixed 2026-08-12 — OPEN-014-C closed)_: The system MUST support per-producer publish quotas. Publishes exceeding the quota MUST be rejected with a structured rate-limit error and counted in a per-producer throttled-publish counter. The quota's **unit is a token bucket fixed by this service** — see FR-044.
- **FR-020**: The system MUST NOT deliver any message to an unauthenticated client.
- **FR-021**: The system MUST NOT permit a subscriber to receive messages addressed to a user identity other than the subscriber's authenticated identity.
- **FR-022**: The system MUST resolve group membership at delivery time, not at publish time.
- **FR-023** _(amended 2026-08-12 — narrowed so FR-037 is not a violation of it)_: The system MUST treat `payload` as **opaque as to MEANING and SCHEMA**: it MUST NOT interpret it, MUST NOT impose a per-`messageType` schema on it, and MUST NOT transform the value it stores or delivers. It MAY do exactly two things to it: **bound its size**, and **compute a canonical structural hash of it for deduplication** (FR-037). Hashing establishes no knowledge of meaning and imposes no schema, so it does not make this service the author of a producer's contract — which is what this requirement exists to prevent. Two consequences follow and are deliberate: the payload MUST be well-formed JSON, and a payload the service **cannot canonically serialize** (FR-037's number-representability rule) is rejected at ingress. **Superseded**: the previous wording — "MUST NOT validate, inspect, or transform it beyond size limits" — forbids the hash the owner's dedup ruling requires, and reading it uncorrected would make FR-037 look like a violation of FR-023.

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
- **FR-026** _(minimum envelope — normative wire contract; amended 2026-08-12, OPEN-014-A closed)_: Every
  envelope, on either path, MUST carry `schemaVersion` (integer), `recipient` (FR-004), `messageType`,
  `occurredAt` (ISO-8601, producer-assigned), `payload`, and **`producer`**. An envelope missing any required
  field MUST be rejected — never partially routed, never defaulted, never defaulted to a sentinel (FR-043).
  `idempotencyKey` remains REQUIRED on the EventBridge path (delivery there is at-least-once, and the claim is
  what survives an acknowledgement — FR-018, FR-038) and optional on HTTP.
    - **`supersedes` is OPTIONAL and, when present, MUST be `{ key, sequence }`** _(added 2026-08-14, owner
      ruling — [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §4)_. `key`
      identifies the **entity** whose state the message reports (a recipe, a food item); `sequence` is a
      **monotonically increasing integer assigned by the producer** for that key. Semantics are defined by
      FR-045. An envelope carrying `supersedes` MUST still satisfy every other field rule in this FR —
      supersession changes retention and delivery, never validity.
    - **`producer` is REQUIRED on BOTH paths**, which is the amendment. It was previously required only on
      EventBridge, justified as "that path has no bearer token to derive identity from" — a rationale FR-027
      contradicted, since `source` does derive identity without a bearer token. The ruling (FR-041) is that
      **both signals are required and a mismatch is a rejection**, so the field is required wherever an
      envelope is accepted. This also makes one envelope shape valid on both paths, which is what lets FR-024's
      "one core, two adapters" be served by literally **one** zod (SC-008's paired tests would otherwise be
      comparing two different shapes).
- **FR-027** _(event-path authorization — the trust boundary)_: The HTTP path derives producer identity from
  an authenticated credential (FR-002). The EventBridge path has **no credential**, so its trust boundary MUST
  be (a) an EventBridge resource policy restricting which principals may put events on the notification bus,
  AND (b) validation of the event's `source` against an allowlist of registered producers. Both are required:
  without them the event path is an unauthenticated publish channel through which any principal with bus
  access could address a notification to any user, defeating FR-005, FR-020 and FR-021.
    - _(amended 2026-08-12, OPEN-014-A closed)_ The `source` allowlist is the **producer registry** (FR-041),
      and `source` is not merely allowlisted — it MUST **resolve to a producer name** which MUST equal the
      envelope's `producer`. A resolution failure or a mismatch is a rejection (FR-042). The same rule applies
      on the HTTP path with the token principal in place of `source`, so neither path has a weaker identity
      story than the other.
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
- **FR-033** _(quota is declared, not inferred; unit fixed 2026-08-12 — OPEN-014-C closed)_: The per-producer
  quota of FR-019 MUST be **configurable per registered producer**, and its **magnitudes** MUST be declared by
  that producer in its registry entry (FR-041). This service MUST NOT infer a bound from a producer's
  internals. The **unit is fixed by this service**, not declared by the producer — see FR-044 for why, and for
  the unit. A quota rejection MUST be alarmed rather than silent.

**Retention, consumption and payload deduplication (added 2026-08-12, owner directive)**

Design reasoning and the rejected alternatives — DynamoDB-with-TTL, the three PostgreSQL tables this
replaces, raw-byte hashing, SQS FIFO's own dedup, TTL extension on a duplicate, per-device ack, and a
per-PR cache — are in
[ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md).

- **FR-034** _(the consumption signal is on the wire)_: The system MUST expose an acknowledgement endpoint
  `POST /api/v1/notifications/ack` accepting `{ notificationIds: string[] }` (1–100 ids per call),
  authenticated as the subscriber. A successful ack MUST end retention for each named notification **for that
  user** (FR-012). "The client indicates it has been consumed" means **this call**, made **after** the client's
  `messageType` handler has run to completion (US-004) — not on receipt, because a client that crashes between
  receipt and handling would otherwise lose a notification the service believes landed. Ack MUST be batched
  because a reconnecting client drains many notifications at once (US-005).
    - **The response MUST report a per-id outcome, and the outcome vocabulary is part of the contract**:
      `settled` (this call ended its retention) or `alreadySettled` (it was already acked, has expired, does not
      exist, or is not this user's — FR-035 deliberately makes those four indistinguishable). A bare `204` is
      **not** sufficient: a client that cannot tell which ids it still owes an ack for has to guess, and the
      guess is either a lost ack or an unbounded retry. These two literals are normative because a client and a
      service inventing them independently is the drift GR-015 exists to prevent.
- **FR-035** _(ack is idempotent, and user-scoped)_: A second ack for the same id, an ack for an expired or
  unknown id, and an ack for an id belonging to **another** user MUST all return success, reporting that id as
  already settled. Ack MUST NOT have an error path for a repeated call — a client retrying after a dropped
  response must not be punished — and MUST NOT reveal whether an id exists, or an ack endpoint becomes an
  existence oracle for other users' notifications. **Ack settles a notification per USER, not per device or
  per connection.** An accepted consequence: a user who acks on one device will not see that notification on
  another device opened later. Group notifications are settled **per member** (each member has their own
  pending entry over one stored envelope).
- **FR-036** _(the retention clock is never refreshed)_: `expiresAt` MUST be assigned once, at publish
  acceptance, as `publishedAt + 72h`, and MUST NOT be extended by anything — not a duplicate publish (FR-038),
  not a delivery attempt, not a reconnect, not a partial ack. A producer MUST NOT be able to lengthen how long
  a notification waits for a user, or a retrying producer could hold one notification pending indefinitely.
    - ⚠️ **Expiry MUST be effected by a SWEEP, not only by a store TTL, because FR-013's counter needs code to
      run.** A key reclaimed passively by the store fires no application logic, so the
      undelivered-after-retention counter cannot be emitted for it. The sweep is therefore the mechanism and a
      store TTL is a **growth backstop** for anything the sweep misses. **Accepted consequence, recorded rather
      than hidden:** a notification reclaimed by the backstop rather than the sweep is one uncounted expiry — so
      a persistent gap between the sweep's tally and the pending set's shrinkage is itself a signal worth
      alarming, not noise.
- **FR-037** _(dedup identity — canonical payload hash)_: While a notification is **pending**, the system MUST
  deduplicate on a **SHA-256 hash of the RFC 8785 (JSON Canonicalization Scheme) canonical serialization** of
  `{ schemaVersion, recipient, messageType, producer, payload }`. Two structurally identical payloads MUST
  collide; two different ones MUST NOT. The following are normative, because each is a way a naive
  implementation silently gets it wrong:
    - The canonicalizer MUST be a **stable, maintained library implementing RFC 8785** — not a hand-rolled
      serializer (the repo's library-first rule; writing an exhaustive test for a reinvention does not redeem
      the reinvention). The intended dependency is **`canonicalize`** — verified 2026-08-12 via `npm view`:
      v4.0.0, **Apache-2.0**, zero runtime dependencies, authored by RFC 8785's own authors, ESM-only (fine,
      the services are already `"type": "module"`). ⚠️ Re-verify the licence against `npm view` before adding
      it, not against this sentence. Object keys are sorted lexicographically by UTF-16 code unit at every
      depth, and numbers use
      ECMAScript shortest-round-trip form, so `1`, `1.0` and `1e0` all serialize identically.
    - **Array order MUST be preserved.** An array is ordered data; sorting it would collide two different
      payloads.
    - **An absent key and an explicit `null` MUST remain different.** Normalizing `{"a":null}` to `{}` would
      collide two payloads whose difference belongs to a producer this service does not speak for.
    - **Strings MUST be byte-exact — no Unicode normalization.** NFC folding would decide that two different
      producer strings mean the same thing.
    - A payload containing a number that does **not** survive an IEEE-754 round trip MUST be **rejected** at
      ingress with a `reason` naming the offending path — never silently canonicalized, which would make two
      different payloads hash alike.
    - `occurredAt` and `idempotencyKey` MUST be **excluded** from the identity. `occurredAt` changes on a
      producer retry, which is precisely the case dedup exists to collapse.
    - The identity MUST include the **recipient**, so the same payload addressed to two users produces two
      notifications.
- **FR-038** _(what happens on a collision)_: A publish whose payload identity (FR-037) or `(producer,
idempotencyKey)` claim (FR-018) already exists MUST be treated as a **duplicate**: the new envelope is
  **dropped**, the call **succeeds** returning the **original** notification's id with a `deduplicated`
  indicator naming which index matched, and **nothing about the original changes** — not its `expiresAt`
  (FR-036), not its `sequence`, not its delivery state. A duplicate MUST NOT be reported as an error, or a
  producer will treat a normal condition as a failure and retry into it. **Dedup is scoped to the pending
  window**: once a notification is acked or expired, its payload-identity claim is released, and the same
  payload published afterwards is a **new** notification. The `(producer, idempotencyKey)` claim is the
  exception — it **survives an acknowledgement** for its own configured window, because suppressing a
  transport redelivery that arrives after a fast ack is the one thing payload identity cannot do.
- **FR-039** _(unacked notifications are redelivered; a notification nobody can consume is an alarm)_: Every
  notification still pending for a user MUST be redelivered on reconnect or replay, in `sequence` order.
  Delivery therefore remains **at-least-once** and US-010's requirement that handlers be idempotent is
  structural, not defensive. Each delivery attempt MUST increment a per-notification attempt count, and a
  notification with a high attempt count and no ack MUST be **counted and alarmed** as a poison notification
  rather than dropped early — the 72-hour clock (FR-012) is the backstop.
- **FR-040** _(the store, and its accepted residual risk)_: The pending set MUST be held in **ElastiCache
  Serverless for Valkey** — Redis-compatible, one cache per **stage**, with a `pr-{N}:` key prefix isolating
  each preview (ADR-0006's shared-data-plane pattern, not a cache per PR). All pending-set access MUST sit
  behind **one** repository module, so the store can be replaced without touching handlers.
    - ⛔ **Accepted residual risk, recorded as a risk:** ElastiCache is a cache service and **durability is
      opt-in, off by default in both the node-based and the serverless flavour**. With it off, a node
      replacement or failover can **drop retained notifications this service already told a producer it had
      accepted** (FR-003), and producers keep no copy (FR-031) — so the loss is unrecoverable and silent.
      **The owner chose Redis knowing DynamoDB-with-TTL would be both durable and cheaper for this shape.**
    - **Mitigations, in order:** (1) enable ElastiCache **synchronous** durability if it is available for
      Serverless Valkey at the engine version provisioned — AWS added a Multi-AZ transactional-log durability
      option for ElastiCache for Valkey on 2026-06-02, with synchronous (designed for zero loss) and
      asynchronous (up to ~10 s of acknowledged writes lost) modes; ⚠️ **its availability on _Serverless_ is
      UNVERIFIED and MUST be confirmed before the cache is provisioned**; (2) if unavailable, alarm on cache
      failover and on an unexplained drop in pending-set cardinality, so a loss is at least known;
      (3) **escalate** to **Amazon MemoryDB** (same API, durable by design) or **DynamoDB with TTL** if a loss
      is ever judged unacceptable.

**Producer identity, rejection handling, identifiers and quotas (rulings, 2026-08-12)**

- **FR-041** _(the producer registry, and dual-signal identity)_: The system MUST maintain a
  **version-controlled producer registry**, and MUST resolve every publish's producer identity through it on
  **both** ingress paths.
    - **Where it lives:** the registry is **authored in the notification service**, as version-controlled data
      beside the zod it is validated by (`src/registry/*.registry.ts`, validated at load by a `*.schema.ts` in
      the same service), and it is **copied into `@kitchensink/schema-notifications` by the same generator that
      copies the zod** — so producers and clients read it from the leaf package without depending on the
      service. It MUST NOT be hand-edited **in** the schema package (that package is generated — GR-015 §15-a),
      it MUST NOT be a database table (a runtime write would change a trust boundary with no review and no
      deploy), and it MUST NOT be assembled from the producer packages it constrains (that inverts the
      dependency and lets a producer widen its own allowlist and its own quota).
    - **Entry shape:** one entry per producer, carrying the authoritative `producer` name, the set of HTTP
      token principals that map to it, the set of EventBridge `source` values that map to it, its quota
      magnitudes (FR-044), its registered `messageType` keywords (FR-016), and its owning feature.
    - **Injectivity is a security property and MUST be asserted at boot:** a principal or a `source` MUST map
      to **at most one** producer. Overlapping mappings make attribution ambiguous, which makes quota
      accounting (FR-019) and the per-producer counter (FR-013) unattributable.
    - **Both signals are REQUIRED, and a mismatch is a REJECTION.** The transport signal (the Ed25519 token
      principal on HTTP, the validated `source` on the bus) MUST resolve through the registry to a producer
      name, the envelope MUST carry `producer` (FR-026), and the two MUST be equal. A resolution failure, a
      missing `producer`, or a mismatch MUST be rejected via FR-042's single path with the reason recorded —
      it MUST NOT be resolved by preferring one signal, and the envelope's self-asserted `producer` MUST NOT
      be trusted on its own.
    - **Why both, when the transport signal alone would identify the producer:** the transport signal proves
      **origin** and the envelope field states **intent**, and a disagreement is real evidence — a
      misconfigured producer, an envelope copied between environments, or a replay onto the wrong bus. It also
      keeps **one** envelope shape valid on both paths (FR-026), which is what lets FR-024's two adapters share
      literally one zod. The self-asserted field is never the authority: it is a **cross-check** whose only
      permitted outcomes are "agrees" and "rejected".
- **FR-042** _(ONE rejection path; an invalid payload is NOT retried)_: Every rejection at ingress MUST take
  **one** path per adapter, carrying the cause as a **`reason`** field on a single structured rejection shape.
  **A signature/credential failure and a shape failure are equally invalid and MUST NOT have two different
  behaviours** — they differ only in their `reason`.
    - **An invalid payload MUST NOT be retried.** It cannot become valid by being sent again, so retrying it
      converts a producer bug into sustained load and buries the real signal.
    - ⚠️ **For a signed third-party webhook, "not retried" means answering `2xx` on a SHAPE failure — and
      **non-2xx** on a SIGNATURE failure.** Signature-verifying senders (svix, Stripe) **retry on any non-2xx**,
      so a `4xx` for a body that cannot parse requests exactly the retry storm this rule forbids: answer `2xx`,
      record the rejection in the response body and in structured logs, count it per `reason`, and **alarm**.
      But a **signature** failure may be **our own stale secret** — transient and operator-fixable, with the
      sender's retry window as the recovery — and on a public endpoint a `2xx` also tells a forger the forgery
      landed. So the status comes from **one complete `reason`→status lookup**, never a second code path. The
      question a status answers is _"would a redelivery ever succeed?"_ See
      [GR-018 §18-a](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) and
      `packages/services/identity-webhooks/src/common/handlerPipeline.ts`, where returning `2xx` for **both**
      once dropped a real `user.created`. A contributor will get one of the two backwards on instinct.
    - **This service has no signature-verifying ingress today**, so the clause above is forward-looking here.
      014's live cases are the HTTP publish path — called by our own producers, which do not blind-retry, so it
      returns the `400`/`403` GR-016 §16-a.3 requires — and the EventBridge path, which has **no caller at all**
      and therefore dead-letters (FR-028).
    - **A rejected event MUST NOT be recorded as a row.** An invalid payload has **no trustworthy identifier**
      to key such a row on, and a store whose identity column is `NOT NULL` would force the writer to invent
      one — which is exactly the sentinel FR-043 forbids. The **log line, the counter and (on the bus) the DLQ
      entry are the record**; the DLQ's depth is what is alarmed.
- **FR-043** _(identifiers are never sentinels)_: No identifier — `producer`, `recipient.id`, a notification
  id, a subscriber id — may ever be written, logged as data, or compared as a **sentinel string** such as
  `'unknown'`, `'none'`, `''` or `'n/a'`. An id is **REQUIRED** on every path that consumes one; the sole
  exception is a **create/upsert**, where an absent id is **generated** by the system (ULID). A value that
  cannot be resolved is a **rejection** (FR-042), never a placeholder: a sentinel makes every subsequent
  aggregate — the per-producer counter, the quota bucket, the recipient's pending set — silently wrong, and it
  cannot be distinguished later from a real value.
- **FR-044** _(quota unit — token bucket, fixed by the service; OPEN-014-C closed)_: The FR-019/FR-033 quota
  MUST be a **token bucket** whose unit is fixed by this service: a **sustained rate in publishes per second**
  plus a **burst allowance in publishes**. A producer's registry entry declares only the two magnitudes, and
  this service MUST cap both.
    - **Why a token bucket rather than a fixed window:** NFR-006 bounds the degradation a misbehaving producer
      may inflict on unrelated producers, which is a statement about **instantaneous** contention. A fixed
      window permits the entire budget in its first millisecond and therefore cannot bound it. A bucket bounds
      the sustained rate **and** the burst, which is also what the SQS FIFO account-level TPS ceiling requires
      us to bound against.
    - **Why the unit is fixed by the service and not declared:** two registry entries declaring different units
      are not comparable, and the registry's schema could not type the value (a `z.strictObject` needs one
      dimension). FR-033's intent — the producer declares its own bound rather than having one inferred — is
      satisfied by declaring **magnitudes**.
    - **One budget per producer, shared across BOTH ingress paths.** FR-024 gives the two adapters one core;
      two budgets would let a producer double its allowance by splitting traffic, and FR-013's counter is
      per producer, not per path.
    - **`global` broadcasts carry a SEPARATE bound owned by this service, not by the producer.** One `global`
      publish fans out to every subscriber, so it is not commensurable with a `user`-addressed publish, and a
      producer permitted to declare its own global quota could declare a large one. Global publishing is an
      operator action (US-003) and its bound is a service constant.
    - The bucket MUST be **shared state, not per-task memory**: N API tasks each holding a local bucket grant
      N× the quota. It lives in the same store as FR-040's pending set.

- **FR-045** _(supersession — added 2026-08-14, owner ruling; normative source [ADR-0019](../../docs/architecture/decisions/0019-recipe-import-spine.md) §4)_:
  When an envelope carries `supersedes = { key, sequence }` (FR-026), the service MUST retain **only the
  highest-`sequence` message per `(recipient, key)`** among those still pending, and MUST deliver that one.
  A message whose `sequence` is **lower than or equal to** the highest already observed for its
  `(recipient, key)` MUST be **discarded** — not delivered, not stored.
    - **Why the producer's `sequence` decides and arrival order MUST NOT.** Both ingress paths are
      at-least-once and neither guarantees order (FR-018; the EventBridge path is explicitly unordered).
      Last-write-wins on **arrival** therefore lets a redelivered or delayed `processing` message overwrite a
      terminal `succeeded`, showing a user a finished import as still running — permanently, since nothing
      later corrects it. Deciding on a producer-assigned monotonic integer makes the outcome independent of
      delivery order and of redelivery.
    - **Why this is not `idempotencyKey`.** `idempotencyKey` answers _"have I already seen THIS message?"_
      and its correct action is to drop a duplicate. `supersedes` answers _"is this message still the current
      truth for this ENTITY?"_ and its correct action is to **replace** an older, different message. A
      producer reporting five distinct stages of one recipe emits five distinct messages — none of them
      duplicates — of which only the latest should reach the client. Conflating the two would either deliver
      all five or discard four as false duplicates.
    - **Interaction with payload dedup (FR-037/FR-038).** Supersession is evaluated **first**, on
      `(recipient, key)`. Payload-identity dedup then applies to whatever survives. The two cannot disagree,
      because a superseded message is discarded before it is ever considered for dedup.
    - **Interaction with acknowledgement (FR-036).** Supersession applies only among **pending** messages. A
      message already acked is settled; a later `sequence` for the same key produces a **new** pending
      notification rather than resurrecting the acked one, matching FR-038's post-ack behaviour.
    - **Absence is not a default.** An envelope without `supersedes` is an ordinary independent notification.
      The service MUST NOT infer a supersession key from `messageType`, `payload` contents, or producer
      identity — inference would silently collapse unrelated notifications that happened to share a shape.

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

- **PublishEnvelope**: Producer-supplied input. Fields: `schemaVersion`, `recipient`, `messageType`, `payload`, `occurredAt`, `producer` — all REQUIRED on both paths — plus `idempotencyKey`, REQUIRED on the EventBridge path and optional on HTTP, plus **`supersedes` (`{ key, sequence }`, OPTIONAL — FR-026/FR-045, added 2026-08-14)**. `payload` is opaque as to meaning (FR-023). **FR-026 is the normative field set**; this entry previously listed the pre-amendment fields, omitted `schemaVersion` and `producer` entirely, and then described `producer` as EventBridge-only — corrected 2026-08-12 when OPEN-014-A closed. FR-001's inline shape carries the same omission and is superseded by FR-026 on both paths.
- **PendingNotification**: The retained, not-yet-consumed record for **one recipient user**. Fields: notification `id` (ULID), the stored envelope, `sequence`, `publishedAt`, `expiresAt` (`publishedAt + 72h`, never refreshed — FR-036), `attempts` (delivery-attempt count, FR-039). One stored envelope may be referenced by many `PendingNotification`s (a group's members). Held in the FR-040 store, not in a relational table.
    - ⚠️ **`sequence` is monotonic per DELIVERING USER, not per `recipient.id`** — a distinction FR-035 forces and which the pre-2026-08-12 wording ("per-recipient monotonic") did not capture. Because an ack settles a group notification **per member**, the pending set and therefore the sequence counter are per **user**; a user who belongs to two groups and also receives direct notifications has **one** ordered pending set, not three. FR-008's per-recipient FIFO is still delivered by the SQS FIFO queue keyed on `MessageGroupId = recipient.id` — the queue is the **ordering authority** and the store **records its verdict** (see `plan.md` → _Ordering & Partitioning_). What changes is only where the counter lives, and it changes so that a client can order and de-duplicate **the one stream it actually receives**.
- **PayloadIdentityClaim**: The pending-scoped dedup index — a canonical-payload hash (FR-037) per recipient, released on ack or expiry. Not a user-visible entity; named here because FR-038's "the same payload after an ack is a NEW notification" is a property of its **lifetime**, not of the payload.
- **IdempotencyClaim**: The publish-scoped dedup index — `(producer, idempotencyKey)` with its own configured window, which **survives an ack** (FR-018, FR-038). Distinct from `PayloadIdentityClaim` on purpose; see ADR-0016 decision 3 before merging them.
- **Acknowledgement**: A subscriber's statement that a notification was consumed. `{ notificationIds }` in, per-id settled/already-settled out. Idempotent and **user-scoped** (FR-034, FR-035); there is no per-device acknowledgement entity, deliberately.
- **ProducerRegistryEntry**: `{ producer, httpPrincipals[], eventSources[], quota: { sustainedPublishesPerSecond, burstPublishes }, messageTypes[], ownerFeature, registeredAt }`. Version-controlled, authored in the notification service and copied into the schema package (FR-041). It is the allowlist for FR-027, the principal→producer map for both paths, the FR-016 keyword registry, and the FR-044 quota source — one artifact, because splitting them would let a producer be authorized in one and unknown in another.
- **RecipientDescriptor**: `{ kind: "user" | "group" | "global", id?: string }`. `id` required for `user` / `group`; absent for `global`.
- **DeliveryEnvelope**: Service-output to clients. Fields: service-assigned `id`, `messageType`, `payload`, `occurredAt`, `publishedAt`. The service-assigned `id` MUST be unique and MAY encode per-recipient ordering (e.g., monotonically increasing per recipient).
- **MessageTypeRegistryEntry**: `{ messageType: string, ownerFeature: string, description: string, registeredAt: ISO-8601 }`. Lives in version control — specifically, **nested under its owning `ProducerRegistryEntry`** (FR-041), not in a second file. Two registries would let a keyword be registered to a producer that is not itself registered, and the FR-016 registry check and the FR-027 allowlist would then disagree about who exists.
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
  the **`AckRequest` / `AckResponse`** (FR-034), the single **rejection shape with its `reason`** (FR-042), and
  the `ProducerRegistryEntry` / `MessageTypeRegistryEntry` (FR-041).
- **The registry is DATA authored beside the zod and copied out by the same generator** (FR-041). It is not
  hand-edited in the schema package (that package is generated), not a database table, and not assembled from
  the producer packages it constrains. The regenerate-and-diff gate therefore covers the registry for free.
- **That same zod is what performs FR-015's pre-durability validation**, via `nestjs-zod`'s `createZodDto` on
  the HTTP path. There is no second DTO that "agrees with" the schema by convention — FR-015 and the published
  contract are the same artifact, so a producer cannot be surprised by a rule it could not see.
- **FR-024's "one core, two adapters" makes this stricter, not looser: ONE zod validates BOTH paths.** The
  HTTP adapter and the EventBridge adapter both call the same schema. A separate schema per adapter is the
  literal mechanism by which "a rule enforced in only one adapter" (an FR-024 defect) happens, so the shared
  zod is how FR-024 is _made true_ rather than merely asserted.
- **`payload` stays opaque in the schema, and that is a requirement of the schema, not an omission.** FR-023
  forbids interpreting it or imposing a per-`messageType` schema on it, so the envelope's zod models `payload`
  as unknown/opaque with a **size bound** only. A schema that grew per-`messageType` payload validation would
  put 014 in violation of its own FR-023 — do not "improve" it that way. FR-037's canonical hash is **not** such
  a schema: it treats every payload identically and asserts nothing about its shape.
- `@kitchensink/schema-notifications` is **generated and committed** — the zod, `z.infer` types,
  `contractHash.ts`, a barrel, and a **derived** `openapi.yaml` (for `oasdiff`, docs and integrators;
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
    - **The ACK is a client obligation, not just a client convenience** (FR-034, US-012). `packages/clients/notifications`
      owns the ack call — its request body typed and validated by the schema package's `AckRequest` zod, its
      response parsed on receipt (GR-016 §16-c.3) — and **both** web and mobile issue it through **one shared
      command** rather than each calling the endpoint. That is the same lesson ADR-0009 records for sign-out: two
      platforms independently implementing a post-condition is how one of them ships without it, and here the
      failure mode is silent (retention simply never ends, so notifications reappear on every reconnect for three
      days and nothing is red).
    - **A client MUST NOT ack on receipt.** Ack means the `messageType` handler ran to completion; acking earlier
      converts a client-side crash into a lost notification with the service believing it landed.
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

### ✅ RESOLVED (2026-08-12) — where the registry lives, and why it is the same file as the producer registry

The previous revision recorded this as OPEN: the `messageType` registry must be version-controlled (FR-016), is
read by the service for the registry check and by producers to register a keyword, and
`@kitchensink/schema-notifications` was the obvious home — except that package is **generated and never
hand-edited**, while a registry entry is **authored by a producer feature**.

**Ruling: registry entries are AUTHORED IN THE NOTIFICATION SERVICE, beside the zod, and COPIED OUT by the same
generator** (FR-041). Concretely: `packages/services/notification-service/src/registry/producers.registry.ts`
is version-controlled data, validated at module load by a `*.schema.ts` in the same service, and the existing
`@kitchensink/contract-gen` copy step publishes it into `@kitchensink/schema-notifications` alongside the zod.

Three things this ruling settles, each of which the OPEN wording left ambiguous:

- **It resolves the "generated package is never hand-edited" tension without exception.** The registry is
  hand-authored **in the service** and generated **into** the schema package, which is exactly the flow §15.2
  already prescribes for the zod. No new distribution mechanism, and the regenerate-and-diff gate covers the
  registry for free.
- **It is ONE registry, not two.** The `messageType` keyword registry (FR-016), the `source`/principal
  allowlist (FR-027), the principal→producer map (FR-041) and the quota magnitudes (FR-033, FR-044) are all
  fields of one `ProducerRegistryEntry`. Split across files, a keyword could be registered to a producer that
  the allowlist does not know, and the FR-016 check and the FR-027 check would disagree about who exists.
- **A producer onboards by opening a PR against the notification service.** That is the point rather than
  friction: the registry is where a producer's **quota** and its **authority to address any user** are
  declared, so both are cross-producer concerns that must be reviewed by the owners of the shared service. A
  registry each producer wrote for itself would let a producer raise its own quota and widen its own allowlist.
- ⛔ **Not a database table, and not assembled from the producers.** A table means a runtime write can change a
  trust boundary with no review and no deploy; assembling it from producer packages inverts the dependency
  (this service would depend on every producer) and hands the constrained party the constraint.

## Input Validation (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-018`](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) ·
[`GR-019`](../governance-rules.md#gr-019-identifier-integrity--no-sentinels) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). The section above
applies GR-015 (**who authors** the envelope). This one applies GR-016 (**where that envelope is enforced**).
It introduces **no new requirement** and mints no FR (GR-003): FR-015 already requires pre-durability
validation, FR-024 already requires one core with two adapters, FR-027 already makes `source` a trust decision,
and FR-023 already scopes `payload` to opaque-as-to-meaning. GR-016 states what those requirements jointly
oblige, in one place, so no adapter can satisfy them individually. The 2026-08-12 rulings that **are** new
requirements are minted as FRs — FR-034 – FR-044 — and are portfolio-wide as GR-018 (one rejection path,
invalid input is never retried) and GR-019 (no sentinel identifiers).

### ONE authored zod validates BOTH ingress paths

- **FR-015's pre-durability validation is performed by the envelope's authored zod, on both paths.** The HTTP
  adapter reaches it via `nestjs-zod`'s `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`; the
  EventBridge adapter has **no pipe available** and therefore **calls the same schema explicitly**.
- ⚠️ **The mechanisms differ; the schema must not.** A schema per adapter is the literal way "a rule enforced in
  only one adapter" — an FR-024 defect — comes into existence, and it would be invisible until the two copies
  disagreed. One schema is how FR-024 is _made_ true; SC-008's paired per-rule tests are what prove it.
- ⚠️ **`createZodDto` requires `nestjs-zod`'s `ZodValidationPipe`. Under Nest's own built-in `ValidationPipe`
  it validates NOTHING while looking correctly wired** — a live case elsewhere in this portfolio (identity's
  `PATCH /users/me`). On the HTTP publish path that failure would admit **arbitrary envelopes into the durable
  store** with every visible signal saying they were checked. The proof is a test that publishes a known-bad
  envelope over HTTP and asserts the rejection, paired (per SC-008) with the same envelope over the bus.

### ONE rejection path, the cause in a `reason`, and an invalid payload is NEVER retried (FR-042, GR-018)

**"One validation-failure path per service" (GR-016 §16-a.3) means one _verdict_ and one _rejection shape_ per
ingress — not a `400` on the bus.** The HTTP path returns a `400` naming the offending field (or `403` when the
failure is producer attribution, FR-041). The event path has no caller to receive a structured error, so a
rejection **dead-letters and alarms**. Both carry the cause in a **`reason`** field on one shape: malformed
(FR-015), unregistered under enforcement (FR-017), quota-exceeded (FR-019, FR-044), `source` unresolvable or
producer-mismatched (FR-027, FR-041), payload not canonically serializable (FR-037), per FR-028. An envelope
missing a required field is **rejected outright — never partially routed, never defaulted, never defaulted to a
sentinel** (FR-043), on either path.

Three properties of that single path are load-bearing, and each one is a thing a plausible implementation gets
backwards:

- **A credential/signature failure and a shape failure are EQUALLY invalid and share ONE path, ONE shape, ONE
  `reason`, ONE counter, ONE alarm.** Two rejection **code paths** means two places to keep in step, and the
  credential path is the one that ends up without a counter.
- **An invalid payload is not retried**, because it cannot become valid by being sent again. ⚠️ **For a
  signature-verifying third-party sender (svix, Stripe) that means `2xx` on a SHAPE failure and non-2xx on a
  SIGNATURE failure** — those senders retry on **any** non-2xx, so a `4xx` for a body that cannot parse requests
  the retry storm the rule forbids; but a signature failure may be **our** stale secret, which is transient and
  operator-fixable, and the sender's retry is the recovery. So the **status is derived from the `reason` by one
  complete lookup**, never a second branch, and the question it answers is _"would a redelivery ever succeed?"_
  This service has no such ingress today: its HTTP publish path is called by our own producers (which do not
  blind-retry) so it keeps GR-016's `400`/`403`, and the bus path has no caller and dead-letters. **Reject the
  content, accept the delivery** — see
  [GR-018 §18-a](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) for the
  portfolio rule and the incident behind it.
- **A rejected event is NOT recorded as a row.** An invalid payload has **no trustworthy identifier**, and a
  table whose identity column is `NOT NULL` would force the writer to invent one — the exact sentinel FR-043
  and GR-019 forbid. The log line, the counter, and (on the bus) the DLQ entry **are** the record; the DLQ's
  depth is what is alarmed. This is not hypothetical elsewhere in the portfolio: identity's
  `webhook_events.identity_id` is `text NOT NULL`, so "record the rejection" there means inventing an id.

### The AWS wrapper is parsed BEFORE `source` becomes a trust decision

The **EventBridge event wrapper** (`source`, `detail-type`, `detail`, `account`, `resources`) is **AWS's**
shape, not ours (GR-015 §15-d), and it is **validated at the boundary in the ingress adapter before `detail` is
treated as an envelope**. This ordering is the control, not a formality: **FR-027 makes the validated `source`
a trust decision**, so reading `source` off an unvalidated payload means trusting a field to authorise the
record that carries it. The wrapper's shape is **not** added to `@kitchensink/schema-notifications` as though we
owned it; GR-016 is what makes the parse **mandatory** rather than merely permitted.

### ⛔ `payload` stays opaque AS TO MEANING — GR-016 does NOT reach inside it, and neither does dedup

FR-023 (as amended 2026-08-12) forbids **interpreting** `payload`, imposing a per-`messageType` schema on it, or
transforming the value stored or delivered; the 2026-05-10 clarification puts the meaning of every
`messageType` with its **producer**. So the envelope's zod models `payload` as unknown/opaque **with a size
bound only**, and that is a requirement of the schema rather than an omission in it. **A contributor citing
GR-016 to add per-`messageType` payload validation would put this service in violation of its own FR-023** and
make it the author of knowledge it explicitly disclaims. A producer's payload type belongs to **that
producer's** schema package, and the producer validates it there.

⚠️ **FR-037's dedup hash is not an exception to this, and it is not "validating the payload".** Canonicalizing
and hashing establishes **no knowledge of meaning** and imposes **no schema** — it is the same operation on
every payload from every producer. Two consequences of the hash are nevertheless real constraints on the
payload, and they are stated in FR-023 rather than smuggled in: the payload must be **well-formed JSON**, and a
payload carrying a number that cannot survive an IEEE-754 round trip is **rejected** (because canonicalizing it
would collapse two different payloads into one hash). Do **not** "fix" the tension by reverting FR-023's
narrower wording — the pre-amendment text forbade the hash the owner's dedup directive requires, and reading
it uncorrected makes FR-037 look like a violation.

### The storage floor, and the subscriber surface

- **Every envelope field that writes a bounded store is validated at least as strictly as that store can hold**
  — `messageType`, `groupId`, `idempotencyKey`, `schemaVersion` and `producer` lengths, the recipient
  descriptor's enum, nullability, and a hard **size** bound on the envelope and on `payload`. A value the store
  cannot hold must be a rejection at ingress, never a failed durable write — a publish that fails **after** the
  caller was told it succeeded is worse here than in a plain CRUD service, because the producer has no other
  record of the notification (FR-031).
    - ⚠️ **The retained set is a metered cache, not a table (FR-040), so "the column" is not the floor here —
      the SIZE BOUND is.** ElastiCache Serverless for Valkey meters stored bytes above a 100 MB floor, so an
      unbounded `payload` is not a `500`, it is a **bill** and a fan-out amplifier. The bound is a product
      decision with no storage floor to derive from — exactly GR-016 §16-d's "a floor is not a target" case, and
      the reason it must be an explicit number in the schema rather than left to the engine.
    - ⚠️ **Asserted, never derived.** No zod is generated from Drizzle, and the envelope schema imports **no
      storage type, no cache-client type, no SQS/EventBridge SDK type and no Nest symbol** — the constraint the
      section above already states, and it matters doubly here because this schema is imported by **web and
      mobile**.
- **`GET /api/v1/notifications/subscribe` and `/replay` validate their inputs too** — the replay cursor/window
  and any subscription filter are parsed at the boundary. FR-020/FR-021/FR-022 scope a subscription to the
  **authenticated** identity, so a request-supplied identity or group is **never** the authority for what is
  delivered; parsing it does not make it trusted, and US-007's cross-user rejection (SC-005) stands
  independently of the parse.
- **`POST /api/v1/notifications/ack` is a mutating body and validates as one** (FR-034): `notificationIds` is
  a `z.strictObject` body with a non-empty, length-capped array of well-formed ids, parsed by the same authored
  zod, published in the schema package, and imported by web and mobile. The **cap matters** — an unbounded ack
  array is an unbounded multi-key store operation from an authenticated client. Note what parsing does **not**
  do: it does not authorize. FR-035 makes an id belonging to another user return "already settled" **as an
  authorization outcome**, not as a validation one, so the two must not be collapsed into one check.
- **Unknown keys: `z.strictObject()` on every mutating body, including the publish envelope and the ack body**
  (the portfolio default, ruled 2026-08-12 — GR-016 OPEN-GR-016-B closed; see GR-017 §17-c). A producer's typo'd
  envelope field is a **rejection**, not a silently dropped one: on this surface a silently stripped key means a
  notification that was accepted and is subtly not the one the producer sent, with a `200` in the producer's
  logs. Plain `z.object` is permitted only on a **read** surface (a query string) and only with the
  forward-compatibility reason documented at the schema.

### ⛔ Response validation is DEFERRED (GR-016 §16-g) — and note what that means here

No service in this portfolio validates the bodies it emits; the deferral is an owner decision, not an
unfinished task. For 014 the consequence is specific and worth stating: **the `DeliveryEnvelope` this service
emits is checked by the SUBSCRIBER on receipt** — web, mobile and `packages/clients/notifications` all import
the envelope's zod and parse what arrives (GR-016 §16-c.3) — **not by the service on its way out.** That is
consistent with `schemaVersion`'s purpose (letting a receiver handle an envelope minted by another version) and
with a released mobile binary that cannot be redeployed in step with this service. Do not "complete" the rule by
adding an emission-side parse.

✅ **All three items that previously blocked generating the schema package are now ruled** (2026-08-12) — see
[Resolved Questions](#resolved-questions-owner-rulings-2026-08-12). The envelope's zod can now be authored:
`producer` is REQUIRED on both paths and cross-checked against the transport signal (FR-041), the quota carries
a service-fixed unit the registry entry can type (FR-044), and the delivery guarantee is stated as
effectively-once within a window rather than exactly-once (SC-011).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A publish reaches a subscribed client end-to-end, over BOTH ingress paths, with the client dispatching by `messageType`. Verified in CI against a **synthetic reference producer owned by this feature** — not against another feature's pipeline, so this criterion never waits on a consumer's schedule. (Amended 2026-08-10: previously required feature 003 specifically, and cited `US-005` / `FR-NOTIF` requirements that do not exist in 003. Note this removes the _consumer_ coupling only — this feature still has an upstream dependency it builds itself, the identity groups model of T-023..T-025, so it is not shippable ahead of that.)
- **SC-002**: Per-recipient FIFO is observed in tests: 100 messages addressed to one user are delivered in publish order to a connected client (zero out-of-order deliveries across 10 test runs).
- **SC-003** _(window fixed 2026-08-12)_: Catch-up works: a client offline for ≤ **72 hours** receives 100% of the messages addressed to it during the offline interval that it had not already acked; 0% redelivery beyond the window (FR-012).
- **SC-004**: Operational counters reflect ground truth: synthetic load of K publishes results in counters reading ≥ K within 1 minute (NFR-005).
- **SC-005**: Subscription identity binding is verified: 100% of attempted cross-user subscriptions are rejected (US-007).
- **SC-006**: At least 5 distinct `messageType` keywords are registered in the central registry by launch, covering the launch consumer feature (003) plus reserved namespaces for 001 / 005 / 008 / 009.
- **SC-007**: WA-004 in `specs/cross-feature-consistency-report.md` is closed, with a citation to this feature as the owner of cross-feature notification delivery.
- **SC-008**: Both ingress paths are proven equivalent: the same envelope published over HTTP and over EventBridge produces an identical delivered message, and a rule violated on one path is rejected identically on the other. Verified by a paired test per rule (FR-024).
- **SC-009**: The event path rejects spoofing: 100% of envelopes whose `source` is not an allowlisted producer are rejected and dead-lettered, and none is ever delivered (FR-027, FR-028).
- **SC-010**: The no-aggregation contract is observable: N envelopes published for one recipient arrive as N deliveries, and this service never merges them (FR-031).
- **SC-011** _(narrowed 2026-08-12 — OPEN-014-B closed)_: An EventBridge envelope redelivered by the transport produces **at most one notification per `(producer, idempotencyKey)` within the claim window, and never zero** — proven by replaying the same event with an unchanged `idempotencyKey`, before and **after** an ack, and asserting one notification in both cases (FR-018, FR-026, FR-030, FR-038). **Superseded**: this criterion previously claimed delivery "exactly once", which the design cannot satisfy in general and which three of this feature's own artifacts contradict (US-010's at-least-once handler contract, FR-018's bounded window, FR-026's "EventBridge delivery is at-least-once"). The guarantee is **effectively-once within the window**; consumers still write idempotent handlers (FR-039).
- **SC-012**: Retention ends on consumption: of 100 delivered notifications, the acked ones are **0%** redelivered after reconnect and the unacked ones are **100%** redelivered, in `sequence` order (US-012, FR-012, FR-034, FR-039).
- **SC-013**: Ack is idempotent and non-disclosing: acking the same id twice, an expired id, an unknown id, and an id owned by another user all return success reporting "already settled", and **none** reveals whether the id exists (FR-035). Verified per case, not in aggregate.
- **SC-014**: Payload dedup holds without producer cooperation: two publishes of the same payload with **no** `idempotencyKey`, differing only in `payload` key order and in `occurredAt`, produce **one** notification; the original's `expiresAt` is byte-identical before and after; and the same payload published **after** an ack produces a **second** notification (US-013, FR-037, FR-038, FR-036).
- **SC-015**: Producer identity is dual-signal: 100% of publishes whose transport signal does not resolve through the registry, or resolves to a producer other than the envelope's `producer`, are rejected on **both** paths with the mismatch `reason` recorded, and none is ever delivered (FR-041, FR-042).
- **SC-016**: An invalid publish is never retried and never stored: a malformed envelope and a credential failure produce the **same** rejection shape differing only in `reason`, no row is written for either, and the counters move per reason **and are alarmed** (FR-042). Should this feature ever accept a signature-verifying third-party sender, the criterion is that **all three** dispositions are asserted — a shape failure answers `2xx`, a signature failure answers non-2xx, and a valid body still succeeds — because asserting any two of the three passes on a handler that always returns the same status.

## Resolved Questions (owner rulings 2026-08-12)

All three items previously recorded here as **genuinely open** — each an internal contradiction or a missing
value that could not be derived from `docs/CODING_STANDARDS.md` §15, GR-015 or any existing ADR — have been
**ruled by the owner**. The rulings are normative as the FRs cited below; the reasoning and rejected
alternatives are in
[ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md). Each
question is retained with its analysis, because a ruling read without the conflict it settles invites the
conflict back.

### ✅ OPEN-014-A — producer identity: BOTH signals are required, and a mismatch is a rejection

**The conflict (unchanged, recorded so the ruling is legible).** FR-026 made `producer` a REQUIRED envelope
field on the EventBridge path, justified as "that path has no bearer token to derive identity from (FR-027)".
FR-027 says the event path's trust boundary **is** the bus resource policy plus **validation of the event's
`source` against an allowlist of registered producers** — which does derive identity without a bearer token. So
the same request carried **two** producer identities, one self-asserted inside the envelope and one
transport-asserted outside it, and FR-026's stated rationale was contradicted by FR-027. Downstream behaviour
hung on the answer: the FR-016/FR-017 registry lookup, FR-019/FR-033 quota accounting and the FR-013
per-producer counter each need exactly one authoritative producer id.

**Ruling.**

1. **Neither field alone is the authority. BOTH are required and they must agree.** The transport signal — the
   Ed25519 token principal on HTTP, the validated `source` on the bus — is resolved **through the producer
   registry** to a producer name; the envelope's `producer` is compared to it.
2. **A mismatch, or a transport signal that resolves to nothing, is a REJECTION** on FR-042's single path with
   the cause in `reason` (`403` on HTTP, dead-letter on the bus). It is **not** resolved by preferring one
   signal, and the envelope's `producer` is **never** trusted on its own — which is what closes the
   "a principal with bus access could spend another producer's quota" hole the OPEN identified.
3. **`producer` is NOT dropped; it becomes REQUIRED on both paths** (FR-026 amended). It is a cross-check, not
   advisory metadata: its only permitted outcomes are "agrees" and "rejected". Keeping it also keeps **one**
   envelope shape valid on both ingresses, which is what lets FR-024's two adapters share literally one zod —
   SC-008's paired tests would otherwise be comparing two different shapes.
4. **The registry is where the mapping lives** — one `ProducerRegistryEntry` per producer carrying its HTTP
   principals and its `source` values, with the mapping asserted **injective at boot** so attribution can never
   be ambiguous. Authored in the notification service, copied into the schema package, never a table (FR-041).

**Why both rather than the cheaper single signal:** the transport signal proves **origin**, the envelope field
states **intent**, and a disagreement is real evidence of a real fault — a misconfigured producer, an envelope
copied between environments, a replay onto the wrong bus. Requiring agreement costs one comparison and removes
a class of silent misattribution that would otherwise surface as another producer's quota exhaustion.

### ✅ OPEN-014-B — the guarantee is effectively-once within a window, not exactly-once

**The conflict (unchanged).** SC-011 claimed a redelivered EventBridge envelope is "delivered **exactly
once**", which three of this feature's own artifacts contradict: US-010 states plainly that exactly-once is
**not** promised and that handlers may run more than once; FR-018 scopes collapse to a **window**, with
US-010's own scenario 2 saying the same key **after** the window delivers twice; and FR-026 justifies requiring
`idempotencyKey` precisely because "EventBridge delivery is **at-least-once**".

**Ruling.**

1. **SC-011 is narrowed** to what the design provides: **at most one notification per
   `(producer, idempotencyKey)` within the claim window, and never zero.** An at-least-once transport plus a
   bounded claim is **effectively-once within the window** — that is the phrase to use in any client-facing
   material, and "exactly-once" is not to be reinstated.
2. **US-010's contract stands and is now structural**: unacked notifications are **redelivered by design**
   (FR-039), because redelivery is the retention mechanism. Idempotent handlers are a requirement, not a
   defensive nicety.
3. **The dedup design is what makes the narrowed claim strong in practice**, and it is worth stating why the
   answer is not simply "we promise less": payload-identity dedup (FR-037) is **always on** and needs no
   producer cooperation, so the common duplicate — the same notification published twice — collapses whether or
   not the producer derived a key correctly. The `idempotencyKey` claim adds the one case payload identity
   cannot cover, a transport redelivery arriving **after** a fast ack (FR-038).
4. **The client-facing contract therefore says:** a notification may be delivered more than once, will not be
   delivered zero times inside its retention window, and is settled by an ack. Handlers are idempotent; clients
   also dedupe and order by `(recipient, sequence)`.

### ✅ OPEN-014-C — the quota is a token bucket with a service-fixed unit

**The gap (unchanged).** FR-019 required "per-producer publish quotas" and FR-033 required the value to be
"declared by that producer at registration", but neither stated a **unit or a window**. The only unit anywhere
was US-011's narrative "K/sec", and a user story is not the normative requirement — so FR-033 asked a producer
to declare a value with no dimension, and the registry contract could not type it.

**Ruling** (normative as **FR-044**), answering the four questions in order:

1. **Unit and window: a token bucket** — a sustained rate in **publishes per second** plus a **burst allowance
   in publishes**. Not a fixed window: NFR-006 bounds the degradation one producer may inflict on unrelated
   producers, which is a statement about **instantaneous** contention, and a fixed window permits the whole
   budget in its first millisecond. The bucket also bounds against the SQS FIFO account-level TPS ceiling the
   ordering design already accepts as a hard cap.
2. **Scope: one budget per producer, shared across BOTH ingress paths.** FR-024 gives the adapters one core;
   two budgets would let a producer double its allowance by splitting traffic, and FR-013's counter is per
   producer, not per path.
3. **Not per `recipient.kind` — but `global` carries a SEPARATE bound owned by this service.** One `global`
   publish fans out to every subscriber and is not commensurable with a `user`-addressed publish, and a
   producer allowed to declare its own global quota could declare a large one. Global publishing is an operator
   action (US-003), so its bound is a service constant, not a registry field.
4. **The unit is fixed by the service; the producer declares magnitudes only** — and this service **caps**
   them. Two registry entries declaring different units are not comparable, and the registry's
   `z.strictObject` could not type a value whose dimension varies. FR-033's intent (the producer declares its
   own bound rather than having one inferred) is satisfied by declaring the magnitudes.
5. **The bucket is shared state, not per-task memory.** N API tasks each holding a local bucket grant N× the
   quota; the bucket lives in the FR-040 store alongside the pending set.

### Still open — and honestly so

- 🟠 **Whether ElastiCache durability is available on Serverless Valkey at the engine version we get**
  (FR-040 mitigation 1). This is a **factual question about AWS**, not a design question, and it must be
  answered against the AWS documentation **before the cache is provisioned**; the answer decides a $3.21/month
  trade between a durable node and a non-durable serverless cache. Recorded in
  [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md) →
  _Durability_.
- 🟠 **The concrete `payload` size bound and envelope size bound** (FR-037, FR-040). These are product decisions
  with no storage floor to derive from, and they set both the fan-out cost and the metered-memory profile. They
  must be **numbers in the schema** before the envelope zod is generated; a default inherited from a transport
  limit is not a decision.

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
- **A-009** _(added 2026-08-12)_: The retained-notification store is **infrastructure this feature provisions**, not a dependency to wait on: one ElastiCache Serverless for Valkey cache per stage, `pr-{N}:`-prefixed per preview (FR-040, ADR-0006's shared-data-plane pattern). It is **not** durable by default and that is an accepted, recorded risk with a named escalation — see FR-040 and ADR-0016 → _Durability_. Do not read the ≈ $6.13/month figure as the whole decision: the durable options cost more or change the data model.
- **A-010** _(added 2026-08-12)_: A client is assumed to be able to **acknowledge** (FR-034). A consumer that cannot — a surface with no way to run a handler to completion and call back — is out of scope for this release, and its notifications would simply wait out the 72 hours. If such a consumer is ever required, it needs its own decision; it is **not** a reason to add a server-side "assume consumed on send" rule, which would restore the exact behaviour FR-012's amendment removed.

---

## Amendment (2026-08-16) — the message substrate exists; 014 consumes it as a DOORBELL, and `supersedes` is withdrawn

PR 91 built the producer half of a durable per-group message substrate (plan U4–U6): a DynamoDB table with
`PK = <groupType>#<groupId>`, `SK = <ISO-8601 ms>#<ULID>`, a 3-day TTL, and a `KEYS_ONLY` stream that is
**enabled and deliberately unattached**. 014 owns the consumer. This section is the contract that consumer
must implement, recorded here so the design work is not lost between releases, and it **supersedes FR-045
and the `supersedes` field of FR-026**.

### C-1. The stream record is a DOORBELL. Re-query the group; never read record contents

On trigger, the consumer MUST re-`Query` the message's group and act on what the query returns. It MUST NOT
treat the stream record itself as the data.

**Why, precisely.** AWS orders stream records **per item (`PK` _and_ `SK`)**, not per partition key — so the
premise "a group arrives in order for free" is false. A group's `Query`, on the other hand, **is** ordered,
because `SK` leads with an ISO-8601 instant that sorts lexicographically in chronological order. Re-querying
therefore makes ordering correct by construction, makes duplicate deliveries harmless, makes
`parallelizationFactor` safe to raise, and is what makes `KEYS_ONLY` the right stream view — the record only
has to say _which group changed_.

### C-2. Every read MUST carry a TTL filter expression

Expired-but-unreaped items **still return from `Query`**. DynamoDB's TTL deletion is asynchronous and
best-effort, typically within 48 hours of expiry but not guaranteed. A consumer that trusts the TTL as a
read boundary will deliver messages it believes cannot exist, and the bug is invisible until a reap runs
late — i.e. under exactly the load where it matters.

### C-3. Paginate on `LastEvaluatedKey`, never on an empty page

An empty page is **not** the end of a result set when a filter expression is in play: DynamoDB applies the
filter after reading, so a page can legitimately return zero items and still carry a `LastEvaluatedKey`.
Stopping on an empty page silently truncates a group.

### C-4. Set `retryAttempts` and `maxRecordAge` EXPLICITLY

Both default to `-1` (infinite). Left at the defaults, one poison record blocks its shard for the full
24-hour stream retention, and every group hashing to that shard goes dark with no alarm and no DLQ entry.
Also set `bisectBatchOnError` and `reportBatchItemFailures`, so one bad record fails alone rather than
condemning its batch.

### C-5. The on-failure destination MUST be S3

SQS and SNS on-failure destinations carry **metadata only** — the record identifiers, not the payload. For a
substrate whose items expire in three days, a metadata-only failure record points at data that is gone
before anyone reads the alarm. S3 is the only destination that captures enough to diagnose after the fact.

### C-6. Parse every record with zod at the boundary (GR-017)

The consumer is reading from a store that other services write to. Trusting its shape is the same class of
mistake as trusting an HTTP body.

### C-7. ⚠️ NEVER put a group id or an entity id in an EMF dimension

The repo's cardinality gate rejects it, and moving the id to a metric **property** fixes only the cost half
of the problem. Emit a scrubbed structured log line instead, and keep metrics dimensionless (or dimensioned
only on `service`/`metric`, matching the existing emitters).

### C-8. Selection per group is CONSUMER-SIDE: most-recent-by-timestamp wins

**This withdraws FR-045 and the `supersedes` field of FR-026.** The producer assigns no sequence; the
consumer decides which message for a group is current, by timestamp.

**Why the sequence could not be built.** A monotonic sequence must be issued by the producer, which makes a
**fire-and-forget** producer stateful for a value whose only reader is a consumer that did not yet exist —
and the substrate's producers may run concurrently in more than one task, so there is no single writer of
"the last sequence I used". More importantly the sequence was solving a problem the substrate already
solves: FR-045's stated hazard is a redelivered `processing` overwriting a terminal `succeeded`, and a
consumer that **re-queries an ordered group** (C-1) can never observe that, because it never reads one
message in isolation.

**⛔ The precondition, stated so it is checked rather than assumed: SINGLE WRITER PER GROUP.** Timestamp
selection is correct only while one writer produces a group's messages. Two concurrent writers for one
entity can stamp out of order relative to their true sequence, and most-recent-wins would then pick the
loser. Every producer named today satisfies this — a bulk import job owns its entities, and food's
resolution pipeline is the single writer for a food. **A future producer that shares a group with another
writer MUST NOT rely on this rule**; it needs its own ordering discipline, and adding one is a decision, not
an implementation detail.

**What is unaffected.** `idempotencyKey` (FR-018/FR-038) and payload-identity dedup (FR-037) are untouched —
they answer _"have I already seen THIS message?"_, which is a different question from _"is this still the
current truth for this entity?"_ FR-045's own analysis of that distinction stands; only its mechanism is
replaced.

### C-9. ⛔ The substrate is NOT a backfill source

Anything published before 014's consumer exists is **gone** before that consumer can read it: the substrate's
3-day reaper outruns 014's delivery window, and PR 91 ships the producer half with no consumer at all. 014
starts from an empty pending set. It MUST NOT be specified, planned, or tested as though it can replay
history from the substrate.

### C-10. The substrate and 014's pending set are TWO stores

The substrate (DynamoDB, 3-day TTL, reaped) is a **log a consumer reads**. 014's pending set (Valkey, this
spec) is **state a consumer mutates** — ack deletes it, and dedup compares against what is currently pending.
Merging them would put ack-and-dedup semantics onto a table whose producers must stay ignorant of consumers,
which is the property R1.1 exists to protect. See [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md)'s
2026-08-16 amendment, which also records that ADR's escalation clause firing for the substrate and **not**
for this pending set.

**Consequences for this spec's existing text.** FR-045 is superseded in full by C-8; the `supersedes` bullet
in FR-026 and the `PublishEnvelope` entry's `supersedes` field are withdrawn with it. Scenario 92's
T1-before-T2 ordering guarantee is now satisfied by C-1's ordered re-query rather than by a producer
sequence. Every behaviour in C-1…C-10 becomes a test scenario when 014 is implemented.
