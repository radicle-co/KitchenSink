# 0062 — Custom metrics are scoped by Stage, and every alarm reaches Sentry through one relay per base stage

- **Status:** Accepted
- **Date:** 2026-10-13
- **Relates to:** [ADR-0042](0042-log-drain-coverage.md) — the relay's log group is registered and drained under key
  `alarm-relay`, and the relay's ARN travels by export where that ADR's forwarder could not. [ADR-0004](0004-minimize-nat-egress.md)
  — the relay is deliberately outside the VPC, so the NAT consumer list is unchanged. [ADR-0013](0013-cdk-nag-advisory-iac-security-linting.md)
  — the relay adds one stack to the census it asserts. [ADR-0060](0060-sandbox-starts-only-by-hand.md) — the alarm switch
  stays the single per-stage switch.

## Context

Two facts were true at once, and each hid the other.

**The metrics were shared.** The `Commise/Food` namespace was published dimensionless, so one series was written by
production and by every `pr-{N}` food worker. Production's tombstone alarm read it, and went ALARM each morning when the
sandbox workers started and OK when the sandbox stopped: it was reporting the previews, not production. The identity
webhooks' emitter listed `service` and `metric` and no stage, so a sandbox Lambda and a production Lambda shared a series
too. recipe-workers and recipe-service already dimensioned by `Stage`, but spelled the name three different ways in three
files, and food's remote-search metrics wrote a lowercase `stage` — a different dimension, and a different, silent series.

**The alarms reached nobody.** No alarm topic in the repository had a subscriber that a team reads. A topic delivers to an
email address someone configured, or to nothing. Sentry is where this team reads production, and Sentry has no integration
that ingests an SNS topic or a CloudWatch alarm.

Two further defects surfaced while reading the code, and both would have defeated the design had they been left:

- The webhooks emitter wrote its facet dimensions and its metric value under a nested `dimensions` key instead of at the
  top level of the line. CloudWatch extracts a metric only when its name, and each dimension key, is a top-level member of
  the line, so those metrics never produced a datapoint under any dimension set.
- `LogForwarderFailureAlarm` selected `{service, metric}`, but the forwarder only ever emits `LogForwarderFailure` with a
  `reason`. The series the alarm watched did not exist.

## Decision

**1. Every custom-namespace metric carries the dimension `Stage`, and every alarm and dashboard on one selects
`Stage=<its stage>`.** The name, the way a runtime learns its stage and the map an alarm selects with are one piece of
knowledge with an emitter end and an infrastructure end, so they live once in `@kitchensink/metric-dimensions`: a CDK-free
package, because a Lambda bundle or a pruned service image must not acquire `aws-cdk-lib` to spell a dimension. It publishes
the name and nothing else. The EMF envelope stays with each emitter, because the namespace and metric names are an alarm
contract that differs per metric. A runtime with no `STAGE` still emits, under `unknown`: CloudWatch discards a record whose
directive names a dimension the line does not carry, and a dropped metric is the worse failure.

The stage is a dimension and not a facet. Food's recorder takes it as a required constructor argument and its facet type is
closed over `source` and `reason`, so a caller can neither omit it nor displace it. Food's dashboard SEARCH expressions
filter on the quoted value, because declaring `Stage` as a schema key alone still matches every stage's series.

**2. One `AlarmRelay` Lambda per base stage, in a persistent global stack `kitchensink-alarm-relay-{stage}`.** Every alarm
topic, in every app, subscribes it when its stack's alarm switch is on. The topic stays owned by the service that raises the
alarm; the relay is the Observer and the topic is the seam. A mirrored module, `alarmRelaySubscription.ts`, does the
subscribing: one invoke permission per topic with its `SourceArn` set to that topic, and an Aspect that makes every alarm's
`OKActions` equal its `AlarmActions`. It is mirrored for the reason `scheduledRuleGate.ts` is: its natural home,
`@radicle-co/infra-shared`, is consumed at a pinned published version only a commit may move, so a new export there cannot
reach the apps in the change that adds it. `mirroredModuleParity.test.ts` holds the copies identical.

**3. What the relay does with a delivery.** An ALARM, an ECS task event and a message nobody planned for each become a
Sentry issue with `level: error` and `environment` set to the stage. An OK becomes one structured log line on the drained
log group and nothing else. A relay that cannot reach Sentry throws.

- _Fingerprints are built from names, never from text._ `['cloudwatch-alarm', stage, AlarmName]`,
  `['ecs-task-failed-to-start', stage, group]`, `['alarm-topic-unrecognised', stage, topicName]`. The text carries datapoint
  values and changes on every transition. Changing a fingerprint splits issue history, so each is pinned exactly by test.
- _An unreadable message is reported, not dropped._ The parser is total: bad JSON and a known shape with a missing field are
  both `unrecognised`, and an alarm channel that throws on a message it does not understand goes quiet on the day it has
  something new to say.
