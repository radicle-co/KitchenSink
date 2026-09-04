# 0016 — A notification is retained until the client acks it or 3 days pass, deduplicated by canonical payload while pending, in ElastiCache Serverless for Valkey

- **Status**: Accepted
- **Date**: 2026-08-12
- **Drivers**: owner directive 2026-08-12, verbatim — _"Keep the notification until the client indicates
  that it has been consumed or three days have passed. Dedup messages based on payload so we don't have
  messages with identical payload waiting to be consumed"_ and _"use redis"_
- **Scope**: feature 014 (`specs/014-notification-service/`). This ADR decides the **store, the retention
  clock, the dedup identity and the ack contract**. It does not change the ingress model (FR-024's one core
  / two adapters), the ordering authority (SQS FIFO per `MessageGroupId = recipient.id`), or the wire-contract
  rules ([ADR-0014](0014-service-owned-api-contracts.md), [ADR-0015](0015-input-validation-at-every-boundary.md)),
  all of which stand unchanged.
- **Relates to**: [ADR-0004](0004-minimize-nat-egress.md), [ADR-0007](0007-sandbox-cost-controls.md),
  [ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md) — the cost posture this
  choice is measured against; [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md) — why a
  per-PR preview shares a stage-level resource instead of provisioning its own.

## Context

`specs/014-notification-service/plan.md` previously specified retention as three PostgreSQL tables in a
notification-service-owned schema — `notification`, `delivery`, `publish_idempotency` — with
`expires_at = published_at + 24h`, a scheduled eviction sweep, and dedup keyed on a **producer-declared**
`(producer, idempotencyKey)`. Three properties of that design are what this ADR replaces:

1. **Retention had no consumption signal.** A notification expired on a clock whether or not anyone had
   read it, and there was no wire affordance for a client to say it had. The `delivery` table recorded that
   the service _sent_ something, which is a different fact from the client having _consumed_ it.
2. **Dedup depended on the producer getting `idempotencyKey` right.** FR-030 asks producers to derive the
   key from durable domain state; a producer that derives it from a clock or a transport id deduplicates
   nothing, and the service cannot tell the difference. So the guarantee was outsourced to the least
   supervised party.
3. **It required a database the feature did not otherwise need.** 014's pending set is small, short-lived,
   read by id or by an ordered range per recipient, and never queried analytically. That is a cache-shaped
   workload paying for a relational one.

The owner's directive resolves 1 and 2 and names the store for 3.

## Decision

> ⚠️ **NOTHING IN THIS SECTION IS BUILT — re-verified 2026-09-04, and it is stated here rather than only in
> _Known-incomplete work_ 300 lines below, because a reader who stops at the Decision has no way to tell.**
> `packages/services/notification-service`, `packages/schemas/notifications` and
> `packages/clients/notifications` do not exist; `packages/services/` holds `food`, `food-service`,
> `identity`, `identity-webhooks`, `ingredient-parser`, `recipe-service`, `recipe-workers` and nothing else.
> No ElastiCache or Valkey resource is declared anywhere in the CDK (the only occurrences of the word are the
> "why NOT Valkey" docblock in `packages/infra/global/lib/platform/MessageSubstrateStack.ts:40-44`), the
> `canonicalize` dependency is in no `package.json`, no cache key, Lua script or `/api/v1/notifications/ack`
> endpoint exists, and `packages/schemas/*/openapi.yaml` publishes no notification path. 014 is a spec
> (`specs/014-notification-service/`). **The one thing here that DID ship is the 2026-08-16 amendment's
> DynamoDB message substrate** — `MessageSubstrateStack` with `timeToLiveAttribute: 'ttl'` and
> `packages/shared/messaging` — which is a **different store for a different job**; see the amendment's own
> two-stores table before reaching for it as 014's pending set.

### 1. The retained-notification store is **ElastiCache Serverless for Valkey**, one cache per stage

One cache per **stage** (`kitchensink-notifications-{stage}`), shared by every `pr-{N}` preview that imports
that stage's platform, exactly as ADR-0006 has previews share the sandbox RDS instance and ADR-0003 has them
share one ALB. Keys are prefixed `pr-{N}:` on a preview so a teardown deletes only its own keys, and so two
open PRs cannot read each other's notifications.

Measured against the alternatives (us-east-1, published on-demand rates; the owner priced these on
2026-08-12 and the arithmetic is reproduced so a later reader can re-check it rather than trust it):

