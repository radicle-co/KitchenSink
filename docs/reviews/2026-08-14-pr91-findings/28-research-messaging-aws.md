# 28 — AWS message substrate: sourced technology comparison

**Type**: technology research (evidence-backed comparison)
**Date**: 2026-08-15
**Posture**: read-only research. No repository file outside this document was modified. No command was
executed against the AWS account; every price and quota below is from published AWS sources, retrieved on
the dates stated.
**Region for all prices**: `us-east-1`.

---

## 0. Read this first — the requirement changed, and it inverts the previous answer

[`17-message-substrate.md`](17-message-substrate.md) answered a **different question**. Its §1 resolved the
then-current requirement to _"per-group-final-state, not per-message"_ and concluded (17:108-114) that
_"every technology whose primitive is 'keep all messages in order' … is solving a problem this requirement
does not have"_, recommending **collapse-on-write** via a conditional Postgres upsert whose `ON CONFLICT …
WHERE EXCLUDED.sequence > t.sequence` clause **deliberately discards** superseded messages.

**Requirement 2 in the present brief is the exact negation of that.** _"Messages must be groupable, and a
consumer must be able to see ALL messages that were sent for a group (per-group history, not just the
latest)."_ Under that requirement, doc 17's recommended write is a **defect**: it destroys history by
construction. Everything downstream of 17 §1 — the SQS-FIFO disqualification reasoning, the
collapse-on-write framing, the `claimed_at = NULL` re-arm, the delete-on-drain — is scoped to the old
requirement and **must not be carried forward unexamined**.

What survives from 17 and is re-used here, because it is requirement-independent and I verified it:
the producer-sequence-must-be-durable finding (17/B-9), the swallowed-`PutEvents` defect
(17/S-1), and the ADR-0016 durability record.

**The discriminator, stated once.** Requirement 2 asks for a **re-readable, per-group, ordered log**. That
is a _query_ requirement, not a _delivery_ requirement. Every product whose primitive is "deliver a message
and then delete it" fails it outright, and no amount of configuration rescues them. This eliminates SQS
Standard, SQS FIFO, and SNS→SQS on the merits, before cost is even considered.

---

## 1. Requirement-by-requirement matrix

Legend: **✅** native · **⚠️** achievable but you build or pay for it · **❌** fails.

| Option                                             | R1 any producer                                                   | R2 per-group **re-readable history**                                                                                          | R3 durable / no loss                                     | R4 fire-and-forget | R5 ~$0 idle                     | R6 scales, no added delay                        |
| -------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------ | ------------------------------- | ------------------------------------------------ |
| **DynamoDB** (PK=group, SK=seq) + Streams          | ✅ public endpoint, IAM only                                      | ✅ **`Query` on PK, any time, unlimited re-reads**                                                                            | ✅ 3-AZ, synchronous                                     | ✅ one `PutItem`   | ✅ **$0.00**                    | ✅ on-demand; per-group ceiling 1,000 WCU/s      |
| **Postgres append-only** (existing RDS)            | ⚠️ **VPC-only** — a non-VPC Lambda cannot reach it                | ✅ `SELECT … WHERE group=$1 ORDER BY seq`                                                                                     | ✅ ACID, **atomic with producer state**                  | ✅ one `INSERT`    | ✅ $0 marginal                  | ⚠️ ceiling is a `db.t4g.micro`; scaling = resize |
| **SQS Standard**                                   | ✅                                                                | ❌ **deleted on consume; 14 d max**                                                                                           | ✅                                                       | ✅                 | ✅                              | ✅                                               |
| **SQS FIFO** (`MessageGroupId`)                    | ✅                                                                | ❌ **same — groups order, they do not retain**                                                                                | ✅                                                       | ✅                 | ✅                              | ❌ per-group serialization                       |
| **SNS Standard → SQS**                             | ✅                                                                | ❌                                                                                                                            | ✅                                                       | ✅                 | ✅                              | ✅                                               |
| **SNS FIFO + archive/replay**                      | ✅                                                                | ⚠️ 365 d archive, but replay is a **control-plane, time-ranged, subscription-scoped** operation, not a query                  | ✅                                                       | ✅                 | ✅                              | ❌ replay pauses the subscription                |
| **EventBridge + Archive/Replay**                   | ✅                                                                | ❌ archive is indefinite but **replay is explicitly unordered**, goes only to the source bus, and cannot be scoped to a group | ⚠️ a rule-less bus **silently drops**                    | ✅                 | ✅                              | ❌                                               |
| **Kinesis Data Streams** (provisioned)             | ✅                                                                | ⚠️ replayable ≤365 d, but a group's records are **interleaved in a shard** — no per-group read                                | ✅                                                       | ✅                 | ❌ **$10.95/mo idle**           | ⚠️ resharding                                    |
| **Kinesis Data Streams** (on-demand)               | ✅                                                                | ⚠️ same                                                                                                                       | ✅                                                       | ✅                 | ❌ **$29.20/mo idle**           | ✅                                               |
| **MSK Serverless**                                 | ✅ (IAM only)                                                     | ⚠️ same interleaving; per-group = per-topic is unaffordable                                                                   | ✅                                                       | ✅                 | ❌ **$547.50/mo idle**          | ✅                                               |
| **MSK Provisioned** (2× t3.small)                  | ✅                                                                | ⚠️ same                                                                                                                       | ✅                                                       | ✅                 | ❌ **$66.58/mo idle**           | ⚠️ manual                                        |
| **Timestream for LiveAnalytics**                   | ❌ **cannot be provisioned — closed to new customers 2025-06-20** | —                                                                                                                             | —                                                        | —                  | —                               | —                                                |
| **S3 + Firehose**                                  | ✅                                                                | ⚠️ durable and infinite, but query needs Athena and there is **no per-group index**                                           | ✅                                                       | ✅                 | ✅                              | ❌ **≥60 s buffer**                              |
| **ElastiCache Serverless Valkey** (Streams / ZSET) | ⚠️ VPC-only                                                       | ✅ `XRANGE` per group key is a perfect fit                                                                                    | ❌ **cache semantics — acknowledged writes can be lost** | ✅                 | ❌ **$6.13/mo floor, never $0** | ❌ **$61/GB-month retention**                    |

**Only two options satisfy all six: DynamoDB and Postgres.** Everything else fails at least one hard
requirement, and most fail R2 — the requirement that was added.

---

## 2. Per-option detail, with sources

Every figure below carries its source URL and the date I retrieved it. Where the human-readable pricing page
did not render a number, I used the **AWS Price List Bulk API**, which is the machine-readable source
behind those pages and carries its own `publicationDate`.

### 2.0 Deprecation check (mandatory, done before any recommendation)

| Service                                                              | Status                                                                                                                                                                                                                                                                                      | Source                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Amazon Timestream for LiveAnalytics**                              | **CLOSED TO NEW CUSTOMERS**, effective **6/20/25**. _"After careful consideration, we have made the decision to close new customer access to Amazon Timestream for LiveAnalytics, effective 6/20/25."_ Existing customers unaffected. AWS directs new workloads to Timestream for InfluxDB. | [docs.aws.amazon.com/timestream/…/AmazonTimestreamForLiveAnalytics-availability-change.html](https://docs.aws.amazon.com/timestream/latest/developerguide/AmazonTimestreamForLiveAnalytics-availability-change.html) — retrieved 2026-08-15 |
| SQS, SNS, EventBridge, Kinesis, DynamoDB, MSK, Firehose, ElastiCache | No deprecation or sunset notice found.                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                           |

⛔ **Timestream for LiveAnalytics is therefore not evaluable, not merely inadvisable.** Unless this account
already has active Timestream usage under its payer account, the service **cannot be created at all**, so it
fails R1 trivially. Timestream for **InfluxDB** is the surviving product; it is a managed InfluxDB
**instance** (per-hour billed, VPC-attached), which fails R5 for the same reason MSK and Kinesis do, and it
is a time-series database rather than a message substrate. Neither is carried further.
**Open question OQ-7** records the "does this account already use it" check I could not perform.

### 2.1 Amazon SQS — Standard and FIFO

- **Retention**: default 4 days; **minimum 60 seconds; maximum 1,209,600 seconds (14 days)**. Retention
  costs nothing extra. ([quotas-messages](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html), retrieved 2026-08-15)
- **Re-read after consume — NO. This is the disqualifier.** FIFO: _"a message is delivered once and remains
  unavailable until a consumer processes and **deletes** it."_
  ([sqs-fifo-queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html),
  retrieved 2026-08-15). Deletion is terminal; there is no seek, no offset, no re-read, and no API that
  returns "all messages ever sent to group G". A queue is a **transport**, not a log. **R2 fails, absolutely.**
- **Grouping**: FIFO requires `MessageGroupId` (max 128 chars); _"There is no quota to the number of message
  groups within a FIFO queue."_ Standard queues now accept `MessageGroupId` too, but only to enable **fair
  queues**, not retention. Grouping without retention does not satisfy R2.
- **Ordering**: FIFO — strict within a group. Standard — _"messages may occasionally arrive out of order"_,
  best-effort only ([standard-queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html), retrieved 2026-08-15).
- **Delivery semantics**: Standard = at-least-once, duplicates possible. FIFO = exactly-once **processing**
  (5-minute dedup window). Consumer failure → visibility timeout expires → redelivery → DLQ after
  `maxReceiveCount`.
- **Durability**: _"Amazon SQS redundantly stores the message in multiple availability zones (AZs) before
  acknowledging it."_ R3 is satisfied — for the 14-day window only.
- **Throughput ceiling**: Standard is _"nearly unlimited"_. **FIFO's per-group ceiling is the problem**:
  messages in a group are serialized, and non-high-throughput FIFO is 300 TPS per API action per partition
  (3,000 msg/s with 10-message batching). High-throughput FIFO in us-east-1 reaches 70,000 TPS unbatched /
  700,000 msg/s batched — but only by **spreading across many groups**, which is precisely what a
  group-ordered workload cannot do.
- **Local testability**: LocalStack, all tiers.
- **Verdict**: **fails R2**. FIFO additionally fails R6 for any workload with few, hot groups.

### 2.2 Amazon SNS — Standard and FIFO, fan-out to SQS

- **Standard SNS → SQS** inherits SQS's lifecycle exactly. Fan-out changes the number of copies, not the
  lifecycle. **Fails R2.**
- **SNS FIFO + message archiving and replay** is the only queue-family option that gets close:
  _"store messages directly within the topic archive for **up to 365 days** and replay them to subscribers"_
  ([fifo-message-archiving-replay](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html), retrieved 2026-08-15).
- **But replay is not a query, and the shape is wrong for R2** — four specific reasons, all sourced from
  [message-archiving-and-replay-subscriber](https://docs.aws.amazon.com/sns/latest/dg/message-archiving-and-replay-subscriber.html)
  (retrieved 2026-08-15):
    1. Replay is driven by a **subscription attribute** (`ReplayPolicy`), i.e. a **control-plane** write, not
       a data-plane read. Reading one group's history means mutating a subscription.
    2. `PointType` supports exactly one value: **`Timestamp`**. Selection is by **time range only**. There is
       no group selector.
    3. Per-group scoping is possible only indirectly: _"To replay only specific messages, apply a **filter
       policy** to your subscription."_ So per-group history = replay the whole archive from t0 and discard
       non-matching messages — correct, but O(all messages) per group read.
    4. Setting `EndingPoint` **_"effectively pauses the subscription. While the subscription is paused, newly
       published messages will not be delivered."_** Reading history therefore **stops live delivery**. That
       is a direct R6 violation ("no added delay").
- **Subscription restriction**: SNS FIFO cannot deliver to HTTP/S endpoints; fan-out to Lambda requires an
  intermediate SQS queue ([fifo-message-delivery](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-delivery.html), via AWS docs, retrieved 2026-08-15).
- **Prices** (Price List API, `AmazonSNS`, `publicationDate 2026-02-11`): Standard API requests **$0.50/M**
  with **first 1,000,000/month free**; SQS deliveries **free** (_"There is no charge for SQS Notifications"_);
  FIFO publish **$0.30/M** + **$0.017/GB** payload; FIFO subscription messages **$0.01/M** + **$0.001/GB**;
  FIFO archive processing **$0.10/GB**; FIFO archive storage **$0.023/GB-month**.
- **Verdict**: **fails R2 in practice and R6 outright.** Genuinely good at what it is for — _recovering_
  from a downstream outage. That is not the requirement.

### 2.3 Amazon EventBridge (incl. Archive + Replay)

- **Retention**: _"By default, EventBridge stores events in an archive **indefinitely**."_
  Archive storage is charged. ([eb-archive](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html), retrieved 2026-08-15)
- **Re-read — NO, in the sense R2 needs.** Three independent blockers, all from the same page:
    1. **Replay is explicitly unordered**: _"Events **aren't necessarily replayed in the same order** that
       they were added to the archive. A replay processes events to replay based on the time in the event, and
       replays them on **one minute intervals**."_ One-minute granularity destroys per-group ordering. **R2's
       ordering half fails, and it cannot be configured away.**
    2. _"Archive events can only be replayed to the **source event bus**."_ A replay re-fires every matching
       rule — you cannot deliver history to one consumer without re-delivering it to all of them.
    3. **Max ten active concurrent replays per account per Region**, and _"EventBridge deletes replays after
       90 days."_
- **No grouping primitive at all.** EventBridge has content-based filtering, not partitioning. There is no
  key that constrains ordering or co-location.
- **Delivery semantics**: at-least-once to matched targets; a target failure needs a per-target DLQ (which,
  per the `aws-messaging-and-streaming` skill, silently drops until its queue policy allows
  `events.amazonaws.com`). **An event matching NO rule is discarded with no caller-visible error** — this is
  live in this repo today: `kitchensink-food-{stage}` is created at
  `packages/services/food-service/infra/lib/food-service-stack.ts:266-268` with, per doc 17 §S-1, no rule
  consumer, and `FoodEventEmitter` swallows `PutEvents` failures. **R3 fails as currently deployed.**
- **Prices** ([aws.amazon.com/eventbridge/pricing](https://aws.amazon.com/eventbridge/pricing/), retrieved
  2026-08-15): custom events **$1.00/M with no free tier**; replay billed as custom events (**$1.00/M**);
  archive processing **$0.10/GB**; archive storage **$0.023/GB-month**.
- **Quotas** ([eventbridge quotas](https://docs.aws.amazon.com/eventbridge/latest/userguide/cloudwatch-limits-eventbridge.html),
  retrieved 2026-08-15): `PutEvents` us-east-1 **10,000 TPS**; invocations **18,750 TPS**; **300 rules per
  bus**; **5 targets per rule** (not adjustable).
- **Verdict**: **fails R2 (ordering + no grouping) and, as deployed, R3.** It is an event _router_. The
  provisioned-but-unused bus is not an argument for using it; it is a defect to either wire up or delete.

### 2.4 Amazon Kinesis Data Streams — provisioned and on-demand

- **Retention**: minimum 24 hours; **maximum 8,760 hours (365 days)** via `IncreaseStreamRetentionPeriod`.
  **Retention costs extra**, in three separate tiers (below).
- **Re-read — YES within retention, but NOT per group.** This is the subtle failure. `PartitionKey` maps a
  record to a shard, so a group's records are **ordered within the shard but interleaved with every other
  group hashed to that shard**. Reading "all messages for group G" means `GetShardIterator` +
  `GetRecords` across the whole shard and client-side filtering — O(all records in the shard), with a hard
  read ceiling of **2 MB/s and 5 `GetRecords` transactions per second per shard**. There is no index.
  For a substrate whose _primary_ read pattern is per-group history, this is the wrong data structure.
- **Ordering**: strict per shard, hence per partition key (a group never spans shards at a point in time —
  but note a **resharding split moves a key to a new shard**, and consumers must process the parent shard
  before the child to preserve order).
- **Delivery semantics**: at-least-once; the consumer owns its checkpoint. Consumer failure → resume from
  the last checkpoint (KCL lease table, or Lambda ESM). Checkpoint loss → full-window replay.
- **Ceilings** ([service-sizes-and-limits](https://docs.aws.amazon.com/streams/latest/dev/service-sizes-and-limits.html),
  retrieved 2026-08-15): provisioned — **1 MB/s or 1,000 records/s write; 2 MB/s or 2,000 records/s read
  per shard**. On-demand — new streams start at **4 MB/s write / 8 MB/s read**, scaling to **10 GB/s
  write / 20 GB/s read** in us-east-1. On-demand scale-up is automatic but **not instantaneous**, which is
  a soft R6 risk on a bursty bulk import. Mode switches limited to **twice per 24 hours**.
- **Prices** (Price List API, `AmazonKinesis`, `publicationDate 2026-08-13`): provisioned shard-hour
  **$0.015**; PUT payload unit (25 KB) **$0.014/M**; extended retention (24 h–7 d) **$0.020/shard-hour**;
  long-term (7–365 d) **$0.023/GB-month** storage + **$0.021/GB** retrieval; on-demand **$0.040/stream-hour**
    - **$0.08/GB** in + **$0.040/GB** out, retention 1–7 d **$0.10/GB-month**, beyond 7 d **$0.023/GB-month**.
- **Local testability**: LocalStack, all tiers (Hobby/Base/Ultimate), with persistence.
- **Verdict**: **fails R5** (a per-hour charge exists whether or not you send anything) and **fails R2's
  per-group access pattern**. It is the right answer for a high-throughput analytics fan-out, which is not
  this.

### 2.5 Amazon DynamoDB — PK = group, SK = sequence (+ Streams)

This is the option that matches the requirement's _shape_.

- **Retention**: **unbounded and free of policy** — items persist until deleted. _"There is no practical
  limit on a table's size."_ Retention is charged purely as **storage: $0.25/GB-month** (Standard class),
  **$0.10/GB-month** (Standard-IA). TTL is optional and **costs nothing**: _"DynamoDB automatically deletes
  expired items within a few days of their expiration time, **without consuming write throughput**."_
  ([TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html), retrieved 2026-08-15).
  ⚠️ Note the "within a few days" imprecision — TTL is a cost-control mechanism, **not** a compliance
  deletion mechanism, and per doc 17/B-10 an expiry fires no application code.
- **Re-read a group's full history — YES, natively, and this is the discriminator.**
  `Query(KeyConditionExpression: pk = :group)` returns every item for the group, **sorted by sort key**,
  ascending or descending (`ScanIndexForward`), **any number of times, by any number of independent
  consumers, with no coordination and no consumption of the data**. No other candidate offers this. Pages
  are **1 MB max** per `Query`
  ([LSI](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html), retrieved 2026-08-15);
  history longer than that paginates via `LastEvaluatedKey`.
- **No per-group size cap — provided you add no LSI.** _"The maximum size of any item collection for a table
  which has one or more local secondary indexes is 10 GB. **This does not apply to item collections in
  tables without local secondary indexes**"_ (same page). ⛔ **Therefore: do not add an LSI to this table.**
  Adding one silently imposes a 10 GB-per-group ceiling that then throws
  `ItemCollectionSizeLimitExceededException` on write, and an LSI **cannot be added after table creation**.
- **Ordering within a group**: total, and it is **yours to define** — the sort key is producer-assigned, so
  ordering does not depend on arrival time, server clock, or partition placement. This is strictly stronger
  than every log-based option, whose order is arrival order. It also makes duplicate suppression free: a
  duplicate `PutItem` of the same `(group, sequence)` is idempotent by definition.
- **Delivery semantics**: `PutItem` is a synchronous, durably-acknowledged write replicated across three
  AZs. There is no "consumer failure" mode at the substrate level, because there is no consumption — a
  reader that dies simply re-queries. **This is why DynamoDB satisfies R4 more cleanly than any queue**:
  the producer genuinely does not manage delivery or handle consumer failure, because delivery has been
  replaced by durable availability.
- **Push path (optional)**: DynamoDB Streams for a wake-up signal. **24-hour retention, hard** — _"All data
  in DynamoDB Streams is subject to a 24-hour lifetime"_ — with _"Each stream record appears exactly once"_
  and per-item ordering: _"DynamoDB Streams guarantees ordering at the level of an individual item … not
  across an entire partition."_ ⚠️ **Max two simultaneous readers per shard.**
  ([Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), retrieved 2026-08-15).
  The 24 h limit is irrelevant here **because the table, not the stream, is the history** — the stream is a
  latency optimisation only. Treat a stream record as "group G changed, go `Query` it".
- **Ceilings** — the real ones, stated plainly:
    - **Per partition: 3,000 read units/s and 1,000 write units/s.** _"Every partition in a DynamoDB table is
      designed to deliver a maximum capacity of 3,000 read units per second and 1,000 write units per second"_
      ([bp-partition-key-design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html),
      retrieved 2026-08-15). For ≤1 KB messages this is **~1,000 messages/second into a single group** — the
      per-group throughput ceiling R6 asks about. Adaptive capacity applies to on-demand and provisioned, but
      it isolates hot partitions; it does not raise the per-partition ceiling. The documented escape is
      **write sharding** (suffix the PK with `#0…#N`), at the cost of N `Query` calls to reassemble.
    - **Per table: 40,000 read request units and 40,000 write request units** on-demand, **adjustable**; _"No
      account-level read and write throughput quotas are applied to tables in on-demand mode."_
      ([ServiceQuotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html), retrieved 2026-08-15)
