---
title: 'feat: stage-scoped custom metrics and production alarms in Sentry'
type: feat
date: 2026-10-13
---

# Stage-scoped metrics and an alarm relay to Sentry

## Owner rulings (2026-10-13)

- "Subscribe sentry and add stage."
- The prod alarm switch `/kitchensink/prod/observability/alarms-enabled` was `false` since 2026-09-08. The owner
  approved setting it to `true`. DONE 2026-10-13 (SSM version 2). Without it, the next prod deploy deletes every prod
  alarm.

## Coordinator decisions

- No Sentry org token. An OK transition is a drained log line, not an issue resolve. Issues close through the Sentry
  project's auto-resolve. This avoids a stored credential.
- The relay sends every ALARM as a Sentry issue with `environment` = the stage and `level` = `error`. The
  `kitchensink-platform` project (id 4512093189636096, the platform DSN) has the issue alert "Send a notification for
  high priority issues" (rule 3996727, environment `prod`), which emails issue owners and falls through to active
  members on new and existing high-priority issues. Verified 2026-10-13.
- The account-wide cost alert topic (`CostGuardrailsStack`) is out of scope.

## Measured facts (read-only, 2026-10-13)

- All 21 alarms in the account are in us-east-1: 19 prod, 2 AWS-managed target-tracking alarms on the sandbox
  identity service.
- The live prod tombstone alarm reads `Commise/Food` with no dimensions. `list-metrics` shows one dimensionless series
  that prod and every pr-N food worker publish into. From 2026-09-14 to 10-01 it went ALARM at about 13:05 UTC (the old
  09:00 ET sandbox start) and OK at about 04:05 UTC (the midnight stop).
- No prod alarm topic has a subscriber. `OKActions` is empty on every live alarm.
- Deployed prod is behind this branch: source reads `food-failed-backlog`, prod still reads `food-tombstone-count`. The
  merge ships a backlog of alarm changes too.

## Current state in source

- recipe-workers already emits `Stage` (`recipe-workers/src/common/metrics.ts:115`) and its alarms select it.
- recipe-service emits `Stage` (`emfMetricLine.ts`). No alarm reads it.
- food: four EMF alarms are dimensionless (`FoodServiceStack.ts:1064-1070`, the `emfMetric` helper). Remote-search
  metrics use lowercase `stage` (`emfMetrics.ts:443-470`, `FoodServiceStack.ts:1296`).
- identity-webhooks emits `['service','metric',...]` with no stage (`observability.ts:114`).
- `LogForwarderFailure` is always emitted with `{reason}` (`logForwarder.ts:53,69`) but its alarm selects only
  `{service, metric}` (`WebhooksStack.ts:720-736`), a series that never has data.
- W3/W4 in `serviceInfraWiringInvariants.test.ts` skip helper-built metrics (`:1563`) and math-expression alarms.
- `FoodTaskFailedToStartRule` publishes raw ECS events to the food alarm topic (`FoodServiceStack.ts:1265-1281`).
- `nagRulesAtZero.integration.test.ts` synthesizes every app at prod offline, but its environment does not set
  `ALARMS_ENABLED`, so it synthesizes zero alarms.
- Sentry has no integration that ingests SNS or CloudWatch alarms.

## Decision

1. Every custom-namespace metric carries the dimension `Stage`. Every alarm and dashboard on one selects
   `Stage=<its stage>`. The name and the stage reader live once, in a new CDK-free package
   `@kitchensink/metric-dimensions`, imported by runtime emitters and infra.
2. One `AlarmRelay` Lambda per base stage lives in a new persistent global stack `kitchensink-alarm-relay-{stage}`.
   Every alarm topic subscribes it when that stack's `alarmsEnabled` is true. Every alarm's `OKActions` equals its
   `AlarmActions`, set by a CDK Aspect.