| Option                                         | Monthly at idle | How it gets there                                   | Why not chosen                                                                                             |
| ---------------------------------------------- | --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **ElastiCache Serverless, Valkey** ✅          | **≈ $6.13**     | 0.1 GB floor × 730 h × $0.084/GB-h + $0.0023/M ECPU | **chosen** — cheapest managed option, no instance to size, scales to the floor when idle                   |
| ElastiCache node, `cache.t4g.micro`, Valkey    | ≈ $9.34         | $0.0128/h × 730 h                                   | 52 % more, and a fixed size that is wrong in both directions (too small under fan-out, paid for when idle) |
| Self-managed Valkey on EC2 `t4g.micro`         | ≈ $7.00         | instance + EBS                                      | **$0.87/mo MORE than serverless** _and_ we own patching, failover and backups — dominated on both axes     |
| ElastiCache Serverless, **Redis OSS**          | ≈ $61 – $91     | **1 GB** minimum × 730 h × ($0.084 – $0.125)/GB-h   | **10× the metered floor** for identical semantics — and Valkey is also ~33 % cheaper per GB-h (see note)   |
| ElastiCache node, `cache.t4g.micro`, Redis OSS | ≈ $11.68        | $0.016/h × 730 h                                    | Valkey is 20 % cheaper node-for-node with the same API                                                     |
| Amazon MemoryDB                                | higher          | durable by design                                   | see _Durability_ — held as the **escalation**, not the launch choice                                       |
| DynamoDB + TTL                                 | ≈ $0 idle       | on-demand, TTL deletes are free                     | **durable and cheaper for this exact shape** — rejected by the owner in favour of Redis (recorded below)   |

