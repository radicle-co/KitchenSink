# 30 — DynamoDB + DynamoDB Streams: implementation research for a first deployment

**Type**: framework/platform research (primary-source, version-current)
**Date**: 2026-08-15
**Posture**: read-only research. No repository file outside this document was modified; no command was run
against the AWS account. Every quota, price and default below carries a source URL and a retrieval date.
**Region for all prices**: `us-east-1`. **Retrieval date for every AWS URL below**: **2026-08-15** unless
stated otherwise.
**Toolchain verified locally**: `aws-cdk-lib@2.254.0` (read from `node_modules/aws-cdk-lib/package.json`),
Node 24, esbuild-bundled Lambdas.

**Design under study** (from the brief): `PK = groupId`, `SK = ISO-8601 UTC timestamp, fixed ms precision`.
Producers (Fargate + Lambda) `PutItem` fire-and-forget. Consumer reads ALL messages for a group in one
ordered `Query`. TTL ~3 days. DynamoDB Streams → Lambda → push to clients. At-least-once; idempotent consumer.

---

## 0. Read this first — four findings that change the design, not just its settings

### D-1 (BLOCKER). The sort key as specified is a silent data-loss key.

`PutItem` is a **replace**, not an append: _"Creates a new item, or replaces an old item with a new item. If
an item that has the same primary key as the new item already exists in the specified table, the new item
completely replaces the existing item."_
([PutItem API reference](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html),
retrieved 2026-08-15.)

The proposed key is `(groupId, ISO-8601 ms)`. Two messages for the same group in the **same millisecond**
therefore collide, and the second **destroys** the first — returning **HTTP 200** while doing so. Because the
producers are explicitly **fire-and-forget**, there is no caller to observe the loss, no error, and no metric.
This is not a rare race in the intended topology: the recipe-import spine emits stage transitions in bursts,
two Fargate tasks and a Lambda can produce for the same `groupId` concurrently, and a millisecond is a long
time. A retry of a "failed" (but actually applied) put is _idempotent_ under this key, which is the one thing
the design gets for free — but it is not worth the collision exposure.

**The fix is in the key, not in the caller.** Either:

- make the SK **`<ISO-8601 ms>#<ULID>`** (or `#<KSUID>`, or `#<producer>#<monotonic seq>`) — still
  lexicographically time-ordered, because ISO-8601 with fixed-width ms sorts correctly as a string and the
  suffix only breaks ties; or
