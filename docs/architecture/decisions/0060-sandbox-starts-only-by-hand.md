# 0060 — The sandbox starts only by hand, and its scheduled jobs follow its state

- **Status**: Accepted
- **Date**: 2026-10-12
- **Drivers**: Owner rulings of 2026-10-12, recorded in `docs/plans/2026-10-12-001-fix-sandbox-manual-start-plan.md`.
  Verbatim: _"no automatic or scheduled tasks or jobs except for the single one to check if the sandbox is running at
  midnight and bringing every single sandbox down. There should not be a wake of CI push. I never authorized that."_
  And: _"The queue checks, sweeps, and reconciliations should only be enabled when the sandbox is up for that PR."_
- **Supersedes**: the START half of [ADR-0007](0007-sandbox-cost-controls.md) §2 (the 09:00 schedule), and
  [ADR-0028](0028-on-demand-sandbox.md) §5 together with its amendment that restored the 09:00 start.
- **Relates to**: [ADR-0005](0005-environment-tagging-and-pr-cleanup.md) (teardown scope),
  [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md) (the preview deploy gate),
  [ADR-0032](0032-deployed-ecosystem-test-tier.md) (a down sandbox is a skip).

## Context

The plan was that the sandbox costs money only while someone uses it. It did not work that way. Reading the code
found four reasons:

1. A daily 09:00 schedule started the database and the NAT every morning, whether or not anyone pressed anything.
2. CI started it too. `sandboxWake.sh ensure` ran inside `sandboxPreview.yml`, `sandbox-identity-deploy.yml` and the
   deployed e2e tiers. So any push to any PR woke the shared tier. The status probe read only CloudFormation status.
   After the midnight stop it still answered "up". A push then deployed, and the wake in that deploy started
   everything.
3. The scheduler's `start` restored EVERY cluster it had stopped, so starting one PR brought back every preview.
4. The scheduled worker jobs (queue checks, sweepers, reconciliations, the food catalog refresh) ran on their own
   clocks, whatever the sandbox was doing. A hard-coded copy of the shutdown hours kept the queue checks quiet
   overnight. That copy is a second copy of a fact, and it can drift.

There is a fifth fact that shapes the fix: CloudFormation re-applies an `AWS::Events::Rule` `State` on every update.
A rule whose state is written by anything other than its template is reset by the next deploy.

## Decision

### 1. One automatic job: the midnight stop

`SandboxSchedulerStack` has one schedule: `stop` at 00:00 `America/New_York`. The stop first switches every
scheduled rule off. Then it stops the RDS instance, the NAT instance and every sandbox and per-PR ECS service. It
records the desired count of each service. There is no daily start. The stop also catches the automatic restart that
AWS does after an RDS instance is stopped for 7 days.

### 2. One start: Sandbox Up, for one PR

The scheduler accepts `{ action: 'start', stage: 'pr-<N>' }` and nothing else as a start. It starts the RDS
instance, the NAT, the shared identity service and only the services of that PR. The scheduler refuses a start with
no PR token. Before this decision, such a start meant "start everything". Only `sandboxUp.yml` sends a start. It
sends it through `.github/scripts/sandboxScheduler.sh`, the one invoker. That script knows that `aws lambda invoke`
exits 0 when the function threw.

### 3. Nothing else starts anything

`sandboxWake.sh` loses `ensure`. Its `check` finds the database and the NAT, waits a limited time while they start,
and answers: 0 up, 3 down (or inside the pre-midnight headroom), 1 error. It never starts anything. A job that needs
the sandbox SKIPS when the sandbox is down. It never fails for that reason. `sandboxStatus.sh` answers through
`check`, so a stopped database reads as down. Its old `fail` outcome is gone.

### 4. Scheduled rules follow the sandbox