Valkey rather than Redis OSS is the whole reason this lands near $6: the **100 MB metered floor** (against
Redis OSS's 1 GB) is what makes an idle serverless cache cost single-digit dollars, and it is the same wire
protocol and the same client libraries.

⚠️ **One figure in that table is a range on purpose, and it is stated as one rather than guessed at.** Serverless
Redis OSS lands somewhere between **≈ $61** (1 GB at Valkey's $0.084/GB-h) and **≈ $91** (1 GB at $0.125/GB-h),
because published summaries disagree about whether the 33 %-cheaper claim is a rate difference, a floor
difference, or both. **The decision does not turn on which**: the 10× floor alone settles it, and a 15× figure
would only settle it harder. Do not "tidy" the range into a single number without re-checking the AWS pricing
page — and if you do check it, record what you found here rather than in a commit message.

### 2. Retention: until an explicit client ack, **or** 72 hours, whichever comes first

- `expiresAt = publishedAt + 72h`, absolute, assigned once at publish-accept.
- **Nothing refreshes it.** Not a duplicate publish, not a delivery attempt, not a reconnect, not a partial
  ack. The 72 hours are a promise to the **recipient** about how long a notification waits for them — not a
  budget the producer can top up.
- An ack retires the notification for that user immediately, before the clock runs out.
- A notification that reaches `expiresAt` unacked increments the undelivered-after-retention counter
  **before** its keys are released, or the counter can never be emitted (FR-013).
- **Retention and dedup apply to `user` and `group` recipients only.** `global` stays live-only and
  best-effort, as FR-009 already says. This is also a cost control: retaining a broadcast per subscriber
  would multiply one publish by the entire user base inside a 100 MB floor.

### 3. Dedup: **two indexes over one verdict**, both scoped so a duplicate can never outlive the original

A publish is a **duplicate** if either index already holds a claim. On a duplicate the service **drops the
new envelope, returns the ORIGINAL notification's id with `deduplicated` set, and changes nothing about the
original** — not its `sequence`, not its `expiresAt`, not its delivery state.

| Index                 | Key                                     | Identity                                                                                                            | Lifetime                                             | Answers                                                                     |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| **Payload identity**  | `notif:dedup:payload:{u:USER-ID}:HASH`  | `HASH` = SHA-256 over the RFC 8785 canonical JSON of `{ schemaVersion, recipient, messageType, producer, payload }` | released on ack **or** at the original's `expiresAt` | "is an identical notification already **waiting to be consumed**?"          |
| **Idempotency claim** | `notif:dedup:key:{p:PRODUCER}:IDEM-KEY` | producer-declared (FR-018, FR-030)                                                                                  | fixed window, default 24 h, **survives ack**         | "is this the same publish arriving twice from a retry or a bus redelivery?" |

⚠️ **`{…}` in those keys is the Redis/Valkey CLUSTER HASH TAG, not placeholder notation** — a correction to a
first draft of this ADR, which wrote `notif:dedup:payload:{recipientKind}:{recipientId}:{h}` and thereby tagged
on **three** different segments, so the keys of one publish would have hashed to three different slots and
decision 6's single Lua script could not have run at all. **Exactly one `{…}` per key, and it wraps the
routing identity** (`{u:…}` for a user, `{g:…}` for a group, `{p:…}` for a producer). Everything else is a
plain, untagged segment. A contributor "tidying" the braces onto the variable parts silently breaks slot
co-location, and the failure surfaces as a `CROSSSLOT` error only under cluster mode.

Both indexes are needed and they answer different questions:

- **Payload identity is the owner's rule and it is pending-scoped.** A payload re-sent after its predecessor
  was consumed is a **new** notification — that is deliberate, and it is why this index is released by the
  ack. "You have 3 new followers" arriving again tomorrow is correct behaviour.
- **The idempotency claim survives the ack precisely because payload identity does not.** An at-least-once
  transport can redeliver an EventBridge event seconds after a fast user has already acked; without a claim
  that outlives the ack, that redelivery would mint a second, user-visible copy. This is also the honest
  answer to 014's OPEN-014-B: the guarantee is **at most one notification per `(producer, idempotencyKey)`
  within the claim window, and never zero** — effectively-once, not exactly-once.

**The dedup identity deliberately excludes `occurredAt` and `idempotencyKey`.** `occurredAt` changes on a
producer retry, which is exactly the case dedup exists to collapse; including it would make the index
useless while looking correct.

**Canonicalization is RFC 8785 (JSON Canonicalization Scheme), taken from a library — not hand-rolled.**
JCS is the published standard for this exact problem: lexicographic key sorting by UTF-16 code unit at every
depth, ECMAScript shortest-round-trip number serialization (so `1`, `1.0` and `1e0` all serialize to `1`),
and defined string escaping. **`canonicalize` is the intended dependency** — verified with `npm view` on
2026-08-12: **v4.0.0, licence Apache-2.0, zero runtime dependencies**, authored by RFC 8785's own authors
(Erdtman + Rundgren), ESM-only (fine — the services are already `"type": "module"`). ⚠️ **An earlier draft of
this ADR said MIT; it is Apache-2.0.** Confirm the licence against `npm view` before adding it, not against this
sentence. Four properties are load-bearing and each one is a way the naive version gets it wrong:

- **Array order is preserved.** An array is ordered data; sorting it would collide two different payloads.
- **An absent key and an explicit `null` stay different.** Normalizing `{"a":null}` to `{}` would collide
  two payloads whose difference belongs to a producer we do not speak for.
- **Strings are byte-exact — no Unicode normalization.** NFC-folding would decide that two visually
  identical producer strings mean the same thing, which is not ours to decide.
- **A number that does not round-trip through IEEE 754 is a rejection, not a silent collision.** JSON's
  `10000000000000001` parses to `10000000000000000`, so canonicalizing a parsed value would make two
  different payloads hash alike. Such a payload is rejected at the boundary with
  `reason: 'payload.number-not-representable'`.

### 4. Ack: one idempotent, batched, **user-scoped** endpoint

`POST /api/v1/notifications/ack` with `{ notificationIds: string[] }` (1–100 ids), Clerk-authenticated.

- **Idempotent by construction.** Acking an id that is already acked, expired, never existed, or belongs to
  another user returns `200` with that id reported as `alreadySettled`. There is no error path for a
  double-ack, because a client that retries an ack after a dropped response must not be punished for it, and
  a client cannot distinguish "already acked" from "expired" without leaking the existence of other users'
  notifications.
- **Ack is per USER, not per device.** A notification is addressed to a user (FR-005), not to a connection.
  Per-device retention would multiply state by an unbounded, unenumerable device set with no way to learn a
  device is gone. **Accepted consequence:** a user who acks on mobile will not see that notification in a web
  tab opened afterwards. That is standard notification-bell behaviour and it is the behaviour we want.
- **Ack means "consumed", not "displayed".** The client acks after its `messageType` handler has run to
  completion (US-004), not on receipt — otherwise a crash between receipt and handling loses the
  notification with the service believing it landed.
- **`sequence` is not a cursor.** A high-water-mark cursor would implicitly ack everything below it,
  including a notification the client skipped or failed to handle. Ack carries explicit ids.

### 5. Unacked notifications are redelivered, and a notification nobody can consume is an alarm

On reconnect or replay, every notification still pending for that user is delivered again in `sequence`
order. Delivery therefore remains **at-least-once** — US-010's requirement that handlers be idempotent is
unchanged and is now load-bearing rather than defensive.

Each delivery attempt increments `attempts` on the pending entry. A notification with a high `attempts` and
no ack is a **poison notification**: a payload the client cannot handle, redelivered on every reconnect for
three days. That is counted and alarmed rather than capped — dropping it early would lose a notification the
service promised to keep, and the 72-hour clock is already the backstop.

### 6. Atomicity, and one ordering that must not be "simplified"

All keys for one recipient share **exactly one** hash tag (`{u:USER-ID}` / `{g:GROUP-ID}`; see decision 3's
correction — a second `{…}` anywhere in the key moves it to a different slot) so the publish-accept path —
payload-dedup claim, `sequence` assignment, envelope write, pending insert — runs as **one Lua script in one
slot**. ElastiCache Serverless runs in cluster mode; a script may not span slots.

The producer-scoped idempotency claim is in a different slot and therefore a **separate** command. ⚠️ **The
order is: create the notification FIRST, take the idempotency claim SECOND.** A crash between the two then
leaves a notification with no claim — a possible visible duplicate on redelivery, which is recoverable. The
reverse order leaves a claim with no notification, which **silently suppresses a notification that was never
created**, and nothing anywhere can detect it. Prefer the visible duplicate over the invisible loss; this is
the same mirrored-order reasoning as ADR-0005's preview-domain create/teardown pair, and it must not be
"tidied" into one order for symmetry.

Group fan-out stays as the plan already has it: publish once addressed to the **group**, expand membership in
the routing consumer (FR-022, at delivery time), one envelope stored once and referenced by each member's
pending entry. A group of 20 costs one envelope plus 20 sorted-set members, not 20 copies.

## Durability — the residual risk, stated as a risk and not a footnote

⛔ **ElastiCache is a cache service. Durability is opt-in, and it is OFF by default in both the node-based
and the serverless flavour.** With it off, an acknowledged write lives in one node's memory: a node
replacement, a failover, or a maintenance event can **drop retained notifications that this service has
already told a producer it accepted** (FR-003 promises exactly that acceptance). Producers keep no copy —
FR-031 makes the publisher the only party that knew the outcome, and it published once — so a dropped
pending notification is **unrecoverable and silent**. It shows up as a user who never learns their import
finished, and as a gap in a `sequence` no one is watching.

**The owner chose Redis knowing this was flagged, and knowing that DynamoDB with a TTL attribute would be
both durable by default and cheaper for this shape.** That trade is recorded here as made, not relitigated.

**Mitigations, in the order they should be applied:**

1. **Enable ElastiCache durability if the engine version supports it on serverless.** AWS added a durability
   option for ElastiCache for Valkey on **2026-06-02** (Valkey 9.0), backed by a Multi-AZ transactional log,
   in two modes: **synchronous** (designed for zero data loss, single-digit-millisecond writes) and
   **asynchronous** (microsecond writes, up to roughly **10 seconds** of acknowledged writes lost on a
   failure). Synchronous is the correct mode here — a publish-accept is not a hot path, and FR-003 already
   promises durability. ⚠️ **UNVERIFIED at the time of writing: whether that option is available on
   ElastiCache _Serverless_ for Valkey at the engine version we get.** Confirm it against the AWS docs at
   implementation time and record the answer in 014's plan; if it is node-only, the choice between a
   `cache.t4g.micro` node with durability (≈ $9.34/mo) and a non-durable serverless cache (≈ $6.13/mo) is a
   $3.21/mo decision and should be taken as one.
2. **If durability is unavailable, keep the risk bounded and observed.** ElastiCache Serverless is documented
   as replicating data across multiple Availability Zones by default, which — **if confirmed for our
   configuration, which is worth confirming rather than assuming** — means the exposure is the
   async-replication gap at a failover rather than a cold start from empty. Either way: alarm on cache
   failover events and on an unexplained drop in pending-set cardinality, so a loss is at least _known_. An
   **unobserved** loss is the only version of this risk that is unacceptable.
3. **Escalation, if a loss is ever judged unacceptable:** move the retained set to **Amazon MemoryDB**
   (same Valkey API, durable Multi-AZ transaction log by design, higher cost) or to **DynamoDB with TTL**
   (durable, cheapest at this volume, but a different data model — the ordered pending set becomes a range
   query on a sort key and the Lua atomicity becomes a conditional write plus a transaction). Either is a
   store swap behind the same service interface, which is why the pending-set access is kept behind one
   repository module rather than spread across handlers.

**Do not read the low price as the whole decision.** The $6.13/mo option is the one with the durability
caveat; the durable options cost more or change the data model, and that is the actual trade being made.

## Alternatives rejected

### 1. DynamoDB with a TTL attribute

Durable across AZs by default, effectively free at this volume (on-demand, and TTL deletions are not
billed), no floor to pay for while idle, no cluster to fail over, and a conditional `PutItem` gives the same
"claim or lose" dedup primitive as `SET NX`.

**Rejected by the owner in favour of Redis, after the durability and cost advantages were flagged.** Recorded
as an owner decision rather than an oversight, and kept as the named escalation above. The honest cost of the
rejection is the durability caveat in the section above; the honest cost of choosing DynamoDB would have been
losing the ordered-range and atomic-multi-key primitives that make the pending set a five-line Lua script.

### 2. Keep the three PostgreSQL tables (the design this replaces)

Durable, transactional with the `sequence` assignment, and it needed no new infrastructure primitive.

**Rejected — it pays a relational price for a cache-shaped workload, and its eviction is a job.** Every
pending notification would need an index-supported sweep to expire; TTL in Valkey is the store doing it.
014's queries are "read by id" and "read an ordered range per recipient", both of which are a sorted set. The
one thing Postgres bought — durability — is the exact thing this ADR now records as a residual risk, so the
rejection is a real trade and is named as such rather than presented as a free win. **If the durability risk
is escalated, revisiting this option is legitimate**; it is not a closed door.

### 3. Dedup on the raw payload bytes as received

No parsing, no canonicalization, no number-representability edge case, and no argument about whether hashing
counts as inspecting.

**Rejected — it does not satisfy the directive.** Two structurally identical payloads must collide, and
`{"a":1,"b":2}` and `{"b":2,"a":1}` are the same payload serialized by two code paths (a retry that rebuilds
the object from a row map is the ordinary case). Byte-hashing would report them as different and let both sit
pending, which is the state the directive exists to prevent.

### 4. Let SQS FIFO's content-based deduplication be the dedup

The ingest queue already has it, and it needs no store at all.

**Rejected — its window is a fixed 5 minutes and its identity is the message body.** FR-018 requires a
configurable window, the directive requires a window that lasts as long as the notification is pending (up to
72 hours), and the message body includes fields the dedup identity must exclude. This was already recorded as
a consequence of choosing SQS FIFO in 014's plan; it remains at best a coincidental first line of defence.

### 5. Extend the original's TTL when a duplicate arrives

The intuitive reading of "keep it until consumed": a producer still trying to say something must mean it is
still relevant.

**Rejected — it makes retention unbounded and hands a producer control of a user-facing promise.** A producer
in a retry loop would keep one notification pending forever, growing a 100 MB metered store on a schedule
nobody chose. The retention clock belongs to the recipient's 72 hours, so the duplicate is dropped with the
original untouched (`SET NX`, never `SET` with a fresh TTL, never `EXPIRE` on hit).

### 6. Per-device (per-subscriber) retention and ack

It would let each of a user's clients independently confirm consumption, which is a more literal reading of
"the client indicates it has been consumed".

**Rejected — the device set is unbounded, unenumerable and has no end-of-life signal.** A user who installs
the app on a fourth device, or closes a browser tab forever, would leave notifications pending until the
72-hour clock, permanently. And the product behaviour is wrong: a notification the user has already read on
their phone should not be waiting on their laptop. Ack is user-scoped; the accepted consequence is recorded
in decision 4.

### 7. One cache per PR preview

It would isolate previews perfectly and match the per-PR ECS/task model.

**Rejected on cost and on precedent.** Every open PR would add ≈ $6.13/mo for a cache holding a handful of
test notifications, on top of the ≈ $8.25/mo food API task ADR-0010 already accepts per PR. ADR-0006 already
established that a preview imports the stage's shared data plane and namespaces itself inside it; a `pr-{N}:`
key prefix gives the same isolation for $0.

## Consequences

**Accepted costs.**

- **Delivery is at-least-once and clients must be idempotent.** Unchanged from US-010, but now structural:
  redelivery of an unacked notification is the retention mechanism, not a degenerate case.
- **A payload re-sent after its predecessor was consumed produces a second notification.** Deliberate, per
  the directive. A producer that wants suppression across the ack boundary must supply an `idempotencyKey`.
- **Two dedup indexes exist, and a contributor will want to merge them.** They have different scopes and
  different lifetimes on purpose; merging them either loses the post-ack replay guard or breaks the
  pending-only rule. The table in decision 3 is the answer to "why two?".
- **The pending set is metered memory, so a fan-out is a cost event.** One envelope is stored once and
  referenced per member, `global` is not retained at all, and the envelope carries a hard size bound — those
  three together are what keep a group notification from being a bill.
- **Retained notifications can be lost.** See _Durability_. Stated, bounded, mitigated, escalatable — not
  hidden.

**Known-incomplete work (as of 2026-08-12) — this ADR describes a decision, not a shipped state.**

- **No notification service exists.** `packages/services/notification-service`,
  `packages/schemas/notifications` and `packages/clients/notifications` are all unbuilt; 014 is a spec.
  ✅ **Re-verified 2026-09-04: still true, unchanged.** So is the durability bullet below — no ElastiCache
  resource has been provisioned in any stack, so the serverless-durability question has not been forced.
- **The serverless-durability question in mitigation 1 is unresolved** and must be answered against AWS docs
  before the cache is provisioned.
- **No `// ⚠️ DELIBERATE` guard comments and no `CLAUDE.md` pointer exist yet**, because there is no code to
  attach them to. Per this directory's README they are owed at three sites when the service lands: the Lua
  publish-accept script (decision 6's ordering), the ack handler (idempotency and user-scoping), and the
  dedup key derivation (the RFC 8785 canonicalization and its four load-bearing properties).

## Amendment (2026-08-16) — the escalation clause FIRED, and the substrate is a SECOND store, not a swap

Two things this ADR left open are now settled. Neither reverses its choice of Valkey for 014's pending set.

### The escalation fired on R1.3 — DynamoDB, for a different store

Mitigation 3 above holds the escalation as conditional: _"if a loss is ever judged unacceptable"_. PR 91's
R1.3 judged exactly that, for the message substrate: a progress message that is dropped between being
published and being read is unrecoverable and silent, and the producers are fire-and-forget so nobody holds
a copy to re-send. The clause therefore fires, and the substrate is **DynamoDB with a Number TTL attribute**
— the option this ADR already named.

Two supporting facts, neither of them price, because the price argument in this ADR's table was about a
different question:

- **ElastiCache is VPC-only.** R1.1 requires producers to write without VPC attachment. That is not a cost
  trade; it is a hard exclusion, and it alone settles the substrate.
- **Valkey pub/sub drops a message when no listener is connected.** R1.3 forbids exactly that, and PR 91
  ships the producer half **before** any consumer exists (plan U5/U7), so "no listener connected" is the
  normal state for the substrate's entire first release rather than an edge case.

⚠️ The brainstorm that preceded this rejected Valkey at **$61.32/mo**. That figure is the **Redis OSS** row
of the table above, not the Valkey row (≈ $6.13). The price objection is withdrawn; the VPC and pub/sub
facts are what decide it.

### The substrate and 014's pending set are TWO STORES, and that is deliberate

Say it plainly, because "we now have DynamoDB, so move the pending set too" is the obvious next thought and
it is wrong:

| Store                                    | Owns                                                             | Lifecycle               |
| ---------------------------------------- | ---------------------------------------------------------------- | ----------------------- |
| **Message substrate** (DynamoDB, PR 91)  | Producer progress messages, per group, written fire-and-forget   | 3-day TTL, reaped       |
| **014's pending set** (Valkey, this ADR) | Notifications RETAINED until the client acks them or 3 days pass | Deleted on ack (FR-003) |

They differ in the thing that matters: the substrate is a **log a consumer reads**, while the pending set is
**state a consumer mutates** (ack deletes it, and dedup-by-canonical-payload compares against what is
currently pending). Merging them would put ack-and-dedup semantics onto a table whose producers must stay
ignorant of consumers, which is the property R1.1 exists to protect.

**The substrate is NOT a backfill source for 014.** Its 3-day reaper outruns 014's own delivery window, so
anything published before 014 exists is gone before a consumer could read it. 014 starts from an empty
pending set; it does not replay the substrate.

**What this ADR's mitigation 1 still owes:** the unverified question — whether ElastiCache _Serverless_ for
Valkey exposes the durability option at our engine version — is **still unverified** and still belongs to 014. The escalation firing for the substrate does not answer it for the pending set.
