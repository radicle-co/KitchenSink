# Implementation Plan: Notification Service

**Branch**: `014-notification-service` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-notification-service/spec.md`

---

## Summary

Feature 014 is the platform-owned notification delivery interface for KitchenSink. It provides a single publish contract and authenticated subscriber delivery for `user`, `group`, and `global` recipients, with client-side behavior keyed by `messageType`.

Producers reach it over **two ingress paths** — an authenticated HTTP endpoint and an EventBridge
subscription — which are adapters over **one** core (FR-024). See _Producer ingress_ below; a rule enforced
in only one of them is a defect, not a variation.

This plan is milestone-aware for `M8` and explicitly inventories cross-feature trigger ownership (`001`–`013`) so integration can be coordinated as the final v1 deliverable.

**Must Have stories addressed**: US-001 – US-006 **plus US-012 and US-013** (`spec.md` numbering: publish +
user routing, group routing, global broadcast, client dispatch, catch-up,
operational counters, **client acknowledgement**, **payload deduplication**).
US-007 – US-009 are Should Have and US-010 / US-011 are Could Have; all are planned below.

> US-012 (ack) and US-013 (payload dedup) were added to `spec.md` on 2026-08-12 as **P1**, on the owner's
> retention/dedup directive. They are not enhancements to US-001: without an ack the service cannot tell
> "delivered" from "consumed", which is what the previous 24-hour clock papered over. Reasoning:
> [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md).

> The previous revision of this line read _"US-001 … US-007"_, which resolved to a
> different story set depending on whether the reader used product-spec or `spec.md`
> numbering (sync-report DRIFT-001). Both artifacts now use `spec.md` ids.

---

## Milestone Context (`M8` Mordor)

Source of truth: [`../v1-launch-plan.md`](../v1-launch-plan.md) (§3.9).

- Artifact remediation required by M8: `plan.md`, `tasks.md`, `review.md`, `verify-report.md`.
- This artifact covers planning remediation and integration sequencing.
- Remaining M8 exit gates (verification evidence, release-audit unblock, full surface integration) are tracked in [`tasks.md`](./tasks.md).

---

## Governance Alignment

Source of truth: [`../governance-rules.md`](../governance-rules.md).

- **GR-002 (CRITICAL)**: All APIs constrained to `/api/v1/notifications/*`. The EventBridge ingress
  (FR-024) exposes no URL, so GR-002 does not reach it; its equivalent constraint is the reserved
  `detailType` plus the `source` allowlist (FR-025, FR-027).
- **GR-007 (CRITICAL)**: Shared core entities must come from `@kitchensink/recipe-core`; no local duplicate shared domain types.
- **GR-011 (WARNING)**: 014 is owner of notification transport/delivery; producer features publish through 014.
- **GR-008 (WARNING)**: Node runtime remains Node 24.x.
- **GR-009 (WARNING)**: New package naming follows `@kitchensink/{group}-{name}`.
- **GR-015 (CRITICAL)**: the notification service **authors** its wire contract as zod at `src/**/*.schema.ts`
  and publishes it as the generated, committed `@kitchensink/schema-notifications`
  (`packages/schemas/notifications`); **every consumer — subscribers AND producers — imports the envelope and
  declares no wire shape of its own**. `openapi.yaml` is derived and outbound-only, never a codegen input. Full
  bindings: [`spec.md` → _Wire Contract Ownership (GR-015)_](./spec.md#wire-contract-ownership-gr-015).
  Normative source: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md); reasoning and rejected
  alternatives: [ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).
- **GR-016 (CRITICAL)**: every ingress this service owns is parsed at the boundary by the authored zod —
  the HTTP publish body, the ack body, the subscribe/replay inputs, and the EventBridge event (wrapper first,
  then `detail` as an envelope). ⛔ Server-side **response** validation stays DEFERRED (GR-016 §16-g) and must
  not be "completed"; the `DeliveryEnvelope` is parsed by the **subscriber on receipt** instead.
- **GR-017 (CRITICAL)**: this is a NEW service, so it owes the whole 17-a list **on the day its package is
  created** — authored zod, a `contract:generate` script, a committed `packages/schemas/notifications` with a
  derived `openapi.yaml`, a `CONTRACT_HASH` boot assertion, **`nestjs-zod`'s** `ZodValidationPipe` (never
  Nest's own), `z.strictObject()` on every mutating body, validated non-HTTP ingress, and all four test tiers.
  ⛔ **17-e.12 — client work is its own deliverable and carries its own TASKS.** Measured 2026-08-12, not one
  `tasks.md` in this portfolio had a schema-package, `CONTRACT_HASH` or receipt-validation task; see
  [`tasks.md`](./tasks.md) → _Contract & Client Deliverables_.
- **GR-018 (CRITICAL)**: ONE rejection path per ingress carrying the cause in a `reason`; a credential failure
  and a shape failure are equally invalid and differ only in `reason`; an invalid payload is **never retried**;
  a rejected event is **not** recorded as a row (FR-042).
- **GR-019 (CRITICAL)**: no identifier is ever a sentinel. `producer`, `recipient.id`, the notification id and
  the subscriber id are REQUIRED wherever consumed; the only generation point is the notification id at
  publish-accept, which is a create (ULID) — FR-043.
- **GR-020 (CRITICAL)**: the publish ingress is a **dual-signal principal binding** — the transport signal
  resolves through the version-controlled producer registry to a name, the envelope's `producer` must equal it,
  the mapping is injective and asserted at boot, and a mismatch is a rejection (FR-041). 014 is the only edge
  in the portfolio that GR-020 binds today.

---

## Transport and Queue Architecture Choice (from research + spec constraints)

### Chosen v1 architecture

**Hybrid in-app model**:

1. **Durable ingest + routing queue (required)**
    - Producer publish requests are validated and durably accepted before success response (FR-003).
    - Routing jobs are processed asynchronously so producer latency is stable under burst.

2. **Realtime push delivery (primary online path)**
    - Authenticated subscribers receive low-latency in-app delivery (aligned with timer-alert latency constraints from 008 references).

3. **Catch-up pull/replay (required offline path)**
    - User/group notifications are retained for reconnect replay **until the client acks them (FR-034) or 72
      hours elapse, whichever comes first** (FR-012, amended 2026-08-12). Redelivery of an unacked notification
      **is** the retention mechanism, not a degenerate case (FR-039).
    - **Superseded**: this line previously read "retained for reconnect replay (FR-012, min 24h)". Both halves
      of that are now wrong — the window is 72 hours and the clock is no longer the only terminating condition.

### Why this choice

- `research/codebase-analysis.md` identifies **time-sensitive timer events (008)** and **offline catch-up need (003/general reconnect)**.
- Product spec keeps transport implementation-open (Q-001), while feature requirements force both low-latency and durable catch-up.
- Hybrid push + replay satisfies both without constraining producers to transport details.

### Deferred transports

- Email, mobile push, and external webhook delivery are explicitly deferred as post-launch expansions.

---

## Ordering & Partitioning (FR-008, FR-009, SC-002)

> Added 2026-08-05. The previous revision of this plan chose a three-path hybrid
> without stating how per-recipient FIFO survives it — the feature's hardest
> guarantee was unplanned (sync-report DRIFT-002).

### The problem this section exists to solve

A message can reach a client by two different routes: **live push** (queue →
consumer → open connection) and **replay** (store → reconnect pull). If those two
routes each decide order independently, FR-008 is violated the moment a client
reconnects mid-stream — which for mobile is constantly. There must be exactly one
authority for "what order did messages for recipient R occur in".

### Decision: SQS FIFO is the ordering authority; the store records its verdict

**Ordering authority**: an SQS **FIFO** queue with `MessageGroupId = recipient.id`
(for `kind ∈ {user, group}`). SQS guarantees strict FIFO **per message group**,
which is exactly per-recipient FIFO, and no ordering across groups — precisely what
FR-008 promises and FR-008's second sentence disclaims.

**The queue preserves ENQUEUE order, which equals publish order on the HTTP path only
(FR-029).** EventBridge does not preserve ordering, so two envelopes for one recipient
can arrive at the adapter in either order regardless of when their producers published
them. Envelopes arriving that way MUST therefore be ordered by the producer-assigned
`occurredAt`, with a deterministic tiebreaker (`producer`, then `idempotencyKey`), before
or as they are enqueued — otherwise the FIFO queue faithfully preserves an arrival order
that is not publish order, and FR-008 becomes silently untrue for every event-path
producer. `occurredAt` is why FR-026 makes it required and producer-assigned rather than
stamped on receipt. If cross-path FIFO for a single recipient proves unachievable in
implementation, FR-008 is narrowed explicitly rather than left to imply a guarantee the
transport does not provide.

**Sequence assignment happens once, at consume time.** The routing consumer, on
dequeue, assigns a monotonically increasing `sequence` and writes the pending entry
carrying it **atomically** (one Lua script, one slot — see _Atomicity_ below). The
store therefore **records** the order SQS produced; it never computes its own.

⚠️ **`sequence` is scoped to the RECIPIENT USER, not to `recipient.id`** _(refined 2026-08-12)_. The pending
set is per recipient **user** — FR-035 settles a group notification **per member**, so each member owns their
own pending entry over one stored envelope — and one user can be a member of several groups while also
receiving `user`-addressed notifications. A `sequence` scoped to `recipient.id` would put three independent
counters into one user's ordered set and collide inside it. So: the **ordering authority** is the FIFO group
(`MessageGroupId = recipient.id`), and the **score** is a per-recipient-user counter (`notif:seq:{u:<userId>}`)
incremented as each member's entry is inserted. A group's publishes therefore land in every member's stream in
the order the FIFO group produced them, which is what FR-008 promises; nothing needs a group-scoped counter.

**Both delivery paths read the same `sequence`:**

| Path          | Order source                                                                         |
| ------------- | ------------------------------------------------------------------------------------ |
| Live push     | consumer emits in dequeue order — the order it just wrote                            |
| Replay / pull | ascending `sequence` range over the recipient's pending sorted set (`ZRANGEBYSCORE`) |
| Client        | dedupes and orders by `(recipient, sequence)`; ignores duplicates                    |

Because a single writer assigns `sequence` in dequeue order, live and replay cannot
disagree. A client that reconnects mid-stream sees a contiguous, gap-free sequence
and can detect a gap and re-pull.

**`recipient.kind = "global"`** does **not** use a FIFO group. Globals publish to a
standard queue and are best-effort ordered (FR-009), live-only (Q-009), and carry no
`sequence`.

### Consequences of choosing SQS FIFO — accept these deliberately

1. **Throughput ceiling.** SQS FIFO is limited per `MessageGroupId`, and the
   account-level FIFO limits (300 TPS without batching, 3 000 with) are a hard cap on
   publish rate. Fan-out to a large group must not become one message per member on
   the ingest queue — publish once addressed to the **group**, and expand membership
   in the consumer, so group size costs consumer work, not queue throughput.
2. **SQS's own dedup window is 5 minutes, and that is NOT FR-018 — nor is it FR-037.** FR-018 requires a
   _configurable_ `idempotencyKey` window and FR-037 requires dedup on a **canonical payload hash** that lasts
   as long as the notification is pending (up to 72 h). Content-based dedup on the queue implements neither: its
   window is fixed and its identity is the whole message body, which includes `occurredAt` — a field the dedup
   identity must **exclude**, because it changes on exactly the producer retry dedup exists to collapse. Both
   claims therefore live in the FR-040 store as their own keys (`notif:dedup:payload:*`, `notif:dedup:key:*`);
   the queue's 5-minute window is at best a coincidental first line of defence. See T-061 (payload identity) and
   T-015 / T-062 (the idempotency claim, and why it survives an ack).
3. **In-flight cap.** FIFO queues cap in-flight messages; a stuck consumer for one
   recipient blocks that recipient's group only, which is the desired blast radius,
   but it must be alarmed (see NFR budgets).
4. **Delivery is at-least-once.** SQS does not promise exactly-once delivery to the
   consumer. This is why `spec.md` US-010 says consumers MUST treat handlers as
   idempotent, and why the client dedupes on `sequence`. As of the 2026-08-12 amendment this is **structural
   rather than defensive**: redelivering an unacked notification is how retention works (FR-039), and SC-011 is
   narrowed to **effectively-once within the claim window** — at most one notification per
   `(producer, idempotencyKey)`, and never zero.

### Atomicity — one script, one slot, and one ordering that must NOT be "simplified"

> Added 2026-08-12 with the store change (FR-040). The previous revision leaned on a SQL transaction for
> "assign `sequence` and persist in one step"; the retained set is now a cluster-mode Valkey cache
> ([ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md)
> decision 6), which has no transaction spanning slots. Everything below is what replaces that guarantee.

**All of one recipient's keys share a hash tag** (`{u:<userId>}` for a user, `{g:<groupId>}` for a group), so
publish-accept — payload-dedup claim, `sequence` assignment, envelope write, pending insert — is **ONE Lua
script in ONE slot**. ElastiCache Serverless runs in **cluster mode**, so a script may not span slots; the hash
tag is not a tidiness convention, it is the precondition for the script existing at all.

**The producer-scoped idempotency claim is a different slot, so it is a separate command.**

⚠️ **DELIBERATE — the order is: create the notification FIRST, take the idempotency claim SECOND. Do not
"tidy" the two into one order for symmetry.**

| Order                 | A crash between the two leaves…  | Consequence                                                                     |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| **create → claim** ✅ | a notification with **no claim** | a possible **visible duplicate** on redelivery — noticeable and **recoverable** |
| claim → create ❌     | a claim with **no notification** | **silently suppresses** a notification that was never created — undetectable    |

Prefer the visible duplicate over the invisible loss. This is the same mirrored-order reasoning as
[ADR-0005](../../docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md)'s preview-domain pair
(creation takes the Vercel claim **before** publishing DNS; teardown deletes DNS **before** releasing the
claim), and it must survive the same instinct to make the two halves look alike.

**Group fan-out is per member, each in that member's own slot, and must be idempotent under SQS redelivery.**
The publish is accepted once addressed to the **group** (one envelope, in the group's slot). The routing
consumer expands membership at delivery time (FR-022) and inserts one pending entry per member — each a separate
command in that member's slot, because a script cannot span members. Two properties follow and both are
testable requirements, not implementation detail:

- **Idempotent per member.** SQS redelivers; a replayed fan-out must not add a second pending entry for a member
  who already has one. The insert is conditional on the member not already holding an entry for that
  notification id.
- **No `sequence` gaps.** A retry must not burn a counter value it then fails to use, or the recipient's stream
  develops a hole and the client's gap detection (which re-pulls) fires forever. Reserve-then-insert inside one
  per-member atomic step, and treat "entry already present" as success without incrementing.

---

## Group Model (identity service) — Q-002 resolution

> Added 2026-08-05 (owner decision). `spec.md` A-002 required this plan to define the
> group-membership lookup and the previous revision never did; `tasks.md` T-005
> meanwhile assumed a "002 group membership API" that does not exist
> (sync-report DRIFT-003).

**Groups belong to the identity service, and this feature builds them.** They are
**not** Clerk Organizations — the group concept here is a KitchenSink domain concept
(a household, a shared collection's audience), and binding it to an external vendor's
tenancy model would couple an application concept to Clerk's billing/tenancy
semantics.

Feature 002 is shipped, so this lands as an **extension to
`packages/services/identity`** delivered under 014:

| Element         | Detail                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables          | `group` (id ULID, name, created_at), `group_membership` (group_id, user_id, joined_at) — Drizzle, in the identity DB alongside users/accounts/profiles                                 |
| Ownership       | identity service — the single source of truth for "who is in group X"                                                                                                                  |
| API             | `/api/v1/groups/*` (GR-002 prefix), Clerk-authenticated per the existing `AuthMiddleware`                                                                                              |
| 014's use       | membership resolved at **delivery time** in the routing consumer (FR-022), never at publish time                                                                                       |
| Failure posture | identity unavailable at delivery → the message stays on the queue and retries; it is **not** dropped and **not** failed back to the producer (whose publish already succeeded, FR-003) |

**Cross-feature note:** groups are useful well beyond notifications (001 shared
collections, 006/007 household planning). Building them in identity rather than
inside 014 is what keeps them reusable. Their API surface is owned by the identity
service and must be specced there, not left implicit in 014 — see the open item in
[`./review.md`](./review.md).

---

## Data Model (FR-012, FR-018, FR-037, FR-040, retention)

> Added 2026-08-05; **rewritten 2026-08-12** for the owner's retention/dedup directive. The retained set is no
> longer three PostgreSQL tables — it is keys in **ElastiCache Serverless for Valkey** (FR-040). What each
> superseded table was for, and why it is not coming back, is recorded at the end of this section so nobody
> reintroduces it. Reasoning and rejected alternatives:
> [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md).

### The retained set — key layout (FR-040)

Every key belonging to one recipient carries the **same hash tag** — `{u:<userId>}` or `{g:<groupId>}` — so the
whole publish-accept path lands in one cluster slot and can be one Lua script (see _Atomicity_ above). All
access goes through **ONE repository module** (`src/persistence/pending-set.repository.ts`, T-053), which is what makes
the escalation to MemoryDB or DynamoDB+TTL a store swap rather than a rewrite (FR-040).

| Key                                               | Valkey type       | Holds                                                                                                                                                                             | Lifetime                                                                   |
| ------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `notif:msg:{u:<userId>}:<id>`                     | hash              | the accepted envelope, stored **ONCE** — `schemaVersion`, `recipient`, `messageType`, `producer`, `payload`, `occurredAt`, `idempotencyKey?` — plus `publishedAt` and `expiresAt` | until ack (all referents settled) or `expiresAt`; TTL as the backstop      |
| `notif:msg:{g:<groupId>}:<id>`                    | hash              | the same, for a **group**-addressed publish — one copy referenced by every member's pending entry                                                                                 | as above                                                                   |
| `notif:pending:{u:<userId>}`                      | **sorted set**    | one recipient **user's** pending queue: member = notification `id`, score = `sequence`                                                                                            | entries removed on ack (FR-034) or by the expiry sweep (FR-012)            |
| `notif:seq:{u:<userId>}`                          | string (`INCR`)   | that user's monotonic `sequence` counter — the score authority                                                                                                                    | long-lived; never reset (a reset would replay scores and reorder a stream) |
| `notif:attempts:{u:<userId>}`                     | hash `id → count` | FR-039's per-notification delivery-attempt count, per **member** (a group's members fail independently)                                                                           | removed with the pending entry                                             |
| `notif:dedup:payload:{u:<userId>}:<h>`            | string (`SET NX`) | value = the **original** notification's `id`; `<h>` = SHA-256 over the RFC 8785 canonical JSON of `{ schemaVersion, recipient, messageType, producer, payload }` (FR-037)         | released on ack **or** at the original's `expiresAt` — **pending-scoped**  |
| `notif:dedup:payload:{g:<groupId>}:<h>`           | string (`SET NX`) | the same, for a group recipient — dedup is **per recipient**, so the same payload to two recipients is two notifications                                                          | as above                                                                   |
| `notif:dedup:key:{p:<producer>}:<idempotencyKey>` | string (`SET NX`) | value = the notification `id` claimed by `(producer, idempotencyKey)` (FR-018)                                                                                                    | its own configured window, default 24 h — ⚠️ **SURVIVES an ack**           |
| `notif:quota:{p:<producer>}`                      | hash              | FR-044's token bucket — `tokens`, `lastRefillAt` — **shared** state, because N API tasks each holding a local bucket grant N× the quota                                           | long-lived                                                                 |
| `notif:quota:global`                              | hash              | the **separate**, service-owned `global` broadcast bound (FR-044) — not a registry field, because a producer allowed to declare its own global quota could declare a large one    | long-lived                                                                 |

⚠️ **Notation collision, resolved here.** ADR-0016 decision 3 writes the dedup keys as
`notif:dedup:payload:{recipientKind}:{recipientId}:{h}` and `notif:dedup:key:{producer}:{idempotencyKey}`, using
`{…}` as **placeholder** notation. In Valkey cluster mode `{…}` is the **hash-tag delimiter**, so read
literally those keys would be tagged on `recipientKind` (every `user` notification in the platform in one slot)
and on `h` (a different slot per payload — which breaks decision 6's single-slot script outright). The forms
above keep the ADR's names and segments and place the **recipient** segment as the literal hash tag; that is the
only placement under which the ADR's own atomicity decision is achievable. Same for the envelope: a bare
`notif:msg:{id}` would tag on the notification id and land the envelope in a slot of its own, so the recipient
tag is the hash tag and `<id>` is a plain suffix.

### Retention (FR-012, FR-036)

- **`expiresAt = publishedAt + 72h`**, absolute, computed **once** at publish-accept and stored on the envelope.
- ⛔ **Nothing refreshes it.** Not a duplicate publish, not a delivery attempt, not a reconnect, not a partial
  ack. Concretely that means the dedup claim is always `SET NX` and **never** `SET` with a fresh TTL and
  **never** `EXPIRE` on a hit — a producer in a retry loop would otherwise hold one notification pending
  forever, growing a metered store on a schedule nobody chose. The 72 hours are a promise to the **recipient**,
  not a budget the producer can top up.
- An **ack** retires the notification for that user immediately, before the clock runs out (FR-034).
- ⚠️ **The undelivered-after-retention counter MUST increment BEFORE the keys are released, or it can never be
  emitted at all (FR-013).** This has a hard implementation consequence: **a passive Valkey TTL cannot satisfy
  it.** When a TTL fires, the key simply ceases to exist with no application code running, so there is nothing
  left to count and nothing to count it. Expiry is therefore driven by a **sweep** that reads entries whose
  stored `expiresAt` has passed, increments the counter, and **then** releases the pending entry, the attempts
  field, the payload-identity claim and (when no referent remains) the envelope. TTLs stay on the keys as a
  **backstop against unbounded growth** if the sweep is down — accepting that a key reclaimed by TTL is one
  uncounted notification, which is preferable to an unbounded metered store. Keyspace notifications are **not**
  a substitute: Valkey delivers them best-effort, at-most-once, to whoever happens to be subscribed.

### Why a fan-out is cheap, and why `global` is not retained at all

**A group of 20 members costs one envelope plus 20 sorted-set members — not 20 copies of the envelope.** The
envelope (the only part that carries `payload`, i.e. essentially all of the bytes) is written once under the
group's tag; each member's pending entry is a sorted-set member holding a ULID and a score, plus one
attempts-hash field. So a group of _n_ costs `E + n·m` where `E` is the envelope and `m` is tens of bytes,
rather than `n·E`. That, the envelope's hard size bound, and the rule below are the three things that keep a
group notification from being a bill.

**`global` is not retained at all.** FR-009 already makes global broadcasts live-only and best-effort, and this
is **also a cost control**: retaining a broadcast per subscriber would multiply one publish by the entire user
base inside a **100 MB metered floor** — the same publish that costs `E + n·m` for a 20-member group would cost
`E + N·m` for every registered user, on a store whose price is measured in stored bytes. Globals carry no
`sequence`, get no pending entry, and are never acked.

### ⛔ Superseded — the three PostgreSQL tables, and what each was for

The previous revision of this section specified a notification-service-owned PostgreSQL schema. It is **gone**,
not merely unused. Named here in full so a contributor reading a stale artifact does not "restore" it:

| Superseded table      | What it was for                                                                                     | What replaces it                                                                                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification`        | the durable record + the replay source, with a `(recipient_kind, recipient_id, sequence)` index     | `notif:msg:*` (the envelope, once) + `notif:pending:*` (the ordered per-user set the replay range reads directly)                                                                                                                                                                                          |
| `delivery`            | a per-**client** delivery row (`notification_id`, `subscriber_id`, `delivered_at`) driving counters | `notif:attempts:*` for FR-039's attempt count, and the **ack** (FR-034) for consumption. ⛔ A per-subscriber row is **not** reintroduced — that is the per-device retention ADR-0016 rejected (the device set is unbounded, unenumerable and has no end-of-life signal), and FR-035 makes ack per **user** |
| `publish_idempotency` | FR-018 dedup on `(producer_feature, idempotency_key)` with a TTL independent of SQS's fixed 5 min   | `notif:dedup:key:*`, plus the **new primary** index `notif:dedup:payload:*` (FR-037) that needs no producer cooperation                                                                                                                                                                                    |

**Consequences of that removal, stated so they are not discovered later:**

- **The notification service owns no relational database and no Drizzle migration.** The Phase 5.5 migration
  plan for this feature therefore covers **only** the identity group tables below. A "notification schema"
  migration is not a missing task.
- **The durability the tables provided is now a named residual risk**, not a free property — see _Store Choice_
  below. If that risk is ever escalated, revisiting this option is legitimate (ADR-0016 → _Alternatives
  rejected_ 2 says so explicitly); it is not a closed door.
- **GR-016 §16-d's storage floor has no column to derive from here.** The bound that matters is the explicit
  **size** bound on the envelope and on `payload`, asserted in the zod as a number — because on a metered cache
  an unbounded payload is not a `500`, it is a bill and a fan-out amplifier. GR-017 §17-d's bidirectional
  parity test binds the **identity group tables**, which do have bounded columns.

### The `messageType` registry is not a table — and not a second file either

The superseded table list above deliberately kept one row that was never a table. Its spirit stands and its
target has moved: the registry is **one `ProducerRegistryEntry` file authored in the notification service**
(`src/registry/producers.registry.ts`), validated at module load by a `*.schema.ts` in the same service, and
copied into `@kitchensink/schema-notifications` by the same `@kitchensink/contract-gen` step that copies the zod
(FR-041). The `messageType` keywords (FR-016) are **nested under** their owning producer entry, alongside that
producer's HTTP token principals, its EventBridge `source` values and its quota magnitudes.

- ⛔ **Not a table** — a runtime write would change a trust boundary with no review and no deploy.
- ⛔ **Not a second file** — split across two, a keyword could be registered to a producer the FR-027 allowlist
  does not know, and the FR-016 check and the FR-027 check would disagree about who exists.
- ⛔ **Not assembled from the producer packages it constrains** — that inverts the dependency and hands the
  constrained party its own quota and its own authority to address any user.
- The mapping (principal → producer, `source` → producer) MUST be asserted **injective at boot** (GR-020) —
  overlapping mappings make attribution ambiguous, which silently misattributes both the FR-013 counter and the
  FR-044 quota.

### Relational data this feature DOES own — the identity group tables (unchanged)

**The group model stays relational and is unaffected by the store change.** `group` and `group_membership` live
in the **identity** database (see _Group Model_ above), as Drizzle schema with a migration, because membership is
long-lived source-of-truth data queried by relationships — the opposite of the short-lived, read-by-id,
read-by-ordered-range workload the pending set is. Nothing about groups moved to Valkey; a reader who assumes
"the notification feature moved its data to a cache" and goes looking for a Valkey group model will not find one,
by design.

### Rejections are still not rows — and now there is no row to write

**Event-path rejections are not recorded as rows** (FR-042, GR-018 §18-d). This was already true and is now
also structural: there is no notification-service table to write one into. A rejected envelope lands on the
ingress DLQ with its `reason`, and the **log line, the counter and the DLQ entry are the record** — the DLQ's
depth is what is alarmed. An invalid payload has no trustworthy identifier to key a row on anyway, and inventing
one is precisely the sentinel FR-043 / GR-019 forbid.

---

## Store Choice — ElastiCache Serverless for Valkey, and the durability risk it carries (FR-040)

> Added 2026-08-12. Owner directive: _"use redis"_. Reasoning and the full alternatives list:
> [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md)
> decision 1 and _Durability_. The figures below are reproduced **with their arithmetic** so a later reader can
> re-check them rather than trust them — and three of them do **not** reproduce, which is recorded rather than
> smoothed over.

### Cost comparison (us-east-1, published on-demand rates, priced by the owner 2026-08-12)

| Option                                         | ADR-0016 figure | Stated arithmetic                                   | Recomputed here                                             | Why not chosen                                                                                                |
| ---------------------------------------------- | --------------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **ElastiCache Serverless, Valkey** ✅          | **≈ $6.13/mo**  | 0.1 GB floor × 730 h × $0.084/GB-h + $0.0023/M ECPU | `0.1 × 730 × 0.084 = 6.132` ✅ reproduces                   | **chosen** — cheapest managed option, nothing to size, meters down to the floor when idle                     |
| ElastiCache node, `cache.t4g.micro`, Valkey    | ≈ $9.34/mo      | $0.0128/h × 730 h                                   | `0.0128 × 730 = 9.344` ✅ reproduces                        | 52 % more, at a fixed size that is wrong in both directions (too small under fan-out, paid for while idle)    |
| Self-managed Valkey on EC2 `t4g.micro`         | ≈ $7.00/mo      | instance + EBS (not itemized)                       | `0.0084 × 730 = 6.13` + ~8 GB gp3 ≈ `0.64` → **≈ $6.77** ⚠️ | we would own patching, failover and backups — and it is **not cheaper**; see the sign note below              |
| ElastiCache Serverless, **Redis OSS**          | ≈ $61+/mo       | **1 GB** minimum × 730 h × $0.125/GB-h              | `1 × 730 × 0.125 = 91.25` ❌ **does not reproduce**         | 10–15× the floor for identical semantics — the **100 MB Valkey floor vs Redis OSS's 1 GB** is the whole story |
| ElastiCache node, `cache.t4g.micro`, Redis OSS | ≈ $11.68/mo     | $0.016/h × 730 h                                    | `0.016 × 730 = 11.68` ✅ reproduces                         | Valkey is 20 % cheaper node-for-node on the same API                                                          |
| Amazon MemoryDB                                | higher          | durable by design                                   | not priced here                                             | held as the **escalation**, not the launch choice — see _Durability_                                          |
| DynamoDB + TTL                                 | ≈ $0 idle       | on-demand; TTL deletions are not billed             | not priced here                                             | **durable and cheaper for this exact shape** — rejected by the **owner** in favour of Redis, recorded below   |

**Valkey rather than Redis OSS is the entire reason this lands near $6:** the **100 MB metered floor** against
Redis OSS's **1 GB**, on the same wire protocol with the same client libraries.

⚠️ **Two arithmetic defects in the source table, recorded because a quoted number outlives the document it came
from.** Neither changes any decision; both would mislead the next reader.

1. **The Serverless Redis OSS row is internally inconsistent.** `1 GB × 730 h × $0.125/GB-h = $91.25`, not
   `≈ $61`. The `$61` figure corresponds to `1 × 730 × 0.084` — the **Valkey** rate applied to the Redis OSS
   floor. The internally consistent reading is that **$0.125/GB-h is right** (it is exactly what makes
   ADR-0016's other claim, "Valkey is 33 % cheaper per GB-h", true: `1 − 0.084/0.125 = 32.8 %`) and the **≈ $61
   total is the figure to distrust**. Re-verify against current AWS pricing before quoting either.
2. **The self-managed EC2 row has its comparison inverted.** ADR-0016 calls it "~$0.87/mo **cheaper** than
   serverless", but `$7.00 > $6.13`: it is ~$0.87/mo **dearer**, and on the itemized reconstruction (≈ $6.77)
   ~$0.64/mo dearer. That strengthens the rejection rather than weakening it — we would be paying **more** for
   the privilege of owning patching, failover and backups.

### ⛔ Durability — the residual risk, stated as a risk and not a footnote

**ElastiCache is a cache service, and durability is opt-in and OFF by default in BOTH the node-based and the
serverless flavour.** With it off, an acknowledged write lives in one node's memory. A node replacement, a
failover or a maintenance event can therefore **drop retained notifications that this service has already told a
producer it accepted** — and FR-003 promises exactly that acceptance.

**The loss is unrecoverable and silent.** FR-031 makes the publisher the only party that ever knew the outcome,
and it published **once**; producers keep no copy. So a dropped pending notification surfaces as a user who never
learns their import finished, and as a gap in a `sequence` nobody is watching. There is no reconciliation to run,
because there is no second copy to reconcile against.

**The owner chose Redis knowing this was flagged, and knowing that DynamoDB with a TTL attribute would be both
durable by default and cheaper for this shape.** That is recorded as a decision made, not relitigated here — and
it is why the low price must not be read as the whole decision: the ≈ $6.13/mo option is the one with the
durability caveat, and every durable option costs more or changes the data model.

**Mitigations, in the order they are to be applied:**

1. **Enable ElastiCache durability if the engine version supports it on serverless.** Per ADR-0016, AWS added a
   durability option for ElastiCache for Valkey on **2026-06-02** (Valkey 9.0), backed by a Multi-AZ
   transactional log, in two modes: **synchronous** (designed for zero data loss, single-digit-millisecond
   writes) and **asynchronous** (microsecond writes, up to roughly **10 seconds** of acknowledged writes lost on
   a failure). **Synchronous is the correct mode here** — a publish-accept is not a hot path and FR-003 already
   promises durability.
    - 🟠 ⚠️ **UNVERIFIED, and it gates provisioning: whether that option is available on ElastiCache _Serverless_
      for Valkey at the engine version we are given.** This is a factual question about AWS, not a design
      question. It MUST be confirmed against the AWS documentation **before the cache is provisioned**, and the
      answer recorded here. If it is node-only, the choice between a `cache.t4g.micro` node **with** durability
      (≈ $9.34/mo) and a non-durable serverless cache (≈ $6.13/mo) is a **$3.21/mo decision** and should be taken
      as one — which, at that price, points at the node. Tracked as **T-049**, which **gates** provisioning (T-051).
2. **If durability is unavailable, keep the risk bounded and OBSERVED.** Multi-AZ replication is on by default on
   serverless, so the exposure is the async-replication gap at failover rather than a cold start from empty.
   Alarm on **cache failover events** and on an **unexplained drop in pending-set cardinality**, so that a loss
   is at least _known_ (see _Non-Functional Budgets_).
3. **Escalate if a loss is ever judged unacceptable:** **Amazon MemoryDB** (same Valkey API, durable Multi-AZ
   transaction log by design, higher cost) or **DynamoDB with TTL** (durable, cheapest at this volume, but a
   different data model — the ordered pending set becomes a range query on a sort key and the Lua atomicity
   becomes a conditional write plus a transaction). Either is a store swap **behind the same interface**, which
   is the whole reason FR-040 keeps pending-set access behind **one** repository module instead of spreading it
   across handlers.

### Sandbox and per-PR cost — one cache per STAGE, `$0` per open PR (ADR-0006's pattern)

**One cache per stage** (`kitchensink-notifications-{stage}`, matching the `kitchensink-{thing}-{stage}` naming
the platform stacks already use), **shared by every `pr-{N}` preview that imports that stage's platform**, with
a **`pr-{N}:` key prefix** for isolation and teardown. This is not a new pattern: it is exactly
[ADR-0006](../../docs/architecture/decisions/0006-per-pr-feature-deploys-base-stage-and-logical-db.md)'s
shared-data-plane rule — a preview resolves `baseStage = sandbox` and rides the shared sandbox VPC, RDS and
domain, namespacing itself **inside** the shared resource — and
[ADR-0003](../../docs/architecture/decisions/0003-shared-alb-per-stage.md)'s one-ALB-per-stage rule applied to a
different resource.

| Model                       | Cost per additional open PR | Isolation                                                         |
| --------------------------- | --------------------------- | ----------------------------------------------------------------- |
| **One cache per stage** ✅  | **$0**                      | `pr-{N}:` key prefix — two open PRs cannot read each other's keys |
| One cache per PR preview ❌ | ≈ **$6.13/mo**              | perfect, and paid for a cache holding a handful of test keys      |

At ≈ $6.13/mo each, a per-PR cache would stack on top of the ≈ $8.25/mo per-PR food API task
[ADR-0010](../../docs/architecture/decisions/0010-ensure-exists-per-pr-deploy-gate.md) already accepts — for a
preview whose entire notification corpus is whatever a test just published.

**Placement and ownership.** The cache is a **stage-level, persistent** resource, so per
[ADR-0005](../../docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md) it is tagged
**`Environment=global`**, never `Environment=pr-{N}`, and it lives with the other shared platform stacks in
`packages/infra/global` (created by `GlobalStack`, the same place `SharedAlbStack` and `DataStack` are created —
T-051). The notification service imports its endpoint by **`baseStage`**, exactly as the feature services import
`kitchensink-data-{baseStage}`. A `pr-{N}`-tagged cache would be **deleted by the PR-close cleanup**, taking the
shared sandbox pending set with it.

**Teardown of a preview's keys is CI work, not CloudFormation work.** The cleanup script deletes resources by
tag **or** name; a _key inside_ a shared cache is neither, so nothing in
`.github/scripts/teardown-sandbox-pr.sh` reclaims `pr-{N}:` keys today. That is the same shape as the preview
DNS/Vercel claim, which ADR-0005 records as CI-owned for the same reason — CloudFormation owns neither. Tracked
as **T-052**; without it a closed PR's keys sit in the shared cache until their 72-hour TTL expires, which is
bounded but is metered memory nobody is using.

**Network.** ElastiCache is VPC-only, so the cache sits in the shared VPC with a security group admitting the
notification service's task SG on the Valkey port. Per
[ADR-0004](../../docs/architecture/decisions/0004-minimize-nat-egress.md) the service's Fargate tasks run in
**public subnets with `assignPublicIp`**, which is fine — a VPC-internal cache is reached over private
addressing and needs no NAT. ⛔ Do not add a NAT consumer for it.

🟠 **Residual — the cache is NOT in the sandbox nightly-shutdown selector.**
[ADR-0007](../../docs/architecture/decisions/0007-sandbox-cost-controls.md)'s scheduler stops exactly three
things (the sandbox RDS instance, sandbox ECS services scaled to 0, and the NAT EC2 instance); **a serverless
cache sitting at the 100 MB floor has no instance to stop**, so it carries its ≈ $6.13/mo through the 00:00–09:00
ET window like the shared ALB does. Recorded here as a residual in exactly the way ADR-0010 records that per-PR
ECS clusters are not in that selector — the point is that the exclusion is **known**, not that it is free. If
this is ever judged material, the lever is a `cache.t4g.micro` node (stoppable) or DynamoDB (no idle cost at
all), and both are already on the table above.

---

## Non-Functional Budgets (NFR-001, NFR-003, NFR-006)

> Added 2026-08-05. NFR-001 and NFR-003 previously had no plan coverage
> (sync-report DRIFT-010); "low-latency" was asserted without a number, leaving
> SC-004 and the k6 tier nothing to assert against.

| NFR     | Budget                                             | Measurement point                                                                                                                |
| ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001 | ≥ 99.9 % availability, publish API                 | ALB 5xx rate on `/api/v1/notifications/publish`, 30-day window                                                                   |
| NFR-003 | p95 ≤ 2 s, publish-accept → client-receive         | timestamp at publish acceptance vs client receipt ack; "nominal load" = 50 publishes/s sustained with 500 concurrent subscribers |
| NFR-006 | ≤ 10 % latency degradation for unrelated producers | same p95 measured per producer while one producer is driven to its quota ceiling (FR-019)                                        |

Alarms: publish 5xx rate, consumer age on the FIFO queue (the ordering path's
liveness signal), in-flight cap approach, undelivered-after-retention rate, **event-path
DLQ depth** (FR-028 — the only signal a rejection on the credential-less path produces),
and quota rejections per producer (FR-033 — a silent rejection is a lost notification).

**Added 2026-08-12 with the retention/dedup/store change** — each of these covers a failure that is otherwise
**invisible**, which is why they are alarms rather than dashboard panels:

| Alarm                                         | Covers                                                                                                                                                                                                                                                                                    | Trace                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Cache failover event**                      | the durability window — with durability off, a failover is the moment retained notifications can be dropped after acceptance                                                                                                                                                              | FR-040 mitigation 2  |
| **Pending-set cardinality drop, unexplained** | the same loss seen from the data side: total pending members falling faster than acks + expiries account for it. Without this a loss leaves no trace at all                                                                                                                               | FR-040 mitigation 2  |
| **Poison-notification attempt count**         | a payload no client can handle, redelivered on every reconnect for 72 h. Counted and alarmed, **never capped** — dropping it early would discard a notification the service promised to keep, and the 72-hour clock is already the backstop                                               | FR-039               |
| **Ack failure rate**                          | ack is what ends retention; if it is failing, every notification silently reverts to the 72-hour clock and reappears on every reconnect, with nothing red anywhere                                                                                                                        | FR-034, US-012       |
| **Rejection counters, per `reason`**          | one counter per rejection cause on the single rejection path — malformed, unregistered-under-enforcement, quota-exceeded, `source`/principal unresolvable, producer mismatch, payload-not-canonically-serializable. A `reason` without its own counter is the one that ends up unobserved | FR-042, GR-018 §18-a |

## Notification Ownership Contract (GR-011)

### Producer ingress — two adapters, one core (FR-024)

| Ingress         | Surface                                       | Producer identity from                                                                                                                                                                                | Requirement trace                      |
| --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| HTTP            | `POST /api/v1/notifications/publish`          | the Ed25519 service-principal token's principal (verified networklessly), **resolved through the producer registry to a name**, which **MUST equal** the envelope's `producer` — mismatch **rejects** | FR-001..FR-004, FR-015, FR-032, FR-041 |
| **EventBridge** | reserved `detailType` on the notification bus | the validated event `source` + the bus resource policy, **resolved through the producer registry to a name**, which **MUST equal** the envelope's `producer` — mismatch **rejects**                   | FR-024..FR-030, FR-041                 |

⚠️ **Neither signal alone is the authority** _(amended 2026-08-12, OPEN-014-A closed — GR-020)_. The transport
signal proves **origin**; the envelope's `producer` states **intent**; the only permitted outcomes of comparing
them are **"agrees"** and **"rejected"**. A transport signal that resolves to nothing is a rejection, never a
default (FR-043, GR-019), and the self-asserted `producer` is **never** trusted on its own — that is what closes
the hole where any party with bus access could attribute its traffic to another producer and spend that
producer's quota. The registry mapping (principal → producer, `source` → producer) is asserted **injective at
boot**, because ambiguous attribution silently corrupts both the FR-013 counter and the FR-044 quota bucket.

Both adapters delegate to the **same** core: validate → registry check → producer authorization →
idempotency dedupe → durable accept → enqueue routing. A rule enforced in only one adapter is a defect
(FR-024), so the adapters own transport concerns only and hold no business logic.

The EventBridge path exists because the platform's async producers already emit domain events; forcing them
into a synchronous publish inside a database transaction would make this service a runtime dependency of
their hot paths and hard-code a dual write. It ingests **notification envelopes, never domain events**
(FR-025) — a domain event carries no recipient, and deriving one would require inspecting `payload`
(forbidden, FR-023) or calling back into the producer.

The HTTP path's `FR-002` mechanism is now decided: the platform's **Ed25519 service-principal token**,
verified networklessly against a public key (the scheme already deployed as `FOOD_SERVICE_PRINCIPAL_JWT_KEY`,
minted and verified by `packages/shared/recipe-core/src/serviceErasureToken.ts`). Verification performs no
outbound call, so no third-party round trip sits on the publish path (FR-032). Per-producer quotas are read
from that producer's registry entry, declared at registration, never inferred (FR-033).

Envelope shape (contract source: `spec.md` FR-026 — normative, both paths):

```text
{
  schemaVersion:  <integer>,             // REQUIRED — two doors make this a versioned wire contract
  recipient:      { kind: "user" | "group" | "global", id?: string },
  messageType:    string,                // REQUIRED — registry-checked
  payload:        <opaque producer-defined>,
  occurredAt:     ISO-8601,              // REQUIRED, producer-assigned — the FIFO ordering key (FR-029)
  idempotencyKey: string,                // REQUIRED on EventBridge (at-least-once); optional on HTTP
  producer:       string                 // REQUIRED on BOTH paths — cross-checked against the transport
                                         // signal, mismatch rejects (FR-026, FR-041, GR-020)
}
```

⚠️ **`producer` is REQUIRED on BOTH paths** _(amended 2026-08-12)_. The comment on that line previously read
"REQUIRED on EventBridge (no bearer token to derive it from)" — a rationale FR-027 already contradicted, since
`source` derives identity without a bearer token either. Requiring it everywhere is also what makes **one**
envelope shape valid on both ingresses, which is what lets FR-024's two adapters share literally **one** zod;
had it stayed path-specific, SC-008's paired tests would have been comparing two different shapes.

An envelope missing a required field is rejected outright — never partially routed, never defaulted, never
defaulted to a sentinel (FR-043). Both paths take **ONE rejection path** carrying the cause as a **`reason`**
field on a single structured shape (FR-042, GR-018 §18-a): a credential/signature failure and a shape failure are
**equally invalid** and differ only in `reason`. HTTP answers `400` (shape) or `403` (producer attribution) —
correct here because our own producers call it and do not blind-retry. The EventBridge path has no caller to
receive a status, so a rejection **dead-letters once** and alarms (FR-028), with a counter per `reason`:
malformed (FR-015), unregistered under enforcement (FR-017), quota-exceeded (FR-019, FR-044), `source`/principal
unresolvable or producer-mismatched (FR-027, FR-041), payload not canonically serializable (FR-037). ⛔ **An
invalid payload is never retried** — it cannot become valid by being sent again (GR-018 §18-b).

### Where that envelope shape LIVES (GR-015) — one authored zod, both adapters

The block above is a **description**; the **artifact** is zod authored in the notification service at
`src/**/*.schema.ts`, copied into the committed `@kitchensink/schema-notifications`
(`packages/schemas/notifications`) alongside `z.infer` types, a `contractHash.ts`, a barrel, and a **derived**
`openapi.yaml`. Full bindings and the client obligation:
[`spec.md` → _Wire Contract Ownership (GR-015)_](./spec.md#wire-contract-ownership-gr-015).

Four points bear on this plan's design specifically:

1. **FR-024's "one core, two adapters" is delivered by ONE zod validating BOTH paths.** A schema per adapter is
   the literal mechanism by which "a rule enforced in only one adapter" becomes a defect. The shared schema is
   how FR-024 is _made_ true rather than merely asserted, and it is what SC-008's paired per-rule tests assert
   against.
2. **That same zod is FR-015's pre-durability validation** (`nestjs-zod` `createZodDto` on the HTTP path), so
   the published contract and the enforced contract are the same artifact.
3. **`payload` stays opaque in the schema** — unknown, with a size bound only. Adding per-`messageType` payload
   validation would put this service in violation of its own FR-023, and would make it the author of knowledge
   the 2026-05-10 clarification says producers own. A producer's payload type belongs to **that producer's**
   schema package.
4. **Producers are clients.** A producer that hand-writes the envelope to `PutEvents` onto the bus is committing
   the same violation as a client that hand-writes a response type — it just fails as a dead-lettered envelope
   (FR-028) instead of a type error. Producers import `@kitchensink/schema-notifications`.

⚠️ **The EventBridge event WRAPPER is AWS's shape, not ours (GR-015 §15-d).** `source`, `detail-type`, `detail`
and friends are validated at the boundary in the ingress adapter **before** `detail` is treated as an envelope,
and they are **not** put in our schema package. This is security-relevant rather than cosmetic: FR-027 makes the
validated `source` a **trust decision**, so the code that reads `source` must first prove the wrapper is the
shape it claims to be. `packages/clients/usda` is the reference implementation for this pattern; never
"converge" a boundary schema away.

⚠️ **`CONTRACT_HASH` and `schemaVersion` are different mechanisms; 014 needs both.** `CONTRACT_HASH` is a
build-time fingerprint asserted at **service boot** when a deployed service and a pinned schema package
disagree. `schemaVersion` is a runtime wire field letting a **receiver** handle an envelope minted by another
version. A released mobile binary cannot be redeployed in step with this service — the case GR-015 §15-c cites
as invisible to the turbo and CI layers.

⚠️ **`oasdiff` covers only the HTTP path.** The EventBridge ingress exposes no URL (as _Governance Alignment_
notes for GR-002), so an envelope change on the bus is invisible to an OpenAPI-diff gate. The
regenerate-and-diff gate over the authored zod is what covers it — a second reason the two adapters must share
one schema.

✅ **All three items that previously blocked generating this schema package are RULED** (owner, 2026-08-12) — see
[`spec.md` → _Resolved Questions_](./spec.md#resolved-questions-owner-rulings-2026-08-12). The paragraph that
stood here said they blocked generation and that "none of them is resolved here"; that is **no longer true**, and
the envelope's zod can now be authored:

- **OPEN-014-A → both signals are required and a mismatch rejects** (FR-041, GR-020). `producer` stays REQUIRED
  and becomes required on **both** paths, so **one** zod serves both adapters — which is what turns FR-024's
  "one core, two adapters" from an assertion into a structural property.
- **OPEN-014-B → the guarantee is effectively-once within the claim window**, not exactly-once: at most one
  notification per `(producer, idempotencyKey)` inside the window, and never zero. SC-011 is narrowed to say
  exactly that (FR-039). "Exactly-once" is not to be reinstated in any client-facing material.
- **OPEN-014-C → the quota is a token bucket with a service-FIXED unit** — sustained publishes/second plus a
  burst allowance in publishes — so the registry entry's `z.strictObject` can finally type it (FR-044). The
  producer declares **magnitudes** only, this service caps them, one budget spans both ingress paths, and
  `global` carries a separate service-owned bound.

**The full set of schemas authored in this service** (all at `src/**/*.schema.ts`, all copied out by
`@kitchensink/contract-gen`):

| Authored schema                                               | For                                                                                      | Unknown keys                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `PublishEnvelope` + `RecipientDescriptor`                     | FR-026's normative field set, validated on **both** ingress paths                        | **`z.strictObject()`** — mutating body (GR-017 §17-c) |
| `DeliveryEnvelope`                                            | what subscribers receive and parse **on receipt** (never validated on emission)          | n/a (output shape)                                    |
| `AckRequest` / `AckResponse`                                  | `POST /api/v1/notifications/ack` — `{ notificationIds: string[] }`, 1–100, capped        | **`z.strictObject()`** — mutating body                |
| the **single rejection shape**, with `reason`                 | FR-042's one path per adapter; a credential failure and a shape failure differ only here | n/a (output shape)                                    |
| `ProducerRegistryEntry` (+ nested `MessageTypeRegistryEntry`) | FR-041 — validates `producers.registry.ts` at module load; copied out with the zod       | **`z.strictObject()`**                                |

⛔ **`z.strictObject()` on the publish envelope and on the ack body** is settled portfolio-wide, not a per-endpoint
choice: GR-017 §17-c closed OPEN-GR-016-B on 2026-08-12. On this surface a silently **stripped** unknown key means
a notification that was accepted and is subtly not the one the producer sent, with a `200` in the producer's logs
— the failure whose visibility the ruling optimizes for.

🟠 **One item still genuinely blocks generation, and it is a product decision rather than a design one:** the
concrete **`payload` and envelope SIZE bounds** (FR-037, FR-040). They must be **numbers in the schema** before the
zod is generated — a bound inherited from a transport limit is not a decision — and on a metered cache they set
both the fan-out cost and the memory profile. Tracked as **T-050**, which **blocks** T-067 (the schema package).

### Where that zod RUNS (GR-016) — one schema, two ingress paths, ONE rejection verdict

> **Heading corrected 2026-08-12.** It previously read "two rejection **behaviours**", which FR-042 and GR-018
> §18-a now forbid: there is **one** verdict and **one** rejection shape carrying the cause in a `reason`, and the
> only thing that differs by adapter is how the verdict is **delivered** (a status to a caller, or a dead-letter
> where there is no caller). Two behaviours is how a credential failure ends up without a counter.

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). Full bindings:
[`spec.md` → _Input Validation (GR-016)_](./spec.md#input-validation-gr-016). Four points bear on **this
plan's** design:

1. **The `createZodDto` + `nestjs-zod` `ZodValidationPipe` mechanism covers the HTTP adapter only — a pipe
   reaches nothing on the bus.** The EventBridge adapter therefore **calls the same schema explicitly**. That
   asymmetry is precisely why "one authored zod, both adapters" is load-bearing rather than tidy: the two
   paths reach the schema by different mechanisms, so a **second** schema per adapter would be invisible until
   a rule diverged (the FR-024 defect).
2. **"One `400` path" (GR-016 §16-a.3) means one validation outcome per ingress, not a `400` on the bus.** The
   HTTP path returns a `400` naming the offending field (or `403` when the failure is producer attribution,
   FR-041); the event path has no caller to receive it, so a rejection **dead-letters once and alarms** with the
   per-`reason` counter this plan already specifies (FR-015, FR-017, FR-019, FR-027, FR-028, FR-037). Same parse,
   same verdict, **one** rejection shape, different delivery of the verdict — the equivalence SC-008's paired
   tests assert. A credential failure and a shape failure differ **only** in `reason` (FR-042, GR-018 §18-a).
3. **⚠️ The AWS wrapper is parsed BEFORE `source` is trusted, and that ordering is the control.** FR-027 makes
   the validated `source` a trust decision, so the adapter proves the wrapper is the shape it claims to be
   **first**. Reading `source` off an unvalidated `PutEvents` payload is trusting a field to authorise the
   record that carries it.
4. **⛔ `payload` stays opaque, and GR-016 does NOT change that.** FR-023 forbids inspecting or validating the
   payload beyond size limits, so the envelope's zod bounds its **size** and nothing else. GR-016 requires the
   **envelope** to be validated, not its opaque contents; a contributor citing GR-016 to add per-`messageType`
   payload validation here would put this service in violation of its own FR-023.

✅ **The three items GR-016 could not answer are now RULED, and the rulings land squarely in this section**
(owner, 2026-08-12). The paragraph that stood here said GR-016 "answers none of the three OPEN items above" and
that "they stay open" — both are **no longer true**. What changes for the runtime:

- **A quota bound is now expressible as a schema constraint** (OPEN-014-C → FR-044): the registry entry's
  `z.strictObject` types `{ sustainedPublishesPerSecond, burstPublishes }`, this service caps both, and the bucket
  is **shared state in the FR-040 store** — never per-task memory, because N API tasks each holding a local bucket
  grant N× the quota. `global` broadcasts are bounded by a **service constant**, not a registry field.
- **Producer identity is now a checkable rule rather than a contested field** (OPEN-014-A → FR-041, GR-020): the
  transport signal resolves through the registry to a name, the envelope's `producer` must equal it, the mapping
  is injective and asserted at boot, and a mismatch is a rejection on the single path. This is a **rejection, not
  a preference** — resolving a mismatch by logging a warning and continuing is a GR-020 violation.
- **The rejection path itself is now specified end to end** (FR-042, GR-018): one shape, the cause in `reason`, a
  credential failure and a shape failure equally invalid, an invalid payload **never retried**, and **no row
  written** for a rejected event (there is no notification-service table to write one into anyway — see _Data
  Model_).
    - ⚠️ 014's own HTTP publish path keeps its `400`/`403`, because our own producers call it and do not
      blind-retry. GR-018 §18-c's **`2xx` inversion applies to signature-verifying third-party senders** (svix,
      Stripe) — this feature has none today, and if it ever accepts one, that ingress answers `2xx` with the
      rejection in the body plus a per-`reason` counter and an alarm (SC-016's second sentence).

**And one thing GR-016 §16-g deliberately does NOT ask for, so nobody "completes" it:** ⛔ **no server-side
response validation.** The `DeliveryEnvelope` this service emits is parsed by the **subscriber on receipt** — web,
mobile and `packages/clients/notifications` all import its zod and parse what arrives — **not** by this service on
its way out. That is consistent with `schemaVersion`'s whole purpose and with a released mobile binary that cannot
be redeployed in step with a backend deploy. Consumer-side receipt validation is **required**; emission-side
validation is **forbidden while the deferral stands** (GR-017 §17-f) — do not conflate the two.

### Event-path trust boundary (FR-027)

The event path carries **no credential**. Its trust boundary is therefore two controls, both required:

| Control                                 | Enforced at                                                                           | Fails to                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EventBridge resource policy             | the bus — which principals may `PutEvents`                                            | reject at the AWS API before the envelope is ever seen                                                                                                                                                                             |
| AWS wrapper parse                       | the adapter — `source`, `detail-type`, `detail` validated **before** `source` is read | dead-letter with `reason: 'wrapper.malformed'`; reading `source` off an unvalidated payload would trust a field to authorise the record carrying it                                                                                |
| **Registry resolution** _(2026-08-12)_  | the adapter — `source` **resolved through the producer registry to a NAME**           | dead-letter with `reason: 'producer.unresolvable'`. An allowlist answering only yes/no is **insufficient**: attribution needs a name, because the FR-013 counter, the FR-044 bucket and the audit trail all key on one (GR-020 §2) |
| **Producer cross-check** _(2026-08-12)_ | the adapter — the resolved name vs the envelope's `producer`                          | dead-letter with `reason: 'producer.mismatch'`. ⛔ **Never** resolved by preferring one signal, and **never** by defaulting the unresolvable one (GR-019, GR-020 §3, §6)                                                           |

Neither of the first two substitutes for the other, and the last two are what turn an allowlist into an identity.
Without them, this path is an unauthenticated publish channel through which any principal with bus access can
address a notification to any user — or spend another producer's quota — defeating FR-005, FR-020 and FR-021.
**The same registry resolution and the same cross-check run on the HTTP path**, with the token principal in place
of `source`, so neither path has a weaker identity story than the other (FR-027 as amended, SC-015).

`idempotencyKey` must be derived from durable domain state — a job identity plus terminal status — so it is stable
across producer retries (FR-030); a key derived from a transport id or a clock changes on retry and deduplicates
nothing. Its claim is the **second** dedup index, not the primary one: FR-037's payload identity is always on and
needs no producer cooperation, and the claim exists for the one case payload identity cannot cover — a transport
redelivery arriving **after** a fast ack, which is why the claim **outlives** the ack and payload identity does
not (FR-038).

### Producer-side correlation (FR-031)

This service does not aggregate. A producer whose work fans out publishes **one** envelope per
user-meaningful outcome, correlating its own fan-out first — typically via a feature-owned **translator**
that subscribes to its own domain events, resolves recipients, and publishes once. 004's recipe import is
the sizing case: up to 100 ingredient resolutions (004 FR-020 × 003 FR-045) must become one notification.
One envelope per underlying completion is a publisher defect, not a gap here.

### Subscriber API

| Method       | Path                              | Purpose                                                                                                                                                                   | Requirement trace                          |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET`/stream | `/api/v1/notifications/subscribe` | Authenticated realtime subscription scoped to authenticated identity/group/global match                                                                                   | FR-010, FR-020, FR-021, FR-022             |
| `GET`        | `/api/v1/notifications/replay`    | Retrieve every notification still **pending** for the authenticated user, in `sequence` order — acked ones are gone, unacked ones are redelivered                         | FR-012, FR-039, SC-012                     |
| **`POST`**   | **`/api/v1/notifications/ack`**   | **End retention for the named notifications, for this user** — `{ notificationIds: string[] }`, 1–100 per call, batched because a reconnecting client drains many at once | **FR-034, FR-035, US-012, SC-012, SC-013** |

