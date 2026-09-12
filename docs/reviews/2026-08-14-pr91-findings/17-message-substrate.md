# 17 — Message substrate: adversarial review + technology selection

**Reviewer**: data engineering (`de-1`)
**Date**: 2026-08-14
**Scope**: the PR-91 message substrate — receive / persist / group-by-entity / guarantee delivery /
latest-per-group-wins. Producers: food service first, recipe import processor second. Consumer:
feature 014, deferred.
**Posture**: read-only. No file in the repository was modified.

**Normative inputs read in full**:
[ADR-0016](../../architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md),
[ADR-0019](../../architecture/decisions/0019-recipe-import-spine.md),
`specs/014-notification-service/spec.md` (FR-008, FR-018, FR-023, FR-026, FR-029, FR-036–FR-040, FR-045),
`specs/014-notification-service/plan.md` §_Ordering & Partitioning_.

---

## 0. The three findings that should be read before anything else

**S-1 (BLOCKER for requirement (d)).** The producer path that exists today is **at-most-once, into a bus
with no consumer**. `FoodEventEmitter` catches every bus failure and swallows it
(`packages/services/food-service/src/events/food-event-emitter.ts:172-177` and `:188-193`; the docstring
says so at `:11-12` — _"Both publishes are **fire-and-forget**: a bus failure is logged via the optional
error sink and swallowed"_). And the bus it publishes to has **no rules on it at all**:
`packages/services/food-service/infra/lib/food-service-stack.ts:266-268` creates
`kitchensink-food-{stage}`, and the stack comment at `:262-265` states there is _"deliberately NO rule
consumer on the bus right now"_ — pinned by
`packages/services/food-service/infra/__tests__/food-service-stack.test.ts:394-400`. So every
`FoodFetchCompleted` emitted in production today is **discarded**, and a `PutEvents` failure is
indistinguishable from success. Requirement (d) is not "improve delivery"; it is "there is currently no
delivery at all."

**S-2 (HIGH — a real hole in FR-045).** FR-045 scopes supersession to **pending** messages and says a
_later_ sequence after an ack creates a new notification
(`specs/014-notification-service/spec.md:657-659`). It does **not** say what happens to an _earlier_
sequence arriving after an ack. If the per-`(recipient, key)` high-water mark is released on ack — the way
FR-038 releases the payload-identity claim — then a redelivered `processing` (seq 2) arriving after
`succeeded` (seq 5) was acked is admitted as a **new pending notification**, and the user's finished import
shows as running again, permanently. That is verbatim the failure ADR-0019:108-110 says supersession exists
to prevent. **The high-water mark must outlive the ack** (idempotency-claim lifetime, not payload-claim
lifetime). See §7 OQ-1.

**S-3 (HIGH — supersession and ADR-0016's payload dedup destroy each other if implemented in the stated
order).** FR-045 says supersession is evaluated **first**, then payload dedup
(`spec.md:654-656`). FR-037's dedup identity is `{schemaVersion, recipient, messageType, producer,
payload}` — it **excludes `supersedes` entirely** (`spec.md:491-493`). So two `processing` messages for the
same entity at the same stage with different sequences hash **identically**. Run the stated order: seq 2
supersedes seq 1 → seq 1 is deleted → payload dedup then finds seq 1's payload claim still present → seq 2
is dropped as a duplicate → **nothing is pending and the message is lost**. The supersede-and-reclaim must
be one atomic step that releases the superseded message's payload claim in the same operation. Under
ADR-0016 this is achievable — both keys carry the same `{u:USER-ID}` hash tag (ADR-0016:169-172), so one
Lua script covers it — but it is not what the spec currently prescribes, and the naive reading loses
messages silently.

---

## 1. Requirement ambiguity resolved

### The tension, stated plainly

"GUARANTEES delivery" and "the most recent message in each group is the one consumed" cannot both be true
of _every message_. Last-write-wins **discards** messages by construction. If message 3 of 5 is superseded
by message 4 before a consumer reads it, message 3 is never delivered — and that is not a bug, it is the
mechanism.

### The requirement does not actually ask for per-message delivery, and the repo already says so

The ambiguity is already resolved in the normative documents; the owner's one-line ruling restates a
decision that was made and reasoned two days earlier.

- **ADR-0019:105-107** — _"Messages for one entity **supersede** prior messages for that entity rather than
  accumulating: a consumer that receives only the latest message for an entity holds the correct current
  state."_
- **ADR-0019:148-149** — the alternative "Accumulate events instead of superseding" was **rejected**:
  _"unbounded for a 1,000-recipe import, and it pushes reconciliation into every client."_
- **ADR-0019:126-127** — _"the message is a notification **of** a committed state change, never the state
  itself."_
- **FR-045** (`spec.md:637-642`) — _"MUST retain **only the highest-`sequence` message per
  `(recipient, key)`**… A message whose `sequence` is lower than or equal to the highest already observed…
  MUST be **discarded** — not delivered, not stored."_

So the guarantee is **per-group-final-state, not per-message**. Written as a contract an implementation can
be tested against:

> **G1 (convergence / liveness).** For every group key `k`, the message carrying the highest producer
> sequence ever _accepted_ for `k` is eventually delivered to the consumer **at least once**, unless a
> strictly higher sequence for `k` is accepted first.
>
> **G2 (monotonicity / safety).** A consumer never observes a sequence for `k` lower than one it has
> already observed for `k`. Regression is impossible, including under redelivery and reordering.
>
> **G3 (durability).** A message the substrate has _accepted_ survives the crash of any single component
> before G1 is satisfied. Acceptance is the point at which the producer is entitled to forget.
>
> **Explicitly NOT guaranteed (G0):** that every emitted message is delivered. Intermediate states are
> **deliberately discardable**. A producer that needs an intermediate state to be durable must not model it
> as a status message — it belongs in the database projection (ADR-0019 §5).

### What the owner needs vs. what the words say

| The words                                  | What is actually needed                                                                | Why the difference matters                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "GUARANTEES delivery"                      | G1 + G3: **the final state per entity is never lost**, and acceptance is crash-safe    | Per-message delivery would mandate accumulation — the thing ADR-0019 rejected                                      |
| "most recent message… is the one consumed" | G2: recency is decided by **producer sequence**, never by arrival time or server clock | ADR-0019:108-110 — arrival-order LWW lets a redelivered `processing` revert a terminal `succeeded` **permanently** |
| "PERSISTS them durably"                    | G3 as a **hard** requirement                                                           | ⚠️ This directly contradicts ADR-0016's accepted residual risk. See §6.                                            |
| "GROUPS them by entity"                    | Group key = **entity**, not recipient                                                  | 014's existing ordering key is `MessageGroupId = recipient.id` (FR-029). Entity ≠ recipient. See §2/S-4.           |

**This resolution decides the technology outright.** Because the guarantee is per-group-final-state, the
substrate's job is **collapse-on-write**, not ordered retention of a log. Every technology whose primitive
is "keep all messages in order" (SQS FIFO, Kinesis, Valkey Streams) is solving a problem this requirement
does not have, and pays for it. Every technology whose primitive is "conditional upsert on a version"
(Postgres `ON CONFLICT DO UPDATE … WHERE`, DynamoDB `ConditionExpression`, Valkey hash + Lua) is the shape
of the requirement.

---

## 2. Candidate comparison

### Coverage of (a)–(e)

Legend: ✅ native · ⚠️ achievable, you build it · ❌ does not do this.

| Candidate                                                                  | (a) receive | (b) durable                                         | (c) group by entity                              | (d) guarantee                                                          | (e) latest-wins                      | Verdict                            |
| -------------------------------------------------------------------------- | ----------- | --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| **SQS FIFO**                                                               | ✅          | ✅ (server-side, ≤14 d)                             | ⚠️ `MessageGroupId` groups but does not collapse | ✅ at-least-once + DLQ                                                 | ❌ **ordering only**                 | Fails (e); breaks under §5         |
| **SNS → SQS**                                                              | ✅          | ✅ (in the queues)                                  | ⚠️ same as above                                 | ✅                                                                     | ❌                                   | Adds fan-out, changes nothing else |
| **EventBridge**                                                            | ✅          | ❌ no retention without an Archive                  | ❌ no ordering, no grouping                      | ❌ delivery is best-effort to targets; a rule-less bus **drops** (S-1) | ❌                                   | Fails (b)(c)(d)(e)                 |
| **Kinesis Data Streams**                                                   | ✅          | ✅ (24 h–365 d)                                     | ✅ partition key = entity                        | ✅ replayable                                                          | ❌ log, never collapses              | Fails (e); worst cost profile      |
| **DynamoDB + conditional write + Streams + TTL**                           | ✅          | ✅ multi-AZ **by default**                          | ✅ PK = group key                                | ⚠️ Streams 24 h + consumer checkpoint                                  | ✅ `ConditionExpression: seq < :seq` | **Satisfies all five**             |
| **Valkey / ElastiCache (hash + ZSET + Lua)**                               | ✅          | ❌ **durability off by default** (ADR-0016:188-198) | ✅                                               | ⚠️ you build ack/redelivery                                            | ✅ via Lua CAS                       | **Fails (b)** as written           |
| **Valkey Streams (XADD/XREADGROUP)**                                       | ✅          | ❌ same                                             | ✅ per stream key                                | ✅ consumer-group PEL gives ack                                        | ❌ a stream is a log                 | Fails (b) and (e)                  |
| **Postgres: `ON CONFLICT (group) DO UPDATE … WHERE excluded.seq > t.seq`** | ✅          | ✅ ACID, same txn as the state change               | ✅ `UNIQUE(group_key)`                           | ✅ row persists until drained                                          | ✅ **one atomic statement**          | **Satisfies all five**             |

### Cost, failure mode, operational burden

Costs are us-east-1, at ~1 developer / test traffic, and "scaled to zero" = an idle month.

| Candidate                         | Idle / test cost per month                                                                                                                                                                                                                 | Dominant failure mode                                                                                                                                                                             | Operational burden                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **SQS FIFO**                      | **$0** idle. $0.50/M requests, first 1M/mo free ([SQS pricing](https://aws.amazon.com/sqs/pricing/))                                                                                                                                       | **Head-of-line blocking within a message group.** One poison message stalls every later message for that group, and the group is a whole user's import                                            | Low. Queue + DLQ + alarm. Precedent exists (`recipe-workers-stack.ts:258-299`)                               |
| **SNS → SQS**                     | **$0** idle; SNS $0.50/M publishes, 1M free                                                                                                                                                                                                | As above, plus a second hop that can silently drop if a subscription filter is wrong                                                                                                              | Low-moderate: topic + policy + per-consumer queue                                                            |
| **EventBridge**                   | **$0** idle; **$1.00/M** custom events, **no free tier for custom events** ([EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/))                                                                                            | **Silent total loss** when no rule matches — this is live today (S-1). No caller-visible error                                                                                                    | Low to run, **high to trust**: correctness depends on rules nobody tests at runtime                          |
| **Kinesis Data Streams**          | **≈ $11–$29/mo just to exist.** Provisioned bills per **shard-hour**; On-Demand Standard bills **per stream-hour** ([Kinesis pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)) ⚠️ exact rates unverified — see §Verification | Consumer checkpoint loss → full-window replay; shard-split operations                                                                                                                             | **Highest here.** Shards, KCL/lease table, checkpointing, resharding                                         |
| **DynamoDB + Streams + TTL**      | **≈ $0** idle. On-demand WRU ~**$0.625/M** (post-Jan-2025 cut; previously $1.25/M), RRU ~$0.125/M, Streams ~$0.02/100k `GetRecords`, **TTL deletes free** ([DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/)) ⚠️ re-verify      | Stream shard iterator expiry / 24 h stream retention if the consumer is down > 24 h                                                                                                               | Low. No servers, no VPC, no SG. **New service in the repo** = new IAM, new client dep, new local-test story  |
| **ElastiCache Serverless Valkey** | **≈ $6.13/mo floor, never $0** (0.1 GB × 730 h × $0.084/GB-h; ADR-0016:52). Does **not** scale to zero                                                                                                                                     | **Acknowledged-then-lost writes** on failover/node replacement, **silent and unrecoverable** (ADR-0016:186-198)                                                                                   | Moderate. VPC-only, SG rule, first cache in the repo, Lua scripts, cluster-mode slot rules (ADR-0016:95-101) |
| **Postgres (existing RDS)**       | **$0 marginal.** The instance is already running — `t4g.micro` non-prod / `t4g.small` prod (`packages/infra/global/lib/platform/data-stack.ts:86` and `:153`)                                                                              | Write amplification / connection exhaustion on a `t4g.micro`; pool is `max: 20` per task (`recipe-service/src/database/database.module.ts:38`, `food-service/src/database/database.module.ts:42`) | **Lowest.** Drizzle, migrations, DAO tests, integration harness, load harness — all already exist            |

### S-4 — the finding that eliminates SQS FIFO on the merits, not on cost

014's ordering key is `MessageGroupId = recipient.id` (FR-029, `spec.md:421-424`; plan.md:132-137 calls the
FIFO queue "the ordering authority"). **A 1,000-recipe import belongs to one user.** Therefore every status
message the import produces lands in **one message group**.

AWS is explicit that a message group is a serialization point: messages in the same group are _"always
processed one at a time, in strict order"_, and until a consumer deletes them or the visibility timeout
expires, _"no additional messages from Group A are received"_
([using-messagegroupid-property](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagegroupid-property.html),
[fifo-queue-lambda-behavior](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/fifo-queue-lambda-behavior.html)).
So the entire import drains **serially**, one batch at a time, no matter how many consumers run. Sizing it
in §5: this misses NFR-003's _p95 ≤ 2 s_ by roughly three orders of magnitude.

Two further points on SQS FIFO, both correcting the brief:

- ⚠️ **The 20,000 in-flight figure in the review brief is superseded.** AWS raised the FIFO in-flight limit
  **from 20 K to 120 K in November 2024**
  ([announcement](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-sqs-increases-in-flight-limit-fifo-queues)),
  and `quotas-fifo` now states 120,000 per queue. Some AWS pages still show 20,000; the discrepancy does not
  change the verdict, because the binding constraint is per-group serialization, not the in-flight cap.
- **Setting `MessageGroupId` to the entity key instead would fix the serialization — and break FR-008.**
  Per-recipient FIFO and per-entity supersession want _different_ partition keys. You cannot have both from
  one FIFO queue. See §7 OQ-2.

---

## 3. Recommendation

> **Build a per-producer transactional outbox with per-entity conditional-upsert collapse, in the
> producer's own existing Postgres database, drained by a relay behind the existing injectable bus seam.
> Do not introduce a new managed messaging primitive in PR 91.**

Concretely, in PR 91:

1. **`food_status_outbox`** in `kitchensink_food` (declared by the food service) and, when 004 lands,
   **`recipe_import_status_outbox`** in `kitchensink_recipes` (declared by the recipe service). Two tables,
   two names, two declarers — required by **GR-021 §21-a** (`specs/governance-rules.md:1747-1750`), which
   binds _"even when they target different logical databases"_. One shared table written by both services
   would violate it, and the two services authenticate as **different roles to different logical
   databases** anyway (`food_app` → `kitchensink_food`, `recipe_app` → `kitchensink_recipes`;
   `data-stack.ts:122` and `:127`).
2. **The upsert is written in the same transaction as the state change it reports.** No dual write, so
   ADR-0019:126-127 ("a notification _of_ a committed state change") is true by construction rather than by
   convention, and S-1's swallowed-error class becomes structurally impossible.
3. **A relay drains it** and publishes the _collapsed latest_ state through the existing `EventBus` seam
   (`food-event-emitter.ts:39-47`). The relay pattern is already precedented in this repo twice over.
4. **The transport to 014 stays a seam, chosen when 014 lands.** 014 is deferred; committing its transport
   now is a decision with no consumer to validate it.

### Why this, over the two candidates that also satisfy (a)–(e)

**Over DynamoDB.** DynamoDB is genuinely excellent for this shape — durable by default, native
conditional-write-on-version, effectively free, scale-to-zero. It loses on three project-specific facts:
(i) the producer's state change and the outbox write must be **one atomic unit**, and the state lives in
Postgres — DynamoDB reintroduces the dual-write problem that the outbox pattern exists to remove;
(ii) it is a **new service in the repo** — new IAM, new client dependency, new local/integration test story,
for one developer; (iii) the owner already ruled against DynamoDB for the adjacent store (ADR-0016:229-238),
and re-proposing it here without a new reason would be relitigating a recorded decision. It is, however,
the correct **flip target** (below).

**Over Valkey.** ADR-0016's own _Durability_ section (`:186-198`) records that ElastiCache can **drop
writes it has already acknowledged**, silently and unrecoverably. The 2026-08-14 requirement says
"**PERSISTS them durably**". A store with acknowledged-write loss does not satisfy an explicit durability
requirement — and it costs **$6.13/mo that never scales to zero** against a **$300/mo** account budget
(ADR-0008) already carrying ~$8.25/mo per open PR for food (ADR-0010). See §6 for the full reconciliation:
**this recommendation does not supersede ADR-0016**, because they govern different stores.

### Why this is the right shape, not just the cheap one

- **It is the only candidate that collapses on the WRITE side.** Every other option ingests all ~N messages
  and collapses (or fails to collapse) on the read side. Collapse-on-write is what makes ADR-0019:107's
  _"bounded live view"_ true of the substrate itself rather than only of what the client renders.
- **The pattern is already shipped here, twice, with tests.** `fetch_queue` is a one-row-per-`food_id`
  Postgres-as-queue whose docstring literally calls the primary key _"the `ON CONFLICT` dedup target"_
  (`packages/services/food-service/src/db/schema/operational.ts:24` and `:30-56`), drained with
  `FOR UPDATE SKIP LOCKED` under a lease with a reaper
  (`packages/services/food-service/src/foods/dao/fetch-queue.dao.ts:204-265`, `SKIP LOCKED` at `:249` and
  `:255`). `recipe_version_pending_archives` is an idempotent outbox with `onConflictDoNothing`
  (`packages/services/recipe-service/src/versions/dal/pending-archives.dal.ts:63-71`), whose docstring
  states the exact durability argument this recommendation depends on: _"The row outlives the SQS message.
  The message is a latency optimisation; the row is the record"_ (`:14-17`). Choosing anything else means
  building a **third** mechanism for a job two existing ones already do.
- **It is the smallest verifiable increment**, matching the owner's standing "start micro, plan and scale
  large" directive. The substrate ships with zero new AWS resources, zero new IAM, zero new cost, and a
  seam where the transport goes.

### Flip condition — state it, so the decision is reversible on evidence, not vibes

Flip to **DynamoDB (`ConditionExpression` on `seq` + Streams + TTL)** — _not_ Kinesis, _not_ SQS FIFO —
when **any one** of these becomes true:

1. A producer that is **not backed by this Postgres instance** must emit into the substrate (011's image
   service is explicitly stateless and database-less, ADR-0019:84-86 — if it emits status directly rather
   than through the recipe service's bulk processor, this fires).
2. Sustained substrate write rate exceeds what the shared `t4g.micro` absorbs without contending with the
   food/recipe request path — **measure it**, see §5 for the trigger arithmetic.
3. The relay's poll interval cannot meet NFR-003 (_p95 ≤ 2 s_) without a poll frequency whose connection
   cost is itself the problem.
4. Cross-producer fan-in grows past two producers, so that N outboxes × N relays is more machinery than one
   shared table with a partition key.

And flip **away from a message substrate entirely** if the answer to §7 OQ-4 is that clients can poll the
ADR-0019 §5 database projection — the projection is authoritative regardless, and the substrate only ever
buys _liveness_.

---

## 4. Keying & schema design

### Group key

`(producer, entity_kind, entity_id)`. **The entity, not the recipient** — ADR-0019:94-95 emits _"per entity
— per recipe, and per food item"_. The recipient is derived at delivery time by the consumer, never part of
the collapse key: two users watching the same food shell must collapse to **one** substrate row, or a
popular ingredient during a bulk import fans out per watcher inside the producer.

`entity_kind` is in the key because `food:01H…` and `recipe:01H…` are different namespaces; omitting it
makes a collision possible and undetectable.

### How recency is determined — producer sequence, and it must be derived from durable state

**Not a server timestamp.** Two food-worker tasks with skewed clocks produce a non-monotonic order, and
ordering by receipt time is exactly what ADR-0019:108-110 forbids.
**Not an in-memory counter.** A task restart resets it, and every message after the restart is silently
discarded as "already seen" — a permanent stall that no alarm catches.

**Use the producing row's own durable version.** The strongest available construct: the entity's row in the
producer's database already advances monotonically per state change, in the same transaction. Make that
value the sequence (`xmin`-free, explicit `bigint version` column, or a per-entity `bigserial`). It is
monotonic **by construction**, survives restart, survives redeploy, and needs no coordination. Where an
entity has no version column, add one — it is a column, not a subsystem.

⚠️ **The sequence must not be a global sequence shared across entities.** FR-045 compares sequences only
_within_ a `(recipient, key)`, so a global counter works but wastes the property that makes debugging
possible ("recipe X is at version 4"). Per-entity is strictly better.

### The write — one statement, and the `WHERE` is the entire guarantee

```sql
INSERT INTO food_status_outbox
    (entity_kind, entity_id, sequence, stage, payload, produced_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (entity_kind, entity_id) DO UPDATE
   SET sequence    = EXCLUDED.sequence,
       stage       = EXCLUDED.stage,
       payload     = EXCLUDED.payload,
       produced_at = EXCLUDED.produced_at,
       claimed_at  = NULL              -- a newer state re-arms an in-flight row
 WHERE EXCLUDED.sequence > food_status_outbox.sequence;
```

⛔ **The `WHERE EXCLUDED.sequence > …` clause is load-bearing and must never be "simplified" away.** Without
it this is unconditional last-write-wins on _arrival_, which is the precise defect
`docs/reviews/2026-08-14-pr91-findings/01-recipe-service.md:134-167` (**F-R2**) already found in
`updateResolution` — the review's own summary table calls the current substrate one that _"actively fights"_
ADR-0019 §4 (`01-recipe-service.md:546`). The same discipline is required in **both** places, and F-R2's
proposed predicate fix and this clause are the same idea applied to the projection and to the outbox.

`claimed_at = NULL` on conflict is the second load-bearing detail: a state change that arrives while the
relay holds the row must **re-arm** it, or the newer state waits for a lease to lapse.

Indexes: `UNIQUE(entity_kind, entity_id)` (the collapse target) and a partial index on
`(claimed_at, produced_at) WHERE claimed_at IS NULL` for the drain — mirroring
`operational.ts:48-54`'s partial-index-per-access-path shape.

### The read — claim, publish, then a **sequence-guarded** delete

```sql
-- claim
UPDATE food_status_outbox SET claimed_at = now()
 WHERE (entity_kind, entity_id) IN (
        SELECT entity_kind, entity_id FROM food_status_outbox
         WHERE claimed_at IS NULL OR claimed_at < now() - $lease
         ORDER BY produced_at
         LIMIT $batch
         FOR UPDATE SKIP LOCKED)
RETURNING entity_kind, entity_id, sequence, stage, payload;

-- …publish… then settle, guarded:
DELETE FROM food_status_outbox
 WHERE entity_kind = $1 AND entity_id = $2 AND sequence = $3;
```

**The `AND sequence = $3` is what makes the read-and-acknowledge idempotent and race-free.** Without it,
this sequence loses data: relay reads seq 5 → publishes → producer upserts seq 7 → relay deletes the row,
believing it published what it deleted. Seq 7 is gone and nothing ever notices. With the guard, the delete
matches **zero rows**, the row survives, and seq 7 drains on the next pass. Redelivery is then harmless in
both directions: a duplicate publish of seq 5 is discarded by the consumer's own G2 check, and a duplicate
delete matches nothing.

`FOR UPDATE SKIP LOCKED` + a `claimed_at` lease + a reaper is exactly `fetch-queue.dao.ts:249,255` and its
`reapExpiredLeases` — reuse the shape, do not reinvent it.

### The consumer side — G2 must be enforced at the consumer too, and its watermark must outlive the ack

The substrate guarantees G1/G3 up to the transport. G2 is enforced **again** at the consumer, because the
transport is at-least-once and unordered:

```
if (incoming.sequence <= watermark[recipient][key]) discard;
else { watermark[...] = incoming.sequence; supersede-and-store; }
```

Per **S-2**, `watermark` must **survive the ack** — same lifetime class as ADR-0016's
`(producer, idempotencyKey)` claim (ADR-0016:93), never the payload-identity claim's pending-scoped
lifetime. A watermark released on ack readmits a stale `processing` after a `succeeded`.

Per **S-3**, supersede-and-store must **release the superseded message's payload-identity claim in the same
atomic step**. Under ADR-0016 that is one Lua script, because all three keys share the `{u:USER-ID}` hash
tag (ADR-0016:169-172).

### How a slow or absent consumer does not lose the latest state — three independent layers

1. **The outbox row is not deleted until publish is confirmed.** A consumer offline for an hour costs
   nothing but staleness; the row still holds the latest state.
2. **Collapse means a returning consumer sees ONE message per entity, not a backlog.** This is the property
   SQS FIFO and Kinesis cannot provide, and it is why an outage does not turn into a thundering drain.
3. **The database projection is authoritative regardless** (ADR-0019:115-127). A client connecting
   mid-import renders correct state from a **read**. The substrate provides liveness, never truth — which
   is exactly why the substrate is allowed to discard intermediate messages at all.

---

## 5. Failure modes, and what breaks at bulk-import volume

### The arithmetic

Bounds are real, not assumed: **1,000 recipes per file** (`specs/004-recipe-importing/spec.md:299`,
004 FR-026) × **100 ingredients max per recipe** (`packages/shared/recipe-core/src/recipeRequestBounds.ts:62`,
`MAX_RECIPE_INGREDIENTS = 100`) = **up to 100,000 ingredient references**, plus 1,000 recipe entities. Five
stages each (ADR-0019:97-103) ⇒ a worst case near **500,000 status transitions from one import**. Real
uniqueness is lower (recipes share ingredients), but the _transition_ count is what the substrate absorbs.

### What breaks, by candidate

| #        | Failure                                                                                                                                                                                                                                                                                                                                                                                       | Where it bites                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **B-1**  | **SQS FIFO serializes the whole import.** One user ⇒ one `MessageGroupId` ⇒ one batch in flight at a time. Even at 10 msgs/batch and 100 ms/batch, 500 K messages ≈ 50 K batches ≈ **~83 minutes**, against NFR-003's **p95 ≤ 2 s**                                                                                                                                                           | Disqualifying for FIFO-keyed-on-recipient |
| **B-2**  | **Head-of-line blocking.** One malformed message in that group stalls **every** later message for that user until the DLQ threshold — the import appears frozen, not failed                                                                                                                                                                                                                   | FIFO / any per-group-ordered transport    |
| **B-3**  | **Cost of accumulation.** ~500 K events × (send + receive + delete) ≈ 1.5 M requests. Trivial in dollars; the cost is **latency and reconciliation**, which is exactly why ADR-0019:148-149 rejected accumulation                                                                                                                                                                             | FIFO, SNS+SQS, Kinesis                    |
| **B-4**  | **Postgres write amplification — the real risk of the recommendation.** ~500 K upserts in the import window, on a shared **`t4g.micro`** (`data-stack.ts:86`) that also serves food and recipe request traffic. A 10-minute import ⇒ ~830 writes/s sustained. This is the **most likely thing to break**, and it is the trigger for flip condition 2                                          | **The recommendation**                    |
| **B-5**  | **Connection pressure.** Pool `max: 20` per task (`database.module.ts:38`/`:42`); a `db.t4g.micro` (1 GiB) yields roughly ~110 connections under RDS's default `max_connections` formula, shared across identity/food/recipe/workers/relays. Adding a polling relay per producer must be counted against that budget, not assumed free                                                        | **The recommendation**                    |
| **B-6**  | **`LISTEN`/`NOTIFY` is not a delivery mechanism.** `NOTIFY` is **not durable** — with no listener attached, the notification is discarded — and it holds a dedicated connection out of a 20-slot pool. Use it **only** as a latency hint on top of polling, never as the guarantee. (No RDS Proxy/pgbouncer exists here, so it would at least function; that is not a reason to depend on it) | **The recommendation**                    |
| **B-7**  | **Valkey 100 MB floor is fine; ECPU is fine; durability is not.** ~11 K live entries × ~1 KB ≈ 11 MB, well inside the floor. The failure at volume is not capacity — it is that a failover mid-import drops acknowledged state with no way to know what was lost                                                                                                                              | Valkey                                    |
| **B-8**  | **DynamoDB Streams does not collapse.** One stream record **per write**, so 500 K writes ⇒ 500 K stream records even though the table collapsed to ~11 K items. Mitigation: treat the stream as a **wake-up signal** and read the item, or poll the table                                                                                                                                     | DynamoDB                                  |
| **B-9**  | **Producer sequence resets.** A task restart with an in-memory counter makes every subsequent message ≤ the stored watermark ⇒ **all silently discarded, forever**, with no error anywhere. §4's durable-row-version rule exists solely to make this unrepresentable                                                                                                                          | All candidates                            |
| **B-10** | **Terminal rows never reclaimed.** Without delete-on-drain (or TTL), the outbox grows monotonically. Delete-on-drain handles it; a periodic sweep is the backstop — and note FR-036's warning (`spec.md:484-489`) that a passive TTL reclaim **fires no application code**, so any counter that depends on expiry must be driven by a sweep                                                   | All candidates                            |

### Mitigations for B-4 (the one that matters)

- **Coalesce in the producer before the write.** A worker processing one recipe's 100 ingredients need not
  emit 100 × 5 messages; per-entity progress within a single unit of work can be debounced in-process. The
  outbox's conditional upsert makes the debounce a _pure optimization_ — correctness never depends on it.
- **Do not emit a message per stage for every entity.** ADR-0019's five stages are the _vocabulary_, not a
  mandate that all five be emitted. `queued` for 100 K ingredient shells is almost pure cost.
- **Instrument first.** Add an outbox-write-rate counter and an outbox-depth gauge in PR 91, so flip
  condition 2 fires on a measurement rather than on a hunch.

---

## 6. Reconciliation with ADR-0016

**This review does not supersede ADR-0016, and does not need to. The two decisions govern different
stores, keyed differently, holding different things, at different lifetimes.**

|            | ADR-0016's Valkey store                                 | This substrate                                           |
| ---------- | ------------------------------------------------------- | -------------------------------------------------------- |
| Keyed by   | **recipient** (`{u:USER-ID}` hash tag, ADR-0016:95-101) | **entity** (`(producer, entity_kind, entity_id)`)        |
| Holds      | pending _notifications_ awaiting a client ack           | latest _entity state_ awaiting hand-off to the transport |
| Lifetime   | until ack, or 72 h (ADR-0016:71-82)                     | until the relay confirms publish (seconds)               |
| Owner      | notification service (014, deferred)                    | each producing service (food, recipe)                    |
| Written by | 014's publish-accept path                               | the producer, in the same txn as the state change        |

ADR-0016 sits **downstream** of this substrate. The substrate hands a message to 014; 014 then applies
FR-037/FR-038 dedup and FR-045 supersession and retains the result in Valkey under ADR-0016's rules.
Nothing in ADR-0016 is contradicted, no arithmetic is re-opened, and its one-Lua-script-one-slot rule is
untouched.

### Three things ADR-0016 must nevertheless absorb

1. **The supersession index fits ADR-0016's hash-tag rule — and only if the key is written correctly.**
   The correct form is `notif:super:{u:USER-ID}:ENTITY-KEY` — **exactly one `{…}`, wrapping the routing
   identity**, with the entity key as a plain untagged segment (ADR-0016:95-101). This puts it in the same
   slot as the payload-dedup and pending-set keys, so supersede + dedup-release + pending-insert remain
   **one Lua script** (ADR-0016:169-172). ⚠️ A contributor who "tidies" the braces onto `ENTITY-KEY`
   produces a `CROSSSLOT` error visible only under cluster mode — the identical trap ADR-0016 already
   documents.
2. **The supersession watermark's lifetime is the `idempotencyKey` claim's, not the payload claim's**
   (finding **S-2**). ADR-0016's decision-3 table has two lifetime classes; the watermark belongs in the
   _survives-ack_ class. This is an addition ADR-0016 does not currently cover, because it predates FR-045
   by two days.
3. **The supersede/dedup ordering trap (finding S-3) must be recorded as a `// ⚠️ DELIBERATE` guard.**
   ADR-0016:317-326 already owes three such guard sites when 014 lands; this is a fourth, at the same Lua
   script.

### Where this review does dissent from ADR-0016 — narrowly, and only on scope

ADR-0016 rejected the three-Postgres-tables design partly because _"it required a database the feature did
not otherwise need"_ (`:32-34`) and _"pays a relational price for a cache-shaped workload"_ (`:242`). Both
are correct **for 014's recipient-keyed pending set**. Neither transfers to this substrate, for a reason
ADR-0016 could not have anticipated:

- The producer's state change **is already a Postgres transaction**. The outbox write is not "a database the
  feature does not otherwise need" — it is a second statement in a transaction that is happening anyway,
  and it is the only way to make the message and the state change atomic. Any other store reintroduces the
  dual write.
- The 2026-08-14 requirement says "**PERSISTS them durably**". ADR-0016 explicitly records the opposite
  property for its chosen store (`:186-198`: acknowledged writes can be lost, _"unrecoverable and silent"_).
  ADR-0016 itself names the escape hatch: _"**If the durability risk is escalated, revisiting this option is
  legitimate**; it is not a closed door"_ (`:248-249`). A new, explicit durability requirement is such an
  escalation — for this substrate. **It is not a reason to re-open the retention store**, which the owner
  ruled on with the risk in front of them (ADR-0016:196-197).

**Nothing in ADR-0016 has been built.** There is no ElastiCache construct, no `ioredis`/`valkey`
dependency, no cache in any stack anywhere in `packages/` — verified by exhaustive grep across
`packages/**/*.{ts,json}` (only false positives: `redispatched`, `requireDisposableDatabaseUrl`,
"rediscover"). 014's own plan says it would be _"the first ElastiCache resource in the repo"_
(`specs/014-notification-service/plan.md:968-972`). So this is a decision **not yet spent**, and choosing a
different store for a _different_ concern costs nothing in rework.

---

## 7. Open questions for the owner

**OQ-1 (blocking, correctness).** Does the per-`(recipient, key)` supersession watermark **survive an
ack**? FR-045 answers this for a _later_ sequence but not an _earlier_ one (finding **S-2**). If it does
not survive, a redelivered `processing` after an acked `succeeded` permanently shows a finished import as
running. Recommended answer: **yes, it survives**, for the same configured window as the
`(producer, idempotencyKey)` claim.

**OQ-2 (blocking, architecture).** FR-008 wants per-**recipient** FIFO; FR-045 wants per-**entity**
supersession. One FIFO queue cannot partition on both. Given that FR-045's producer sequence makes ordering
**irrelevant** for status messages, is FR-029's SQS FIFO ingest still required — or should status messages
take an unordered, non-serializing path, with FIFO reserved for message types that genuinely need
per-recipient order? Per §5/B-1, keeping FIFO for status is a ~3-orders-of-magnitude NFR-003 miss.

**OQ-3 (blocking, scope).** Does PR 91 build **only** the substrate (outbox + relay + seam), or also a
concrete transport? Building a transport with no consumer means choosing 014's ingest before 014 exists.
Recommendation: outbox + relay + seam only.

**OQ-4 (design, could shrink the whole feature).** Given ADR-0019 §5 makes the **database projection
authoritative** and messages merely "live", would client polling of the projection meet the product need at
launch, with the message substrate deferred until polling demonstrably does not? This is the largest
available scope reduction and it is worth being asked before, not after, the substrate is built.

**OQ-5 (correctness, cheap to answer).** Confirm the sequence source: the producing entity's **durable row
version**, not a clock and not an in-memory counter (finding **B-9**). If some entity has no version
column, is adding one acceptable in PR 91?

**OQ-6 (governance).** Two outbox tables (one per producer, per GR-021 §21-a) versus one shared substrate
table. Two is what the single-writer rule requires; one shared table would need an owning service to
declare it. Confirm two.

**OQ-7 (operational, pre-existing).** S-1 means `FoodFetchCompleted` is currently emitted into a
consumer-less bus and discarded, with failures swallowed. Is repairing that in scope for PR 91, or tracked
separately? It is the same code path the outbox replaces.

---

## Verification — what I did and did not do

**Examined (read directly, cited above):** ADR-0016 in full; ADR-0019 in full; 014 `spec.md` FR-008/018/
023/024/026/027/029/030/031/036/037/038/039/040/045 and NFR-001–005; 014 `plan.md` §_Ordering &
Partitioning_ and its client-obligations section; `food-event-emitter.ts` in full; `operational.ts`
(`fetch_queue`); `fetch-queue.dao.ts` (`leaseNext`); `pending-archives.dal.ts`; `versions.ts`
(outbox schema); `data-stack.ts` (instance sizing, logical DB names, SQS); `recipe-workers-stack.ts`
(queue/DLQ shape); `food-service-stack.ts` (event bus); `recipeRequestBounds.ts`;
004 `spec.md` FR-026/D-013; `01-recipe-service.md` (F-R2); `governance-rules.md` GR-021.

**NOT examined:** 014's `tasks.md`, `v-model/`, `review.md`, `verify-report.md`, `sync-report.*`; the other
16 files in this findings directory (checked only for topic overlap — none covers substrate selection);
011's spec; 006/007/009/010 specs; the k6 load harness under `food-service/tests/load/`; any CDK synth
output; any running AWS resource. **No commands were executed against AWS**; every cost and limit below is
from published documentation, not from this account's bills.

**Price/limit figures — provenance, and which ones need re-verification.** ADR-0016:64-69 sets the house
rule here: state a range rather than guess, and re-check the pricing page rather than trust a sentence.
Applying it:

- **Verified against AWS documentation:** SQS FIFO per-message-group serial processing and head-of-line
  blocking; SQS FIFO in-flight raised 20 K → 120 K (Nov 2024); SQS FIFO default 300 TPS/API action, ~3,000
  with batching.
- **From AWS pricing pages, via search summary — re-verify before quoting in an ADR:** SQS $0.50/M FIFO
  requests with 1 M/mo free; EventBridge $1.00/M custom events with no custom-event free tier; DynamoDB
  on-demand ~$0.625/M WRU (reported as a post-Jan-2025 reduction from $1.25/M), ~$0.125/M RRU, Streams
  ~$0.02/100 K `GetRecords`, TTL deletions free; Kinesis per-shard-hour (provisioned) and per-stream-hour
  (on-demand) — **I could not confirm the specific $0.015/shard-h and $0.04/stream-h rates**, so the
  "$11–$29/mo" band in §2 is an estimate and is labelled as one. The Kinesis verdict does not turn on it:
  any per-hour charge disqualifies it against a scale-to-zero preference.
- **From ADR-0016's own arithmetic (not independently re-priced):** ElastiCache Serverless Valkey ≈
  $6.13/mo at the 0.1 GB floor.
- **From the repo:** RDS instance classes, pool sizes, table shapes, bus configuration, volume bounds.

**Not proven, and stated as a risk rather than a finding:** B-4's ~830 writes/s figure is arithmetic from
the documented bounds, not a measurement. Nothing in this repository has been load-tested at bulk-import
volume against the substrate, because the substrate does not exist. That is precisely why §3's flip
condition 2 is tied to instrumentation shipped in PR 91.

**Confidence: High** on the requirement resolution (§1), the SQS-FIFO disqualification (§2/S-4), the
keying design (§4), and the ADR-0016 reconciliation (§6) — all rest on quoted normative text or AWS
documentation. **Medium** on the absolute cost figures flagged above, and on B-4's write-rate estimate.