- keep the bare timestamp and add `ConditionExpression: 'attribute_not_exists(PK)'`, which AWS documents as
  the anti-overwrite idiom (_"To prevent a new item from replacing an existing item, use a conditional
  expression that contains the `attribute_not_exists` function with the name of the attribute being used as
  the partition key"_, same source). But this converts a collision into a `ConditionalCheckFailedException`
  that a fire-and-forget producer will swallow — it turns silent loss into silent loss with extra steps.

**Recommendation: append a ULID.** It removes the failure mode by construction rather than detecting it, and
ULID is a stable, widely-used library (library-first: do not hand-roll monotonic ID generation). Note the
key-length ceilings while you are here: partition key max **2048 bytes**, sort key max **1024 bytes**
([data types & naming rules](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html),
retrieved 2026-08-15) — neither binds here.

### D-2 (BLOCKER for any ordering claim). Stream ordering is per **item**, not per **partition key**.

The brief asks to "confirm ordering is per partition key." **It is not.** AWS states it precisely:

> "DynamoDB Streams guarantees ordering at the level of an individual item—that is, across all modifications
> to the same primary key (the partition key, or the partition key and sort key)—not across an entire
> partition. Because an item collection that shares a partition key can span more than one partition,
> DynamoDB preserves the order of changes for each item rather than across a whole item collection."

([Change data capture for DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html),
retrieved 2026-08-15.)

In this design **every message is a distinct item** (unique `PK+SK`), and each item is written exactly once.
So the per-item guarantee is **vacuous**: it says nothing whatsoever about the relative order in which two
messages of the same group reach the consumer Lambda. This is compounded by the second half of the quote —
and confirmed on the partitions page:

> "If your table doesn't have local secondary indexes, DynamoDB will automatically split your item collection
> over as many partitions as required to store the data and to serve read and write throughput."

([Partitions and data distribution](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html),
retrieved 2026-08-15.)

and each partition maps to its own shard:

> "Each open shard corresponds to exactly one table partition: a given partition writes its stream records to
> a single dedicated shard, and no other partition writes to that shard."
> ([Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html))

So a busy group's item collection can split across partitions → across shards → across concurrently-invoked
Lambda instances, with **no** cross-shard ordering. In practice a small group stays on one partition and its
records arrive in sequence order, but that is an **implementation artifact you must not encode as a
guarantee**.

**The design already contains the escape hatch, and should use it.** Requirement (2) is that the consumer can
read **all** messages for a group in **one ordered `Query`** — and `Query` **is** ordered, by sort key, from
the table itself. Therefore:

> **Treat the stream record as a _doorbell_, not as _data_.** On any stream record for `groupId=G`, the
> consumer re-`Query`s `G` from the table and pushes the resulting ordered set. Order then comes from the
> table (guaranteed), not from the stream (not guaranteed). Duplicate and out-of-order doorbells become
> harmless, which is exactly what an at-least-once + idempotent-consumer contract wants.

This also makes `KEYS_ONLY` the right `StreamViewType` (see §5) and makes `parallelizationFactor` safe to
raise (see §3).

### D-3 (HIGH, correctness). Expired-but-not-deleted items **do** still come back from `Query`.

The brief flags this as a correctness issue, and it is real. AWS is explicit:

> "Expired items that are pending deletion can be filtered from read and write operations. … If they are not
> filtered, they'll continue to show in read and write operations until they are deleted by the background
> process."
> "**Note** These items still count towards storage and read costs until they are deleted."

([Working with expired items and TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html),
retrieved 2026-08-15)

and the lag is measured in **days**, not minutes:

> "DynamoDB automatically deletes expired items **within a few days** of their expiration time, without
> consuming write throughput."
> "Items with valid, expired TTL attributes may be deleted by the system at any time, **typically within a few
> days** after their expiration."
> ([Using TTL in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html),
> retrieved 2026-08-15)

So a "3-day TTL" is a **3-day floor, not a 3-day ceiling**: an item may remain readable for a week. Every
read path MUST carry `FilterExpression: '#ttl > :now'`. See §6 for the exact shape and its cost consequence.

### D-4 (HIGH, operability). The SQS/SNS on-failure destination gives you **metadata only**.

> "Each record sent to the destination is a JSON document containing metadata about the failed invocation.
> **For Amazon S3 destinations, Lambda also sends the entire invocation record along with the metadata.**"
> "**You can use this information to retrieve the affected records from the stream for troubleshooting. The
> actual records aren't included, so you must process this record and retrieve them from the stream before
> they expire and are lost.**"

([Retain discarded records for a DynamoDB event source](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html),
retrieved 2026-08-15)

An SQS DLQ therefore hands you `{shardId, startSequenceNumber, endSequenceNumber, streamArn, batchSize, …}`
and a **24-hour clock** to go fetch the actual records yourself before the stream trims them. **Use the S3
on-failure destination**, which includes `"payload": "<Whole Event>"`. CDK supports it for
`DynamoEventSource` — `dynamodb.js` passes `supportS3OnFailureDestination: !0` when binding (verified in
`node_modules/aws-cdk-lib/aws-lambda-event-sources/lib/dynamodb.js`, 2.254.0). Under the D-2 doorbell design
this matters much less (the payload is re-derivable from the table for 3 days), which is another argument for
that design.

---

## 1. Streams → Lambda event source mapping: every knob, CDK name vs API name, defaults

**The CDK prop names are NOT the API names.** Three of the names in the brief (`bisectBatchOnFunctionError`,
`maximumRetryAttempts`, `maximumRecordAgeInSeconds`) are **API** parameters; CDK exposes them under different
names. `retryAttempts` and `maximumRetryAttempts` in the brief are **the same knob**, not two.

Sources for the whole table:
[Lambda parameters for DynamoDB event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html)
(retrieved 2026-08-15) for the API column; and the installed
`node_modules/aws-cdk-lib/aws-lambda-event-sources/lib/stream.d.ts` + `stream.js` + `dynamodb.js` (2.254.0,
read 2026-08-15) for the CDK column.

| API parameter                                      | CDK prop (`DynamoEventSourceProps`)         | API default        | CDK default                                                                                   | Range / notes                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BatchSize`                                        | `batchSize`                                 | `100`              | **`100` — set explicitly by CDK** (`batchSize: this.props.batchSize \|\| 100` in `stream.js`) | API: "Maximum: 10,000". **See discrepancy note below.** Also capped by the 6 MB invocation payload.                                 |
| `MaximumBatchingWindowInSeconds`                   | `maxBatchingWindow` (`Duration`)            | `0`                | passthrough → `0`                                                                             | Max `Duration.minutes(5)`                                                                                                           |
| `ParallelizationFactor`                            | `parallelizationFactor`                     | `1`                | passthrough → `1`                                                                             | 1–10                                                                                                                                |
| `StartingPosition`                                 | `startingPosition`                          | n/a (**required**) | n/a (**required** — CDK has no default)                                                       | `TRIM_HORIZON` or `LATEST` only for DynamoDB                                                                                        |
| `BisectBatchOnFunctionError`                       | **`bisectBatchOnError`**                    | `false`            | passthrough → `false`                                                                         | boolean                                                                                                                             |
| `MaximumRetryAttempts`                             | **`retryAttempts`**                         | `-1` (infinite)    | passthrough → `-1`                                                                            | API table says "Minimum: 0, Maximum: 10,000"; CDK says "-1 (infinite) or 0 to 10000". **Ambiguity flagged below.**                  |
| `MaximumRecordAgeInSeconds`                        | **`maxRecordAge`** (`Duration`)             | `-1` (infinite)    | passthrough → `-1`                                                                            | API: min `-1`, max `604,800` (7 d). CDK docstring: min 60 s, max 7 d. **Values > 86,400 are inert** — the stream only retains 24 h. |
| `DestinationConfig.OnFailure`                      | `onFailure` (`IEventSourceDlq`)             | none               | none — "discarded records are ignored"                                                        | SQS queue, SNS topic, S3 bucket, or Kafka topic. S3 is supported for DynamoDB in CDK.                                               |
| `FilterCriteria`                                   | **`filters`** (`Array<{[k: string]: any}>`) | none               | none                                                                                          | See §1.3                                                                                                                            |
| `FunctionResponseTypes: [ReportBatchItemFailures]` | **`reportBatchItemFailures`**               | not enabled        | `false`                                                                                       | See §2.3                                                                                                                            |
| `TumblingWindowInSeconds`                          | `tumblingWindow` (`Duration`)               | n/a                | none                                                                                          | 0–900 s. Not needed here.                                                                                                           |
| `Enabled`                                          | `enabled`                                   | `true`             | `true`                                                                                        |                                                                                                                                     |
| —                                                  | `filterEncryption` (`IKey`)                 | —                  | AWS-managed key                                                                               | CMK for filter criteria                                                                                                             |
| —                                                  | `metricsConfig` (`MetricsConfig`)           | —                  | disabled                                                                                      | Opts into ESM metrics (§4)                                                                                                          |
| —                                                  | `provisionedPollerConfig`                   | —                  | none                                                                                          | **MSK / self-managed Kafka only** — not applicable to DynamoDB                                                                      |

### 1.1 ⚠️ CDK doc-vs-code discrepancy on `batchSize` (verified locally)

`stream.d.ts` documents the DynamoDB maximum as **1000**:

> "Maximum value of: _ 1000 for `DynamoEventSource` _ 10000 for `KinesisEventSource`…"

but the shipped validator in `dynamodb.js` (2.254.0) enforces **1–10000**:

> `Maximum batch size must be between 1 and 10000 inclusive (given ${this.props.batchSize})`

The **code** agrees with the current API doc ("Maximum: 10,000"); the **docstring** is stale (AWS raised the
DynamoDB ceiling from 1,000 to 10,000). Do not trust the JSDoc/IDE hover here. Practically irrelevant for this
workload — batches will be small — but it is exactly the kind of thing that produces a confident wrong review
comment.

### 1.2 Ambiguity to flag rather than guess

`MaximumRetryAttempts` is documented with **`Default: -1`** and **`Minimum: 0`** in the same row of the AWS
table ([services-ddb-params](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html),
retrieved 2026-08-15) — the default is below the stated minimum. CDK's docstring reads it as "-1 (infinite) or
0 to 10000", which is the sensible reading, but **AWS's own table is self-contradictory**. If you set an
explicit value you are outside the ambiguity; do that.

### 1.3 Filter criteria specifics

DynamoDB ESM filtering supports only the `dynamodb` key, and filters on the DynamoDB-typed JSON:

> "**Note** DynamoDB event source mappings only support filtering on the `dynamodb` key."
> "DynamoDB event filtering doesn't support the use of numeric operators (numeric equals and numeric range).
> Even if items in your table are stored as numbers, these parameters are converted to strings in the JSON
> record object."
> The `Exists` operator "only works on leaf nodes in the event JSON".

([Using event filtering with a DynamoDB event source](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb-filtering.html),
retrieved 2026-08-15)

Pattern shape (CDK `filters` takes the object, not the escaped string):

```ts
filters: [
    lambda.FilterCriteria.filter({
        eventName: lambda.FilterRule.isEqual('INSERT'),
    }),
],
```

**Two live consequences for this design.** (a) TTL deletions arrive as `eventName: 'REMOVE'`; if the consumer
only cares about new messages, filter to `INSERT` and Lambda will not even invoke on expiry churn — this is
free and removes a whole class of accidental re-push. (b) If you choose `KEYS_ONLY` (§5) you can only filter
on `Keys`/`eventName`, not on payload attributes. Note also that filtered-out records still count as read from
the stream; the `FilteredOutEventCount` metric exists to observe it (§4).

---

## 2. Poison-pill handling

### 2.1 How one bad record blocks a shard

> "**During invocation:** If the function is invoked but returns an error, Lambda retries until the records
> expire, exceed the maximum age (`MaximumRecordAgeInSeconds`), or reach the configured retry quota
> (`MaximumRetryAttempts`)."
> "If the error handling measures fail, Lambda discards the records and continues processing batches from the
> stream. **With the default settings, this means that a bad record can block processing on the affected shard
> for up to one day.** To avoid this, configure your function's event source mapping with a reasonable number
> of retries and a maximum record age that fits your use case."

([services-dynamodb-errors](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html),
retrieved 2026-08-15)

The mechanism: the ESM checkpoints a shard only on batch success, so a failing batch is retried **in place**
and every record behind it on that shard waits. "Up to one day" is the 24-hour stream retention (§4) — i.e.
with the shipped defaults (`retryAttempts: -1`, `maxRecordAge: -1`) **one un-processable message stalls its
entire shard until the records rot**. For a user-facing push path that is a total outage for every group that
hashes to that partition.

**Therefore: never deploy this ESM on defaults.** Set `retryAttempts` and `maxRecordAge` explicitly.

### 2.2 `bisectBatchOnError`

> "For function errors, you can also configure `BisectBatchOnFunctionError`, which splits a failed batch into
> two smaller batches, isolating bad records and avoiding timeouts. **Splitting batches doesn't consume the
> retry quota.**" (same source)

So bisection is a binary search for the poison record: it repeatedly halves the failing batch until the bad
record is isolated in a batch of one, which then exhausts its retries alone and is discarded (or sent to the
on-failure destination) while its neighbours succeed. Because splits are free against the retry quota, there
is **no reason not to enable it** on a stream ESM. Interaction with partial batch response:

> "If your invocation fails and `BisectBatchOnFunctionError` is turned on, the batch is bisected regardless of
> your `ReportBatchItemFailures` setting. When a partial batch success response is received and both
> `BisectBatchOnFunctionError` and `ReportBatchItemFailures` are turned on, the batch is bisected at the
> returned sequence number and Lambda retries only the remaining records."
> ([partial batch response](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html),
> retrieved 2026-08-15)

### 2.3 `reportBatchItemFailures` (partial batch response)

> "When consuming and processing streaming data from an event source, by default Lambda checkpoints to the
> highest sequence number of a batch **only when the batch is a complete success**. Lambda treats all other
> results as a complete failure and retries processing the batch up to the retry limit."

Enable it and return:

```jsonc
{ "batchItemFailures": [{ "itemIdentifier": "<SequenceNumber>" }] }
```

> "If the `batchItemFailures` array contains multiple items, **Lambda uses the record with the lowest sequence
> number as the checkpoint.** Lambda then retries all records starting from that checkpoint."

Complete-success signals: empty `batchItemFailures`, null list, empty `EventResponse`, null `EventResponse`.
Complete-**failure** signals — the footguns — are: **an empty-string `itemIdentifier`, a null `itemIdentifier`,
or an `itemIdentifier` with a bad key name.** (All quotes: same source, retrieved 2026-08-15.) A TypeScript
handler that builds the array by mapping over `record.dynamodb?.SequenceNumber` will emit `undefined` and
convert a partial failure into a **total** batch failure — write the test that catches this.

Types are built in: `DynamoDBStreamEvent`, `DynamoDBBatchResponse`, `DynamoDBBatchItemFailure` from
`@types/aws-lambda`. Note AWS also ships `@aws-lambda-powertools/batch` (`BatchProcessor`,
`EventType.DynamoDBStreams`, `processPartialResponse`) which implements this contract — **library-first: use
it rather than hand-rolling the checkpoint arithmetic.**

### 2.4 Recommended poison-pill posture for this design

```
reportBatchItemFailures: true      // don't re-run 99 good records for 1 bad one
bisectBatchOnError:      true      // free isolation, doesn't burn the retry quota
retryAttempts:           <small, e.g. 3-5>
maxRecordAge:            Duration.minutes(15)   // push is worthless when stale anyway
onFailure:               S3OnFailureDestination // metadata + payload (D-4)
```

`maxRecordAge` short is defensible **specifically because** of the D-2 doorbell design: a dropped record is
not a lost message — the message is still in the table for 3 days, and the next doorbell for that group
re-pushes the whole ordered set. Without the doorbell design, dropping records means losing user-visible
notifications and the calculus changes.

---

## 3. Ordering guarantees, and what `parallelizationFactor` does to them

**The guarantee** (verbatim, both from
[Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), retrieved 2026-08-15):

> "Each stream record appears exactly once in the stream."
> "For each item that is modified in a DynamoDB table, the stream records appear in the same sequence as the
> actual modifications to the item."

Note the **exactly once in the stream** is about the _stream_, not about _delivery_. Lambda's contract is
separate and is at-least-once:

> "**Warning** Lambda event source mappings process each event at least once, and duplicate processing of
> records can occur. To avoid potential issues related to duplicate events, we strongly recommend that you
> make your function code idempotent."
> ([with-ddb](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html), retrieved 2026-08-15)

**What Lambda adds with `parallelizationFactor = 1`:**

> "When you use AWS Lambda to consume a stream through an event source mapping, Lambda processes each open
> shard with a single function instance and reads that shard's records in sequence-number order. Lambda also
> follows shard lineage for you, processing a parent shard before its child shards."
> ([Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html))

**What `parallelizationFactor > 1` does:**

> "Configure the `ParallelizationFactor` setting to process one shard of a DynamoDB stream with more than one
> Lambda invocation simultaneously. You can specify the number of concurrent batches that Lambda polls from a
> shard by using a parallelization factor from 1 (default) to 10. … **When you increase the number of
> concurrent batches per shard, Lambda still ensures in-order processing at the item (partition and sort key)
> level.**"
> ([with-ddb](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html), retrieved 2026-08-15)

**Read that last sentence precisely.** The preserved unit is the **item — partition key AND sort key**. It is
_not_ the partition key. In a table where each message is its own `(PK, SK)`, raising
`parallelizationFactor` above 1 means two messages of the same group can be processed **concurrently and in
either order**, and Lambda considers that correct.

So:

- **Under the D-2 doorbell design**: `parallelizationFactor` up to 10 is **safe**, because the consumer never
  relies on record order — it re-reads the ordered set from the table. Raise it to drain `IteratorAge`.
- **If the consumer instead consumes record payloads as the ordered message sequence**: `parallelizationFactor`
  **must stay 1**, and _even then_ you only get a best-effort ordering that is an artifact of one-partition
  co-location (D-2), not a guarantee. Do not build on it.

Also relevant to any second consumer:

> "For single-Region tables that are not global tables, you can design for up to two simultaneous processes to
> read from the same DynamoDB Streams shard at the same time. Exceeding this limit can result in request
> throttling."
> ([Service Quotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html),
> retrieved 2026-08-15)

Two readers max. A stream is not a fan-out bus; if a third consumer appears, put EventBridge Pipes or a fan-out
topic behind the single Lambda rather than adding a third ESM.

One more, easy to miss:

> "If you perform a `PutItem` or `UpdateItem` operation that does not change any data in an item, DynamoDB
> Streams does _not_ write a stream record for that operation."
> ([Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html))

An exact-duplicate retry of a `PutItem` produces **no** stream record. Harmless here, load-bearing if you ever
use a rewrite as a trigger.

---

## 4. Stream retention, `IteratorAge`, and the standard alarm

**Retention — 24 hours, hard:**

> "DynamoDB Streams captures a time-ordered sequence of item-level modifications … and stores this information
> in a log for up to 24 hours."
> "All data in DynamoDB Streams is subject to a 24-hour lifetime. You can retrieve and analyze the last 24
> hours of activity for any given table. However, **data that is older than 24 hours is susceptible to trimming
> (removal) at any moment.**"
> "If you disable a stream on a table, the data in the stream continues to be readable for 24 hours. **There is
> no mechanism for manually deleting an existing stream.**"
> ([Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), retrieved 2026-08-15)

Note the asymmetry that makes the doorbell design attractive: **table TTL is 3 days, stream retention is 1
day.** The table outlives the stream by 3×, so a consumer that reconstructs from the table can recover from a

> 24 h outage; a consumer that depends on stream payloads cannot.

**`IteratorAge` — exact definition:**

> "`IteratorAge` – For DynamoDB, Kinesis, and Amazon DocumentDB event sources, **the age of the last record in
> the event in milliseconds. This metric measures the time between when a stream receives the record and when
> the event source mapping sends the event to the function.**"
> ([Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html),
> retrieved 2026-08-15)

It is a **Lambda** metric (`AWS/Lambda`, dimension `FunctionName`), in **milliseconds**, and it is a
_performance_ metric — so alarm on `Maximum`, not `Average` (an average hides the one stuck shard, which is the
exact failure mode from §2.1).

**The standard alarm.** Retention is 24 h = 86,400,000 ms; past that, data loss. Alarm well below it:

```ts
new cloudwatch.Alarm(this, 'MessageStreamIteratorAge', {
    metric: consumerFn.metric('IteratorAge', {
        statistic: 'Maximum',
        period: Duration.minutes(1),
    }),
    threshold: Duration.minutes(5).toMilliseconds(), // 300_000 ms
    evaluationPeriods: 3,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
```

A rising `IteratorAge` has exactly three causes worth distinguishing: the function is too slow / too
concurrency-starved (raise `parallelizationFactor` or memory), a poison pill is blocking a shard (§2.1 — pair
with an `Errors` alarm), or write volume exceeded consumer throughput. `treatMissingData: NOT_BREACHING`
matters because Lambda emits no `IteratorAge` when the stream is idle, which is the normal state for this
workload.

**Also opt into the ESM metrics** (they are off by default — `metricsConfig` in CDK). The `EventCount` group
gives `PolledEventCount`, `FilteredOutEventCount`, `InvokedEventCount`, `FailedInvokeEventCount`,
**`DroppedEventCount`** and **`OnFailureDestinationDeliveredEventCount`**. `DroppedEventCount` is the one that
tells you a message was thrown away:

> "`DroppedEventCount` – The number of events that Lambda dropped due to expiry or retry exhaustion.
> Specifically, this is the number of records that exceed your configured values for
> `MaximumRecordAgeInSeconds` or `MaximumRetryAttempts`. Importantly, this doesn't include the number of
> records that expire due to exceeding your event source's retention settings. Dropped events also excludes
> events that you send to an on-failure destination."
> (same source, retrieved 2026-08-15)

Read that carefully: with an on-failure destination configured, `DroppedEventCount` **excludes** the records
that made it to the destination — so alarm on `DroppedEventCount > 0` **and**
`OnFailureDestinationDeliveredEventCount > 0` and `DestinationDeliveryFailures > 0`, or you will miss losses.

---

## 5. `StreamViewType`: options and the `NEW_IMAGE` vs `KEYS_ONLY` trade

Four options ([Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html),
retrieved 2026-08-15):

| Value                | Contents                                                  |
| -------------------- | --------------------------------------------------------- |
| `KEYS_ONLY`          | "Only the key attributes of the modified item."           |
| `NEW_IMAGE`          | "The entire item, as it appears after it was modified."   |
| `OLD_IMAGE`          | "The entire item, as it appeared before it was modified." |
| `NEW_AND_OLD_IMAGES` | "Both the new and the old images of the item."            |

**Immutability warning — this is a one-way door:**

> "**Note** It is not possible to edit a `StreamViewType` once a stream has been setup. If you need to make
> changes to a stream after it has been setup, you must disable the current stream and create a new one."

and disabling + re-enabling mints a **new stream ARN**:

> "If you disable and then re-enable a stream on the table, a new stream is created with a different stream
> descriptor."

In CDK that means changing `dynamoStream` forces the ESM to be recreated and, with `startingPosition: LATEST`,
**silently skips whatever arrived during the swap**. Per CLAUDE.md's "design for the cost of change" rule,
this is an expensive-to-reverse decision — decide it once, deliberately.

**The trade for this design:**

|               | `KEYS_ONLY`                                                                                           | `NEW_IMAGE`                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Consumer gets | `{groupId, sk}` only — must `Query`/`GetItem` to read content                                         | full message inline, zero extra reads                                                                                       |
| Read cost     | +1 `Query` per doorbell (RRU, §8)                                                                     | none                                                                                                                        |
| Record size   | tiny → far more records per 6 MB invocation payload, cheaper Streams RRUs if ever read outside Lambda | bounded by the 400 KB item limit                                                                                            |
| Ordering      | irrelevant — order comes from the `Query` (D-2)                                                       | tempting to (wrongly) treat record order as message order                                                                   |
| Expired items | naturally correct — the `Query` applies the TTL filter (D-3)                                          | **stale risk**: a `REMOVE` record's `OLD_IMAGE`/a replayed `NEW_IMAGE` can carry content the consumer should no longer show |
| ESM filtering | only on `Keys` / `eventName`                                                                          | can filter on payload attributes                                                                                            |
| Coupling      | consumer depends on the table, not the record schema                                                  | record schema becomes a second wire contract to version                                                                     |

**Recommendation: `KEYS_ONLY`, coupled to the D-2 doorbell design.** It is the only choice that makes ordering
correct-by-construction rather than correct-by-luck, it makes the TTL filter (D-3) apply on the push path
automatically, and it avoids minting a second, undocumented wire contract in the stream record — which would
sit awkwardly against ADR-0014's "the service owns its wire types" rule (`docs/CODING_STANDARDS.md` §15,
GR-015), since a stream record is not a schema-package-owned shape.

**Choose `NEW_IMAGE` instead only if** you abandon the doorbell design and accept a per-record push, in which
case you must (a) pin `parallelizationFactor: 1`, (b) accept that ordering is unguaranteed anyway (D-2), and
(c) re-check the TTL staleness case. Cost is not the discriminator: at these volumes the extra `Query` RRUs are
cents (§8).

---

## 6. TTL semantics

**Mechanics.** The attribute must be **Number, Unix epoch seconds**:

> "The timestamp must be stored as a Number data type in Unix epoch time format at the **seconds** granularity.
> **Items with a TTL attribute that is not a Number type are ignored by the TTL process.**"
> ([TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html), retrieved 2026-08-15)

⚠️ This cuts directly against a repo convention. CLAUDE.md mandates _"Dates: ISO 8601 strings in interfaces,
never `Date` objects."_ The TTL attribute **cannot** be an ISO string — it would be silently ignored and
**nothing would ever expire**, with no error, until the table grew without bound. Keep the ISO string as the
sort key / a display attribute, and carry a **separate** numeric `expiresAt` attribute for TTL. Write the test
that asserts the type. (Note this also means the same instant appears twice in the item, in two
representations — that is a deliberate, documented exception to DRY, since the two exist for different reasons.)

**Deletion lag — days, not minutes:**

> "DynamoDB automatically deletes expired items **within a few days** of their expiration time, without
> consuming write throughput."
> "Items with valid, expired TTL attributes may be deleted by the system at any time, **typically within a few
> days** after their expiration." (same source)

AWS gives **no SLA and no upper bound** here. "Within a few days" is the entire commitment. Treat TTL as
**storage reclamation, not as a retention guarantee** — if "3 days" is a product or privacy requirement, TTL
alone does not satisfy it and the filter in the next paragraph is what makes it true for readers.

**Expired items still read — the correctness issue, confirmed:** see D-3 above. The fix, per AWS's own
JavaScript v3 example on
[ttl-expired-items](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html)
(retrieved 2026-08-15):

```ts
const now = Math.floor(Date.now() / 1000);
await doc.send(
    new QueryCommand({
        TableName: table,
        KeyConditionExpression: '#pk = :pk',
        FilterExpression: '#ea > :now', // exclude expired-but-not-yet-deleted
        ExpressionAttributeNames: { '#pk': 'groupId', '#ea': 'expiresAt' },
        ExpressionAttributeValues: { ':pk': groupId, ':now': now },
    }),
);
```

**Cost consequence of the filter, which is the trap.** `FilterExpression` is applied **after** the read:
_"when you use a `FilterExpression`, `Query` applies the 1 MB/`Limit` page cap to the items it reads before
applying the filter, so a page can return zero matching items and still include a `LastEvaluatedKey`"_
([Query pagination](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html),
retrieved 2026-08-15). You pay RRUs for the expired items you filter out, and AWS confirms _"These items still
count towards storage and read costs until they are deleted."_ So a group with a long tail of not-yet-reaped
items costs reads forever. **The consumer must therefore paginate on `LastEvaluatedKey`, not on a non-empty
page** — a `while (LastEvaluatedKey)` loop, never `if (Items.length)`.

**TTL deletions in the stream — yes, and identifiable:**

> "Once deleted, items go into DynamoDB Streams as **service deletions instead of user deletes**, and are
> removed from local secondary indexes and global secondary indexes just like other delete operations."
> ([TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html))

Identification is via `userIdentity`:

```jsonc
"userIdentity": { "type": "Service", "principalId": "dynamodb.amazonaws.com" }
```

> "TTL deletions can be identified in DynamoDB Streams, **but only in the Region where the deletion occurred.**"
> ([ttl-expired-items](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html),
> retrieved 2026-08-15)

So the consumer **will** be invoked ~3 days after every message, with `eventName: 'REMOVE'`. Handle it
explicitly — either filter to `INSERT` at the ESM (§1.3, free, preferred) or branch on
`record.userIdentity?.principalId === 'dynamodb.amazonaws.com'`. A consumer that treats every stream record as
"something to push" will re-notify users on expiry, three days late. Cost note: TTL deletes consume **no** write
throughput in a single-Region table.

---

## 7. Item and query limits

| Limit                             | Value                                                                                                                                         | Source (all retrieved 2026-08-15)                                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Max item size                     | **400 KB**                                                                                                                                    | "constrained by the maximum DynamoDB item size limit of 400 KB" — [naming rules & data types](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html)                                                                     |
| Max partition key value           | 2048 bytes                                                                                                                                    | same                                                                                                                                                                                                                                                                     |
| Max sort key value                | 1024 bytes                                                                                                                                    | same                                                                                                                                                                                                                                                                     |
| Max nesting depth                 | 32 levels                                                                                                                                     | same                                                                                                                                                                                                                                                                     |
| Max `Query` result page           | **1 MB**                                                                                                                                      | "the `Query` results are divided into 'pages' of data that are 1 MB in size (or less)" — [Query pagination](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)                                                                      |
| Per-partition throughput          | **3,000 read units/s and 1,000 write units/s**                                                                                                | "Every partition in a DynamoDB table is designed to deliver a maximum capacity of 3,000 read units per second and 1,000 write units per second." — [partition key design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) |
| Per-table on-demand ceiling       | 40,000 RRU/s and 40,000 WRU/s (adjustable)                                                                                                    | [Service Quotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html)                                                                                                                                                                    |
| Table size                        | unbounded — "There is no practical limit on a table's size. Tables are unconstrained in terms of the number of items or the number of bytes." | same                                                                                                                                                                                                                                                                     |
| Items per partition key           | unbounded — "there is no upper limit on the number of distinct sort key values per partition key value"                                       | [Partitions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html)                                                                                                                                                                |
| Simultaneous stream shard readers | 2                                                                                                                                             | [Service Quotas](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html)                                                                                                                                                                    |

### The LSI question — and it is the most consequential item in this section

**Without an LSI: no per-partition-key size limit.**

> "The maximum size of any item collection for a table which has one or more local secondary indexes is 10 GB.
> **This does not apply to item collections in tables without local secondary indexes**, and also does not
> apply to item collections in global secondary indexes. **Only tables that have one or more local secondary
> indexes are affected.**"
> ([LSI](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html), retrieved 2026-08-15)

**Adding an LSI imposes one, and it is a hard write-stop:**

> "For tables with local secondary indexes, there is a **10 GB size limit per partition key value**."
> "If an item collection exceeds the 10 GB limit, DynamoDB may return an
> `ItemCollectionSizeLimitExceededException`, and **you may not be able to add more items to the item
> collection**…"
> "**In a table with one or more local secondary indexes, each item collection is stored in one partition.**
> The total size of such an item collection is limited to the capability of that partition: 10 GB." (same)

So the answer to "does an LSI change it?" is: **an LSI is the only thing that creates the limit** — and it
simultaneously **pins the whole item collection to a single partition**, which caps a single `groupId` at
1,000 WCU/s forever and removes the split-to-scale behaviour quoted in D-2. Both effects are bad here.

> ⛔ **Do not add a Local Secondary Index to this table.** It would (a) create a 10 GB per-group hard write
> stop with no natural recovery for a hot group, (b) permanently cap one group at 1,000 write units/s, and
> (c) be **irreversible** — LSIs can only be created at `CreateTable` and are deleted only with the table.
> If a second access pattern appears, use a **GSI**, which has neither constraint.

**Sizing this workload against the limits.** 3-day TTL and ~1 KB messages: to reach 10 GB in one group you
would need ~10 million messages for one `groupId` in 3 days (~38/s sustained). Nowhere near. The **1 MB
`Query` page** binds much sooner: at ~1 KB/message a single page holds only ~1,000 messages, so a group with
more than ~1,000 live messages **requires pagination** — the brief's "read ALL messages for a group in one
query" is satisfied by one _logical_ query, not necessarily one _round trip_. Build the pagination loop from
day one (see §6 — the TTL filter makes empty-but-continuing pages routine, so the naive loop is wrong from day
one too).

---

## 8. Cost model (us-east-1, on-demand)

All prices from [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/) and
[DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), **retrieved 2026-08-15**:

| Line item                      | Price                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Write request unit (WRU)       | **$0.6250 per million writes** (1 WRU = 1 write ≤ 1 KB)                                                 |
| Read request unit (RRU)        | **$0.125 per million reads** (1 RRU = 1 strongly-consistent read ≤ 4 KB; eventually-consistent = ½ RRU) |
| DynamoDB Streams read request  | **$0.02 per 100,000** read requests                                                                     |
| Storage (Standard table class) | **$0.25 per GB**-month                                                                                  |
| Free tier (always-free)        | "25 WCUs, 25 RCUs" + "25 GB of data storage" + "2.5 million stream read requests from DynamoDB Streams" |
| New-account credits            | "up to $200 USD in credits with the AWS Free Tier … for up to 6 months"                                 |

**GetRecords via a Lambda trigger is free — with a new 2026 caveat.** Verbatim:

> "You are not charged for GetRecords API calls invoked through DynamoDB triggers on AWS Lambda, **unless the
> functions are running on Lambda Managed Instances**"

That trailing clause is new (Lambda Managed Instances is a 2026 feature). This repo's esbuild-bundled Lambdas
run on standard on-demand Lambda, so **Streams reads cost $0** — but if anyone later moves the consumer to
Managed Instances, a previously-$0 line item becomes billable. Worth a comment in the stack.

⚠️ **Free-tier caveat — do not budget on it.** The pricing page qualifies the 25 WCU/25 RCU allowance as
applying to _provisioned capacity and the DynamoDB Standard table class_. An **on-demand** table (what this
design uses) does **not** draw down a 25 WCU/25 RCU allowance — those are provisioned-capacity units. The
**25 GB storage** and **2.5 M stream reads** allowances are not capacity-mode-specific. The arithmetic below
therefore takes **no** WRU/RRU free tier and shows storage both ways.

### Assumptions, stated so they can be challenged

- Message item ≈ **1 KB** including the ~100 B/item DynamoDB overhead ⇒ **1 WRU per message**.
- TTL 3 days ⇒ steady-state resident items ≈ monthly volume × 3/30 = **10%** of a month.
- Consumer re-`Query`s a group per doorbell (D-2), **eventually consistent** (½ RRU per 4 KB).
- Read amplification ≈ **1×** the write volume in bytes (each message read back roughly once).

### 1,000,000 items/month

| Component                              | Arithmetic                                                                       | Cost/mo                                        |
| -------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| Writes                                 | 1,000,000 WRU × $0.625 / 1e6                                                     | **$0.63**                                      |
| Reads (`Query`, eventually consistent) | 1e6 × 1 KB = 1,024 MB ⇒ ⌈/4 KB⌉ ≈ 262,144 units × 0.5 = 131,072 RRU × $0.125/1e6 | **$0.02**                                      |
| Streams `GetRecords` (Lambda trigger)  | not billed                                                                       | **$0.00**                                      |
| Storage                                | 1e6 × 0.10 = 100k items × 1 KB ≈ **0.10 GB** × $0.25                             | **$0.03** (→ $0.00 under the 25 GB free tier)  |
| TTL deletions                          | no write throughput consumed                                                     | **$0.00**                                      |
| **DynamoDB total**                     |                                                                                  | **≈ $0.68/mo** (**≈ $0.65** with free storage) |

### 100,000,000 items/month

| Component                              | Arithmetic                                            | Cost/mo                                          |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| Writes                                 | 100,000,000 WRU × $0.625 / 1e6                        | **$62.50**                                       |
| Reads (`Query`, eventually consistent) | 100 × the above                                       | **$1.64**                                        |
| Streams `GetRecords` (Lambda trigger)  | not billed                                            | **$0.00**                                        |
| Storage                                | 100e6 × 0.10 = 10M items × 1 KB ≈ **9.54 GB** × $0.25 | **$2.38** (→ $0.00 under the 25 GB free tier)    |
| TTL deletions                          | no write throughput consumed                          | **$0.00**                                        |
| **DynamoDB total**                     |                                                       | **≈ $66.52/mo** (**≈ $64.14** with free storage) |

### The three things that actually move this number

1. **Item size, superlinearly at the KB boundary.** WRU is metered per **1 KB, rounded up**. A 1.1 KB message
   costs **2 WRU — double**. At 100 M/month that is **+$62.50/mo for 100 bytes.** Keep attribute names short
   (AWS: _"It is considered best practice to keep your attribute names as short as possible. This helps reduce
   read request units consumed, as attribute names are included in metering of storage and throughput usage"_ —
   [naming rules](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html),
   retrieved 2026-08-15). Measure the real serialized size before committing to a schema.
2. **Read amplification from the TTL filter.** Expired-but-unreaped items are read and paid for (§6). A
   pathological group can multiply the read line item several-fold. Small in absolute terms here.
3. **Lambda, which is a separate bill.** 100 M records at `batchSize: 100` ≈ 1 M invocations ≈ $0.20 in
   requests plus GB-seconds. Not a DynamoDB cost, but it belongs in the comparison against the alternatives in
   [`28-research-messaging-aws.md`](28-research-messaging-aws.md).

**Idle cost is $0.00**, which is the property doc 28 identified as decisive for the per-PR sandbox topology
(ADR-0005 `Environment=pr-{N}` teardown): an unused per-PR table costs nothing, unlike an ALB or an RDS
instance. On-demand is unambiguously the right billing mode here — do not provision capacity.

---

## 9. VPC access

**The gateway endpoint is free.** Verbatim:

> "Gateway VPC endpoints provide reliable connectivity to Amazon S3 and DynamoDB **without requiring an
> internet gateway or a NAT device for your VPC.** Gateway endpoints do not use AWS PrivateLink, unlike other
> types of VPC endpoints."
> "**Pricing** — **There is no additional charge for using gateway endpoints.**"

([Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html), retrieved
2026-08-15.) Routing is via an AWS-managed prefix list added to the selected route tables, and the endpoint
route wins by longest-prefix match over a `0.0.0.0/0` IGW route. DynamoDB also supports **interface**
(PrivateLink) endpoints, which **are** billed per-hour + per-GB — do not use one here.

**Is it required? — It depends on where the caller sits, and in this repo the answer differs per producer.**

| Caller                                                                           | Placement (per ADR-0004 / CLAUDE.md)                      | Reaches DynamoDB via | Needs the endpoint?                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Fargate services (identity, food, recipe)                                        | **public subnets, `assignPublicIp`**                      | Internet Gateway     | **No.** No NAT is involved today, so there are no NAT charges to avoid.                                                                 |
| Non-VPC Lambdas                                                                  | outside any VPC                                           | public endpoint      | **No.**                                                                                                                                 |
| VPC-attached Lambdas (`webhook`, `deletion-worker`, `reconciliation`, `migrate`) | private subnets, egress via the **t4g.nano NAT instance** | NAT instance → IGW   | **Yes — add it.** It is free, it removes DynamoDB bytes from the single shared NAT instance, and it removes a SPOF from the write path. |
| The new Streams **consumer** Lambda                                              | TBD                                                       | see below            | **Only if it is VPC-attached at all.**                                                                                                  |

**Two non-obvious points specific to this repo.**

1. **`assignPublicIp` does not give a VPC Lambda egress** (CLAUDE.md/ADR-0004 states this explicitly — it is
   Fargate-only). So any VPC-attached producer Lambda is on the NAT path today, and a DynamoDB gateway
   endpoint is the correct, free fix. This is materially better than "it saves a little money": the repo runs
   **one `t4g.nano` NAT instance** as a deliberate cost decision, and routing a fire-and-forget write path
   through a single micro instance is a reliability decision nobody made on purpose.
2. **Ask first whether the consumer Lambda needs a VPC at all.** The ESM poller that calls `GetRecords` is
   **managed by the Lambda service and does not run in your VPC** — attaching the function to a VPC does not
   put stream polling inside it. So the consumer needs VPC attachment only if _its own code_ must reach a
   private resource (RDS, or a Valkey/ElastiCache cluster per ADR-0016). If the push path is
   API-Gateway-WebSocket or a public endpoint, **keep the consumer out of the VPC entirely** — no ENI cold
   starts, no NAT, no endpoint, no subnet capacity coupling.

**CDK.** The repo's VPC lives in `NetworkStack`; add the endpoint on the `Vpc` construct:

```ts
vpc.addGatewayEndpoint('DynamoDbEndpoint', {
    service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
});
```

or at construction via `gatewayEndpoints: { S3: {...}, DynamoDB: {...} }`. Selecting subnets is what associates
the route tables; omitting `subnets` associates all of them.

**⚠️ Documented ambiguity — the Streams endpoint.** AWS maintains _separate_ endpoints:
_"AWS maintains separate endpoints for DynamoDB and DynamoDB Streams… To read and process DynamoDB Streams
records, your application must access a DynamoDB Streams endpoint"_ — `streams.dynamodb.<region>.amazonaws.com`
([Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html), retrieved
2026-08-15). Whether the `com.amazonaws.<region>.dynamodb` **gateway** endpoint's prefix list also covers the
Streams endpoint is **not stated** in the gateway-endpoint documentation I retrieved. **I am not going to guess.**
It is very likely moot here — the ESM poller is Lambda-managed and outside your VPC — but **if** you ever write
code inside a VPC that calls `GetRecords`/`DescribeStream` directly, verify empirically (a `DescribeStream`
call from a private-subnet host with the NAT route removed) before relying on the gateway endpoint.

---

## 10. IAM

### 10.1 Producer — `PutItem` to one table only

```jsonc
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PutMessagesOnly",
            "Effect": "Allow",
            "Action": "dynamodb:PutItem",
            "Resource": "arn:aws:dynamodb:us-east-1:<acct>:table/kitchensink-messages-<stage>",
        },
    ],
}
```

That is the whole minimum. Deliberately **absent**, and each for a reason:

- **No `dynamodb:BatchWriteItem`** — it is a separate action and it can _delete_.
- **No `/index/*` resource** — `PutItem` targets the table; index ARNs are only needed for reads.
- **No `dynamodb:DescribeTable`** — the SDK does not call it for `PutItem`.
- **No `dynamodb:UpdateItem` / `DeleteItem`** — a producer that can only append cannot corrupt history, which
  is the property requirement (2) depends on.

⚠️ **`table.grantWriteData()` is wrong for a producer here.** CDK's `WRITE_DATA_ACTIONS` (verified in
`node_modules/aws-cdk-lib/aws-dynamodb/lib/perms.js`, 2.254.0) is
`["dynamodb:BatchWriteItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]` — it grants
**delete**. Use the narrow form:

```ts
table.grant(producerRole, 'dynamodb:PutItem');
```

If the table gets a customer-managed KMS key, add `kms:Encrypt`, `kms:ReEncrypt*`, `kms:GenerateDataKey*`
separately — CDK's `grant()` does not add key grants (`table.d.ts`: _"If `encryptionKey` is present,
appropriate grants to the key needs to be added separately"_).

**Hardening worth considering** given fire-and-forget producers: a `dynamodb:LeadingKeys` condition
(`"Condition": {"ForAllValues:StringEquals": {"dynamodb:LeadingKeys": ["${aws:PrincipalTag/groupId}"]}}`)
restricts a principal to its own partition keys. Only meaningful if producers are per-tenant; the current
services are not, so it is noted, not recommended.

### 10.2 Streams consumer

The AWS managed policy is:

```jsonc
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:DescribeStream",
                "dynamodb:GetRecords",
                "dynamodb:GetShardIterator",
                "dynamodb:ListStreams",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
            ],
            "Resource": "*",
        },
    ],
}
```

([AWSLambdaDynamoDBExecutionRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaDynamoDBExecutionRole.html),
retrieved 2026-08-15; policy version v1, unchanged since 2015-04-09.)

⚠️ **`"Resource": "*"` — every stream in the account.** Do not attach it. The least-privilege form scopes to
the one stream ARN; note `ListStreams` **cannot** be scoped (it has no resource), so it needs its own
statement:

```jsonc
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
            "Resource": "arn:aws:dynamodb:us-east-1:<acct>:table/kitchensink-messages-<stage>/stream/*",
        },
        { "Effect": "Allow", "Action": "dynamodb:ListStreams", "Resource": "*" },
    ],
}
```

**In CDK you get most of this for free and should not hand-write it.** `DynamoEventSource.bind()` calls
`this.table.grantStreamRead(target)` (verified in `dynamodb.js`, 2.254.0), which grants
`READ_STREAM_DATA_ACTIONS` = `["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"]`
scoped to the stream ARN, plus `dynamodb:ListStreams` on `*` (`perms.js`, 2.254.0). Under the D-2 doorbell
design the consumer additionally needs read on the **table**:

```ts
fn.addEventSource(
    new DynamoEventSource(table, {
        /* … */
    }),
); // grants stream read automatically
table.grant(fn, 'dynamodb:Query'); // narrower than grantReadData()
```

`grantReadData()` would add `BatchGetItem`, `GetItem`, `Scan`, `ConditionCheckItem` — `Scan` in particular has
no business on this path. Plus destination permissions per §2 (`s3:PutObject` + `s3:ListBucket`, or
`sqs:SendMessage` / `sns:Publish`), which
[services-dynamodb-errors](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html)
enumerates, along with a warning to constrain S3 destinations with an `s3:ResourceAccount` condition to prevent
records landing in a bucket recreated in someone else's account.

---

## 11. Local testing

### 11.1 ⚠️ LocalStack Community no longer exists — this invalidates a standing repo assumption

The project memory records the e2e harness as _"LocalStack (Community, no token)"_. **That is stale.**
LocalStack discontinued the Community edition **beginning on March 23, 2026**; users _"will need to create a
user account"_ and pipelines _"will need to be updated to account for the required auth token"_
([Important Updates to Pricing & Packaging for LocalStack for AWS](https://blog.localstack.cloud/2026-upcoming-pricing-changes/),
retrieved 2026-08-15). A permanent free, non-commercial tier remains (marketed as **Hobby**), but it is
**account-gated and requires `LOCALSTACK_AUTH_TOKEN`**; the `LOCALSTACK_ACKNOWLEDGE_ACCOUNT_REQUIREMENT=1`
grace-period workaround expired in April 2026 (corroborated across secondary reports; the primary blog post
confirms the account requirement but not that specific env-var date, so treat the date as unverified).

**Consequence for this work, and it is a CI problem before it is a DynamoDB problem:** any new
DynamoDB/Streams e2e tier that assumes a tokenless LocalStack will fail in CI, and the _existing_ LocalStack
e2e harness is on the same clock. **Verify the current harness actually starts before building on it** — this
is a pre-existing risk this research surfaced, not one the DynamoDB work introduces.

### 11.2 Does LocalStack support DynamoDB and DynamoDB Streams?

**Yes, both — and both are in the free tier.** LocalStack's own docs state _"DynamoDB emulation is powered by
[DynamoDB Local]"_ and list DynamoDB and DynamoDB Streams among the services included in the Hobby/Base/Ultimate
plans ([LocalStack DynamoDB](https://docs.localstack.cloud/aws/services/dynamodb/) and
[LocalStack DynamoDB Streams](https://docs.localstack.cloud/aws/services/dynamodbstreams/), retrieved
2026-08-15). Its Streams guide demonstrates `CreateEventSourceMapping` → Lambda invocation end-to-end, so the
**full trigger path is testable locally** — which matters, because the ESM is where most of the risk in §1–§2
lives.

**Caveats found in the docs:**

- _"DynamoDB Streams are exclusively supported for original tables and not for replicated ones"_ (i.e. not for
  global-table replicas — irrelevant here, single region).
- TTL is not wall-clock in emulation; LocalStack exposes a manual reaper endpoint,
  `curl -X DELETE localhost:4566/_aws/dynamodb/expired`, which is exactly what you want for a **deterministic**
  TTL test rather than a sleep. (Playwright/vitest rule in this repo bans `waitForTimeout`; this endpoint is the
  principled equivalent.)
- The tier statement in LocalStack's own docs is presented as a plan-inclusion badge rather than prose; I read
  it as "included in the free Hobby plan" and flag that as **read from a badge, not a sentence**.

### 11.3 DynamoDB Local as the alternative

`DynamoDBLocal` is AWS's official offline emulator — available as a download (JRE), a Maven dependency, or a
**Docker image**, default port **8000**
([Setting up DynamoDB local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html),
retrieved 2026-08-15). It supports Streams (the usage notes discuss stream shard behaviour, below). **It is
free, unauthenticated, and has no account requirement** — which, given §11.1, makes it the lower-risk choice
for _unit/integration_ tests of the DAO layer.

**Documented differences that matter here** (all from
[DynamoDB local usage notes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html),
retrieved 2026-08-15):

- _"If you're using DynamoDB Streams, the rate at which shards are created might differ. In the DynamoDB web
  service, shard-creation behavior is partially influenced by table partition activity. **When you run DynamoDB
  locally, there is no table partitioning.**"_ ⇒ **the D-2 multi-shard ordering hazard is unreproducible
  locally.** A green local test proves nothing about cross-shard ordering. This is precisely why the doorbell
  design (which is order-independent) is safer than one that "passed the integration test".
- _"Read operations are eventually consistent. However, due to the speed of DynamoDB local running on your
  computer, most reads appear to be strongly consistent."_ ⇒ read-after-write races hide locally.
- _"Provisioned throughput settings are ignored"_ ⇒ no throttling behaviour to test against.
- _"Item collection metrics and item collection sizes are not tracked"_ ⇒ the LSI-size guard (§7) is untestable.
- _"table names are case insensitive"_ (vs case-sensitive in the real service) ⇒ a naming bug can pass locally.
- _"The AWS SDKs for DynamoDB require that your application configuration specify an access key value and an AWS
  Region value… These values don't have to be valid AWS values to run locally."_
- No PITR; no tagging; `billingModeSummary` always null.

**Pointing the SDK at either** — identical mechanism, only the port differs:

```ts
const client = new DynamoDBClient({
    region: 'us-east-1',
    ...(process.env['DYNAMODB_ENDPOINT']
        ? {
              endpoint: process.env['DYNAMODB_ENDPOINT'], // http://localhost:8000  (DynamoDB Local)
              credentials: { accessKeyId: 'local', secretAccessKey: 'local' }, // http://localhost:4566 (LocalStack)
          }
        : {}),
});
```

(Bracket notation per CLAUDE.md.) Note the access key **"can contain only letters (A–Z, a–z) and numbers
(0–9)"** for DynamoDB Local, and without `-sharedDb` the DB filename is derived from the access key + region —
so **two tests using different fake keys silently get different databases.** Use `-sharedDb` or `-inMemory`.

**Recommended split**, consistent with §7.1 of the coding standards:

| Tier        | Harness                                             | Covers                                                                                         |
| ----------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| unit        | in-memory fakes / `aws-sdk-client-mock`             | key construction (D-1 collision!), TTL computation, filter expression, idempotency             |
| integration | **DynamoDB Local** (`-inMemory`, Docker, port 8000) | real `PutItem`/`Query` semantics, pagination on `LastEvaluatedKey`, the TTL `FilterExpression` |
| e2e         | LocalStack (auth-token gated — see §11.1)           | table → stream → ESM → Lambda, partial batch response, poison-pill isolation                   |

The one thing **neither** can prove is cross-shard ordering (D-2) — which is the strongest possible argument
for choosing a design that does not depend on it.

---

## 12. SDK v3: `client-dynamodb` vs `lib-dynamodb`

**Use `@aws-sdk/lib-dynamodb` (the `DynamoDBDocumentClient`) for simple put/query. Not a close call.**

`@aws-sdk/client-dynamodb` speaks the wire protocol directly, so every value carries a **type descriptor**
(`S`, `N`, `B`, `BOOL`, `NULL`, `M`, `L`, `SS`, `NS`, `BS` —
[data types](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html),
retrieved 2026-08-15):

```ts
Item: { groupId: { S: 'g1' }, sk: { S: '2026-08-15T…' }, expiresAt: { N: '1755302400' } }
```

`@aws-sdk/lib-dynamodb` wraps a `DynamoDBClient` and _"simplifies DynamoDB interaction by handling marshalling
and unmarshalling of data. It allows developers to work with native JavaScript types instead of DynamoDB's
`AttributeValue` format"_
([lib-dynamodb README](https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-dynamodb/README.md), retrieved
2026-08-15):

```ts
Item: { groupId: 'g1', sk: '2026-08-15T…', expiresAt: 1755302400 }
```

**Why this is a correctness argument, not an ergonomics one.** Under D-1 and §6, this table's key and TTL
correctness hinge on the _type_ of two attributes: the SK must be `S` and the TTL attribute must be `N` (AWS:
_"Items with a TTL attribute that is not a Number type are ignored by the TTL process"_). With the raw client
those types are stringly-typed literals a reviewer must eyeball; `'1755302400'` vs `1755302400` in an `N`
field, or an accidental `{ S: '1755302400' }`, both compile and both silently disable expiry. With
`lib-dynamodb` the marshaller derives the descriptor from the JS type, so `typeof expiresAt === 'number'`
becomes the invariant — checkable by TypeScript. This is CLAUDE.md's "make illegal states unrepresentable"
applied at the SDK boundary, and it is the reason to prefer the DocumentClient here.

### Marshalling options — set them explicitly

Per the README (retrieved 2026-08-15), all four default to **false**/unset:

```ts
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: {
        removeUndefinedValues: true, // default false
        convertClassInstanceToMap: false, // default false
        convertEmptyValues: false, // default false
    },
    unmarshallOptions: {
        wrapNumbers: false, // default false
    },
});
```

- **`removeUndefinedValues: true` is effectively mandatory.** Default `false` means a single `undefined`
  property — trivially produced by an optional field on a message type — throws at send time. In a
  fire-and-forget producer that error is _swallowed_, so the message vanishes. Turn it on, and be aware it
  makes `undefined` and "absent" indistinguishable (fine here; the wire contract already treats optional as
  absent).
- **`convertEmptyValues: false` is correct now.** DynamoDB has accepted empty strings for non-key attributes
  since 2020 (_"Empty String and Binary attribute values are allowed"_ —
  [PutItem](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html), retrieved
  2026-08-15). Any pre-2020 blog telling you to set it `true` is **stale**; leaving it `false` preserves
  round-trip fidelity. ⚠️ But empty **is** still rejected for a **key** attribute — _"Attribute values of type
  String and Binary must have a length greater than zero if the attribute is used as a key attribute"_ — so an
  empty `groupId` is a `ValidationException`. Validate before the put.
- **`wrapNumbers: false` (default) loses precision above `Number.MAX_SAFE_INTEGER`.** DynamoDB numbers carry 38
  digits of precision. A seconds-epoch TTL is nowhere near the boundary, so `false` is right — but do not put a
  large ID in an `N` attribute without setting `wrapNumbers: true`.

### Practical notes

- Commands come from `lib-dynamodb` (`PutCommand`, `QueryCommand`), not from `client-dynamodb`. Mixing them is
  the classic bug: a `client-dynamodb` `QueryCommand` sent through the document client is **not** unmarshalled
  and you get raw `AttributeValue`s back. Import discipline matters; an ESLint `no-restricted-imports` rule on
  `@aws-sdk/client-dynamodb`'s command exports inside the DAO would enforce it.
- Keep `client-dynamodb` for the **control plane** (`CreateTable`, `DescribeTable`) and for `@aws-sdk/util-dynamodb`'s
  `marshall`/`unmarshall` if you ever need them directly — notably to **unmarshall stream record images**, which
  arrive in `AttributeValue` form and are _not_ processed by the document client.
- Under `KEYS_ONLY` (§5) the consumer barely touches marshalling at all — another small point in its favour.
- Bundle size: `lib-dynamodb` is a thin middleware layer over the same client; for esbuild-bundled Lambdas the
  cost is negligible, and both should be `external`-ed only if the runtime provides them (Node 24 Lambda images
  do **not** bundle the v3 SDK for all clients — verify before marking external).

---

## 13. Reference CDK shape (aws-cdk-lib 2.254.0, verified against the installed typings)

Prop names, defaults and enum members below were read from `node_modules/aws-cdk-lib/aws-dynamodb/lib/table-v2.d.ts`,
`billing.d.ts`, `shared.d.ts` and `aws-lambda-event-sources/lib/stream.d.ts` on 2026-08-15. `TableV2` is the
current L2 (`TablePropsV2` exposes `partitionKey`, `sortKey`, `timeToLiveAttribute`, `dynamoStream`, `billing`,
`removalPolicy`, `pointInTimeRecoverySpecification`).

```ts
const table = new dynamodb.TableV2(this, 'Messages', {
    tableName: `kitchensink-messages-${stage}`,
    partitionKey: { name: 'groupId', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING }, // `${iso8601Ms}#${ulid}` — see D-1
    billing: dynamodb.Billing.onDemand(),
    timeToLiveAttribute: 'expiresAt', // MUST be Number/epoch-seconds — see §6
    dynamoStream: dynamodb.StreamViewType.KEYS_ONLY, // one-way door — see §5
    removalPolicy: isEphemeral ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !isEphemeral },
});