Three properties of `ack` are contract, not implementation, and each is a thing a plausible implementation gets
wrong:

- **Idempotent by construction, with NO error path for a repeat.** A second ack for the same id, an ack for an
  expired id, for an unknown id, or for an id belonging to **another user** all return `200` reporting that id as
  `alreadySettled`. A client retrying after a dropped response must not be punished for it (FR-035).
- **Non-disclosing.** A client cannot distinguish "already acked" from "expired" from "never existed" from
  "someone else's" — otherwise the endpoint is an **existence oracle** for other users' notifications. ⚠️ Note
  what parsing does _not_ do here: the other-user case is an **authorization** outcome, not a validation one, so
  the two checks must not be collapsed into one.
- **Ack means CONSUMED, not displayed, and it is per USER, not per device.** The client acks **after** its
  `messageType` handler has run to completion (US-004) — acking on receipt turns a client-side crash into a lost
  notification with the service believing it landed. And `sequence` is **not** a cursor: a high-water mark would
  implicitly ack a notification the client skipped or failed to handle, so ack carries explicit ids. The accepted
  consequence of user-scoping is recorded, not a defect: a user who acks on mobile will not see that notification
  in a web tab opened afterwards (FR-035, ADR-0016 decision 4).

---

## Cross-Feature Notification Trigger Inventory (`001`–`013`)