- **R1 — the quiet advantage.** DynamoDB is a **regional public endpoint reached with IAM alone**. A Lambda
  needs no VPC attachment, no NAT, no security group, and no database credential. Under ADR-0004 this repo
  pays real money and real coupling to put a Lambda in the VPC; DynamoDB avoids it entirely.
- **Prices** ([dynamodb/pricing/on-demand](https://aws.amazon.com/dynamodb/pricing/on-demand/), retrieved
  2026-08-15): write request units **$0.6250/M**; read request units **$0.125/M**; storage **$0.25/GB-month**
  (Standard) / **$0.10/GB-month** (Standard-IA); Streams **$0.02 per 100,000** read request units, with
  _"the first 2,500,000 read requests … included in the AWS Free Tier"_, and — materially — _"**You are not
  charged for GetRecords API calls invoked through DynamoDB triggers on AWS Lambda**, unless the functions
  are running on Lambda Managed Instances."_ **A Lambda-consumed stream therefore adds $0 to the idle cost.**
- ⚠️ **Free tier caveat, stated honestly.** The pricing page's 25 WCU / 25 RCU / 25 GB allowance _"uses
  provisioned capacity and the DynamoDB Standard table class"_ — it does **not** apply to on-demand. The
  page also describes a **$200 credit for up to 6 months**, which is a new-account promotion. **I did not
  find an unambiguous "always free" statement for on-demand, and I am not relying on any free tier in §3.**
  All DynamoDB figures in §3 are computed at **full list price**.
- **Local testability**: LocalStack **all tiers** (Hobby/Base/Ultimate), with persistence — and DynamoDB
  Local is a first-party AWS artifact, so the test story does not depend on LocalStack at all.

### 2.6 Amazon MSK and MSK Serverless

- **Retention**: fully configurable, effectively unlimited with tiered storage (**$0.06/GB-month** tiered,
  **$0.0015/GB** retrieval).
- **Re-read**: yes, by offset — the best replay model of any candidate. But a group = a partition key, so
  per-group reads have the **same interleaving problem as Kinesis**. Kafka's answer (a topic or partition
  per group) is affordable at 10 groups and not at 10⁵.
