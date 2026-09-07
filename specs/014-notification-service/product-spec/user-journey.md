# User Journeys: Notification Service

**Branch**: `014-notification-service`
**Date**: 2026-05-13
**Status**: Bootstrapped from [product-spec.md](./product-spec.md)

---

## Journey A — A producer publishes an in-app notification

**Actor**: Producer service
**Goal**: Notify one or more recipients without knowing the active client transport.

1. A producer detects a domain event that should be surfaced to users, and resolves the recipients itself.
2. The producer publishes an envelope — `schemaVersion`, recipient descriptor, message type, payload,
   `occurredAt`, and an `idempotencyKey` derived from its own durable state — by **one of two ingresses**:
   a synchronous authenticated HTTP call, or an event on the notification bus under the reserved
   `detailType`. An async producer takes the event path so publishing does not become a second write inside
   its transaction.
3. The notification service validates the contract and stores the message. Both ingresses run the identical
   validation, registry, authorization, idempotency and durability logic.
4. The service attempts live delivery for currently connected recipients.
5. Offline recipients can retrieve the message later through the replay/pull surface.
6. Delivery status and failures are observable by operations. A rejection on the HTTP path returns a
   structured error to the producer; on the event path there is no caller, so it dead-letters with a reason
   code and the DLQ is alarmed.

**Success evidence**: producers do not select delivery transport; the same envelope over either ingress
produces an identical delivery; idempotent retries do not duplicate messages; recipient authorization is
enforced server-side; a rejection is never silently dropped.

**Where correlation lives**: if the producer's unit of work fans out into many completions, it correlates
them itself and publishes **one** envelope. This service never merges envelopes — it cannot, without reading
`payload`, and it does not know what counts as one outcome to a user.

---

## Journey B — A user receives a food resolution notification

**Persona**: P4 Sam / nutrition and food-data consumer
**Goal**: Know when a previously pending food lookup is ready.

1. The food service resolves the food and emits its own domain event, `FoodFetchCompleted`.
2. The **recipe service** consumes that event, resolves which of its users asked for the ingredient, and
   publishes one `food.resolution.completed` envelope per requester onto the notification bus. It — not the
   food service — owns the subscription set, because `FetchQueueDao.resolve` deletes the food service's
   `fetch_requesters` rows in the same transaction that completes the food.
3. Sam's active client receives the message.
4. The client dispatches behavior based on `messageType`.
5. Sam opens the notification and lands on the relevant food or nutrition context.

**Success evidence**: multiple requesters can be notified; the message deep-links to the correct context;
stale or unauthorized recipients do not receive data; a `FoodFetchCompleted` redelivered by EventBridge does
not produce a second notification, because the `idempotencyKey` is derived from the resolution's durable
state rather than from the event.

**If the resolution belongs to an import**, the recipe service correlates all of that import's ingredient
resolutions against the import's own job identity and publishes **one** envelope. An import of 30 unknown
names yields one notification, not 30. That collapsing happens in the publisher; this service delivers what
it is given.

---

## Journey C — Operations sends a global broadcast

**Actor**: Operations engineer
**Goal**: Send maintenance or incident messaging without adding feature-specific code.

1. Operations authenticates through approved admin tooling.
2. Operations publishes a `global` recipient notification with a constrained message type.
3. The service validates authorization and records the broadcast.
4. Connected clients receive the message; disconnected clients retrieve it later if still relevant.
5. Operations monitors delivery volume and error rates.

**Success evidence**: global broadcast permissions are restricted; broadcasts are auditable; expired messages are not shown after their relevance window.