3. ALARM, an ECS event or an unrecognised message becomes a fingerprinted Sentry issue. OK becomes a structured log
   line drained to Sentry Logs. A relay that cannot reach Sentry throws. Lambda retries asynchronously twice, then the
   event goes to an SQS failure queue whose depth is alarmed.

## Components

- `packages/shared/metric-dimensions/` (new package): `METRIC_STAGE_DIMENSION = 'Stage'`, `metricStage(env)` (reads
  `STAGE`, absent gives `'unknown'`), `stageDimensions(stage)`. `@pattern Published Language`.
- `food-service/src/observability/emfMetrics.ts`: every line declares `[Stage, ...facets]`. `FoodMetrics` takes a
  required `stage`. `buildEmf` takes a required `stage`. `FoodMetricDimension` becomes `'source' | 'reason'`. The
  remote-search recorders drop their `stage` argument. Callers (`worker/main.ts:75`, `foods/foods.module.ts:155,223`,
  `sources/sourceRegistry.ts:55`, `sources/remote/remoteSearchEndings.ts`) pass `metricStage(process.env)`.
- `identity-webhooks/src/common/observability.ts:100-130`: directive becomes `['service','metric',Stage,...keys]` and
  the line carries `Stage`.
- recipe-workers `metrics.ts:106-121`, recipe-service `emfMetricLine.ts`, `resolveMetricStage`: the literal becomes the
  constant and `resolveMetricStage` delegates to `metricStage`. Output stays byte-identical.
- `FoodServiceStack.ts`: the `emfMetric` helper adds `dimensionsMap: stageDimensions(stage)` (alarms and dashboards
  move together). `remoteSearchRate` uses the helper. Each `SEARCH('{Commise/Food,source} ...')` becomes
  `SEARCH('{Commise/Food,Stage,source} Stage="${stage}" MetricName=...')`.
- `WebhooksStack.ts`: `emitterDimensions` adds `...stageDimensions(deployStage)`. `LogForwarderFailureAlarm` becomes a
  math expression `FILL(dsn,0)+FILL(fwd,0)` over the two `reason` series.
- `packages/infra/global/src/observability/sentryEnvelope.ts`: extract
  `postEnvelope(target, body, deadlineMs): Promise<boolean>` (true only on 2xx). `silentNoOp.ts` uses it with no
  behavior change. Do not reuse `announceSilentNoOp` for the relay: it swallows failures by design, and a relay must
  not drop an alarm.
- `packages/infra/global/src/observability/alarmEnvelope.ts` (new): pure `buildAlarmEnvelope(msg, stage, now)`.
  Fingerprints: `['cloudwatch-alarm', stage, AlarmName]`, `['ecs-task-failed-to-start', stage, group]`,
  `['alarm-topic-unrecognised', stage, topicName]`. Level `error`, `environment` = stage, tags alarm, topic and
  namespace. `@pattern Builder`.
- `packages/infra/global/src/alarm-relay/message.ts` (new): zod `parseTopicMessage(raw, topicArn)` into a
  discriminated union `cloudwatch-alarm | ecs-task-state | unrecognised`. Bad JSON is `unrecognised`, never dropped.
- `packages/infra/global/src/alarm-relay/handler.ts` (new): for each SNS record, log one structured line, then post the
  envelope for ALARM, ECS or unrecognised. If any post fails, throw. `@sideEffect`. `@pattern Adapter`.
- `packages/infra/global/esbuild.mjs`: add the handler entry.
- `packages/infra/global/lib/platform/AlarmRelayStack.ts` (new): Node arm64, 128 MB, 30 s, no VPC (ADR-0004
  unchanged). Explicit log group, one-month retention, drain filter when `logForwarderArn` is set (ADR-0042 register
  key `alarm-relay`). `SENTRY_DSN` from the platform-DSN parameter, `STAGE` set. Async config `retryAttempts: 2`,
  `onFailure` to an SQS failure queue (enforceSSL, 14-day retention). Its own alarm topic (enforceSSL, CloudWatch
  publish grant, `subscribeAlarmEmail`, relay-subscribed). A failure-queue depth alarm (>= 1) gated on
  `alarmsEnabled`. Export `${stackName}:AlarmRelayFunctionArn`. Use an explicit log policy rather than the managed
  basic role (avoids IAM4).