consumerFn.addEventSource(
    new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON, // required; see the LATEST warning below
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(1),
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        retryAttempts: 5,
        maxRecordAge: Duration.minutes(15),
        onFailure: new eventsources.S3OnFailureDestination(dlqBucket), // payload, not just metadata — D-4
        filters: [lambda.FilterCriteria.filter({ eventName: lambda.FilterRule.isEqual('INSERT') })],
    }),
);

table.grant(producerRole, 'dynamodb:PutItem'); // NOT grantWriteData() — §10.1
table.grant(consumerFn, 'dynamodb:Query'); // stream read is granted by DynamoEventSource
```

**Prefer `TRIM_HORIZON` over `LATEST`** — AWS's own guidance, and it interacts badly with CDK redeploys:

> "Be aware that stream polling during event source mapping creation and updates is eventually consistent. …
> This behavior means that if you specify `LATEST` as the starting position for the stream, **the event source
> mapping could miss events during creation or updates. To ensure that no events are missed, specify the stream
> starting position as `TRIM_HORIZON`.**"
> ([with-ddb](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html), retrieved 2026-08-15)

Every `cdk deploy` that touches the ESM is an "update". With `LATEST`, notifications are silently dropped during
each deploy — a per-PR sandbox that redeploys constantly would lose messages behind green checks. `TRIM_HORIZON`
trades that for possible re-delivery of up to 24 h of records on first creation, which an idempotent consumer
absorbs by contract.

**`removalPolicy` and ADR-0005.** A `pr-{N}` table must be `DESTROY` and tagged `Environment=pr-{N}` so
`.github/scripts/teardown-sandbox-pr.sh` reclaims it; a persistent table must be `RETAIN` + `Environment=global`
and must **never** be named `pr-{N}` (the teardown matcher is by tag OR name, with no denylist).

---

## 14. Recency check — what changed, and what pre-2024 material will get wrong

Per the brief's instruction to flag staleness. Anything you read from before 2024 is likely wrong about:

1. **Ordering.** The "ordering is per partition key" framing is widespread in older blogs and is **contradicted
   by current AWS wording** (D-2). The precise per-_item_ statement is the one to cite.
2. **`BatchSize` max for DynamoDB** — raised from 1,000 to **10,000**. CDK's own docstring is still stale (§1.1).
3. **S3 as an on-failure destination** for stream ESMs is recent; older material says SQS/SNS only, and
   therefore says "the DLQ only gives you metadata" as if it were unavoidable (§2, D-4).
4. **Empty string attribute values** have been legal since 2020; advice to set `convertEmptyValues: true` is
   stale (§12).
5. **Streams `GetRecords` billing** now carries the _"unless the functions are running on Lambda Managed
   Instances"_ exception — new in 2026 (§8).
6. **ESM metrics** (`metricsConfig`, `DroppedEventCount`, `OnFailureDestinationDeliveredEventCount`) are recent;
   older runbooks alarm only on `IteratorAge` and `Errors` and therefore cannot see a dropped record (§4).
7. **LocalStack Community was discontinued 2026-03-23** — every "just run LocalStack, it's free and tokenless"
   instruction, including this repo's own memory, predates that (§11.1).
8. **AWS Free Tier** now pairs the always-free DynamoDB allowances with **$200 in credits for up to 6 months**
   for new accounts; older "12 months free" framing does not apply (§8).

**Deprecation/sunset check performed:** DynamoDB, DynamoDB Streams, the `DynamoEventSource` CDK construct,
`@aws-sdk/lib-dynamodb` and the DynamoDB gateway VPC endpoint show **no deprecation or sunset notices** on their
current documentation pages as retrieved 2026-08-15. The only deprecation-adjacent items found are internal to
CDK: `TableV2.pointInTimeRecovery` in favour of `pointInTimeRecoverySpecification`, and
`ITable.grantStream`/`grantStreamRead` which the typings mark _"The use of this method is discouraged. Please use
`streamGrants.stream()` instead"_ — note `DynamoEventSource.bind()` still calls `grantStreamRead()` internally in
2.254.0, so you will see it in synthesized output regardless.

---

## 15. Open questions I could not resolve from primary sources (stated, not guessed)

1. **Does the DynamoDB gateway VPC endpoint cover the `streams.dynamodb.<region>.amazonaws.com` endpoint?**
   AWS documents the two service endpoints as separate but does not state the prefix list's coverage. Verify
   empirically if any in-VPC code will call the Streams API directly (§9). Likely moot — the ESM poller is
   Lambda-managed and outside your VPC.
2. **`MaximumRetryAttempts` valid range.** AWS's parameter table gives `Default: -1` and `Minimum: 0` in the
   same row (§1.2). Set an explicit value and the ambiguity cannot bite you.
3. **How quickly DynamoDB splits a hot item collection across partitions.** The split _behaviour_ is documented
   (§7/D-2); the _latency_ is not. A group that suddenly exceeds 1,000 write units/s may throttle before the
   split completes. Not a concern at the volumes in §8, but it is the failure mode if one `groupId` ever goes
   viral — and the sort key already has enough entropy (D-1) that write-sharding the PK would be a
   straightforward later change if needed.
4. **LocalStack's exact free-tier service list.** Read from a plan-inclusion badge on the service pages rather
   than a prose statement (§11.2). Confirm by starting the image before committing an e2e tier to it.

---

## 16. Source index

All retrieved **2026-08-15**.

**DynamoDB (AWS Developer Guide)**

- Streams / ordering / retention / `StreamViewType` — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html
- Partitions & data distribution — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html
- Partition key design (3,000 RCU / 1,000 WCU) — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html
- Local secondary indexes / 10 GB item collection limit — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/LSI.html
- Service quotas — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html
- Data types & naming rules (400 KB, key lengths) — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html
- TTL — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html
- Working with expired items and TTL — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html
- Query pagination (1 MB, `LastEvaluatedKey`) — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html
- DynamoDB local — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
- DynamoDB local usage notes / differences — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html

**DynamoDB (API Reference)**

- `PutItem` (replace semantics, `attribute_not_exists`) — https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html

**Lambda (AWS Developer Guide)**

- Using Lambda with DynamoDB (polling, `ParallelizationFactor`, at-least-once, `TRIM_HORIZON`) — https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html
- ESM parameters & defaults — https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html
- Retain discarded records / on-failure destinations — https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html
- Partial batch response — https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html
- Event filtering with a DynamoDB source — https://docs.aws.amazon.com/lambda/latest/dg/with-ddb-filtering.html
- Metric types (`IteratorAge`, ESM metrics) — https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html
- Execution role — https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html

**IAM / VPC / pricing**

- `AWSLambdaDynamoDBExecutionRole` — https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaDynamoDBExecutionRole.html
- Gateway VPC endpoints (free, S3 + DynamoDB) — https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html
- DynamoDB on-demand pricing — https://aws.amazon.com/dynamodb/pricing/on-demand/
- DynamoDB pricing / free tier — https://aws.amazon.com/dynamodb/pricing/

**SDK / CDK / LocalStack**

- `@aws-sdk/lib-dynamodb` README — https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-dynamodb/README.md
- LocalStack DynamoDB — https://docs.localstack.cloud/aws/services/dynamodb/
- LocalStack DynamoDB Streams — https://docs.localstack.cloud/aws/services/dynamodbstreams/
- LocalStack pricing & packaging change (Community EOL 2026-03-23) — https://blog.localstack.cloud/2026-upcoming-pricing-changes/
- `aws-cdk-lib@2.254.0` installed typings/implementation, read locally 2026-08-15:
  `aws-lambda-event-sources/lib/{stream,dynamodb}.{d.ts,js}`, `aws-dynamodb/lib/{table,table-v2,billing,shared,perms}.{d.ts,js}`

**Related documents in this review**

- [17-message-substrate.md](17-message-substrate.md) — the earlier, superseded requirement framing
- [28-research-messaging-aws.md](28-research-messaging-aws.md) — the cross-technology comparison that selected DynamoDB
- ADR-0004 (NAT minimization), ADR-0005 (`Environment` tagging / PR cleanup), ADR-0014 (service-owned contracts),
  ADR-0016 (retention / dedup / Valkey), ADR-0019 (recipe import spine)