- **MSK Serverless**: **IAM access control is mandatory** — _"MSK Serverless requires IAM access control for
  all clusters. Apache Kafka access control lists (ACLs) are not supported."_
  ([serverless](https://docs.aws.amazon.com/msk/latest/developerguide/serverless.html), retrieved 2026-08-15).
  Available in us-east-1.
- **Prices** (Price List API, `AmazonMSK`, `publicationDate 2026-07-29`): Serverless **$0.75/cluster-hour**,
  **$0.0015/partition-hour**, storage **$0.10/GB-month**, data-in **$0.10/GB**, data-out **$0.05/GB**.
  Provisioned `kafka.t3.small` **$0.0456/broker-hour**; `kafka.m7g.large` **$0.204/broker-hour**;
  storage **$0.10/GB-month**.
- **Verdict**: **fails R5 catastrophically.** MSK Serverless idles at **$547.50/month** — **182% of the
  entire $300 account budget, at zero traffic, forever**. No configuration reduces it; the cluster-hour is
  unconditional. Provisioned is ~$66.58/month for two `t3.small` brokers before storage. Also fails R5's
  spirit for a one-developer project: MSK is the highest-operational-burden option on this list, and
  "serverless" here means "managed", not "scales to zero".

### 2.7 Amazon Timestream, and S3 + Firehose

- **Timestream for LiveAnalytics**: **not evaluable** — see §2.0. Excluded.
- **S3 + Amazon Data Firehose**: genuinely durable, effectively infinite retention, and by far the cheapest
  per byte. It fails R6 and R2 for structural reasons, not price:
    - **Delay**: Firehose is a **buffering** delivery service. Records are accumulated to a buffer size or
      interval before an S3 object is written. R6 says "no added delay"; buffered delivery is added delay by
      definition. ⚠️ I did not re-verify the current minimum S3 buffer interval from a primary source; treat
      "≥60 s" as **unverified** — but the _existence_ of buffering is not in doubt and is sufficient to fail R6.
    - **Per-group read**: an S3 prefix layout can partition by group, but reading "all messages for group G"
      is a `ListObjectsV2` + N `GetObject`s, or an Athena scan — seconds-to-minutes, and Athena is billed per
      TB scanned. There is no index and no ordering guarantee beyond what the key encodes.
    - **Prices** ([firehose/pricing](https://aws.amazon.com/firehose/pricing/), retrieved 2026-08-15, corroborated
      by Price List API `AmazonKinesisFirehose`, `publicationDate 2026-07-29`): Direct PUT **$0.029/GB** for
      the first 500 TB/month, **billed in 5 KB increments** — _"a 3KB record is billed as 5KB"_. **For 1 KB
      messages this is a 5× multiplier**, and it is the single most commonly missed number in Firehose costing.
    - **Correct role**: a **cold tier** behind the primary substrate (DynamoDB TTL → Streams → Firehose → S3),
      not the substrate. That is how the 100M/month storage curve in §3 is kept flat.

### 2.8 PostgreSQL append-only table (the DB already runs)

- **Retention**: unbounded; costs **RDS gp3 storage at $0.115/GB-month** for PostgreSQL in us-east-1
  (Price List API, `AmazonRDS`, `publicationDate 2026-08-12`). ⚠️ RDS bills **allocated**, not used,
  storage — so the marginal cost is zero until the allocation is raised, then it steps.
- **Re-read a group's full history — YES, and it is the most expressive option of all.**
  `SELECT … WHERE group_key = $1 ORDER BY sequence` with a `(group_key, sequence)` index is an index range
  scan. Unlike DynamoDB it also supports ad-hoc predicates, joins to the producer's own state, aggregates,
  and cross-group queries — for free, with no index design decided up front.
- **Ordering**: total and producer-defined, same as DynamoDB.
- **Durability, and the property nothing else has**: the message `INSERT` and the producer's state change
  **commit in the same transaction**. There is **no dual write**, so R3 is satisfied _by construction_
  rather than by a relay, a retry policy, or an outbox. §5 shows this is the crux.
- **R1 — where it fails, and it is not a small thing.** RDS lives in a private subnet. Fargate tasks are in
  the VPC and reach it. **A Lambda cannot**, unless it is VPC-attached — and per ADR-0004 a VPC Lambda gets
  no egress from `assignPublicIp` and must therefore route through the NAT instance. So "any backend
  producer can emit" costs, for each new non-VPC producer: VPC attachment, an ENI, a security-group rule, a
  DB credential, NAT egress, and cold-start penalty — versus an IAM policy for DynamoDB. R1 says _any_
  producer; this is a standing tax on satisfying it.
- **A second R1/R2 problem specific to this repo**: GR-021 §21-a's single-writer rule (cited at doc
  17:184-190) forces **one table per producing service, in that service's own logical database**, with
  distinct roles (`food_app` → `kitchensink_food`, `recipe_app` → `kitchensink_recipes`). A consumer that
  wants a group's history **across producers** must therefore query N databases with N credentials and merge
  client-side. DynamoDB gives one table and one `Query`.
- **R6 ceiling**: the shared **`db.t4g.micro`** for every non-prod stage (`data-stack.ts:83-84,153`;
  prod is `db.t4g.small`), which also serves the food and recipe request paths. Doc 17/B-4 estimates ~830
  writes/s during a bulk import — **an estimate from documented bounds, never measured**. Scaling means an
  instance resize (a failover), not an API call. R6's "no added delay" is not free here.
- **`LISTEN`/`NOTIFY` is a latency hint, never the delivery guarantee.** _"if a `NOTIFY` is executed inside
  a transaction, the notify events are not delivered until and unless the transaction is committed"_ (good —
  it is transactional), and _"It is also guaranteed that messages from different transactions are delivered
  in the order in which the transactions committed"_ (good — it is ordered). **But it is not durable**: the
  queue is in-memory, a notification with no listener attached is discarded, the payload is _"shorter than
  8000 bytes"_, and — a sharp operational edge — _"If this queue becomes full, transactions calling `NOTIFY`
  **will fail at commit**"_ (8 GB standard queue).
  ([PostgreSQL 16 NOTIFY](https://www.postgresql.org/docs/16/sql-notify.html), retrieved 2026-08-15).
  ⛔ **A slow listener can therefore take down writes that have nothing to do with messaging.** Use `NOTIFY`
  only as a wake-up on top of polling, never as the guarantee. **Logical replication / CDC** (Debezium et
  al.) is the durable alternative but adds a replication slot — and an unconsumed slot pins WAL and can fill
  the volume, which is the same class of failure with a worse blast radius on a `t4g.micro`.
- **Local testability**: best of any option — Docker Postgres, already in the repo's harness, no emulator
  fidelity gap at all.

### 2.9 ElastiCache Serverless for Valkey — Streams and sorted sets

- **Fit for R2 is excellent**: one Valkey Stream per group (`XADD` / `XRANGE`) or a ZSET scored by sequence
  gives exactly "all messages for group G, in order, re-readable". Consumer groups (`XREADGROUP` + PEL)
  even give acks. On modelling merit this is the best match after DynamoDB.
- **It fails R3, and R3 is declared non-negotiable.** ElastiCache is a cache. ADR-0016:186-198 already
  records that acknowledged writes can be lost on failover/node replacement, _"unrecoverable and silent"_.
  A requirement that says "must not be lost or dropped. Durability is non-negotiable" is not satisfiable by
  a store with that property. ⚠️ I did **not** independently re-verify this against current AWS docs (the
  serverless overview page did not render for me); I am relying on ADR-0016's own recorded analysis, which
  the owner accepted with the risk in front of them. **OQ-6** records the re-verification.
- **It fails R5 twice over, and the second one is fatal — this is the number that decides it.**
  Storage is billed at **$0.084 per GB-HOUR** for Valkey, with a **100 MB minimum**, plus **$0.0023 per
  million ECPUs** (Price List API, `AmazonElastiCache`, `publicationDate 2026-08-13`; corroborated by
  [elasticache/pricing](https://aws.amazon.com/elasticache/pricing/), retrieved 2026-08-15).
    - Idle floor: `0.1 GB × 730 h × $0.084` = **$6.13/month, which never reaches zero.**
    - **Per GB-HOUR means retention costs `$0.084 × 730` = $61.32 per GB-MONTH.** That is **245× DynamoDB's
      $0.25/GB-month** and **2,666× S3's $0.023/GB-month**. ElastiCache is priced as a working set, not a log.
      Requirement 2 asks it to be a log. §3 shows the result: **$5,825/month at 100M messages.**
- **Local testability**: LocalStack **Base and Ultimate only** — _"LocalStack supports ElastiCache via the
  Pro offering"_ ([docs.localstack.cloud/aws/services/elasticache](https://docs.localstack.cloud/aws/services/elasticache/),
  retrieved 2026-08-15). This is the one option whose local test story requires a **paid** LocalStack licence.
- **Verdict**: fails R3 and R5. Nothing in ADR-0016 is contradicted by declining it _here_ — ADR-0016
  governs a **recipient-keyed, ack-scoped, 72-hour pending set**, a working set. This is a retained log.
  Different store, different lifetime, different requirement.

---

## 3. Cost arithmetic at three volumes

**Model, stated so the arithmetic is checkable and falsifiable.** us-east-1 · 730 hours/month ·
**1 KB average message** · one primary consumer reading each message once · idle = zero messages, resources
still provisioned. DynamoDB storage assumes ~1.1 KB/item (payload + per-item overhead). "100M retained"
assumes a 30-day TTL so storage reaches steady state at one month's volume. **No free tier is applied to any
option** except where the free allowance is unconditional and I have cited it (SQS's 1M requests/month,
SNS's 1M requests/month). Queue options assume **no batching** in the headline number, with the batched
number given alongside — batching is a 10× lever and omitting it would misrepresent SQS.

| Option                            |   **Idle (0 msg)** | **1M msg/month** |                  **100M msg/month** |
| --------------------------------- | -----------------: | ---------------: | ----------------------------------: |
| **DynamoDB on-demand**            |          **$0.00** |        **$0.90** |                          **$91.72** |
| **Postgres (existing RDS)**       | **$0.00** marginal |       **~$0.12** |         **~$12.65** + capacity risk |
| **S3 + Firehose** (cold tier)     |              $0.00 |            $0.17 |                              $16.80 |
| **SQS Standard**                  |              $0.00 |            $0.80 |        $119.60 (**$11.60** batched) |
| **SQS FIFO**                      |              $0.00 |            $1.00 |        $149.50 (**$14.50** batched) |
| **SNS FIFO → SQS FIFO + archive** |              $0.00 |           ~$0.95 |                            ~$144.60 |
| **EventBridge + archive**         |              $0.00 |            $1.10 |           $110.00 + growing archive |
| **Kinesis provisioned, 1 shard**  |         **$10.95** |           $10.96 | $12.35 (+$14.60 if >24 h retention) |
| **Kinesis on-demand**             |         **$29.20** |           $29.32 |                              $41.20 |
| **MSK Provisioned, 2× t3.small**  |         **$66.58** |          ~$66.70 |                                ~$77 |
| **MSK Serverless**                |        **$547.50** |          $558.70 |                             $583.45 |
| **ElastiCache Serverless Valkey** |          **$6.13** |       **$61.32** |                          **$5,825** |

### The arithmetic, shown

**DynamoDB on-demand** — WRU $0.6250/M, RRU $0.125/M, storage $0.25/GB-month, TTL deletes free.

- 1M: writes `1,000,000 × $0.000000625` = **$0.625**. Storage `1M × 1.1 KB` ≈ 1.05 GB × $0.25 = **$0.26**.
  Reads, eventually consistent `Query` at 0.5 RRU per 4 KB: `1.05 GB ÷ 4 KB × 0.5` ≈ 137,626 RRU ×
  $0.000000125 = **$0.02**. Streams via Lambda ESM = **$0.00**. **Total $0.90.**
- 100M: writes `100,000,000 × $0.000000625` = **$62.50**. Storage 110 GB × $0.25 = **$27.50**.
  Reads ≈ **$1.72**. **Total $91.72.**
- ⚠️ **Without TTL this curve is not flat.** At 100M/month retained forever, storage reaches ~1.32 TB by
  month 12 = **$330/month in storage alone**, which alone exceeds the $300 budget. **TTL, or tiering to S3,
  is mandatory at high volume — not optional.** This is the most important caveat in the table.

**Postgres** — $0 marginal instance cost (already billed); RDS gp3 PostgreSQL storage $0.115/GB-month.

- 1M: ~1.05 GB × $0.115 = **$0.12**. 100M: ~110 GB × $0.115 = **$12.65**.
- ⚠️ These are **storage-only** figures and understate the true cost. They exclude the capacity headroom
  consumed on a shared `db.t4g.micro`, the IOPS, and the cost of the instance resize that 100M/month would
  eventually force. **The honest statement is: cheapest on paper, with an unpriced capacity risk.**

**SQS Standard** — $0.40/M requests (Price List API, `AWSQueueService`, `publicationDate 2025-08-28`),
first 1M/month free. Send + receive + delete = 3 requests/message unbatched.

- 1M: `3M − 1M free = 2M × $0.40/M` = **$0.80**. 100M: `300M − 1M = 299M × $0.40/M` = **$119.60**.
- Batched (10/call): `30M − 1M = 29M × $0.40/M` = **$11.60**.

**SQS FIFO** — $0.50/M. 1M: `2M × $0.50/M` = **$1.00**. 100M: `299M × $0.50/M` = **$149.50**
(batched **$14.50**).

**SNS FIFO → SQS FIFO + archive** — publish $0.30/M, payload $0.017/GB, subscription $0.01/M + $0.001/GB,
archive processing $0.10/GB, archive storage $0.023/GB-month, SQS delivery free, plus SQS FIFO
receive+delete at $0.50/M.

- 100M: `$30.00 + $1.70 + $1.00 + $0.10 + $10.00 + $2.30 + (199M × $0.50/M = $99.50)` ≈ **$144.60**.
- ⚠️ At the full 365-day retention the archive reaches ~1.2 TB → **+$27.60/month** at steady state.

**EventBridge** — $1.00/M custom events, **no free tier**. 1M = **$1.00** + $0.10 archive processing.
100M = **$100.00** + $10.00 processing + $2.30/month archive storage, **growing without bound** because the
default archive retention is indefinite.

**Kinesis provisioned, 1 shard** — `$0.015 × 730` = **$10.95** idle. PUT payload units $0.014/M.
1M = $10.95 + $0.014 = **$10.96**. 100M = $10.95 + $1.40 = **$12.35**.
⚠️ 100M/month ≈ 38 records/s average — one shard suffices on average — but a bulk import at ~830 records/s
is **83% of a single shard's 1,000 records/s ceiling**, so the real deployment needs 2+ shards, and
retention beyond 24 h adds $0.020/shard-hour (**+$14.60/shard/month**).

**Kinesis on-demand** — `$0.040 × 730` = **$29.20** idle. 100M × 1 KB = 100 GB: `+ $8.00` in `+ $4.00` out
= **$41.20**.

**MSK Serverless** — `$0.75 × 730` = **$547.50** idle, before a single partition, byte, or message.
Adding 10 partitions (`$0.0015 × 730 × 10` = $10.95), 100 GB in ($10.00), 100 GB out ($5.00) and 100 GB
storage ($10.00) → **$583.45**. **This is 182% of the entire account budget at zero traffic.**

**MSK Provisioned, 2× kafka.t3.small** — `$0.0456 × 730 × 2` = **$66.58** idle + storage at $0.10/GB-month.

**S3 + Firehose** — $0.029/GB, **billed in 5 KB increments**, so 1 KB messages bill as 5 KB.
1M → `1M × 5 KB = 5 GB × $0.029` = **$0.145** + S3 storage ~$0.023 = **$0.17**.
100M → `500 GB × $0.029 = $14.50` + S3 storage `110 GB × $0.023 = $2.53` = **$16.80**.
**Cheapest durable option at volume by 5×** — which is exactly why it belongs as the cold tier, not the
substrate.

**ElastiCache Serverless Valkey** — $0.084/GB-**hour**, 0.1 GB floor.

- Idle: `0.1 × 730 × $0.084` = **$6.13**.
- 1M retained (≈1 GB): `1 × 730 × $0.084` = **$61.32**.
- 100M retained (≈95 GB): `95 × 730 × $0.084` = **$5,825**.
- **That is 19× the entire $300 monthly account budget for the storage of one month of messages.**
  The per-GB-hour unit is not a rounding difference; it is a category difference. **This single line
  eliminates Valkey for R2 independently of the durability objection**, and it is the most decisive number
  in this document.

---

## 4. Ranked recommendation, with an explicit flip condition for each rank

### Rank 1 — **DynamoDB: PK = group key, SK = producer sequence, no LSI, TTL for reclamation**

```
PK  = "{producer}#{entityKind}#{entityId}"     -- the group
SK  = sequence (Number, producer-assigned, durable, monotonic per group)
     payload, producedAt, schemaVersion, ttl
     -- NO local secondary index (see §2.5: an LSI imposes a 10 GB per-group cap)
```

It is the only candidate that satisfies all six requirements without a workaround: `Query` **is** R2, the
3-AZ acknowledged write **is** R3, a single `PutItem` against a public IAM-only endpoint **is** R1 and R4,
on-demand **is** R5 at exactly $0.00 idle, and 40,000 WRU/table (adjustable) with per-partition sharding
**is** R6. It is the only option where R2's read path is O(size of the group) rather than O(size of
everything), and the only one where reading history neither consumes the data nor perturbs live delivery.

⛔ **It is not free of obligations.** Rank 1 is conditional on **also** building a transactional outbox in
each Postgres-backed producer (§5), and on **shipping a TTL or an S3 cold tier from day one** (§3 shows the
storage curve is not flat without one). A recommendation of DynamoDB without those two is not this
recommendation.

**Flip away from Rank 1 when any one of these becomes true:**

1. **There is, and will remain, exactly one producer, and it is Postgres-backed.** Then Postgres wins
   outright: no dual write, no outbox, no relay, no second store, no emulator, richer queries. The whole
   case for DynamoDB is cross-producer reach and non-VPC producers; with one VPC-resident producer that case
   evaporates. **This is the most likely flip, and it should be checked before writing any code.**
2. **Per-group history must be joined to relational producer state in the same query** (e.g. "show me each
   recipe's import history alongside its current row"). Cross-store joins in application code are a
   correctness liability; move the log to Postgres.
3. **Sustained writes to a single group exceed ~1,000/s** and write sharding's N-way scatter-gather makes
   the read path unacceptable — then a partitioned log (Kinesis provisioned) becomes the right shape, and
   the ~$11–25/month is buying something real.
4. **Retention must exceed ~1 TB with full-fidelity queryability** — DynamoDB storage at $0.25/GB-month
   becomes the dominant line item; tier to S3 + Athena (Rank 3).

### Rank 2 — **Postgres append-only table in the producing service's own database**

Loses to Rank 1 on exactly two requirements — **R1** (a non-VPC Lambda cannot reach a private RDS without
VPC attachment + NAT under ADR-0004) and **R6** (the ceiling is a shared `db.t4g.micro`, and raising it is a
resize, not an API call) — plus the GR-021 consequence that cross-producer history means N databases and
N credentials. It **wins decisively on R3**, because the message and the state change commit in one
transaction and the outbox problem never arises.

**Flip TO Rank 2 when:** flip condition 1 or 2 above fires; or when the outbox + relay machinery that
DynamoDB requires is measured to be more code than the Postgres option in total; or when a load test shows
the substrate's write rate is comfortably inside the instance's headroom AND no non-VPC producer is planned.

### Rank 3 — **DynamoDB (hot, TTL ≈30–90 d) + Streams → Firehose → S3 (cold, indefinite)**

Not a competitor to Rank 1 — its **planned successor**. Keeps the $0.00 idle and the O(group) hot query,
and moves the storage curve from $0.25/GB-month to $0.023/GB-month before it matters.
**Flip TO Rank 3 when** monthly volume exceeds ~10M messages, or when required retention exceeds ~90 days.
Build the TTL attribute in Rank 1 so this is a configuration change, not a migration.

### Rank 4 — **Kinesis Data Streams, provisioned**

The right answer to a different question: many independent consumers, high sustained throughput, replay by
offset. Fails R5 ($10.95/month idle) and serves R2 only by shard scan.
**Flip TO Rank 4 when** three or more independent consumers need the same stream at different positions AND
sustained throughput justifies a permanent shard.

### Rank 5 — **SNS FIFO + archive/replay**

Only if the requirement is re-read after a _downstream outage_ rather than per-group _query_.
**Flip TO Rank 5 when** R2 is reinterpreted as disaster recovery.

### Not ranked — eliminated on the merits

| Option                            | Eliminated by                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQS Standard / FIFO / SNS→SQS** | **R2.** Deleted on consume; 14-day cap. No configuration recovers a message a consumer has deleted.                                                                               |
| **EventBridge**                   | **R2** — replay is explicitly unordered at 1-minute granularity, has no grouping key, and can only target the source bus. **R3 as deployed** — a rule-less bus discards silently. |
| **MSK Serverless**                | **R5** — $547.50/month idle = 182% of the total budget.                                                                                                                           |
| **MSK Provisioned**               | **R5** — $66.58/month idle, highest operational burden on the list.                                                                                                               |
| **Timestream for LiveAnalytics**  | **Cannot be provisioned.** Closed to new customers 2025-06-20.                                                                                                                    |
| **ElastiCache Serverless Valkey** | **R3** (acknowledged-write loss) **and R5** ($6.13/month floor; **$61.32/GB-month** retention → $5,825/month at 100M).                                                            |
| **Firehose → S3 alone**           | **R6** (buffered delivery) and **R2** (no per-group index). Excellent as Rank 3's cold tier.                                                                                      |

**Note on method**: none of this ranking rests on adoption or popularity. Kafka is the most widely used
option on the list and finishes unranked, on a sourced price.

---

## 5. The outbox question, answered

> **Question.** When the producer's own state change is a Postgres write, is a transactional outbox
> _necessary_ to guarantee no message is lost, or is producer-side retry sufficient?

### 5.1 Decompose the dual write. There are exactly two failure classes, and they are not alike.

The producer commits transaction **T** to Postgres, then publishes message **M** to the substrate.

- **F1 — the publish fails and the producer survives.** Network error, throttle, 5xx, timeout. The producer
  still holds M in memory and can retry with backoff. **This is a liveness problem.** Delivery is delayed,
  not lost, provided the producer actually retries and does not treat failure as terminal.
- **F2 — the publish is never attempted, because the producer died between `COMMIT` and publish.** Fargate
  task replaced during a deploy, Spot reclamation, OOM kill, Lambda timeout, host failure. **No retry can
  help, because the agent that would retry no longer exists.**

### 5.2 The precise answer

**Producer-side retry closes F1 completely and F2 not at all.** That is the whole of it. A transactional
outbox exists for exactly one reason: to close F2, by making M a row written _inside_ T, so that "the state
changed" and "the message exists" become the same durable fact.

Two things follow that are usually stated sloppily:

- **F1 is not an argument for an outbox.** If F1 currently causes loss in this codebase, that is a _coding
  defect_, not a missing pattern. `FoodEventEmitter` catches and swallows every `PutEvents` failure (doc
  17 §S-1, `food-event-emitter.ts:172-177`), which converts a retryable liveness failure into silent
  permanent loss. **The fix for that is to stop swallowing** — bounded retry, then a loud failure. Adding an
  outbox while still swallowing errors fixes nothing.
- **F2's window is small but it is not random.** It is milliseconds wide, but it is **positively correlated
  with deploys, scale-in, and Spot reclamation** — that is, it fires disproportionately during exactly the
  events an operator is most likely to be causing deliberately, and least likely to attribute to message
  loss. Reasoning about it as "a rare uniform-random event" understates it.

### 5.3 The discriminator: is the message stream derivative or authoritative?

**This is where the prior analysis went wrong, and it is worth naming precisely.**

- **Derivative framing** (the _previous_ requirement set, and ADR-0019:126-127 — _"the message is a
  notification **of** a committed state change, never the state itself"_): truth lives in the database
  projection; the message only conveys freshness. A consumer that misses M can recover **complete, correct**
  state by reading the projection, and the next message for that group restores liveness anyway. Under this
  framing an F2 loss costs **staleness with a bounded, self-healing blast radius** — a **liveness** failure.
  **Under the derivative framing, producer-side retry plus a periodic reconciliation is sufficient, and
  calling an outbox "required for correctness" is a category error.** Any analysis that asserted "without an
  outbox the system is _incorrect_" while the DB remained authoritative was treating a liveness risk as a
  correctness risk.
- **Authoritative framing** (**the present requirement set**): **requirement 2 makes the message sequence
  itself the deliverable.** "The consumer must be able to see ALL messages that were sent for a group" means
  the history _is_ the datum, not a cache of something else. A hole in a history is **wrong**, and — this is
  the load-bearing asymmetry — **no subsequent message repairs it**, because the missing message is not a
  stale view of a current value; there is no current value it is a view of. Requirement 3 says the same
  thing normatively: _"must not be lost or dropped. Durability is non-negotiable."_

**Therefore: under the requirements as written, F2 is a correctness risk, and an outbox (or an equivalent
atomicity mechanism) IS necessary — for the subset of producers whose message is caused by a Postgres
commit. Producer-side retry is provably sufficient for F1 and provably insufficient for F2.**

### 5.4 Four qualifications that keep that answer honest

1. **The obligation is scoped, not universal.** A stateless producer — a Lambda that receives an input and
   emits a message, with no second store — has **nothing to be atomic with**. For it there is no dual write,
   and "retry until the substrate durably acknowledges, then return" is not a compromise; it is exactly
   correct and complete. R1 says _any_ producer must be able to emit; the outbox obligation attaches only to
   the producers that also commit to Postgres. **Do not build an outbox for producers that do not need one.**
2. **If the substrate IS Postgres, the question dissolves entirely.** The message row and the state row
   commit in one transaction; there is no second system to bridge. This is the single strongest technical
   argument for Rank 2, and it is precisely why the outbox is best understood as **the tax levied by
   choosing DynamoDB**. Rank 1 should be adopted with that tax stated on its face, not discovered later.
3. **An outbox converts "may lose" into "may duplicate". It does not deliver exactly-once.** The relay can
   publish and then die before recording the publish, so the substrate must expect repeats. Requirement 2
   therefore _also_ requires a **producer-assigned, per-group, durably-derived, monotonic sequence** — so a
   duplicate is recognisable as a duplicate rather than admitted as a genuine second event. In DynamoDB this
   is free: `(PK=group, SK=sequence)` makes a repeated `PutItem` idempotent by construction. ⛔ Per doc
   17/B-9, that sequence **must** come from the producing row's durable version — never a wall clock (skewed
   across tasks) and never an in-memory counter (a restart resets it and every later message is then
   silently rejected as already-seen, a permanent stall no alarm catches).
4. **The cheaper 90% alternative, and the exact condition under which it is NOT equivalent.** A periodic
   **reconciliation sweep** — compare the producer's state table against the substrate's max sequence per
   group and re-emit the gaps — reduces F2 from "permanent hole" to "hole for at most one sweep interval",
   for far less machinery than an outbox + relay. **It is equivalent to an outbox if and only if every
   message is fully reconstructible from durable state.** The moment a message carries anything not
   persisted elsewhere — a transient error string, a retry count, an observed timestamp, an upstream
   response fragment — the sweep **cannot rebuild it** and only an outbox is correct. **This is the test to
   apply, per message type, before choosing.** For a status-transition message derived entirely from a row's
   current state, the sweep may genuinely be enough at current volume.

**Rejected alternative, named so nobody re-proposes it:** make the substrate append the _first_ durable act
and rebuild the Postgres projection from the log. That also removes the dual write — it is event sourcing —
but it inverts which store is authoritative, contradicting ADR-0019 §5, and it is a vastly larger change
than the requirement asks for. **Rejected on scope, not on merit.**

---

## 6. The single strongest objection to the top choice

> **Choosing DynamoDB manufactures the very dual-write problem that Rank 2 does not have — and the fix for
> it is most of Rank 2. So Rank 1 may be Rank 2 plus a second datastore.**

Stated at its sharpest: requirement 3 says messages must not be lost. **DynamoDB does not satisfy that
requirement on its own** for any Postgres-backed producer. It satisfies it only in combination with a
per-producer **outbox table in Postgres** plus a **relay** — i.e. a `(group, sequence, payload, claimed_at)`
table, a `FOR UPDATE SKIP LOCKED` lease, a reaper for expired leases, a publish step, and a guarded delete.
That is substantially the machinery of Rank 2. A skeptical reviewer is entitled to say: _"you have built the
Postgres option, and then also pay for and operate DynamoDB, and now have two stores to keep consistent, two
failure domains, two backup stories, and a relay that can lag."_ **That objection is correct on its face and
I am not going to argue it away.**

**What is genuinely different, stated without spin:**

- The outbox row is **transient** (deleted once the relay confirms) while the DynamoDB item is the
  **retained, queryable, cross-producer history**. They are not the same artifact doing the same job; one is
  a hand-off buffer measured in seconds, the other is the product surface R2 asks for.
- Rank 2 does **not** avoid all of this at N producers. GR-021's single-writer rule puts each producer's log
  in **its own logical database with its own role**, so cross-producer per-group history requires N
  connections, N credentials, and a client-side merge. Rank 1 replaces that with one `Query`.
- The R1 gap is **structural and unfixable in Rank 2**: under ADR-0004 a non-VPC Lambda cannot reach private
  RDS at all. That is not a preference; it is a topology fact with a NAT bill attached.

**Where the objection wins outright** — and I want this on the record so the flip is honest rather than
grudging: **at exactly one Postgres-backed producer, with no non-VPC producer planned, Rank 2 is the better
engineering answer and Rank 1 is over-built.** That is flip condition 1, and it is the _most likely_ of the
flip conditions to be true today. **It should be checked before a line of code is written.**

**A second, weaker objection, recorded rather than dismissed**: the owner already rejected DynamoDB for the
adjacent store (ADR-0016:229-238). Re-proposing it needs a _new_ reason, and there are three, none of which
ADR-0016 faced: R2's re-readable per-group history (ADR-0016's store is an ack-scoped working set), R1's
any-producer reach (ADR-0016's store has one writer), and R3's declared non-negotiable durability (ADR-0016
explicitly accepted the opposite property). Those are new facts, not a relitigation — but the owner is
entitled to weigh that this is the second time DynamoDB has been proposed.

---

## 7. Open questions

**OQ-1 (blocking — decides Rank 1 vs Rank 2, and it is cheap to answer).** Will more than one producer, or
any producer not backed by this Postgres instance, write to this substrate? If the honest answer is "one
Fargate-resident, Postgres-backed producer, and no plan for another", **flip to Rank 2 now** and skip the
outbox entirely. Requirement 1's "any producer" reads like a design goal; it needs to be confirmed as a
_present_ requirement rather than a presumed future one — building for it otherwise is precisely the YAGNI
misuse CLAUDE.md forbids.

**OQ-2 (blocking — decides the outbox, per §5.4/4).** For each message type: **is the message fully
reconstructible from durable producer state?** If yes, a reconciliation sweep may substitute for the outbox
at a fraction of the machinery. If any message carries information persisted nowhere else, only an outbox is
correct. This must be answered **per message type**, not once globally.

**OQ-3 (blocking — decides retention cost and TTL).** What is the required retention for per-group history,
and does "ALL messages that were sent for a group" mean _ever_, or _within a window_? §3 shows the answer
moves DynamoDB from $91.72/month to $330/month-and-climbing at 100M/month. Unbounded retention is not
free in any option, and it is the difference between Rank 1 and Rank 3.

**OQ-4 (design).** Is the per-group history a **product deliverable** (a user-visible activity feed or audit
trail) or an **internal recovery aid**? This is the same fork as §5.3's authoritative-vs-derivative
framing and it determines whether §5's answer is "outbox required" or "retry + sweep suffices". It is the
single highest-leverage question in this document.

**OQ-5 (sizing, cheap).** What is the expected **maximum number of messages in one group**, and the maximum
**write rate into one group**? These map directly onto DynamoDB's 1 MB `Query` page (pagination) and the
1,000 write-units/s per-partition ceiling (write sharding). Both have documented escapes; both are much
cheaper to design in than to retrofit.

**OQ-6 (verification I could not complete).** I did **not** independently re-verify ElastiCache Serverless's
acknowledged-write-loss behaviour from current AWS documentation — the serverless overview page did not
render for me, and I relied on ADR-0016:186-198. The conclusion does not turn on it (the $61.32/GB-month
retention arithmetic eliminates Valkey independently), but the claim should be re-checked before being
restated as fact in an ADR.

**OQ-7 (verification I could not complete).** Does this AWS account have **pre-existing Timestream for
LiveAnalytics usage**? If it does, LiveAnalytics remains creatable under the payer account and my "cannot be
provisioned" statement is too strong for this account specifically. It changes nothing in the ranking —
Timestream is a time-series database, not a message substrate — but the claim should be checked, not assumed.

**OQ-8 (licensing, affects the local-test story for the whole comparison).** LocalStack's free tier is now
**"Hobby"**, and it is **non-commercial use only**
([localstack.cloud/pricing](https://www.localstack.cloud/pricing), retrieved 2026-08-15). Which LocalStack
tier does this project hold? It does not affect Rank 1 (DynamoDB Local is a first-party AWS artifact and
needs no LocalStack at all) or Rank 2 (Docker Postgres), but it **does** decide whether ElastiCache is
locally testable, and it may affect existing harnesses.

**OQ-9 (pre-existing, inherited from doc 17 §S-1 — still unresolved).** `kitchensink-food-{stage}` has no
rule consumer and `FoodEventEmitter` swallows every `PutEvents` failure, so events emitted in production
today are discarded and the failure is indistinguishable from success. Whichever rank is chosen, that code
path is replaced — but it is live now. **Is repairing it in scope, or tracked separately?**

---

## Verification — what I did, what I did not, and what I am unsure about

**Method.** Skills were checked first (`aws-messaging-and-streaming` supplied the messaging-vs-streaming
framing and the integration gotchas cited inline). A **mandatory deprecation check** was run before any
recommendation and it changed the outcome for one candidate (Timestream). Prices were then taken from the
**AWS Price List Bulk API** — the machine-readable source behind the pricing pages — because several
human-readable pricing pages did not render their tables. Every Price List file carries a `publicationDate`,
reproduced below. All figures retrieved **2026-08-15**.

| Source               | Offer code / URL                                                                                                                          | `publicationDate`         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| SQS                  | `AWSQueueService` (Price List API, us-east-1)                                                                                             | 2025-08-28                |
| SNS                  | `AmazonSNS`                                                                                                                               | 2026-02-11                |
| Kinesis Data Streams | `AmazonKinesis`                                                                                                                           | 2026-08-13                |
| MSK                  | `AmazonMSK`                                                                                                                               | 2026-07-29                |
| ElastiCache          | `AmazonElastiCache`                                                                                                                       | 2026-08-13                |
| Firehose             | `AmazonKinesisFirehose`                                                                                                                   | 2026-07-29                |
| RDS                  | `AmazonRDS`                                                                                                                               | 2026-08-12                |
| DynamoDB             | [pricing/on-demand](https://aws.amazon.com/dynamodb/pricing/on-demand/) (no regional Price List index fetched)                            | page retrieved 2026-08-15 |
| EventBridge          | [eventbridge/pricing](https://aws.amazon.com/eventbridge/pricing/) (**no Price List index exists** — `NoSuchKey` for `AmazonEventBridge`) | page retrieved 2026-08-15 |

**Quotas and semantics** were taken from AWS documentation, each cited inline at the point of use.
**PostgreSQL `NOTIFY`** semantics are from the PostgreSQL 16 manual — the version this repo runs.

**Repository facts I verified directly** (not taken from doc 17): the RDS instance sizing and its per-stage
split (`packages/infra/global/lib/platform/data-stack.ts:83-84,153`); the food EventBridge bus and its
`grantPutEventsTo` grants (`packages/services/food-service/infra/lib/food-service-stack.ts:266-267,366,431,492`);
the existence of the operational-schema and pending-archives DAL precedents.

**Facts I carried from doc 17 without independent re-verification** (cited as such at each use): the
swallowed-`PutEvents` behaviour of `FoodEventEmitter`, the ~830 writes/s bulk-import estimate (which doc 17
itself labels arithmetic, not measurement), and ADR-0016's durability record.

**NOT done, and it matters**: no command was run against AWS; no cost figure comes from this account's
actual bills; **nothing was load-tested**, because the substrate does not exist. The §3 table is list-price
arithmetic on a stated model, not a measurement — the model's assumptions (1 KB messages, one read per
message, no batching) are the largest source of error, and a 10× change in average message size moves every
byte-metered row by 10×.

**Where I am genuinely uncertain, stated rather than asserted:**

- **Firehose's current minimum S3 buffer interval** — I did not verify it from a primary source. The
  _existence_ of buffering is certain and is what fails R6; the specific "≥60 s" figure is **unverified**.
- **DynamoDB's on-demand free-tier status.** The pricing page ties the 25 WCU/25 RCU allowance to
  _provisioned_ capacity and separately describes a time-limited $200 credit. I could not establish an
  unambiguous perpetual on-demand free allowance, **so §3 applies none** — the DynamoDB figures are
  conservative (an upper bound), not optimistic.
- **ElastiCache acknowledged-write loss** — see OQ-6.
- **MSK Provisioned's minimum broker count.** I priced two `t3.small` brokers as the practical floor but did
  not verify the enforced minimum from a primary source. The verdict is insensitive to it: even **one**
  broker is $33.29/month idle, which fails R5.

**Confidence.** **High** on: the R2 discriminator and the elimination of the queue family (quoted AWS
lifecycle wording); the Timestream closure (quoted AWS notice); every price carrying a Price List
`publicationDate`; the DynamoDB per-partition and item-collection quotas (quoted); the EventBridge
replay-is-unordered finding (quoted); the §5 F1/F2 decomposition, which is a logical argument that does not
depend on any figure. **Medium** on: the §3 model's assumptions and therefore its absolute totals; the
Rank 1 vs Rank 2 ordering, which hinges entirely on **OQ-1** and would invert if the answer is "one
producer". **Low** on: the four uncertainties listed immediately above.