- `GlobalStack.ts`, `MessageSubstrateStack.ts`: instantiate `AlarmRelayStack` at every global stage. Messaging takes
  `relay.function.functionArn`.
- `alarmRelaySubscription.ts`, a mirrored module in `packages/infra/global/lib/platform/` and in `infra/lib/` of
  identity, identity-webhooks, food-service, remote-search and recipe-workers (the `@radicle-co/infra-shared` pin rule
  and the `scheduledRuleGate.ts` precedent, held by `mirroredModuleParity.test.ts`): `relayAlarmTransitions(stack,
topic, relayArn)` subscribes the relay (one permission per topic, `SourceArn` = that topic) and adds the
  `AlarmTransitionsRelayed` Aspect (each `CfnAlarm`'s `okActions` = its `alarmActions`). `importAlarmRelayArn(stage)` =
  `Fn.importValue('kitchensink-alarm-relay-${stage === 'prod' ? 'prod' : 'sandbox'}:AlarmRelayFunctionArn')`.
- Each topic owner calls `relayAlarmTransitions(...)` inside its existing `if (props.alarmsEnabled)` block.
- `identity-webhooks/src/common/logDrainRegister.ts` and the ADR-0042 table: register the relay log group.
- `prod-deploy.yml` `on.push.paths` and the food, recipe and webhooks filters: add `packages/shared/metric-dimensions/**`
  (`deployLegsWatchTheirLibraries`). Declare the dependency in the package.json of food, identity-webhooks,
  recipe-workers and recipe-service (`imageRuntimeDependencies`).
- ADR-0062 records the design, including why the relay uses an export plus import where ADR-0042 used a CI-resolved
  input (the relay lives in the global app and every consumer is downstream, so no cycle).

## Transition

Every alarm whose dimensions change is `notBreaching`, so the cutover opens a blind window, never a false page. Food is
blind for its ECS rollout. Webhooks for seconds, except `ErasureIncomplete` (one-day periods, 2 of 2), which cannot fire
for up to about 2 days. `RecipeParseJobStall` already selects `Stage`. If the ECS circuit breaker rolls back the image
but not the template, food stays blind until the next deploy.

## Build order and tests (red first. each phase leaves the tree green)

1. `packages/infra/global/__tests__/alarmPosture.ts`: pure predicates over template JSON
   (`customAlarmsMissingStage`, `alarmTopics`, `topicsWithoutRelay`, `alarmsWithoutOkActions`), unit-tested against
   violating and compliant fixtures (math expression, AWS-namespace exemption, rule-targeted topic, no subscription, OK
   != ALARM).
2. Extract the synth harness from `nagRulesAtZero` into `packages/infra/global/tests/common/everyAppSynthesis.ts`.
   `nagRulesAtZero` stays green unchanged.
3. `tests/prodAlarmPosture.integration.test.ts`: synthesize every app with `STAGE=prod` and `ALARMS_ENABLED=true`.
   Assert every custom-namespace alarm selects `Stage=prod`, every alarm topic has the relay subscription and a
   topic-scoped `sns.amazonaws.com` permission, `OKActions == AlarmActions`, every emitting Lambda and container has
   `STAGE=prod`, and a vacuity check (synthesized alarm count >= AST count of `new cloudwatch.Alarm` sites minus
   `SandboxSchedulerStack`'s. `ingredient-parser`, which cannot synthesize, constructs no alarm or topic). Red now. Keep
   it as `.todo` until phase 6. Do not weaken it.
4. The `metric-dimensions` package and tests. Register the workspace. The prod-deploy paths and dependency
   declarations.
5. Emitters, tests first: food and webhooks directive sets contain `Stage`. recipe-workers and recipe-service give
   byte-identical golden output. Extend W4 to resolve `METRIC_STAGE_DIMENSION` and `stageDimensions(...)`, with
   fixtures. Rewrite the subject test at `:1252` to `['Stage','metric','service']`. Update
   `emfIdentifierDimensionRepoGate`'s allowlist if it objects.
6. Infra Stage half: food helper, `remoteSearchRate`, SEARCH strings. Webhooks `emitterDimensions` and the
   LogForwarderFailure expression. Rewrite the alarm and dashboard assertions in `FoodServiceStack.test.ts` and
   `WebhooksStack.test.ts` to state `Stage=prod`. Turn on the Stage half of phase 3.
7. The relay, tests first: `message.ts` against real SNS samples (alarm ALARM and OK, ECS STOPPED, bad JSON).
   `alarmEnvelope.ts`. the handler with `postEnvelope` injected (2xx resolves. 5xx, timeout and no DSN throw. OK posts
   nothing but logs). `tests/alarmRelay.integration.test.ts` against a local HTTP stand-in for Sentry.
   `AlarmRelayStack.test.ts` (no VPC, drained and retained log group, async config, SSL failure queue, gated depth
   alarm, the export). Then `silentNoOp` uses `postEnvelope` with its tests unchanged.
8. Subscription mirrors: the six copies, a discovered mirror group (`*/lib/**/alarmRelaySubscription.ts`), a check that
   every mirror's export name equals `AlarmRelayStack`'s. The calls in each topic owner, with per-package synth
   assertions. Rewrite `alarmSubscriptionWiring.test.ts` to also require `relayAlarmTransitions(`. Phase 3 is fully on.
9. Registers and generated files: `logDrainRegister.ts` and ADR-0042's table, `queueProducerRegister` and
   `queueBaselineDeclarations` for the failure queue, the global bundle verification guard, regenerate
   `docs/generated/infrastructure`, rerun `nagRulesAtZero` (move ADR-0013's counts if the census shifts), ADR-0062.
10. Before merge (coordinator, read-only): `cdk diff` per app against prod.

Owed but not runnable here: a deployed check that sets a prod alarm's state and finds the Sentry issue. It writes to a
prod alarm, so it needs the owner's go-ahead. No k6 (not a service API).

## One-way doors

- The `Stage` dimension name on `Commise/Food` and `KitchenSink/IdentityWebhooks` (cheap now, nothing is live).
- The export `kitchensink-alarm-relay-{stage}:AlarmRelayFunctionArn`: once imported, the function cannot be replaced
  without detaching every subscriber. In-place updates are fine.
- Sentry fingerprints: changing one splits issue history.

## Cost

Food: 17 series per active stage (prod stays 17). Webhooks: about 15 per stage. $0.30 per metric-month, prorated by the
hours with data, so realistically under $3 per month. Alarms with the switch on: 38 sites, about $2.80 per month above
the free 10.

## Pattern register

Published Language (`metric-dimensions`). Observer (the SNS subscription, the topic is the seam, owned by the
service). Adapter (the relay handler). Visitor twice (the exhaustive switch over `RelayedMessage`, and the
`AlarmTransitionsRelayed` Aspect). Builder (`buildAlarmEnvelope`). Mirrored Module (`alarmRelaySubscription.ts`).
Specification (`alarmPosture.ts`) over a Repository (`everyAppSynthesis.ts`). Preserved: service-owned alarm topics,
`subscribeAlarmEmail`, the copied publish grant, the Builder in each emitter, the alarm switch as the single stage
switch. Rejected: one shared topic per stage (retargets about 40 alarm actions), Sentry's own AWS integration (none
takes alarms in), reusing `announceSilentNoOp` (its swallow rule drops alarms), OK as an event on the same fingerprint
(it reopens resolved issues).
