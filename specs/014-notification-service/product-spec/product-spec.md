# Product Spec: Notification Service

**Branch**: `014-notification-service`
**Status**: Bootstrapped / pending revalidation
**Date**: 2026-05-10

---

## Vision

**Runtime**: Node 24.x (per monorepo `.nvmrc` and root `package.json` engines field).

The Notification Service is the single owner of message delivery from backend services to clients. Any feature that needs to tell a user (or a group of users, or all users) that something happened publishes a message; clients that match the message's recipient descriptor receive it and dispatch behavior based on a `messageType` keyword.

**Tagline**: "One publish API. Any recipient. Client decides what it means."

**Core principles**:

- **Producers don't know transports.** A service publishes a message. It does not care whether the recipient is connected, polling, or absent.
- **Recipient descriptor is first-class.** Single user, group, and global are equally supported and modeled the same way.
- **Type-driven client dispatch.** Every message carries a `messageType` keyword; the client (web or mobile) decides how to render and react.
- **Transport is an implementation detail.** Push (e.g., WebSocket), pull (client polling/retrieval), webhook callback, or a hybrid are all valid implementations of the subscriber side. The product contract does not pin one mechanism.

---

## Personas

> Personas use canonical IDs from `specs/cross-feature-consistency-report.md`. Cross-cutting infrastructure features inherit personas from the consumers they serve; the personas below summarize who is impacted, not new archetypes.

### Primary — All consumer-feature personas (P1..P9)

Notifications surface inside flows owned by other features. The relevant launch-time consumers are:

- **P4 Sam (Nutrition & Diet Planner)** — receives `food.backfill.completed` from feature 003 when a pending ingredient resolves.
- **P1..P9 generally** — receive recipe lifecycle, AI disclosure, timer, and compliance-gap events from features 001 / 005 / 008 / 009 as those producers come online.

### Secondary — Operations Engineer (canonical persona, internal)

- Needs to publish system-level / global broadcasts (e.g., maintenance windows).
- Needs to observe delivery health (publish volume, subscriber count, undeliverable count) without owning the transport themselves.

### Out of scope

External webhook consumers are **not** modeled as personas in this revision. Webhook delivery, if chosen at implementation time, is a transport detail to existing recipients, not a separate consumer class.

---

## Producers (launch-relevant)

| Producer feature         | Example `messageType` keywords                      | Notes                                                            |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------- |
| 003 — USDA Food Data     | `food.backfill.completed`, `food.fetch.failed`      | First confirmed consumer (US-005).                               |
| 001 — Commise          | recipe lifecycle events owned by 001                | Listed in 001 product-spec; specific events still to be specced. |
| 005 — AI Integration     | AI-generated content disclosure events owned by 005 | Per cross-feature report.                                        |
| 008 — Cooking Mode       | timer alert events owned by 008                     | Per cross-feature report.                                        |
| 009 — Nutrition Planning | compliance-gap events owned by 009                  | Per cross-feature report.                                        |

Each producer owns its own `messageType` namespace. The notification service does not validate semantic content beyond schema-level checks on the envelope.

---

## Epics

1. **Publish API** — Generic, authenticated publish endpoint usable by any backend service.
2. **Recipient model** — Descriptor that resolves a publish to one user, a group, or global.
3. **Subscription / delivery** — Mechanism for a client to declare interest and receive matching messages. Specific mechanism deferred to implementation.
4. **In-app surface** — Client-side primitive for rendering received messages, dispatched by `messageType`.

    **The attachment point already exists and is waiting.** Both clients ship a
    notifications control in the home chrome today — `HomeTopBar.tsx` in
    `packages/apps/commise/web` and its mobile counterpart, labelled from
    `i18n/messages.ts` (`chrome.notifications`). It is deliberately inert, and the
    source comment states why: _"No count badge — there is no notifications service
    in v1, and a fabricated number is exactly what this surface refuses to show."_
    This feature is what that control is waiting for. Launch scope for this epic is
    therefore: an unread count on the existing bell, and a feed surface it opens.
    Per the repo's cross-platform rule, web and mobile ship in the same release.
5. **Operational visibility** — Minimum publish/delivery counters needed to confirm the system is alive in production.

---

## MoSCoW Story Map

> **Numbering authority.** These ids match [`../spec.md`](../spec.md) exactly. They
> were **renumbered on 2026-08-05** to close a collision in which the same `US-NNN`
> denoted different stories here and in `spec.md` (sync-report DRIFT-001). `spec.md`
> is the anchor because `tasks.md` and all 31 `REQ-NNN` rows in `v-model/` already
> key off it. The original numbering is preserved in the mapping table below — cite
> ids from this table when reading any artifact written before 2026-08-05.

<details>
<summary>Pre-2026-08-05 → current id mapping</summary>