Legend:

- **Firm**: explicitly defined in current artifacts.
- **Implied**: referenced by feature docs but event contract not finalized.
- **Coordination**: producer team dependency for final trigger schema/ownership sign-off.

| Feature                   | Candidate trigger(s) / messageType namespace                                    | Recipient kind(s)                   | Priority in M8 integration | Ownership status                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `001` Commise Recipe App  | Recipe lifecycle notifications (create/update/share-style lifecycle references) | user, group                         | Medium                     | **Implied** — requires 001 contract finalization (**coordination required**)                            |
| `002` Clerk User Auth     | Security/session/admin notices (optional for v1)                                | user, global                        | Low                        | Not explicitly required by 014 launch contract                                                          |
| `003` USDA Food Data      | `food.resolution.completed` (003 decision register); failure notice unnamed     | user (fan-out list), optional group | **High**                   | **Firm** — published by the recipe service, not the food service (T-044)                                |
| `004` Recipe Importing    | Import completion/failure notices (optional)                                    | user                                | Low                        | Not currently required by 014 launch goals                                                              |
| `005` AI Integration      | AI-generation disclosure/compliance events                                      | user                                | High                       | **Implied/Firm-in-principle** — disclosure required; event taxonomy pending (**coordination required**) |
| `006` Meal Planning       | Plan-change reminders / schedule nudges                                         | user, group                         | Medium                     | Implied via M8 launch integration requirement (**coordination required**)                               |
| `007` Grocery Lists       | Collaboration/list-change events                                                | group, user                         | Medium                     | Implied by 007 collaboration hazard references (**coordination required**)                              |
| `008` Cooking Mode        | Timer started/completed/expired alerts                                          | user                                | **High**                   | **Firm-in-spirit** time-sensitive alerts; concrete message contract pending (**coordination required**) |
| `009` Nutrition Planning  | Compliance-gap / deficiency-related informational notices                       | user                                | High                       | **Implied** and partially open in 009 artifacts (**coordination required**)                             |
| `010` Subscriptions       | Trial ending, past-due, entitlement-change notices                              | user                                | Medium                     | Present in 010 planning language; integration scope decision pending (**coordination required**)        |
| `011` Recipe Digitization | OCR job completed/failed, circle/invite workflow informational events           | user, group                         | Low/Medium                 | Optional in v1; not hard M8 gate                                                                        |
| `012` Creator Profiles    | Moderation/action-result notifications to creators                              | user                                | Medium                     | Present in 012 requirement narratives; integration contract pending (**coordination required**)         |
| `013` Cooking School      | Publish/enroll milestone events to learners/creators                            | user, group                         | Medium                     | 013 plan explicitly defers full notification ownership to 014 (**coordination required**)               |

