# 22 — Adversarial reliability & operability review of PR 91

**Posture**: refutation. Every claim is anchored to code, CDK, or a live read-only AWS query run on
2026-08-14 against the project's AWS account (`<aws-account-id>`) / `us-east-1`. No mutating command was
issued. Where the
posture is genuinely fine for a pre-launch, zero-user, single-developer product, that is said plainly.

**Scope**: the three things PR 91 will build — (a) a durable, entity-grouped, guaranteed-delivery
message substrate with latest-in-group-wins semantics; (b) food-service placeholder/shell rows for
unresolved ingredients; (c) the 1-task-or-zero service posture — read against what is actually
deployed today.

**Reading convention.** _WILL HAPPEN_ = deterministic given the stated trigger. _CAN HAPPEN_ =
requires a coincidence that is plausible but not certain. _IS HAPPENING_ = verified live, right now.

---

## Headline

Three findings dominate everything else, and two of them are already true in production today:

| #   | Finding                                                                                                                                                                                                           | Class        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| H-1 | **Every alarm topic in the account has zero subscriptions.** 16 alarms and the $300 budget guardrail publish to SNS topics nobody receives.                                                                       | IS HAPPENING |
| H-2 | **`kitchensink-erasure-incomplete-prod` is live with `Dimensions: []` and `AlarmActions: []`** — structurally incapable of firing, on a GDPR Art. 17 control. The code fix exists and was never deployed to prod. | IS HAPPENING |
| H-3 | **A shed `503` on add-by-name strands a permanently-`PENDING` food row that no code path can ever repair.** This is the placeholder lifecycle PR 91 is about to build on.                                         | WILL HAPPEN  |

PR 91's substrate is being added to a system where the delivery leg of the alerting pipeline does
not exist. That ordering is backwards, and it is the single operational prerequisite that outranks
everything else in this document.

---

## Placeholder lifecycle failure modes

### The lifecycle as actually implemented

`ADR-0019 §5` (`docs/architecture/decisions/0019-recipe-import-spine.md:115-134`) and `004-FR-050`
(`specs/004-recipe-importing/spec.md:229-236`) require that a recipe referencing an unresolved
ingredient store a placeholder, and the food catalog hold a corresponding **shell entry carrying
that item's current processing/sync/import status**, readable from the DB at any time.

The shell is not new machinery — it is the existing `food` row in a non-`RESOLVED` state. Walk it:

```
POST /api/v1/foods            → FoodsService.addByName          foods.service.ts:207
  → FoodDao.createByName      → COMMITS a PENDING `food` row     food.dao.ts:239-288
  → AdmissionService.admit    → may throw 503                    foods.service.ts:211
  → EnqueueEmitter.publish…   → fetch_queue row + pg_notify      foods.service.ts:212
Worker leases → fans out to USDA → terminal:
  RESOLVED / UNRESOLVED  → queue row deleted                     food-consumer.service.ts:317
  NOT_FOUND              → tombstone, no alarm event (DSN-9)     food-consumer.service.ts:283-290
  FAILED                 → tombstone after retry budget          food-consumer.service.ts:616-624
```

### F-1 — The commit-before-admit gap creates an unrepairable shell (WILL HAPPEN)

`createByName` runs in **its own transaction** (`food.dao.ts:243`) and returns committed.
`admission.admit()` runs **after** it (`foods.service.ts:208` then `:211`). A shed therefore leaves a
committed `PENDING` `food` row with **no `fetch_queue` row, no `fetch_requesters` row, and no
`pg_notify`**.

That alone would be recoverable — except it is not, and this is the part the prior reviews stopped
short of. Trace the retry:

1. The user retries the same name. `createByName` hits `ON CONFLICT (normalized_name)`. The reactivation
   arm only fires for `status IN ('NOT_FOUND','FAILED') AND tombstoned_at < now() - ttl`
   (`food.dao.ts:254-266`). `PENDING` matches neither, so `created = false, reactivated = false`.
2. `addByName` falls through to line 221-235. The `UNRESOLVED`-with-expired-candidates re-enqueue at
   `:228` does **not** match `PENDING`. Control reaches `return { id: result.id, status }` at `:235` —
   **no `admit`, no enqueue**.
3. The user polls `GET /foods/{id}`. `getFood` throws `FoodPendingError` with
   `estimatedWaitSeconds: 30` (`foods.service.ts:97-102`, `ESTIMATED_WAIT_SECONDS` at `:50`). The
   client is told "30 seconds" **forever**.

`LEGAL_PRIORS` (`food.dao.ts:182-188`) also forbids `PENDING → PENDING`, so nothing can nudge it.

`batchAdd` is strictly worse: it calls `createByName` inside the loop for **every** name
(`foods.service.ts:264`) and calls `admit` **once, after the whole loop** (`:287`). One shed 503
strands up to `FOOD_MAX_BATCH_NAMES` (default 100, `config/env.schema.ts:76`) immortal shells in a
single request.

**Terminal failure state that anyone acts on: there is none.** The only repair is the admin
`POST /foods/{id}/refetch` (`foods.service.ts:387-397`), which requires an operator to already know
the id. Nothing discovers them.

### F-2 — The stranded population is invisible to every metric (WILL HAPPEN)

`AdminMetricsDao.backlog()` deliberately counts only `UNRESOLVED | NOT_FOUND | FAILED`
(`admin-metrics.dao.ts:47-60`, `WHERE status IN (...)` at `:50`). **`PENDING` is excluded.**
`queueDepths()` counts `fetch_queue` rows (`:28-39`) — and a stranded shell has no queue row. The
worker's snapshot emits `depths.pending`, `depths.inFlight`, `depths.tombstone`,
`backlog.unresolved`, and `pendingAgeSeconds` (`worker/main.ts:83-95`).