Outside prod, every `AWS::Events::Rule` with a `ScheduleExpression` synthesizes `State: DISABLED`. It also carries
a `SandboxStage` tag with the name of its stage. Event-pattern rules do not change. Prod gets nothing, so its
templates do not change. The gate is a CDK Aspect. Each stack that owns a scheduled rule applies it. The code is
`scheduledRuleGate.ts`, with one mirrored copy per app. It is not in `@radicle-co/infra-shared`, because the apps use
a pinned, published version of that package, and only a commit moves the pin.

The scheduler's `sync` is the ONLY writer of rule state. It decides each rule with one pure function,
`desiredRuleStates`:

| stage tag | ENABLED when                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| `pr-<N>`  | the RDS instance is available, the NAT is running, and that PR has a service up |
| `sandbox` | the RDS instance is available, the NAT is running, and at least one PR is up    |

The scheduler refuses a rule tagged or named for production. It also refuses a rule whose stage tag names no known
stage. It never writes a refused rule. `sync` runs at these times: at the end of Sandbox Up, first in the stop, in
Sandbox Down, on PR close, and after every non-prod deploy of a stack that owns a scheduled rule. In the stop, the
rules are decided against the tier the stop is about to produce, not the tier that is still running.

The tag sets the scope of the IAM grant. `events:EnableRule` and `events:DisableRule` act on the
`rule-on-default-event-bus` resource type. The condition keys of that type include `aws:ResourceTag/${TagKey}`. The
source is the AWS Service Authorization Reference for `events`, read on 2026-10-12 in its machine-readable form. So
the grant allows only rules tagged `SandboxStage` = `sandbox` or `pr-*`, in the `kitchensink-*` name space. An
explicit Deny refuses any rule tagged `Environment=production`. Discovery uses the EventBridge calls `ListRules` and
`ListTagsForResource`. It does not use the tagging API, because the index of that API can be behind a rule that a
deploy made seconds earlier.

### 5. The clock goes

`isAwake`, `NIGHTLY_START_HOUR` and every clock gate in the queue checks are deleted. The scheduler switches off a job
that must not run while the sandbox is down. The job does not look at the time. The stop hour and its time zone are in
one place, beside the scheduler.

### 6. Sandbox Up runs everything itself

It is one job graph: start, wait for `check`, call `sandbox-identity-deploy.yml`, call `sandboxPreview.yml` (with
`forced: true`) and `previewDomain.yml`, verify, `sync`. It never calls `sandbox-deploy.yml`, which the owner disabled.
It refuses a press inside the pre-midnight headroom.

### 7. Two crons

Only `cachePrune.yml` and `codeql.yml` keep a `schedule:`. Every sandbox and test cron is removed. The reaper, the
reconciler and the abandoned-preview sweep (`sandboxReapClosed.yml`) run by hand.

### 8. PR close deletes that PR's sandbox

`sandboxCleanup.yml` runs on `pull_request: closed`. It runs `teardownSandboxPr.sh` for that PR, then `sync`. It
never touches the shared identity service, the ALB or the database instance.

### 9. The last preview takes the shared tier with it

After its teardown and `sync`, Sandbox Down runs `sandboxSharedTier.sh release-if-idle`. That verb deletes the
identity service, its schema stack and the ALB when two things are true. First, no `pr-<N>` stack exists, in any
state except deleted. Second, no workflow that can stand a preview up is queued or running. It never deletes the
database, the network or the webhooks. When it cannot get an answer, it keeps the tier. The manual reconciler runs
the same verb, so "idle" has one definition.

### 10. A database drop that cannot run now is owed, not forgotten

The reaper that drops a PR's logical databases runs against the shared database, which is usually stopped when a PR
closes. The teardown does not start it. It records the drop as OWED, in SSM under
`/kitchensink/sandbox/owed-per-pr-database-drops/`, and goes on to delete the stacks. Sandbox Up pays every owed drop
before it deploys anything, and Sandbox Down pays them when the sandbox is up. A PR that owns a stack again keeps its
debt until its own teardown. The ledger is written only by a teardown that chose to destroy that PR, so it is not the
"orphaned-looking sweep" ADR-0005 forbids. `.github/scripts/perPrDatabaseDrop.sh` is the one place that invokes the
reaper, for the teardown and for the drain.