### M8 required integration subset (per launch plan + current evidence)

Minimum must-wire in M8 execution backlog:

- `003`, `005`, `008`, `009`, `012`, `013` (and validate whether `006`, `007`, `010` are mandatory-at-exit or “hook-ready” per Director decision).

#### Which of these actually exist in code (checked 2026-08-05)

The owner confirmed on 2026-08-05 that full M8 scope stands. Recording the standing
constraint that comes with it:

| Producer | Exists in code?                     | Integration task                                      |
| -------- | ----------------------------------- | ----------------------------------------------------- |
| `003`    | ✅ `packages/services/food-service` | T-042 – T-044 (publisher lands in the recipe service) |
| `005`    | ❌ specification only               | T-018                                                 |
| `008`    | ❌ specification only               | T-018                                                 |
| `009`    | ❌ specification only               | T-018                                                 |
| `012`    | ❌ specification only               | T-021 (added 2026-08-05)                              |
| `013`    | ❌ specification only               | T-022 (added 2026-08-05)                              |

Only **003** can be integrated end-to-end today, and its notification is published by the
**recipe service**, not the food service: `FetchQueueDao.resolve` deletes every
`fetch_requesters` row in the same transaction that completes a food, so the food service
cannot name the recipients after the fact (T-044). The five remaining integration tasks are
blocked on those features shipping, independently of any work on 014 — 014 cannot reach M8
exit before they do. Previously 012 and 013 were named mandatory here with no task at all in
`tasks.md` (sync-report DRIFT-004).

