# 0007 — Sandbox cost controls: right-sizing + scheduled nightly shutdown

- Status: Accepted
- Date: 2026-07-01
- Deciders: platform
- Related: [0002](0002-vpc-consolidation-and-cidr-scheme.md), [0003](0003-shared-alb-per-stage.md), [0004](0004-minimize-nat-egress.md), [0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md)

## Context

Running two complete persistent environments (`prod` + `sandbox`) costs ~$170/mo (June actual),
forecast ~$210/mo at full-month steady state. The `sandbox` stage is non-production and unused
overnight, yet it carries its own RDS, ALB, NAT instance, and Fargate services 24/7. June drivers:
RDS $56 (2× `db.t4g.small`), networking $55 (NAT instances + public IPv4 + transfer), ECS $21,
ALB $18, CloudWatch $11. Both ECS clusters run **ENHANCED** Container Insights, which is priced
well above the STANDARD tier.

Sandbox does not need production sizing, production observability depth, or 24/7 uptime.

## Decision

**1. Right-size sandbox (per-stage, prod unchanged → no prod diff).**

- RDS instance class is stage-derived: `prod → db.t4g.small` (unchanged), **non-prod → `db.t4g.micro`**.
- Container Insights is stage-derived: `prod → ENHANCED` (unchanged), **non-prod → STANDARD**, in
  both `identity-service-stack` and `food-service-stack`.

**2. Scheduled nightly shutdown of sandbox (America/New_York).** A `SandboxSchedulerStack`
(created by `GlobalStack` **only when `stage === 'sandbox'`**) provisions an EventBridge Scheduler
pair — **stop at 00:00 ET, start at 09:00 ET, daily**, `timezone: America/New_York` (DST-correct) —
targeting a small Lambda that, scoped to sandbox resources by name/tag:

> ⚠️ The 09:00 start was DELETED by [ADR-0028](0028-on-demand-sandbox.md) §5 (2026-08-27) and **RESTORED**
> by its Update of 2026-09-03, so this pair is again what ships. Read that Update before removing it a
> second time: §5's premise — that a start would resurrect the whole tier — expired when ADR-0028's own
> 2026-08-30 amendment made the ALB and identity service _deleted stacks_, which a schedule cannot recreate.

- stops / starts the sandbox RDS instance (`rds:StopDBInstance` / `StartDBInstance`);
- scales sandbox ECS services to `0` and back to their prior desired count (`ecs:UpdateService`);
- stops / starts the sandbox NAT EC2 instance (`ec2:StopInstances` / `StartInstances`).

Prod is never targeted (the Lambda selects only `*-sandbox*` resources). The Lambda holds
least-privilege IAM scoped to those actions.

**What is NOT scheduled off:** the shared ALB (no stop primitive; delete/recreate churns DNS + the
listener imports and is not worth ~7h/night). It remains the residual sandbox cost.

**"Idle" scope.** The nightly window is the concrete idle mechanism; the stoppable resources are
RDS, ECS, and the NAT instance. Finer traffic-based scale-to-zero (e.g. ECS autoscaling on request
count) is deferred — it adds cold-start latency to every first request and is not worth it for a
preview tier the schedule already covers. **Weekends are deliberately left ON** (the team works the
sandbox on weekends); only the nightly 00:00–09:00 ET window is shut down.

## Consequences

- Sandbox compute is off ~9h/day (~37.5%). Combined with the `small → micro` RDS downsize and
  `ENHANCED → STANDARD` insights, estimated savings ≈ **$25–35/mo** now, plus it caps the cost the
  food service adds when it deploys (its cluster inherits STANDARD insights in non-prod).
- **Cold start each morning**: the sandbox RDS takes a few minutes to become available at 09:00 ET,
  and ECS tasks restart — sandbox is briefly unavailable before 09:00 and during startup. Acceptable
  for a preview tier; documented so a 3am sandbox check isn't mistaken for an outage.
- A stopped RDS instance auto-restarts after 7 days (AWS behaviour); the nightly start makes this
  moot, and if the schedule is ever disabled, the instance self-recovers.
