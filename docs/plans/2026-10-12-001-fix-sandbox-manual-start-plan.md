---
title: 'fix: the sandbox starts only by hand, and its scheduled jobs follow it'
type: fix
date: 2026-10-12
---

# The sandbox starts only by hand

## Owner rulings (2026-10-12, verbatim where quoted)

- "no automatic or scheduled tasks or jobs except for the single one to check if the sandbox is running at midnight
  and bringing every single sandbox down. There should not be a wake of CI push. I never authorized that."
- "The queue checks, sweeps, and reconciliations should only be enabled when the sandbox is up for that PR."
- The only start is the manual Sandbox Up workflow (`sandboxUp.yml`, input `pr`), for that PR.
- PR close or merge deletes that PR's sandbox (event-driven, and allowed).
- Sandbox Down for the last live PR also deletes the shared ALB and identity stacks, never the database.
- Keep the `cachePrune.yml` and `codeql.yml` crons. Remove every other sandbox or test cron.
- A job that needs the sandbox SKIPS when it is down. It never fails for that reason.
- Already done out of band: the AWS 09:00 start schedule is DISABLED. GitHub workflows `heavy-e2e.yml`,
  `recipe-loadtest.yml`, `sandbox-deploy.yml` and `sandbox-router-deploy.yml` are disabled (their crons fire from the
  stale `main`). Do not re-enable a disabled workflow. Sandbox Up must not depend on one.

## Findings (staff-architect, verified by reading the code)

1. The merge-gate stubbed-API Playwright job does not need the sandbox. `global.setup.ts` calls only
   `resolvePoolUser` (one Clerk Backend API lookup). Every `/api/v1/**` call is stubbed in the browser. Its wake step
   (`_ci.yml` ~2240) guards deleted code.
2. `sandboxStatus.sh probe` (~104-160) reads only CloudFormation status, so after the midnight stop it still answers
   "up". A push then deploys, and `sandboxPreview.yml`'s `ensure` starts the sandbox.
3. `deployedE2eTiers.yml` (~1116) calls `ensure`, against its own header ("nothing here can conjure a target").
4. Per-PR ECS is already in the nightly stop (`scheduler.ts` ~228-239, `PER_PR_ENVIRONMENT`). ADR-0010 residual 1 is
   stale.
5. `runStart` restores every cluster, so a start for one PR brings up all of them.
6. CloudFormation re-applies an `AWS::Events::Rule` `State` on any update, so a redeploy resets a rule the scheduler
   enabled.
7. Disabling `sandbox-deploy.yml` also stopped its PR-close `cleanup` job and its `preview-domain` job.

## Decisions

- **D1 Start and stop.** Delete `SandboxStartSchedule`. The midnight `stop` is the only automatic job: it first
  disables the sandbox rules (D4), then stops RDS, the NAT and every sandbox and PR ECS service. The scheduler gains a
  per-PR `start` (`{ action: 'start', stage: 'pr-N' }`): RDS, the NAT, the shared identity service and only that PR's
  services.
- **D2 Wake script.** Remove `ensure`, `db_wake_start` and `nat_wake_start` from `.github/scripts/sandboxWake.sh`. No
  script issues a start. Add `check <region>`: discover and classify RDS and the NAT, wait a bounded time while they are
  starting, keep `sandbox_wake_headroom`. Exit 0 up, 3 down or inside the pre-midnight headroom, 1 error. Never starts.
  `sandboxStatus.sh probe` calls `check`, so there is one answer to "is it up?". When down, the status is `skip`.
- **D3 Call sites.** `_ci.yml` ~2240: delete the step and rewrite the stale comments (also ~2050).
  `deployedE2eTiers.yml` ~1116: delete. `sandboxPreview.yml` ~225: use `check`. When down, no deploy, with a notice.
  `sandbox-identity-deploy.yml` ~263: use `check`. On a `pull_request` with the sandbox down, skip. `sandboxUp.yml`:
  invoke the scheduler's per-PR `start`, then `check`. Refuse a dispatch inside the pre-midnight headroom.