**`SC-001` no longer depends on any consumer** (amended 2026-08-10). It is proven against a
**synthetic reference producer owned by this feature** (T-041) exercising both ingress paths,
so this feature's own launch criterion never waits on a producer's schedule. The remaining
upstream dependency is one 014 builds itself — the identity groups model, T-023 – T-025. It
is the M8 _milestone_ gate, not `SC-001`, that needs all six producers.

---

## Delivery Channels and Client Behavior

### Launch channels

- **In-app realtime stream** (web/mobile authenticated clients).
- **In-app catch-up replay** after reconnect.

### Deferred channels

- Email, mobile push provider integration, webhook callbacks.

### Client dispatch contract

- Clients dispatch by `messageType`.
- Unknown `messageType` values must be logged/ignored without crash (FR-011).
- Registry enforcement mode can reject unregistered `messageType` in selected environments (FR-016, FR-017).
- Clients order and dedupe by `(recipient, sequence)` — see _Ordering & Partitioning_.
- **Clients ACK after the handler completes (FR-034, US-012), and both platforms do it through ONE shared
  command.** This is a client **obligation**, not a convenience: retention ends on the ack, so a platform that
  omits it fails **silently** — notifications simply reappear on every reconnect for three days and nothing is
  red. That is the failure mode
  [ADR-0009](../../docs/architecture/decisions/0009-clerk-signout-load-gate.md) records for sign-out, where two
  platforms independently implementing a post-condition is how one of them shipped without it; the fix there was
  one shared command (`signOutAndVerify` in `@commise/features-account/src/session`) with thin per-platform
  adapters, and the ack takes the same shape. ⛔ **Never ack on receipt** — ack means the handler ran to
  completion, and acking earlier converts a client-side crash into a lost notification.