- Per-stage divergence keeps the **prod synthesized template unchanged** (ADR-0002 discipline): prod
  keeps `small` + `ENHANCED` and gets no scheduler.
- Downsizing an existing sandbox RDS to `micro` is a modify with brief downtime; applied during a
  deliberate sandbox deploy, not silently.

## Update (2026-08-23) — the deploy-time wake gate now wakes the NAT too

The nightly window composes with **ADR-0022** (schema migrations run INSIDE the deploy, as an in-stack
`aws-cdk-lib/triggers` Trigger) to produce a failure neither ADR predicted: a sandbox deploy that lands
inside the window runs against stopped infrastructure. `.github/scripts/sandbox-wake.sh` closes that, and
every sandbox deploy step is asserted to be preceded by it
(`packages/infra/global/__tests__/sandboxWakeWiring.test.ts`).

It was written to wake only the **database**, and its own header said it "never touches ECS or the NAT
instance". That was wrong about the NAT, and the gap took a second incident to surface, because the first
symptom looked identical to the one already fixed:

```
Result: {"errorType":"TimeoutError","trace":["AggregateError [ETIMEDOUT]:","at internalConnectMultiple"]}
```

Measured on the live account at the time of failure — the database was `available` (the gate had done its
job, and the RDS event log records `DB instance started` at 04:13Z), `i-0b126b357d15b35fd`
(`Global-sandbox/…/NatInstance`) was `stopped`, and `describe-vpc-endpoints` on the sandbox VPC returned
**nothing**. Per **ADR-0004** the sandbox VPC deliberately carries no interface endpoints, so every
VPC-attached Lambda reaches Secrets Manager, SQS and the Clerk API through that one `t4g.nano`. The
migration runner resolves `DB_SECRET_ARN` before it opens a connection, so it died in Secrets Manager and
never reached Postgres.

⚠️ **The tell is what the trace does NOT contain.** The original incident named `10.1.4.241:5432`; this one
names no address at all, because the failure is upstream of the database. A wake gate that only ever looks
at RDS reports success and the deploy still fails.

The same window also explains the web E2E failures that ran beside it: the Clerk webhook Lambda backfills
`externalId` by calling `clerk.users.updateUser`, which leaves through the same NAT, so
`waitForTestUserExternalId` timed out on every shard. One stopped instance, three red jobs.

`ensure` now wakes **both**, and reports both in one run rather than failing at the first — a deploy needs
the database _and_ the NAT, and stopping at the first verdict costs the operator a second round trip. The
script is renamed `sandbox-wake.sh` because "db-wake" is no longer what it does. ECS stays out of scope on
purpose: a sandbox deploy deploys its own service, and CDK restores the desired count as part of that.

Verified end to end rather than reasoned about: the gate discovered and started the sandbox NAT (and only
it), and the identity migration runner — which had returned `TimeoutError` minutes earlier — returned
`FunctionError: None` with 9 migrations validated on the first invocation after the instance reached
`running`. No warm-up delay was needed, which is why the gate stops at `running` and adds no sleep.

**Residual risk.** The CI credentials must carry `ec2:DescribeInstances` and `ec2:StartInstances`; they
deploy the VPC that owns the NAT, so they do today, but a future least-privilege pass on those keys must
keep them. The failure mode is loud (an `::error::` naming the instance), not silent.

---

## Update (2026-08-27) — the prod exemption became the cost, and is withdrawn

**This ADR's Decision §1 said Container Insights is `prod → ENHANCED` (unchanged), non-prod → STANDARD.
The prod half is now withdrawn: NO stage runs ENHANCED.**

The exemption was written for a good reason — keep the prod synthesized template diff-free (ADR-0002
discipline). But it exempted the half where the cost actually lived, and this ADR's own Context already
names the tier as "priced well above the STANDARD tier" while leaving prod on it. Fourteen months of
service growth later, that is the single largest line on the bill.

**Measured 2026-08-27** (Cost Explorer + `cloudwatch list-metrics`, us-east-1):