So a shell that is `food.status = 'PENDING'` with no queue row is counted by **zero** of the five
emitted metrics, and `food-fetch-pending-age-seconds` — the alarm that exists precisely to catch
"demand not being drained" (`food-service-stack.ts:743-752`) — reads the oldest _queue_ row and
therefore reads `NULL`. The strand is silent by construction.

### F-3 — Shells are immortal, and the TTL runs the wrong direction (WILL HAPPEN)

There is no `DELETE FROM food` anywhere. Verified: `db.delete(...)` appears three times in the
service, all on child tables — `fetch_requesters` (`fetch-requesters.dao.ts:66,83`) and
`food_candidates` (`food-candidates.dao.ts:155`). `FOOD_NOT_FOUND_TTL_DAYS`
(`config/env.schema.ts:78`) has exactly one consumer, `FoodDao.terminalTtl` (`food.dao.ts:209`), and
its only use is the **reactivation** arm of the upsert (`:256-266`). The TTL revives tombstones; it
never reaps them. A shell created once persists for the life of the database.

For a pre-launch product this is a rounding error on cost. It is **not** a rounding error on
correctness: `search` (`foods.service.ts:174-195`) queries the local store with no status filter, so
`FoodSearchDao.search` will surface immortal `PENDING`/`FAILED` shells in the ingredient picker
unless it filters — worth a separate check, flagged under _Not examined_.

### F-4 — `refreshResolvedFood` never demotes, so a permanently-broken upstream item is invisible

The change-refresh branch swallows every re-fetch error and leaves the field intact
(`food-consumer.service.ts:388-400`, `refresh-refetch-skipped` at `:393`) and then unconditionally
`queue.resolve()` + emits `FoodFetchCompleted` with `status: 'RESOLVED'` (`:374-375`). A food whose
backing USDA item was **deleted upstream** will re-emit "RESOLVED" every 6 hours forever, with a
`warn` log and no metric. That is the correct data decision (do not clobber good data with a
transient failure) paired with a missing operational one (nothing counts consecutive skips).

### The reconciler that must exist

PR 91 must ship, at minimum, a **shell reaper/reconciler** — a scheduled pass (the change-refresh
task at `food-service-stack.ts:534`, `rate(6 hours)`, is the natural host) that:

| Step | Query                                                                                                      | Action                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R1   | `food` rows `status='PENDING'` with **no** `fetch_queue` row, `updated_at < now() - interval '10 minutes'` | re-enqueue through `EnqueueEmitter.publishFoodRequested({ reactivate: true })` and count them          |
| R2   | same population, age > 24 h and ≥ N repair attempts                                                        | transition to `FAILED` so it becomes visible to `backlog.failed`, and emit the terminal status message |
| R3   | any population                                                                                             | emit `food-orphaned-shell-count` as EMF, **including zero**, so the alarm has a floor                  |
| R4   | `food` rows terminal past TTL with zero `fetch_requesters` and zero recipe references                      | hard-delete (the missing reap)                                                                         |

Cheaper and strictly better: **close the gap instead of sweeping it.** Move `admission.admit()`
_before_ `createByName` in both `addByName` and `batchAdd`, or wrap create+enqueue in one transaction
(`EnqueueEmitter` already owns a transaction — `enqueue.emitter.ts:66-71` — so the shape exists).
Admission reads only `fetch_queue`/`fetch_requesters` (`admission.service.ts:77-92`); it does not
need the food row to exist. That is a two-line reorder that eliminates the failure class. The
reconciler is still needed for R2–R4 (crash between the two writes), but it stops being the primary
control.

**Cost of omitting it.** Not an outage — a slow correctness rot. Every shed 503, every task kill
between the two writes, and every crash mid-`addByName` deposits a permanent row that reads as
"processing, 30 seconds" to the user and to feature 014's future consumer. With one developer and no
users the population grows at ~0/day, so the _urgency_ is genuinely low. The _cost of adding it
later_ is high, because by then the population is unattributable — you cannot distinguish a shell
stranded by a shed from one stranded by a deploy, and there is no `created_by`/`stranded_at` marker
to reconstruct it. Ship the reorder now; ship R1/R3 with PR 91; defer R2/R4.

---

## Substrate accumulation & retention

### S-1 — The claimed substrate does not exist, and the plan that depends on it says it does

`specs/014-notification-service/plan.md:965-966` states:

> "003 already publishes `FoodFetchCompleted` to EventBridge, so the substrate is in use but no
> cross-feature bus convention exists yet."

This is **false**, and it is load-bearing for 014's dependency analysis. Verified three ways:

1. `worker/main.ts:64` wires `new FoodEventEmitter(new ConsoleEventBus(), …)`. `ConsoleEventBus.putEvent`
   (`events/food-event-emitter.ts:212-214`) calls `console.info` and returns. Nothing reaches AWS.
2. `@aws-sdk/client-eventbridge` is a dependency of **no package in the repo**. `PutEventsCommand` /
   `EventBridgeClient` appear only inside comment prose. **No code in this repository can call
   EventBridge.**
3. The CDK provisions `FoodEventBus` (`food-service-stack.ts:266-268`), grants `PutEvents` to three
   task roles (`:366`, `:431`, `:492`), and injects `FOOD_EVENT_BUS_NAME` into every container
   (`:284`) — which **no source file reads** (repo-wide grep: one hit, the CDK line itself). The
   stack comment at `:263-265` says outright there is deliberately no rule consumer.

So the "substrate" today is: a bus with no publisher, no consumer, no rule, three IAM grants, and an
env var nobody reads. PR 91 is greenfield here, not an extension.

### S-2 — Where messages accumulate, and what bounds it

