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