- **Delivery is at-least-once and handlers MUST be idempotent** (US-010, FR-039). Redelivery of an unacked
  notification is the retention mechanism, so a handler running twice is the normal case, not the degenerate one.

### Client attachment point (added 2026-08-05)

The plan previously specified a transport with **no client surface to attach to**,
while both apps already ship the surface (sync-report DRIFT-007):

- `packages/apps/commise/web/src/components/home/chrome/HomeTopBar.tsx` — a
  notifications icon button, no `onClick`, no `href`, no badge. Its comment reads:
  _"No count badge — there is no notifications service in v1, and a fabricated number
  is exactly what this surface refuses to show."_
- The mobile `HomeTopBar` counterpart, same shape, same `chrome.notifications` label.

Launch work for this epic: an unread count on the existing bell, driven by the
subscribe/replay data, and a feed surface the bell opens. Both platforms ship together
per the repo's cross-platform rule; shared logic goes in a shared package, with
`.native.tsx` only where the platforms genuinely diverge. This also completes
`user-journey.md` Journey B step 5 ("Sam opens the notification and lands on the
relevant context"), which had no implementing surface.

---

## Preferences / Opt-Out Strategy

### v1 baseline

- No user-facing preference center in initial launch baseline.
- Operationally, producers can control emission and target scope; recipients are auth-scoped.

### Planned extension path

- Add per-user category preferences and delivery-channel preferences in follow-on milestone work.
- Preserve backwards compatibility by keeping envelope contract stable and moving preference logic into routing policy.

---

## Dependencies and External Coordination

### Hard dependencies

- **002** for identity/authenticated subscription boundary.
- The platform Ed25519 service-principal token scheme for producer authentication on the
  HTTP path (FR-032).
- An EventBridge bus owned by this service, with a resource policy and a reserved
  `detailType`, for the event ingress (FR-024, FR-027). This is the first shared bus in the
  repo; 003 already publishes `FoodFetchCompleted` to EventBridge, so the substrate is in
  use but no cross-feature bus convention exists yet.
- **One ElastiCache Serverless for Valkey cache per stage** for the retained set (FR-040). This is
  **infrastructure this feature provisions**, not a dependency to wait on (`spec.md` A-008) — but it is the
  **first ElastiCache resource in the repo**, so there is no existing construct, no existing SG rule and no
  existing client dependency to copy. See _Store Choice_ for placement, tagging and the durability question that
  gates provisioning.
- **A maintained RFC 8785 canonicalizer** for the dedup identity (FR-037) — `canonicalize` on npm. ⛔ It MUST NOT
  be hand-rolled: the repo's library-first pre-write gate applies, and four of the properties JCS specifies are
  each a way a naive serializer silently produces a **wrong hash** (see T-059).
- Shared package conventions/governance across monorepo.

### Cross-team contracts required in M8

For each integrated producer feature, confirm:

1. `messageType` namespace owner,
2. Trigger event semantics,
3. Recipient mapping rules (`user`/`group`/`global`),
4. SLA/latency expectation,
5. Failure and retry semantics.

These are explicitly tracked as coordination tasks in [`tasks.md`](./tasks.md).

---

## Rollout and Risk-Control Plan

### Rollout phases

1. **Phase A — Contract hardening**
    - Finalize the authored zod + the producer registry + validation, including the FR-026 minimum on both
      ingress paths, the **ack** request/response, and the **single rejection shape** with its `reason`.
    - Generate and commit `packages/schemas/notifications`; wire the `CONTRACT_HASH` boot assertion. The **size
      bounds** (T-050) must be decided here, because they are numbers in the schema.
2. **Phase A′ — The store**
    - Provision the per-stage cache (**answer the durability question first — T-049**) and land the **one**
      pending-set repository module the rest of the phases build on. Ordering matters: the Lua publish-accept
      script and the ack handler are both written against that module, not against a client.
3. **Phase B — Core delivery path**
    - Publish, route, subscribe, replay, **ack**, expiry sweep, counters. Both adapters land against one core, and
      the paired per-rule equivalence tests (SC-008) are what prove it.
4. **Phase C — Producer integrations**
    - Progressive enablement by feature behind environment flags.
5. **Phase D — Verification closeout**
    - Traceability/test result ingestion, governance closure, release-audit unblock.

### Rollout controls

- Environment-level enforcement toggles for unregistered `messageType` rejection.
- Per-producer quotas and idempotency windows to limit storm/retry amplification. Quota **magnitudes** come from
  the producer's registry entry; the **unit** is fixed by this service (a token bucket: sustained publishes/second
  plus a burst allowance), and this service caps both (FR-033, FR-044).
