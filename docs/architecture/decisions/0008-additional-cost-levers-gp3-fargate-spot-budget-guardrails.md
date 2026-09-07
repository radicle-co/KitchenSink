# 0008 — Additional cost levers: gp3 storage, Fargate Spot (non-prod), and budget guardrails

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** platform
- **Related:** [0002](0002-vpc-consolidation-and-cidr-scheme.md), [0004](0004-minimize-nat-egress.md), [0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md), [0007](0007-sandbox-cost-controls.md)

## Context

ADR-0007 right-sized sandbox (RDS `small → micro`, `ENHANCED → STANDARD` insights) and added the
nightly stop/start schedule. Three further, additive levers remained — each cutting spend without
changing prod's synthesized template (ADR-0002 no-prod-diff discipline) and without a weekend
shutdown (deliberately excluded — the team works the sandbox on weekends):

1. RDS still used gp2 storage everywhere. gp3 is cheaper per GB-month and bundles a 3,000-IOPS /
   125-MiBps baseline at no extra cost.
2. All Fargate tasks ran on-demand, including disposable non-prod previews and an idempotent worker.
3. There was no account-level spend ceiling or anomaly alarm — a runaway resource or a mis-scoped
   deploy could burn budget silently.

## Decision

**1. RDS gp2 → gp3, non-prod only.** `DataStack` derives `storageType` from the stage: `prod →`
undefined (CDK default `gp2`, byte-identical → no prod diff), **non-prod → `StorageType.GP3`**. No
provisioned IOPS or throughput is set — at 100 GB gp3 uses its free baseline, so CDK emits neither
`Iops` nor `StorageThroughput`. Flipping prod to gp3 later is a safe online modify (no downtime), but
is **deliberately deferred** to preserve the prod-no-diff proof on this change; do it in its own PR.

**2. Fargate Spot for non-prod tasks.** Every ECS service and scheduled task in the repository derives
its capacity strategy from `stage` — stated as a rule rather than a roster, because a copy of a list cannot
detect that the list grew (the ADR-0003 / ADR-0004 lesson). The rule reads:
`prod →` on-demand `FARGATE` (unchanged → no prod diff), **non-prod → `FARGATE_SPOT`** (weight 1).
Non-prod is interruption-tolerant: previews are disposable and the fetch worker is idempotent (an
interrupted lease expires and the `fetch_queue` row re-leases, so a Spot reclaim only delays, never
drops, a fetch). The gating is on `stage`, not `baseStage`, so a `pr-{N}` preview runs Spot even
though it imports the sandbox platform (ADR-0006). Each cluster advertises the `FARGATE_SPOT`
capacity provider (`enableFargateCapacityProviders`) only for non-prod, so no
`ClusterCapacityProviderAssociations` resource is added to the prod template.

**3. Account-wide cost guardrails (new additive stack).** A standalone `CostGuardrailsStack` (name
`kitchensink-cost-guardrails`, tagged `Environment=global`) is created **once**, guarded to
`stage === 'prod'` in `packages/infra/global/bin/app.ts` — it is account-scoped, not
prod-service-scoped, so creating it per stage would register duplicate budgets. It is **not** a child
of `GlobalStack`; it is its own top-level stack, so its appearance is purely additive and diffs no
existing stack. It provisions:

- an SNS topic whose alert recipient is supplied per-account via the `costAlertEmail` CDK context /
  `COST_ALERT_EMAIL` env (wired through the `alertEmail` stack prop) — **never** hardcoded, so no
  address is committed into the template; when unset, the topic is still created (budget/anomaly
  publishers intact) but carries **no** email subscription;
- a **MONTHLY COST** budget, limit **$300 USD**, notifying the topic at **80% ACTUAL** and
  **100% FORECASTED**;
- a `CfnAnomalyMonitor` (`DIMENSIONAL`, dimension `SERVICE`) + `CfnAnomalySubscription`
  (`IMMEDIATE`, ~**$20** absolute-impact threshold) notifying the same topic.

The limits/thresholds are documented tunable constants at the top of the stack file; the alert email
is **not** a constant — it is injected per-account (context/env → `alertEmail` prop), so forks and
other accounts configure their own recipient and no PII lands in the code or the synthesized template.

## Consequences

- **gp3**: ~20% cheaper storage on the sandbox instance, with a headroom IOPS baseline for free.
- **Fargate Spot**: 60–70% off the per-task compute rate for all non-prod ECS (sandbox + every open
  per-PR preview), on top of the ADR-0007 nightly shutdown. The trade-off is occasional Spot reclaims
  — acceptable for previews and an idempotent worker, never applied to prod.
- **Guardrails**: a hard-to-miss email if month-to-date spend crosses 80% of $300, if month-end is
  forecast to exceed $300, or if any single service's cost anomaly impact clears ~$20.
- **No prod diff**: every existing prod stack (global network/data/domain/alb + identity + food)
  synthesizes byte-identical; the only prod-synth change is the new `kitchensink-cost-guardrails`
  stack appearing. Proven by a before/after synth diff.

## Notes / wrinkles

- **CfnBudget subscriber shape.** An SNS-topic-ARN subscriber (`SubscriptionType: 'SNS'`) is used for
  clean fan-out. AWS Budgets publishes on the account's behalf, so the SNS **topic policy must grant
  `budgets.amazonaws.com` `sns:Publish`**, and the budget depends on that policy.
- **Anomaly `IMMEDIATE` requires SNS.** Cost Anomaly Detection only delivers `IMMEDIATE` alerts over
  SNS (email is `DAILY`/`WEEKLY`), so the same topic is used and the policy also grants
  `costalerts.amazonaws.com` `sns:Publish`. The subscription depends on that policy.
- **Fargate Spot on the scheduled RunTask.** The L2 `EcsTask` EventBridge target (CDK 2.254) exposes
  only `launchType`, not a capacity-provider strategy. For non-prod the strategy is injected on the
  synthesized rule via an escape hatch (delete `Targets.0.EcsParameters.LaunchType`, set
  `CapacityProviderStrategy`) since the two are mutually exclusive in `EcsParameters`. Guarded to
  non-prod, so prod keeps `LaunchType: FARGATE`.