| Original (this file) | Current (all artifacts) | Story                              |
| -------------------- | ----------------------- | ---------------------------------- |
| US-001 + US-002      | **US-001** (merged)     | Publish + single-user routing      |
| US-003               | **US-002**              | Group recipient routing            |
| US-004               | **US-003**              | Global broadcast                   |
| US-005               | **US-004**              | Client dispatch by `messageType`   |
| US-006               | **US-005**              | Catch-up after disconnect          |
| US-007               | **US-006**              | Operational counters               |
| US-008               | **US-007**              | Authenticated subscription         |
| US-009               | **US-008**              | Envelope schema validation         |
| _(none — see below)_ | **US-009**              | `messageType` registry enforcement |
| US-010               | US-010                  | Producer-defined idempotency key   |
| US-011               | US-011                  | Per-feature publish quotas         |

`US-009` had no story in this map before 2026-08-05: the capability entered via the
Q-005 resolution and was implemented downstream (`tasks.md` T-014, `v-model` REQ-016 /
REQ-017) without ever being promoted into the story map (DRIFT-006). It is now stated
below as the deliberate Should Have it always was.

</details>

### Must Have (launch)

1. **US-001 — Service publishes a user-addressed notification**
   A backend service authenticates and publishes a message containing `{ recipient, messageType, payload, occurredAt }`. The publish call returns success when the message is durably accepted, regardless of whether any subscriber is currently connected. When `recipient = { kind: "user", id: <userId> }`, the message is delivered to (or made retrievable by) every active client of that user, and only that user.

2. **US-002 — Group recipient routing**
   When `recipient = { kind: "group", id: <groupId> }`, the message is delivered to every user that is a member of the group at delivery time. Membership is resolved against the identity service's group model (Q-002).

3. **US-003 — Global broadcast**
   When `recipient = { kind: "global" }`, the message is delivered to every authenticated client, scoped to the application. Global broadcasts are **live-only** — they are not retained for offline catch-up (see Q-009).

4. **US-004 — Client receives and dispatches by `messageType`**
   A connected client receives matching messages and invokes a handler keyed off `messageType`. Unknown `messageType` values do not crash the client; they are logged and ignored.

5. **US-005 — Catch-up after disconnect**
   A client that was offline when a message was published can still receive (or pull) messages addressed to it within a defined retention window once it reconnects. Applies to `user` and `group` recipients only.

6. **US-006 — Operational counters**
   Operations Engineer can observe at minimum: publish rate per producer, delivered count, undelivered count after retention window, current active subscriber count.

### Should Have

7. **US-007 — Authenticated subscription**
   Clients must be authenticated via the existing auth mechanism before they can subscribe; recipient resolution uses the authenticated identity, not client-supplied identity claims.

8. **US-008 — Message envelope schema validation**
   Publishes that violate the envelope schema are rejected with a structured error before being durably stored.

9. **US-009 — `messageType` registry enforcement**
   Each producer registers its `messageType` keywords in a shared, version-controlled registry. Unregistered types are tolerated but counted; once enforcement is enabled per environment, they are rejected at publish. (Promoted from the Q-005 resolution on 2026-08-05.)

### Could Have

10. **US-010 — Producer-defined deduplication key**
    Producer may attach an optional `idempotencyKey`; duplicate publishes with the same key inside a defined window collapse to one delivery.

11. **US-011 — Per-feature publish quotas**
    A producer feature can be rate-limited independently to protect the shared infrastructure.

### Won't Have (this release)

- Email transport.
- Mobile push transport (APNs / FCM).
- User-facing notification preferences (opt-in/opt-out per `messageType`).
- Localization / templating.
- Cross-tenant routing.
- Read/delivery receipts surfaced back to producers.

---

## Out of Scope

- Owning the meaning of any specific `messageType`. Producers define their own namespace and document it in their own feature.
- Replacing transactional email flows owned by auth (002) or other product flows.
- Storing user-facing notification history as a long-term inbox UI. A short retention window is sufficient for catch-up; a richer inbox is a future feature if needed.

---

## Contract sketch (informational, not prescriptive)

> The shape below is illustrative. Concrete field names, transport, and persistence choices are implementation-time decisions.

**Publish envelope** (producer → service):

```text
{
  recipient: { kind: "user" | "group" | "global", id?: string },
  messageType: string,                // producer-owned keyword namespace
  payload:     <opaque, producer-defined>,
  occurredAt:  ISO-8601 timestamp,
  idempotencyKey?: string             // optional (US-010)
}
```

**Delivery envelope** (service → client):

```text
{
  id:          string,                // service-assigned
  messageType: string,
  payload:     <as published>,
  occurredAt:  ISO-8601 timestamp,
  publishedAt: ISO-8601 timestamp
}
```

**Recipient match rule**:

- `user` → matches if subscriber's authenticated user id equals `recipient.id`.
- `group` → matches if subscriber's user id is a member of `recipient.id` at delivery time.
- `global` → matches every authenticated subscriber.

---

## Open Questions