- **The 72-hour retention clock is NOT a rollout control and MUST NOT be shortened as one.** It is a promise to
  the recipient (FR-012, FR-036). If retained volume is a problem the levers are the **size bounds** (T-050) and
  the payload-dedup index — not the window.
- Counter-based canary checks: publish volume, delivery success, undelivered-after-retention, active subscribers.
- The event ingress is enabled per producer by adding that producer's `source` to the
  allowlist and to the bus resource policy. Removing a producer from the allowlist is the
  kill switch for its event path; the HTTP path is gated separately by its token.

---

## Exit Evidence Required for M8

Aligned to [`../v1-launch-plan.md`](../v1-launch-plan.md) and [`../governance-rules.md`](../governance-rules.md):

- `verify-report.md` at `0 CRITICAL, 0 WARNING`.
- `v-model/release-audit-report.md` unblocked with ingested execution results.
- Demonstrable integrated notification flow across required producer set.
- Ingress parity proven: a paired test per rule showing identical acceptance and identical rejection over
  HTTP and EventBridge (SC-008), and 100% of non-allowlisted `source` values dead-lettered (SC-009).
- GR-011 ownership proven by removal of producer-local delivery implementations in integrated features.
- **Retention and dedup proven, per criterion** (added 2026-08-12): acked notifications 0 % redelivered and
  unacked 100 % redelivered in `sequence` order (SC-012); ack idempotent and non-disclosing, verified **per case
  rather than in aggregate** (SC-013); payload dedup holding with **no** `idempotencyKey`, the original's
  `expiresAt` byte-identical before and after, and the same payload after an ack producing a **second**
  notification (SC-014); dual-signal producer identity rejecting on **both** paths (SC-015); and one rejection
  shape differing only in `reason`, with **no row written** for either failure class (SC-016).
- **GR-017 §17-a and §17-b conformance for a service that does not exist yet**: `packages/schemas/notifications`
  committed and generated, the `contract:generate` script wired, the `CONTRACT_HASH` boot assertion failing a boot
  on mismatch, **`nestjs-zod`'s** `ZodValidationPipe` registered (proven by a bad-body route test, not by
  inspection), `z.strictObject()` on every mutating body, and `packages/clients/notifications` validating on
  receipt with a contract-skew guard. ⛔ **17-e.12**: these are TASKS in [`tasks.md`](./tasks.md), not prose here —
  an obligation with no task is an obligation that does not ship.