### 11. Queued work is parked, not lost

A worker that cannot reach its database fails each delivery and spends a receive. The sandbox used to be down for
nine hours. It can now be down for days, so no receive budget outlasts the outage. The rule is now that such a
message reaches its DLQ well before its own queue would delete it, and that the DLQ keeps it longer. The queue check
reports each DLQ when the stage is up again. The nine-hour budget is kept, so no template changes.

## Alternatives rejected

- **Keep the 09:00 start.** It brought the database and NAT up every day for nobody. The owner ruled it out.
- **Keep the CI wake, but narrower.** Any automatic wake is a start that nobody authorized.
- **Let the template of each rule decide its state.** A redeploy resets what the scheduler set. The state then
  depends on which happened last. A rule that synthesizes DISABLED lets a deploy only switch a job off, and `sync`
  puts it back.
- **Set the IAM scope by rule name only.** CloudFormation cuts generated rule names short. In
  `kitchensink-recipe-worker-QueueCheckSchedule…` the stage is gone. So a name cannot carry the boundary. The tag
  carries it. The name prefix is a second layer only.
- **Put the Aspect in `@radicle-co/infra-shared`.** The apps pin a published version. The pipeline does not change
  the pin (owner ruling). So a new export cannot reach the apps in the change that adds it.

## Consequences

- On a day when nobody presses Sandbox Up, the sandbox costs nothing except the resources that cannot stop.
- A press has a cold start. The database takes a few minutes to become available, and Sandbox Up waits for it.
- Queue checks and sweepers run only while their stage is up. Overnight and on idle days, nothing reports on the
  sandbox queues. This is by design. The owner must delete the Sentry cron monitors that expect sandbox check-ins.
- Sandbox Up publishes the preview address of a PR. A later push to the PR does not move the alias to the new
  Vercel deployment. The alias moves when someone presses Sandbox Up again.
- Nothing retries a failed PR-close teardown by itself. The midnight stop still scales the ECS of a leaked preview
  to zero. So a leak costs idle resources, not compute.

## Residual risk

- **The first Sandbox Up after this change meets the OLD scheduler.** The old `start` ignores the stage and restores
  every cluster, one time. Sandbox Up deploys the global app, which holds the new scheduler, in its identity step.
  That step comes before any `sync`. So every `sync` from Sandbox Up reaches the new function.
- **A preview deployed before this change has ENABLED rules with no stage tag** until its next deploy. The stop
  cannot see them. On every run, `sync` warns about a serving PR with no tagged rule, until a deploy tags them.
- **`sync` fails a deploy when the scheduler is absent.** This is deliberate. The alternative is that every job is
  off and nothing says so. The cost is that every non-prod deploy of an app with a scheduled rule depends on the
  scheduler.
- **A parked message expires when its stage stays down longer than its DLQ keeps it** (7 to 14 days). No alarm
  fires: alarms are off at every non-prod stage, and the recipe parse-stall alarm (`BREACHING` on missing data)
  would page all night if they were switched on, because the band drain it reads is disabled while the stage is
  down.
- **Guards.** `SandboxSchedulerStack.test.ts` checks the one schedule, the tag-scoped grant and the Deny.
  `scheduler.test.ts` checks the truth table, that the stop disables rules before it stops anything, and the per-PR
  start. `nonProdScheduledRules.test.ts` checks that every stack with a scheduled rule applies the gate.
  `scheduledRuleSyncWiring.test.ts` checks that a `sync` follows every non-prod deploy of such an app.
  `sandboxWakeWiring.test.ts` checks that only Sandbox Up starts the sandbox. `sandboxSharedTierRelease.integration.test.ts`
  runs the idle rule, and `perPrDatabaseDrop.integration.test.ts` runs the owed-drop ledger.