- **D4 Worker rules follow the sandbox.** A CDK Aspect, applied only at non-prod stages, sets every scheduled
  `AWS::Events::Rule` (`ScheduleExpression` present. Event-pattern rules untouched) to `State: DISABLED` and tags it
  with its stage (covers queueCheck, bandDrain, both erasure sweepers, reconciliation, tombstoneSweep,
  erasureReconciliation, ArchiveSweepSchedule, AnalyticsRetentionSweepSchedule, food's IngestionScheduled). Prod gets no
  Aspect. Its template is byte-identical. The scheduler gains a `sync` action, the ONLY writer of rule state, driven by
  one pure `desiredRuleStates`: a `pr-N` rule is ENABLED only when RDS is available, the NAT is running and that PR has
  an ECS service with desired count > 0. A shared `sandbox` rule is ENABLED while RDS and the NAT are up and at least one
  PR is up. `sync` runs at the end of Sandbox Up, first in `stop`, in Sandbox Down, in PR teardown, and after every
  non-prod deploy of a stack that owns scheduled rules. IAM: `events:EnableRule`/`DisableRule` scoped by an
  `aws:ResourceTag` condition (VERIFY this condition key against the EventBridge service authorization reference before
  relying on it. If unsupported, scope by rule ARN pattern), `tag:GetResources` on `*`, and a prod-name refusal first.
- **D5 The clock goes.** Delete `isAwake`, `awakeLocalHours`, `NIGHTLY_START_HOUR`, recipe-workers'
  `common/nightlyWindow.ts`, the clock gates in the three `queueCheck.ts` handlers, and the crontab branch and
  `hourField` in `monitorSchedule`. Move `NIGHTLY_STOP_HOUR` and the timezone into
  `packages/infra/global/lib/sandbox-scheduler/`. Sentry cron check-in stages become `{prod}` only.
- **D6 Sandbox Up runs everything itself.** It calls `sandboxPreview.yml` (reusable, `forced: true`),
  `sandbox-identity-deploy.yml` (gains `workflow_call`) and a new `previewDomain.yml` extracted from
  `sandbox-deploy.yml`, then the scheduler `sync`. The dispatch-and-poll loops go. It never calls `sandbox-deploy.yml`.
- **D7 Crons.** Remove the cron from `sandbox-deploy.yml`, `sandboxReap.yml` (keep dispatch),
  `sandboxReconcile.yml` (keep dispatch) and `sandbox-router-deploy.yml`. Keep `cachePrune.yml` and `codeql.yml`.
- **D8 PR close.** A new `sandboxCleanup.yml` on `pull_request: closed` runs `.github/scripts/teardownSandboxPr.sh`
  for that PR (DNS first, as today), then `sync`. Never touches the shared identity or the database.
- **D9 Last PR down.** Sandbox Down, when no other PR's services remain up, also deletes the shared ALB and identity
  service stacks (never DataStack/RDS), after `sync`. Sandbox Up already rebuilds them when missing.
- **D10 ADR.** New ADR-0060, "The sandbox starts only by hand. Its scheduled jobs follow its state", superseding the
  start half of ADR-0007 §2 and ADR-0028 §5 with its restoring amendment. In 0007, 0010 (residual 1), 0028 and 0032
  (the `fail` branch), delete the sentences that become false and point at 0060. No `Update` headings, dates or
  strike-through (adrHygiene). Add the CLAUDE.md and AGENTS.md pointers (reviewerContext guard).

## Tests to write first (red, then green)

1. `sandboxWake.test.ts`: `check` answers up, down, crossing (headroom) and error, and waits while starting. The
   script contains no `start-db-instance` or `start-instances`.
2. `sandboxWakeWiring.test.ts`, inverted: no workflow passes `ensure`. The scheduler `start` invoke appears only in
   `sandboxUp.yml`. The `_ci.yml` stubbed job and `deployedE2eTiers.yml` do not reference the script.
3. `sandboxStatus.test.ts`: stacks healthy but RDS stopped answers down. Down yields `skip`.
4. `SandboxSchedulerStack.test.ts`: exactly one schedule (stop, hour 0). IAM grants rule toggling only under the
   chosen scope.
5. `scheduler.test.ts` / `schedulerHandler.test.ts`: the `desiredRuleStates` truth table, including one PR down
   while another is up and the prod interlock. Stop disables before it stops. Per-PR start touches only that PR. A
   `sync` after a simulated redeploy reset re-enables the rules.
6. New `nonProdScheduledRules.test.ts`: synthesize every stack app at `sandbox`, `pr-7` and `prod`, discovering rules
   rather than listing them. At non-prod every scheduled rule is DISABLED and tagged. At prod nothing changes.
7. New guard: every non-prod deploy step of a stack owning scheduled rules is followed by a `sync` invoke.
8. `cronMonitor.test.ts`: sandbox does not check in. `awakeWindow.test.ts` deleted with its module.
   `WebhooksStack.test.ts`'s nightly-window block rewritten to the DISABLED-at-non-prod assertion.
9. Workflow guard: no `schedule:` in any workflow except `cachePrune.yml` and `codeql.yml`. Rewrite the reap,
   lifetime and reclamation guards this breaks, each with the ruling cited.

## Build order

1. D2, D3 and the status probe (tests 1-3). Verify by running the stubbed web suite with the sandbox stopped.
2. D1's per-PR start and D4's `sync`, IAM and Aspect (tests 4-7).
3. D5 (test 8).
4. D6, D7, D8, D9 (test 9).
5. D10.

The global/data deploy issues `ModifyDBInstance`, so it runs through Sandbox Up while the sandbox is up. Keep the
out-of-band disable of the 09:00 schedule until that deploy lands.

## After merge (owner actions)

- Delete the `*-queue-check-sandbox` Sentry cron monitors. They would report missed check-ins forever.