- **Q-001 — Delivery mechanism** _(resolved 2026-08-05)_: **Hybrid.** A durable SQS
  FIFO ingest/routing queue accepts publishes, a realtime push path serves connected
  subscribers, and a pull/replay endpoint serves reconnecting ones. Producers remain
  transport-agnostic. Full design in [`../plan.md`](../plan.md) → _Ordering &
  Partitioning_ and _Transport and Queue Architecture Choice_.

- **Q-002 — Group membership source of truth** _(resolved 2026-08-05, owner decision)_:
  **The identity service owns groups, and this feature builds them.** Groups are a
  first-class identity concept — a `group` and `group_membership` model in
  `packages/services/identity` with its own API — and are explicitly **not** mapped
  onto Clerk Organizations. The notification service resolves membership against that
  API at delivery time, preserving FR-022.

    Rejected alternatives: (b) a membership store owned by 014 (creates a second
    source of truth for who is in a group, guaranteed to drift from identity);
    (c) producer-side expansion (pushes fan-out into every producer and makes
    `recipient.kind = "group"` a fiction); Clerk Organizations (binds the group model
    to an external vendor's tenancy semantics, which is not what these groups are).

    **Scope consequence:** feature 002 is shipped, so this work lands as an extension
    to the identity service delivered under 014. It is new capability, not a
    dependency to wait on — tracked in [`../tasks.md`](../tasks.md) (identity-groups
    task block) and [`../plan.md`](../plan.md) → _Group Model (identity service)_.

- **Q-003 — Catch-up retention window** _(resolved 2026-08-05)_: **24 hours**, uniform
  across `messageType` and applied to `user` and `group` recipients only. This is the
  floor `spec.md` FR-012 already mandates (`MUST be ≥ 24 hours`) and the value
  `tasks.md` T-009 implements; it is recorded here so the two stop being an
  unreconciled default. Revisit only with production evidence of missed catch-up.

- **Q-004 — Authentication strategy for producers**: Are publishes authenticated via service-to-service tokens (e.g., signed JWTs from a service registry), per-feature API keys, or AWS IAM? Should align with feature 002's auth approach.

- **Q-005 — `messageType` namespace governance** _(resolved 2026-05-10)_: A **central registry** of allowed `messageType` keywords is required. Each producer feature must register its keywords (and a short human description) in a shared, version-controlled registry before publishing. Unknown `messageType` values are still tolerated by clients (logged + ignored, per US-005), but publishes of unregistered types will be flagged by operational counters and may be rejected once the registry is enforced. This trades a small amount of producer agility for client-developer discoverability and avoids silent keyword collisions across features.

- **Q-006 — Global broadcast safety**: `recipient = global` is powerful and dangerous. Should it require an additional capability/role check beyond the standard publish auth? At minimum it should be observable in operational counters.

- **Q-007 — Failure semantics on unknown recipient** _(resolved — decision already
  recorded in `spec.md`, restated here 2026-08-05)_: **Counter increment, never an
  error to the producer.** Publishing to an unknown user id succeeds at the API
  boundary (deliberately decoupled from identity lookup) and increments an
  "undeliverable, unknown recipient" counter; publishing to an empty group succeeds
  with zero deliveries and a counter increment. See `spec.md` → _Edge Cases_. The
  rationale is that publish-time identity validation would couple every producer's
  write path to identity availability.

- **Q-009 — Are global broadcasts retained for offline catch-up?** _(new, opened
  2026-08-05)_ `spec.md` FR-012 scopes retention to `user` and `group` recipients,
  and its edge case is explicit: _"broadcasts published while a client is offline
  beyond the retention window are dropped for that client."_ But
  [`user-journey.md`](./user-journey.md) Journey C step 4 states disconnected clients
  _"retrieve it later if still relevant"_ (sync-report DRIFT-013). The story map above
  now follows `spec.md` (live-only). Confirm at the revalidation gate, then correct
  Journey C — an operational maintenance broadcast that silently misses every offline
  client is a defensible product choice, but it must be a stated one.

- **Q-008 — Ordering guarantees** _(resolved 2026-05-10, research-backed)_: **Per-recipient FIFO** for `recipient.kind ∈ { user, group }`. Messages addressed to the same recipient are delivered in publish order; no cross-recipient and no cross-producer ordering is guaranteed. **Global broadcasts (`recipient.kind = "global"`) are best-effort ordered only**, matching industry practice (Ably multi-consumer queues, AWS SNS FIFO carve-outs, Knock broadcast vs. per-user feed). Implementation implication: the transport must support a partition-key-per-recipient model (e.g., SQS FIFO `MessageGroupId = recipient.id`, Kafka partition by recipient, or per-recipient WebSocket channel with monotonic sequence). Producers MAY still send `idempotencyKey` (US-010); consumers MUST treat handlers as idempotent regardless.

---

## Traceability (incoming)

- Resolves `specs/cross-feature-consistency-report.md` §5.3 and warning **WA-004**.
- Unblocks feature 003 US-005 dependency on a notification consumer for `food.backfill.completed`.