- _Throwing is the delivery guarantee._ Lambda retries an asynchronous invocation twice and then discards the event unless a
  failure destination keeps it. The destination is an SQS queue, behind SSL, kept 14 days, whose depth is alarmed. The
  silent-no-op reporter is deliberately not reused: it swallows a failed report because a failed report must not fail a
  deploy, and here the same behaviour would lose the only notice of a production fault. Both share one `postEnvelope`, which
  answers true only for a 2xx and never throws, so each caller owns the policy.
- _The relay's own alarm has a second route._ When Sentry is the thing that is down, the relay cannot report that it is
  down. The failure-queue alarm therefore publishes to a topic with an email subscription as well as the relay.

**4. The relay is imported by export, not resolved in CI.** ADR-0042 had to pass the log forwarder's ARN as a CI-resolved
input because the forwarder lives in the webhooks app, which the global app imports from: an export in that direction was a
cycle that failed every global deploy. The relay is the opposite case. It lives in the global app and every consumer is
downstream of it, so there is no cycle and an `Fn.importValue` is correct. Its name is
`kitchensink-alarm-relay-{prod|sandbox}:AlarmRelayFunctionArn`; every `pr-{N}` preview imports the sandbox relay, exactly as
it imports the sandbox platform. The deploy-edge manifest reads the mirrored helper as that import, so the deploy gate sees
the dependency of each service on the global app.

**5. The proof is read off the synthesized templates of every app at production with the alarms on, not off source.**
`prodAlarmPosture.integration.test.ts` synthesizes every CDK app at `STAGE=prod` and `ALARMS_ENABLED=true`, and asserts that
every custom-namespace alarm selects `Stage=prod`, that every alarm topic has the relay subscription and a topic-scoped
invoke permission, that `OKActions` equals `AlarmActions`, and that every handler and container of an app that links the
published language sets `STAGE`. Its first assertion requires at least as many synthesized alarms as the source declares, so
a synthesis that produced none cannot pass. The `nagRulesAtZero` environment synthesizes no alarms at all, which is why the
harness was extracted and parameterised instead of reused as it stood.

## Consequences

- **A preview can no longer page production.** Production's alarms read production's series; a preview publishes its own.
- **Food's cutover opens a blind window, never a false page.** Every food alarm whose dimensions change is `notBreaching`,
  so until the first datapoints arrive under the new dimension the alarm reports OK. Food is blind for its ECS rollout, and if
  the ECS circuit breaker rolls the image back but not the template it stays blind until the next deploy.
  `RecipeParseJobStall` already selected `Stage`.
- **The webhooks metrics get their first data, which is not a cutover.** Given the emitter defect in the Context, no webhooks
  metric ever produced a datapoint under any dimension set, so there is no window to be blind in: the alarms start receiving
  real data at the deploy that ships the emitter. That includes `WebhookSignatureRejectionAlarm`, on a public endpoint that
  receives scanner noise, whose threshold was chosen without any data and which now routes to Sentry at `error` level.
  `ErasureIncomplete` uses one-day periods and two of two, so it cannot fire for up to about two days after the deploy.
  First-time paging from these alarms is a residual risk, and their thresholds are not retuned here. The emitter defect is
  derived from the EMF specification (a metric name and each dimension key must be top-level members of the line); it was
  read from the specification and the code, not observed in the account.
- **Cost.** A custom metric bills per series per month, prorated by the hours it holds data, so the extra series per active
  stage cost little; the alarm count is the larger line, and the account is already above the free alarm tier.
- **Three one-way doors.** The `Stage` dimension name on the two namespaces (cheap to fix while nothing depends on history).
  The export name: once imported, the relay function cannot be replaced without detaching every subscriber first, though an
  in-place update is fine. The Sentry fingerprints.
- **Issues are not resolved by the relay.** Resolving needs a Sentry organisation token, which is a stored credential. The
  Sentry project's auto-resolve closes issues instead, and the OK transition remains visible as a log line.
- **A topic added without the relay fails a test.** `alarmSubscriptionWiring.test.ts` requires `relayAlarmTransitions(` beside
  every alarm topic's creation, with the account-scoped cost topic the one named exemption, and the posture test proves the
  synthesized result.
- **Residual: the account-wide cost alert topic is out of scope.** It carries budget and cost-anomaly notices, not alarms, and
  has no per-stage relay to deliver to.
- **Residual: a deployed check is owed.** Setting a production alarm's state and finding the Sentry issue writes to a
  production alarm, so it needs the owner's go-ahead and has not been run.

## Alternatives considered

- **One shared alarm topic per stage.** Rejected: it retargets every existing alarm action in every app to a new topic and
  moves topic ownership away from the service that understands the alarm. The relay subscribes the topics that exist.
- **Sentry's own AWS integration.** Rejected: none of the integrations takes an alarm or an SNS topic in.
- **Reusing `announceSilentNoOp` for the relay.** Rejected for the reason in the decision: its swallow rule drops alarms.
- **Sending an OK as an event on the same fingerprint.** Rejected: an event on a resolved issue reopens it, so every recovery
  would reopen the incident it ended.
- **Resolving issues from the relay.** Rejected: it needs an organisation token held as a credential for a convenience the
  project's auto-resolve already provides.