The owner's ruling — durable, grouped by entity, guaranteed delivery, latest-in-group-wins — maps to
SQS FIFO with `MessageGroupId = entity id`, which is what 014 already specifies
(`specs/014-notification-service/plan.md:134-135`, `tasks.md:186`). That is the right primitive and
it is a pattern this repo already operates well: four SQS queue pairs with DLQs and
`maxReceiveCount: 5` exist today (`packages/infra/global/lib/platform/data-stack.ts:302,309`;
`packages/services/recipe-workers/infra/lib/recipe-workers-stack.ts:258,266,280,290,550,557`).

**But the consumer (014) is deferred.** Producing into a FIFO queue with no consumer has hard,
non-obvious bounds that must be decided in PR 91, not discovered later:

| Property           | SQS FIFO reality                                                 | Consequence with no consumer                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retention          | max **14 days** (`MessageRetentionPeriod`)                       | messages silently expire. "Guaranteed delivery" becomes "guaranteed for 14 days"                                                                                                                                     |
| Backlog cap        | **20,000 in-flight**, but unlimited _available_                  | not the binding limit                                                                                                                                                                                                |
| Per-group ordering | strict FIFO per `MessageGroupId`                                 | a poison message at the head of a group **blocks that entire group forever** — this is FIFO's defining hazard and it has no DLQ escape until `maxReceiveCount` is exhausted, which requires a consumer to receive it |
| Dedup              | 5-minute content-dedup window                                    | does **not** implement latest-wins                                                                                                                                                                                   |
| Throughput         | 300 msg/s per group (3,000 batched) without high-throughput mode | irrelevant at this scale                                                                                                                                                                                             |

**Latest-in-group-wins is not an SQS feature.** SQS FIFO gives you _ordering_ within a group; it does
not collapse a group to its latest member. Compaction has to live either in the consumer (apply, then
discard anything with a lower sequence) or in a durable projection. `004-FR-048` already commits to
the correct mechanism — supersession by a **monotonic sequence carried in the envelope, never arrival
order** (`specs/004-recipe-importing/spec.md:221-223`) — and finding 12 (A-1) has already established
that this sequence has **no named durable home** on the food side. That gap is now a reliability gap,
not just a design gap: without it, an at-least-once redelivery reverts `succeeded` to `processing`,
and the DB projection and the message stream disagree — the exact thing ADR-0019 §5 forbids.

### S-3 — An unbounded store with no consumer: what actually bounds it here

Honest assessment: **at this product's stage, growth is bounded by the fact that nothing produces
traffic.** Verified live — every food EMF metric shows a flat idle series, and the only producers are
one developer's manual imports and the 6-hourly change-refresh. The "slow-motion outage" framing is
not warranted for volume.

What _is_ warranted is the **expiry** problem. If PR 91 emits into a queue nobody drains, then either:

- **(a) retention expires them at 14 days** — and the first thing 014 does when it ships is consume a
  queue that has silently dropped every message older than two weeks, with no record that it did. The
  only signal is `NumberOfMessagesDeleted` vs `ApproximateNumberOfMessagesVisible` divergence, and
  **no SQS `ApproximateAgeOfOldestMessage` alarm exists anywhere in this repo** (verified: the only
  SQS alarms are `ApproximateNumberOfMessagesVisible > 0` on two recipe DLQs,
  `recipe-workers-stack.ts:733,775`); or
- **(b) you set retention to 14 days and accept it**, which is the honest choice — but then the
  contract word is not "guaranteed delivery", it is "guaranteed delivery to a consumer that exists".

**Recommendation.** Do not emit into a consumer-less queue. Two defensible alternatives, in order:

1. **Emit to the durable projection only** (the `food` row status, which `FR-050` already requires to
   be the source of truth) and defer the queue to 014. ADR-0019 §5 explicitly says the message is "a
   notification _of_ a committed state change, never the state itself" — so the state change is the
   deliverable, and the notification has no recipient yet. This is the YAGNI-correct read: the queue
   is capability for a presumed future consumer.
2. **If the queue ships anyway** (defensible — it de-risks 014 and the wire shape is expensive to
   reverse), then it MUST ship with: a stub consumer that drains-and-discards after recording a
   count, a DLQ with `maxReceiveCount`, an `ApproximateAgeOfOldestMessage` alarm, and an explicit
   written retention decision. A queue with no consumer and no age alarm is a system that lies about
   its own health.

### S-4 — Nothing wakes a consumer that is scaled to zero

The question "if services scale to zero, what wakes the consumer?" has a concrete answer today and it
is not encouraging. The food worker's wake path is Postgres `LISTEN/NOTIFY`
(`enqueue.emitter.ts:70`, `worker-runtime.ts:115-116`) plus a 60-second reaper tick
(`worker-runtime.ts:123-129`). **`pg_notify` is delivered only to sessions currently `LISTEN`ing** —
a worker at `desiredCount: 0` misses every notify permanently; only the reaper's periodic re-drain
recovers it, and only once the worker comes back.

For SQS the answer is better: a Lambda event-source mapping polls regardless (the repo already does
this six times, e.g. `recipe-workers-stack.ts:472`, `:542`, `:588`). **If PR 91's consumer is a
Lambda, scale-to-zero is a non-issue.** If it is an ECS task at `desiredCount: 0`, nothing wakes it
and the substrate accumulates until retention eats it. Choose Lambda.

### S-5 — The `WorkerRuntime` standby state is terminal (CAN HAPPEN, high severity)

Not strictly substrate, but it is the closest existing analogue to "a consumer that stops consuming
and nobody notices", and PR 91 will inherit the pattern.

`WorkerRuntime.start()` calls `acquireWorkerLock` **once** (`worker-runtime.ts:106`), which is
`pg_try_advisory_lock` — non-blocking, single-shot (`worker-lock.ts:31-36`). On failure it logs
`standby` and returns `false` (`:108-112`). **There is no retry loop anywhere.** `bootstrap()` then
logs `consumer-standby` and falls off the end (`worker/main.ts:115-116`); the process stays alive only
because two pooled pg connections hold the event loop open (`:97-98`).