|               | June 2026 | July 2026 | Aug 1–27    |
| ------------- | --------- | --------- | ----------- |
| CloudWatch    | $11.33    | $41.26    | **$155.30** |
| account total | $26.79    | $243.52   | $483.61     |

**94% of the August CloudWatch spend ($146.50) is custom-metric storage, not logs.** Log ingestion sits
inside the free tier; deleting log groups saves approximately nothing. The two billed operations are
`MetricStorage:AWS/Logs-EMF` ($116.61) and `MetricStorage:CI-ECS` ($29.89) — both Container Insights,
which on ECS Fargate publishes through EMF into `/aws/ecs/containerinsights/<cluster>/performance`.

**Why ENHANCED specifically.** It adds `TaskId` and `ContainerName` dimensions. `TaskId` is **unbounded
cardinality**: each task launch mints ~23 brand-new billable custom metrics that never merge with the ones
the previous task created. Of 2,526 live `ECS/ContainerInsights` series, **2,048 (81%) existed only because
the three prod clusters were ENHANCED**:

| cluster                       | tier     | survives as STANDARD | added by ENHANCED |
| ----------------------------- | -------- | -------------------- | ----------------- |
| `food-service-prod`           | ENHANCED | 102                  | **1,812**         |
| `identity-service-prod`       | ENHANCED | 58                   | 118               |
| `recipe-service-prod`         | ENHANCED | 58                   | 118               |
| `pr-91`, `pr-92` (4 clusters) | STANDARD | 222                  | 0                 |

`food-service-prod` alone is 88% of the waste, and the mechanism is this ADR's blind spot rather than
traffic: **`FoodChangeRefresh` runs on `rate(6 hours)`, so 56 of the 70 task IDs observed in a two-week
window came from one scheduled batch job** whose per-task metrics nobody reads. A tier priced per metric
series meets a workload that mints a new series four times a day.

### Decision

1. **Container Insights is `pr-{N}` → DISABLED, every named stage (prod included) → STANDARD.** ENHANCED
   is no longer reachable from any stage.
2. **The tier decision lives in ONE place** — `containerInsightsForStage`
   (`packages/infra/security/src/containerInsights.ts`) — not a ternary repeated in three stacks.

**Why `pr-{N}` drops to nothing rather than STANDARD.** A preview is observed by its CI smoke test and by a
human reading the PR; neither queries ECS cluster metrics. STANDARD still costs ~111 series per open PR
(food + recipe). On 2026-08-02 seven PRs (77–83) spun up fourteen clusters within nine hours and took daily
CloudWatch spend from $1.75 to $13.07 until they were torn down on Aug 11 — visible as a discrete step in
the daily series, and the reason the $155 August figure overstates the steady state.

**Why one resolver.** "Which observability tier does stage X get" is one piece of knowledge with one reason
to change, and it was spelled out identically in three CDK stacks — the third occurrence with a proven
shared reason to change, which is the bar CLAUDE.md sets for extracting. It was also already drifting in the
way ADR-0003's priority tables drifted: `recipe-service` carried the same ternary with **no test asserting
it at all**, while food and identity both had one. A copy of a rule cannot detect that the rule moved.

**Why ENHANCED is unreachable rather than flag-guarded.** A knob no caller sets is a presumptive feature
(YAGNI). Re-enabling the tier for a debugging session is a one-line edit; leaving a ~$100/mo default one
typo away is not cheap.

### Consequences

- Expected saving **~$101/mo** (81% of the $124/mo current run-rate), taking CloudWatch to roughly $23/mo.
  This is a **series-proportional estimate**: custom metrics are prorated hourly, so short-lived `TaskId`
  metrics cost less per series than continuously-running ones and the realised figure will land somewhat
  lower. Direction and magnitude are solid; the exact number is not asserted.
- **The prod template now DIFFS** — deliberately, reversing this ADR's original no-prod-diff stance for this
  one property. `ClusterSettings` is an in-place update on `AWS::ECS::Cluster`; no cluster is replaced and no
  task is restarted by the change itself.
- **Per-task and per-container metrics are lost on prod.** Cluster- and service-level metrics remain. This is
  the accepted trade: nothing in this repo alarms or dashboards on `TaskId`, verified before the change.
