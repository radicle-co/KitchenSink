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