A standby worker therefore: never drains, never re-attempts the lock, **emits no metrics at all**
(`snapshotMetrics` is called only inside the `holdsLock` branch, `worker-runtime.ts:121,127`), has
**no container health check** (`FoodWorkerContainer`, `food-service-stack.ts:454-460`, has no
`healthCheck` block), and is behind **no load balancer**, so ECS and CloudWatch both report it
perfectly healthy forever.

The deploy path is protected — `minHealthyPercent: 0, maxHealthyPercent: 100`
(`food-service-stack.ts:477-478`) forces stop-then-start, and the comment at `:476` shows this is
deliberate and correct. The unprotected path is an **ungraceful death of the lock holder**: a Fargate
Spot reclaim that overruns the 30-second default `stopTimeout`, a task-level SIGKILL, or an AZ loss
leaves the old backend's TCP session alive at Postgres until keepalives reap it (RDS default
`tcp_keepalives_idle` is the OS default, ~2 h). The replacement starts inside that window, gets
`standby`, and is dead permanently — long after the stale lock is released.

**Fix**: make standby a retry loop (`setInterval` re-attempting `pg_try_advisory_lock`, 30 s), and
emit a heartbeat metric from _both_ branches so "worker alive" is observable independently of "worker
draining."

---

## Signals and alarms (incl. any alarm that cannot fire)

### A-1 — Every alarm topic in the account has ZERO subscriptions (IS HAPPENING)

Live query, `sns list-subscriptions-by-topic` over every topic in the account:

```
0  kitchensink-cost-guardrails-CostAlertTopic839A4E50-IyPLCdg6mkEN
0  kitchensink-food-service-pr-91-FoodAlarmTopicD110DB01-5CnKVPZy4xAK
0  kitchensink-food-service-pr-92-FoodAlarmTopicD110DB01-vWpsCvx65btd
0  kitchensink-food-service-prod-FoodAlarmTopicD110DB01-DwgKBLB2yr8Y
1  kitchensink-handle-sync-prod                    ← application fan-out, not alarms
2  kitchensink-handle-sync-sandbox                 ← application fan-out, not alarms
0  kitchensink-identity-service-prod-IdentityAlarmTopic6BEC41E8-rXsCTX15rm1p
0  kitchensink-identity-service-sandbox-IdentityAlarmTopic6BEC41E8-ZTob7Jpn8B3K
0  kitchensink-identity-webhooks-sandbox-WebhooksAlarmTopic20752206-udJXFiD6S0R5
0  kitchensink-recipe-workers-pr-91-RecipeWorkersAlarmTopic8C3122AE-ITF8iUPqUoOh
0  kitchensink-recipe-workers-pr-92-RecipeWorkersAlarmTopic8C3122AE-0SHTa3wrCyMT
0  kitchensink-recipe-workers-prod-RecipeWorkersAlarmTopic8C3122AE-psyQMqMoB9O7
```