- **Existing `TaskId` series cannot be deleted** — CloudWatch exposes no delete-metric API; they stop
  receiving data, stop billing (prorated), and age out after 15 months. The saving appears as the emitters
  stop, not as a cleanup.
- **PR previews lose ECS cluster metrics entirely.** A preview debugged via cluster CPU/memory now needs the
  service logs instead, or a one-line temporary flip.

**Residual risk.** Nothing here addresses the other two growth lines — ECS ($21 → $40 → $119) and VPC
($16 → $41 → $74) — which together still exceed the `kitchensink-monthly-cost` $300 budget (August actual
$483.61, forecast $560.84). This change recovers ~$101/mo of a ~$260/mo overage.

## Update (2026-08-30) — the residual was ALL prod, nothing reads it, and the tier becomes a constant

The 2026-08-27 amendment took prod from ENHANCED to STANDARD and disabled `pr-{N}` entirely. It worked:
CloudWatch fell from ~$13.07/day (10 Aug) to ~$4.15/day (11 Aug onward), then to ~$1.58/day once ADR-0028's
reaper removed the per-PR clusters.

**What that left is the finding.** Of the ~136 still-billable `ECS/ContainerInsights` series, measured on
2026-08-30, **every one was a prod cluster** — an idle sandbox cluster returned **zero** datapoints over 24
hours and was billing nothing. So the whole $40.80/month residual (136 × $0.30) sat in the half this ADR had
twice declined to touch, for the second time.

### Decision

**Container Insights is DISABLED on every ECS cluster, in every stage.** `containerInsightsForStage(stage)`
collapses to the constant `CONTAINER_INSIGHTS_TIER` in `@kitchensink/infra-security`.

⛔ **The reason is not "prod is unobserved" — that would be a bad reason and it is not this one.** It is that
**nothing anywhere consumes the namespace**, verified before the change rather than assumed:

| Consumer checked                                            | Reads                                         |
| ----------------------------------------------------------- | --------------------------------------------- |
| Every ECS alarm + both target-tracking autoscaling policies | `AWS/ECS` `CPUUtilization` (free tier)        |
| ALB 5xx + crash-loop alarms                                 | `AWS/ApplicationELB`                          |
| The one CloudWatch dashboard (`food-data`)                  | neither namespace                             |
| Repository source                                           | no query anywhere; only ADR prose mentions it |

That reason does not vary by stage, which is why the **stage parameter was removed rather than defaulted**. A
function that ignores its argument still advertises a decision it is no longer making, and the next reader
has to run the experiment to discover that.

### Consequences

- **Realised saving ~$40.80/month**, applied live via `aws ecs update-cluster-settings` on all four clusters
  the same day, so the CDK change and reality are already in sync — this needs no prod deploy to take effect,
  which matters because prod's stacks are hundreds of commits behind this branch (ADR-0022 migration
  Triggers). Verified after the flip: `identity.commise.app/health` → 200, all five prod tasks still running.
- **Lost:** per-service network/storage/task-count series and the Container Insights console view.
  **Not lost:** alarms, autoscaling, deploy health — none of which ever read this namespace.
- ⚠️ **`AwsSolutions-ECS4` now reports on every cluster.** The finding is ACCURATE and is deliberately left
  **REPORTING, not suppressed**: a cdk-nag suppression writes `Metadata.cdk_nag.rules_to_suppress` into the
  CloudFormation resource (ADR-0013), and prod template stability is what ADR-0002 and ADR-0008 stake data
  safety on. Same posture as ADR-0025's `AwsSolutions-L1`.
- Re-enabling for a debugging session is a one-line edit to one constant — which is the point of it living in
  one place.

**Residual risk.** The three prod clusters keep publishing `AWS/ECS` service metrics, so a regression in
autoscaling or alarms would still be visible; a regression in per-service _network or storage_ behaviour now
would not be, and would have to be found in logs. Nothing today alarms on either, so this removes no signal
anyone is watching — but it does remove one nobody has needed **yet**.