**Every alarm-carrying topic: zero subscribers.** Including the cost topic that carries the $300
monthly budget and the cost-anomaly alarms of ADR-0008. The code side matches: no `addSubscription`
for any alarm topic (`identity-service-stack.ts:400` says "subscriptions managed out-of-band per
stage"; `food-service-stack.ts:680`, `webhooks-stack.ts:429`, `recipe-workers-stack.ts:676` likewise),
and `CostAlertTopic`'s email is gated on `props.alertEmail` fed by `costAlertEmail` /
`COST_ALERT_EMAIL`, which is set in **no workflow, no script, no `cdk.json`**.

Net: **16 alarms exist and none of them can notify a human.** The alarm layer is decorative. This
outranks every other finding in this document, because it is the reason a "3am page" is a
counterfactual — nothing pages, ever, at any hour.

Note also: `kitchensink-identity-webhooks-prod-WebhooksAlarmTopic` **does not exist in the account at
all** — only the sandbox one does. The prod webhooks stack predates the alarm topic and has not been
redeployed.

### A-2 — The alarm that cannot fire: `kitchensink-erasure-incomplete-prod` (IS HAPPENING)

The prompt asked for an alarm on a metric nothing emits. There is a better one: an alarm on a metric
**shape** nothing emits, live in production, guarding GDPR Art. 17.

Live `describe-alarms`:

```json
{ "N": "kitchensink-erasure-incomplete-prod",
  "D": [],                    ← no dimensions
  "A": [],                    ← no alarm actions
  "S": "OK" }
{ "N": "kitchensink-erasure-incomplete-sandbox",
  "D": [ {"metric":"ErasureIncomplete"}, {"service":"identity-webhooks"} ],
  "A": [ "…WebhooksAlarmTopic…" ],
  "S": "OK" }
```

The emitter publishes EMF with `Dimensions: [['service','metric', ...]]`
(`identity-webhooks/src/common/observability.ts:109-118`, `emitMetric` at `:100`). **EMF publishes
only the dimension sets the directive lists — there is no dimensionless rollup.** A dimensionless
alarm on `KitchenSink/IdentityWebhooks / ErasureIncomplete` therefore watches a time series that has
never had, and can never have, a single datapoint. With `treatMissingData: NOT_BREACHING`
(`webhooks-stack.ts:466-483`) it reports a confident, permanent **`OK`**.

The code already fixed this — the docstring at `webhooks-stack.ts:433-453` records the old
dimensionless alarm as a known defect. **Sandbox has the fix deployed. Prod does not.** Prod is
strictly less observable than sandbox on the repo's most compliance-sensitive control, and it also
has no action attached.

Corroborating live evidence: `cloudwatch list-metrics --namespace KitchenSink/IdentityWebhooks`
returns **empty** — no metric in that namespace has had a datapoint in 14 days, despite the
reconciliation Lambda running daily and emitting unconditionally (`erasure-reconciliation.ts:158`).
That is a second, independent defect worth its own investigation (flagged under _Not examined_).

And while looking: `kitchensink-identity-webh-ErasureReconciliationFun-rJbzeqnYndRQ` (STAGE=sandbox)
has **38 invocations and 36 errors** over the last 14 days — a ~95% failure rate on the GDPR erasure
reconciliation job, running silently for at least two weeks. Nothing alarms on Lambda `Errors`
anywhere in this repo.

### A-3 — `FetchFailed` correction

The brief states there is a `FetchFailed` alarm that can never fire. **There is not.** Grep across
`packages/services/food-service/infra/**` for `FetchFailed`: zero hits. The food stack has exactly
four alarms (`FoodTombstoneAlarm` `:695`, `FoodApiErrorRateAlarm` `:719`, `FoodQueueDepthAlarm`
`:731`, `FoodPendingAgeAlarm` `:743`), and the `FoodFetchCompleted` EventBridge rule was deliberately
removed (asserted by `infra/__tests__/food-service-stack.test.ts:394-400`).

What is true, and worse in a quieter way, is that **three code comments assert an alarm that was
never built**: `food-consumer.service.ts:607` ("emit BOTH … the alarm fires on FAILED only, DSN-9"),
`food-event-emitter.ts:5-6` ("a `NOT_FOUND` tombstone … raises no alarm"), and `:12`. Anyone reading
the worker believes a terminal-failure alarm exists. It does not. Fix the comments in PR 91 or build
the alarm; do not leave both.

### A-4 — `FoodTombstoneAlarm` watches the wrong number (WILL HAPPEN)

`FoodTombstoneAlarm` fires at `> 0` on `food-tombstone-count` (`food-service-stack.ts:695-704`),
which is `queueDepths().tombstone` — a `fetch_queue GROUP BY status` count of rows whose status is
literally `'tombstone'` (`admin-metrics.dao.ts:28-39`). That column **does not distinguish
`NOT_FOUND` from `FAILED`**.

`NOT_FOUND` is an explicitly _normal_ outcome that must not alarm (DSN-9,
`food-consumer.service.ts:281-290`; `food-event-emitter.ts:5-6`). The discrimination exists —
`backlog()` returns `notFound` and `failed` separately (`admin-metrics.dao.ts:47-60`) — but
`worker/main.ts:93` emits only `backlog.unresolved`. **`backlog.failed`, the actual DSN-9 signal, is
computed and thrown away.**

Consequence: the first ingredient nobody's source has (a misspelling, a brand USDA lacks) latches
this alarm permanently at `> 0`, because tombstone rows are never swept. The alarm becomes noise on
day one and buries the `FAILED` signal it was built for. Fix: emit `backlog.failed` and alarm on
that.

### A-5 — Per-component signal + alarm matrix for what PR 91 adds

| Component                     | Signal that proves it healthy                                               | Alarm when it is not                               | Exists today?                                                                       |
| ----------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Substrate queue               | `ApproximateAgeOfOldestMessage` < retention/4                               | `> 1 h`, `treatMissingData: BREACHING`             | **No — repo has zero age alarms**                                                   |
| Substrate DLQ                 | `ApproximateNumberOfMessagesVisible`                                        | `> 0`                                              | pattern exists (`recipe-workers-stack.ts:733`) — reuse it                           |
| Substrate producer            | `substrate-publish-failed` count, emitted **including zero**                | `> 0` for 2 periods                                | No                                                                                  |
| Substrate consumer (014 stub) | Lambda `Invocations` > 0 daily; `messages-applied` count                    | `Errors > 0`; `Invocations < 1` daily w/ BREACHING | No — **zero Lambda alarms repo-wide**                                               |
| Supersession                  | `messages-superseded` and `messages-out-of-order` counts                    | out-of-order `> 0`                                 | No (no sequence exists yet — finding 12 A-1)                                        |
| Placeholder shells            | `food-orphaned-shell-count` (PENDING with no queue row), emitted incl. zero | `> 0` for 2 periods                                | **No — the population is unmeasured**                                               |
| Shell terminal failures       | `backlog.failed` as EMF                                                     | `> 0`                                              | **No — computed at `admin-metrics.dao.ts:57`, never emitted**                       |
| Food worker liveness          | heartbeat metric from both lock branches                                    | absent for 5 min, `treatMissingData: BREACHING`    | **No — the only liveness proxy is the metrics themselves, which stop when it dies** |

**The load-bearing rule for all of these:** every metric must be emitted **on every tick including
zero**, and every alarm on a "should never happen" condition must use
`treatMissingData: BREACHING`. This repo does the first correctly in recipe-workers
(`archive-sweeper.ts:194-197` and siblings emit before the early return) and does the second exactly
once, in `IdentityServiceCrashLoopAlarm` (`identity-service-stack.ts:447`). **13 of 16 alarms use
`NOT_BREACHING`**, which means "no data" reads as "healthy" almost everywhere.

For food specifically that is actively dangerous: the three EMF alarms are emitted **only by the
lock-holding drainer**, so worker-at-zero / crash-looping / wedged-in-standby ⇒ no datapoints ⇒
`NOT_BREACHING` ⇒ confident permanent `OK`. Verified live: all three food alarms in all three stages
sit `OK` with `treatMissingData: notBreaching`.

### A-6 — Category-level absences (each is its own finding)

Verified absent repo-wide: **any** RDS alarm (CPU, storage, connections, freeable memory) on the
shared instance every service depends on; **any** Lambda `Errors`/`Throttles`/`Duration` alarm across
~10 Lambdas — including the erasure-reconciliation job proven above to be failing 95% of the time,
and including the identity `DeletionDlq` (`data-stack.ts:302`) which has no alarm while the recipe
DLQs do; **any** alarm at all on `recipe-service` (the stack has a Fargate service, target group and
listener rule and does not import `aws-cloudwatch`); **any** ECS task-count or memory alarm anywhere;
**any** ALB `HealthyHostCount` alarm outside identity; **any** `TargetResponseTime` alarm.

`sandbox-scheduler-stack.ts:69` reasons that "throwing surfaces it as a Lambda error/alarm." There is
no such alarm. That is a documented dependency on a control that does not exist.

---

## Blast radius

### B-1 — One bad producer at bulk-import volume

The mechanism is real but narrower than "starves all imports globally", and the distinction matters.

**What is true.** `AdmissionService.admit` sheds when depth ≥ 90% of ceiling **and** the requester's
own pending count exceeds `FOOD_DEMOTE_THRESHOLD` (`admission.service.ts:66-71`), default **50**
(`config/env.schema.ts:72`). The batch cap is **100** (`:76`). So a **single** 100-name batch import
puts one requester over the threshold. If a bulk import runs under one `svc_*` principal, that
principal is a single shed target for the whole import.

**What is not true.** The drain-time demotion is _fair queueing_, not starvation: `leaseNext` orders
`over_threshold` requesters last (`fetch-queue.dao.ts:216`, `:248-254`), so other requesters are
served first — which is the design intent. It deprioritizes; it does not starve.

**The real amplification is F-1, not the shed itself.** Because `batchAdd` creates all rows before
admitting (`foods.service.ts:264` vs `:287`), the shed that is _supposed_ to protect the queue
instead deposits up to 100 immortal shells per shed request. The backpressure control manufactures
the durable defect it exists to prevent.

**Into the shared substrate**, the amplification compounds: a 1,000-recipe import (`004-FR-026`)
emits one recipe message per transition (`ADR-0019 §4`: `queued`/`processing`/`succeeded`) **plus**
one per food item per stage (`004-FR-049`). At ~10 ingredients/recipe that is 1,000 × 3 + 10,000 × 3
≈ **33,000 messages** for one import. Latest-wins compaction bounds what a _client_ renders; it does
**not** bound what the queue holds, because SQS does not compact. 33,000 FIFO messages into a queue
with no consumer, per import.

### B-2 — The change-refresh scan is the actual repeating amplifier (WILL HAPPEN)

`listResolvedBackingItems` is `ORDER BY fs.food_id LIMIT ${limit}` with **no cursor, no offset, no
watermark** (`food-sources.dao.ts:168-190`, `ORDER BY` at `:180`). `DEFAULT_SCAN_LIMIT = 1000`
(`change-refresh.consumer.ts:41`). Every 6-hour run therefore re-scans **the same lowest-1,000
`food_id` rows forever**; rows 1,001+ are never refreshed once the catalog exceeds 1,000 backing
items.

Two independent harms:

1. **Correctness**: refresh coverage silently caps at the first 1,000 rows by id. Since ids are ULIDs
   (`newFoodId`), that is the 1,000 _oldest_ foods, permanently.
2. **Budget**: the scan charges the rolling window per item (`change-refresh.consumer.ts:129`) against
   `FOOD_SOURCE_RATE_LIMIT_PER_HOUR`, default **1000/hr** (`config/env.schema.ts:58`). It yields at the
   90% pause (`:123-127`), so one scheduled pass can consume up to ~900 of the 1,000 hourly USDA
   calls — re-verifying the same 1,000 rows — leaving ~100 for live user demand in that hour. The
   yield check makes this self-limiting rather than fatal, which is why it is a degradation and not
   an outage.

And into the substrate: `refreshResolvedFood` emits `FoodFetchCompleted` **unconditionally on every
refresh**, changed or not (`food-consumer.service.ts:374-375`). So the substrate receives up to 1,000
"still RESOLVED" messages every 6 hours — **4,000/day of pure noise, forever, with zero user
activity**. That is the single largest steady-state producer of substrate volume in the system, and
it produces nothing a consumer needs. Fix: emit only when `changed.length > 0`.

### B-3 — Cost

At `Commise/Food` EMF volume the metric bill is trivial. The substrate bill at the volumes above is
also trivial (SQS at 33k messages ≈ cents). The material costs are already known and accepted:
per-PR food runs one API task ≈ **$8.25/mo per open PR** (ADR-0010), and — verified live — **PR-91
and PR-92 are both running right now**: `kitchensink-food-service-pr-91` (API 1/1, worker 1/1),
`pr-92` (API 1/1, worker 1/1), `kitchensink-recipe-service-pr-91` and `-pr-92` (1/1 each). Per-PR ECS
is **not** in the nightly-shutdown selector — confirmed: `isSandboxClusterArn` matches
`name.toLowerCase().includes('sandbox')`
(`packages/infra/global/lib/sandbox-scheduler/scheduler.ts:156-160`) and per-PR clusters are named
`kitchensink-{service}-pr-{N}-…`, which contains no `sandbox`. So 8 tasks run 24/7 across two open
PRs while the shared sandbox RDS **is** stopped 00:00–09:00 ET.

That last combination deserves a line of its own: **for nine hours every night, every per-PR food
worker is `LISTEN`ing on a database that is switched off**, with no circuit breaker, and its
`processing-error` path consumes the FR-016 retry budget on every leased row
(`food-consumer.service.ts:172-185`). Nine hours of DB-down retries can walk rows to `FAILED`
tombstones that have nothing to do with USDA. That is a real, nightly, automated corruption of the
lifecycle state — and A-1 guarantees nobody is told.

### B-4 — Blast radius on 014's future consumers

014 specifies at-least-once with out-of-order delivery and supersession by monotonic sequence
(`spec.md` FR-026, `plan.md:134-161`). If PR 91 emits **without** the sequence — and finding 12 (A-1)
established there is no durable counter on the food side — then 014's consumer has only arrival order
to work with, which `004-FR-048` explicitly forbids
(`specs/004-recipe-importing/spec.md:221-223`) for the stated reason: a redelivery silently reverts
`succeeded` to `processing`. Shipping the producer before the sequence has a home means 014 inherits
a stream it cannot correctly consume, and the fix is a **wire-contract change** — expensive to
reverse, which is precisely the case where YAGNI does not apply.

---

## Operational prerequisites before this ships

Ordered. Items 1–3 are non-negotiable before anything is left running unattended overnight.

**1. Subscribe the alarm topics. (A-1)** One email subscription per topic, or one central topic that
each stack's alarms publish to. Until this exists, every other observability item in this document is
theatre. Make it code, not console: the pattern already exists at
`cost-guardrails-stack.ts:75-77` — it is simply never fed a value. Set `COST_ALERT_EMAIL` /
`costAlertEmail` and add the equivalent to the four alarm topics. **This is a `devops-1-devops-engineer`
task if it needs workflow/secret plumbing; the CDK half is a five-line change.**

**2. Redeploy the prod identity-webhooks stack. (A-2)** Prod is running a dimensionless, action-less
GDPR alarm that sandbox has already fixed in code. Then investigate why
`KitchenSink/IdentityWebhooks` has had **zero datapoints in 14 days**, and why the sandbox
erasure-reconciliation Lambda is failing 36/38.

**3. Close the commit-before-admit gap. (F-1)** Move `admission.admit()` before `createByName` in
`addByName` and `batchAdd`, or make create+enqueue one transaction. Two-line reorder; eliminates the
failure class rather than mitigating it. Add the regression test first (TDD): shed a 503, assert no
orphan `food` row exists.

**4. Decide the substrate's retention and consumer story in writing. (S-2, S-3)** Either emit to the
projection only and defer the queue, or ship the queue with a draining stub consumer, a DLQ, an
`ApproximateAgeOfOldestMessage` alarm, and a stated retention. Do not ship a producer into a
consumer-less queue with no age alarm.

**5. Site the monotonic sequence on a named durable column. (B-4, finding 12 A-1)** Before the wire
shape is frozen. This is `staff-architect` + `db-arch-1` territory.

**6. Add the three missing food signals.** `backlog.failed` as EMF (A-4); an orphaned-shell count
(F-2); a worker heartbeat emitted from both lock branches (S-5). All three emitted **including zero**;
all three alarmed with `treatMissingData: BREACHING`.

**7. Make `WorkerRuntime` standby retry. (S-5)** A 30-second re-attempt loop. Currently a lost lock
race is a permanent, invisible outage of the entire fetch pipeline.

**8. Give the change-refresh scan a cursor, and stop it emitting no-op events. (B-2)** Keyset
pagination on a persisted watermark; emit `FoodFetchCompleted` only when `changed.length > 0`.

**9. Write the runbooks that do not exist.** `docs/runbooks/` currently holds four documents
(`cr-002-erasure-key-provisioning.md`, `u6-rds-hostname-spike.md`, `gdpr-erasure-of-copies.md`,
`sandbox-vpc-recreation.md`). **None covers a single failure mode in this review.** Minimum set for
PR 91:

| Runbook                       | Covers                   | Recovery                                                                                                                         |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `food-worker-not-draining.md` | S-5, worker standby/dead | check `lock-acquired` vs `standby` in the worker log group; `pg_terminate_backend` the stale lock holder; force a new deployment |
| `food-orphaned-shells.md`     | F-1, F-2                 | the detection query; the `POST /foods/{id}/refetch` repair; the bulk repair SQL                                                  |
| `substrate-backlog.md`        | S-2                      | age-of-oldest triage; DLQ redrive; poison-message-blocks-a-FIFO-group procedure                                                  |
| `alarm-routing.md`            | A-1                      | which topic covers what, who is subscribed, how to verify (`sns list-subscriptions-by-topic`)                                    |

**10. Do NOT gate on**: autoscaling, multi-AZ task spread, or an on-call rotation. See below.

---

## The 1-task posture

**Verdict: `desiredCount: 1` with no autoscaling is the correct decision for this product right now,
and I am not going to demand HA for a pre-launch system with zero users and one developer.** The
posture is defensible. What is _not_ defensible is a specific, small set of things that are cheap and
currently missing.

### What is deployed (verified live and in CDK)

| Unit             | desired        | running | autoscaling                                                         | deploy config                                                        |
| ---------------- | -------------- | ------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| identity prod    | 1 (min of 1–6) | 1       | **yes** — CPU target 60%, 1–6 (`identity-service-stack.ts:316-324`) | 50/200, circuit breaker + rollback                                   |
| food API prod    | 2              | 2       | none                                                                | 50/200, circuit breaker + rollback (`food-service-stack.ts:419-422`) |
| food worker prod | 1              | 1       | none (deliberate — FR-022 single drainer, `:465`)                   | **0/100, no circuit breaker, no health check**                       |
| recipe API prod  | 1              | 1       | none                                                                | 50/200, circuit breaker + rollback                                   |

Note the food API prod count is **2**, not 1 — `FOOD_DESIRED_COUNT` defaults to 2
(`food-service/infra/synth-env.ts:45`) and `prod-deploy.yml` sets no override. If the owner's ruling
is "1 task or zero", the deployed reality diverges and is costing double for the food API.

### The honest availability answer

- **Deploy**: food API and recipe API run 50/200 with a circuit breaker — a rolling deploy at
  `desiredCount: 1` briefly runs two tasks, and a bad image rolls back automatically. Fine.
- **Task replacement / AZ failure**: single-task services are unavailable for the ~60–120 s it takes
  ECS to place a replacement. Tasks are placed across 2 AZs (`network-stack.ts:56-78`, `maxAzs: 2`)
  but a single task lives in one of them, so an AZ loss is a full outage until rescheduling. **For a
  product with no users, a two-minute gap is not an incident.** Accept it.
- **Fargate Spot in all non-prod** (ADR-0008) with no on-demand fallback weight: a capacity reclaim
  is a two-minute-notice restart. Also fine — the worker is explicitly interruption-tolerant
  (`food-service-stack.ts:467-469`), and leases expire and re-lease.

### Where the 1-task posture is genuinely wrong today (four cheap fixes)

1. **No graceful shutdown in any of the three HTTP APIs.** Repo-wide grep for
   `enableShutdownHooks|onApplicationShutdown|beforeApplicationShutdown|OnModuleDestroy` across
   `packages/services/*/src`: **zero hits**. `identity/src/main.ts`, `food-service/src/main.ts`,
   `recipe-service/src/main.ts` all lack it. Node's default SIGTERM terminates immediately, so the
   ALB's 300 s deregistration delay buys nothing and **every deploy and every Spot reclaim drops
   in-flight requests**. At `desiredCount: 1` there is no second task to absorb them. This is a
   one-line fix per service (`app.enableShutdownHooks()`), and the food _worker_ already does it
   correctly (`worker/main.ts:112-113`) — the pattern is in the repo.
2. **`unhealthyThresholdCount: 10` × 30 s interval** on all three target groups
   (`food-service-stack.ts:628-636` and siblings) = a broken task serves traffic for **~5 minutes**
   before the ALB pulls it. At one task, that is a five-minute outage on every unhealthy transition.
   Drop to 3.
3. **The food worker has no circuit breaker and no health check.** With `minHealthyPercent: 0` a bad
   worker image deploys straight into a zero-consumer state, and nothing detects or reverts it. The
   `FoodPendingAgeAlarm` is the only signal, it is `NOT_BREACHING`, and nobody is subscribed (A-1).
   Add `circuitBreaker: { rollback: true }`.
4. **Food and recipe have no `HealthyHostCount` crash-loop alarm.** Identity has exactly the right
   one (`identity-service-stack.ts:438-450`, `treatMissingData: BREACHING`). Copy it to the other two
   ALB-fronted services. Three lines each.

None of these is "add HA". All four are "make one task behave correctly."

---

## Not examined

Stated so nobody reads absence as clearance:

1. **Why `KitchenSink/IdentityWebhooks` has zero datapoints** despite a daily Lambda emitting
   unconditionally to a valid shared log group. The EMF is well-formed
   (`observability.ts:102-124`); the extraction is not happening. Root cause unknown. Likely a
   subscription-filter / log-routing interaction with the Sentry log forwarder
   (`webhooks-stack.ts:574-630`) — unverified.
2. **The 36/38 sandbox erasure-reconciliation failures.** Invocation and error counts confirmed via
   CloudWatch; the log group is the shared `…WebhooksLogGroup…`, not the per-function default, and I
   did not read the actual exception.
3. **Whether `FoodSearchDao.search` filters by status** — i.e. whether immortal `PENDING`/`FAILED`
   shells surface in the ingredient picker (F-3). Not read.
4. **The recipe-side placeholder representation.** `ingredients` has no `updated_at` and no version
   column per finding 12; I did not independently verify the recipe→food reference shape or how a
   placeholder renders in the UI.
5. **The bulk-import path** (`origin = 'bulk'`, `foodOriginEnum` at `db/schema/food.ts:75`) and its
   seed module — I confirmed the admission arithmetic but not the importer's own principal or
   batching.
6. **k6 / load-test evidence.** No load test was run; all throughput statements are arithmetic from
   configured limits, not measurement.
7. **`pg_notify` payload limits** for the batch path (`enqueue.emitter.ts:104-106` joins up to 100
   ULIDs ≈ 2.7 KB, under the 8 KB limit) — checked arithmetically, not tested.
8. **Deployed-vs-code drift beyond the one case proven in A-2.** Given that prod's webhooks alarm is
   stale, a full CloudFormation drift detection across all prod stacks is warranted and was not run.
9. **Security review of the substrate** (resource policies, cross-account `PutEvents`, encryption
   posture) — out of lane. Recommend `ssec-1-security-engineer`.
10. **CI/CD gating** for any of the prerequisites above — recommend `devops-1-devops-engineer`.
11. **The `sequence` column design** for supersession — recommend `staff-architect` and `db-arch-1`;
    finding 12 A-1 already frames it.

---

**Confidence**: High for everything with a live AWS citation or a read file:line (A-1, A-2, A-3, A-4,
F-1, F-2, F-3, S-1, S-4, S-5, B-2, B-3, and the 1-task inventory). Medium for S-2/S-3 (depends on
PR 91's substrate choice, which is not yet code) and B-1 volume arithmetic (derived from spec
constants, not measured). Low for nothing asserted here; everything I could not verify is in
_Not examined_.

**Sources**: `packages/services/food-service/src/{foods,worker,events,observability,config,db}/**`;
`packages/services/food-service/infra/lib/food-service-stack.ts`;
`packages/services/identity/infra/lib/identity-service-stack.ts`;
`packages/services/identity-webhooks/{src/common/observability.ts,src/handlers/erasure-reconciliation.ts,infra/lib/webhooks-stack.ts}`;
`packages/services/recipe-workers/infra/lib/recipe-workers-stack.ts`;
`packages/infra/global/lib/{platform/data-stack.ts,platform/network-stack.ts,sandbox-scheduler/scheduler.ts}`;
`specs/004-recipe-importing/spec.md`; `specs/014-notification-service/{plan.md,spec.md,tasks.md}`;
`docs/architecture/decisions/{0008,0010,0019}-*.md`; `docs/reviews/2026-08-14-pr91-findings/12-*.md`.
Live read-only AWS (2026-08-14, `us-east-1`, the project's AWS account `<aws-account-id>`): `sns list-topics`,
`sns list-subscriptions-by-topic`, `cloudwatch describe-alarms`, `cloudwatch list-metrics`,
`cloudwatch get-metric-statistics`, `ecs list-clusters/list-services/describe-services`,
`lambda list-functions/get-function-configuration`, `logs describe-log-groups`.
