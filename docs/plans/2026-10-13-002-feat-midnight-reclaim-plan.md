---
title: 'feat: the midnight stop deletes the sandbox stacks that nothing uses'
type: feat
date: 2026-10-13
---

# Midnight reclaim

## Owner ruling (2026-10-13, verbatim)

"The midnight stop should delete things if nothing else is using them."

## Decisions (coordinator, from the staff-architect blueprint)

- The stop stays as it is: rules off, RDS stop, ECS to 0, NAT stop. Then it starts a Step Functions loop that calls a
  dedicated reclaim Lambda once a minute until the reclaim is done. Cost safety comes first: a reclaim failure never
  undoes the stop.
- The reclaim deletes every `kitchensink-<app>-pr-N` stack, then the shared tier (the `sandboxSharedTier.sh` allowlist,
  in its order, one at a time) once no `pr-N` stack is left.
- It keeps the RDS instance, the network, data, domain, webhooks, scheduler, service-logs and remote-search-shared
  stacks, the shared ECR repos, the per-PR logical databases (no drop and no deferred drop), and the preview DNS record
  and Vercel binding. PR close still reclaims DNS, Vercel and the database through `teardownSandboxPr.sh`. This is why
  no Vercel token, node or Route 53 code goes into AWS.
- Per-PR queues and their parked messages are deleted with the stacks. Nothing is live, so that loses nothing.
- A failure creates a Sentry issue through `announceSilentNoOp` and the platform DSN. No dead-man monitor in this
  change.
- The record is a new ADR-0061, not an edit of ADR-0060 (README rule 2). It supersedes ADR-0060 section 9's single
  definition of idle and section 11 for per-PR stages.
- Raising the 45 min Sandbox Up headroom is a separate change.

## Facts checked (read-only, 2026-10-13)

- The stop is `scheduler.ts:603-653`, one schedule in `SandboxSchedulerStack.ts:302-317`.
- pr-91 has 7 stacks, each tagged `Environment=pr-91-sandbox`. Every stack carries `RoleARN` =
  `cdk-hnb659fds-cfn-exec-role-...`, which has AdministratorAccess. A `DeleteStack` call with no `RoleARN` uses that saved
  role and needs no `iam:PassRole`. So the reclaim role's grant (which stacks it may name) is the only boundary.
- `DeleteStack` supports `aws:ResourceTag/${TagKey}` on the stack resource. The action key is `cloudformation:RoleArn`.
- No reclaimable stack has a custom resource, provider or trigger.
- `IngredientParserStack.ts:116-119` and `RecipeWorkersStack.ts:538-541` declare named log groups with the CDK default
  RETAIN, so a rebuild after a delete fails with AlreadyExists. `RemoteSearchStack.ts:137-141` already uses DESTROY.
- The sandbox alarm topic has no subscriber. The failed-run alarm reaches nobody in sandbox.

## Ordering: stop first, then reclaim

The reclaim runs `ecsQuiesce.sh`'s proven order first (force-delete the services, stop the tasks, wait until services
are INACTIVE and tasks STOPPED). Only then does it call `DeleteStack`, so CloudFormation has nothing to drain. Deleting
before the stop will keep the tier reading up during the reclaim and re-admit CI preview deploys. If a reclaim delete
ever wedges on `NotStabilized`, move the RDS and NAT stop to the end of the state machine.

## Mechanism

1. The schedule input becomes `{ action: 'stop', scheduledTime: <aws.scheduler.scheduled-time> }`
   (`scheduler.ContextAttribute.scheduledTime()`).
2. `runStop` is unchanged, then calls `startExecution` with name `nightly-<scheduledTime with ':' replaced by '-'>`
   and input `{ iteration: 0 }`. `ExecutionAlreadyExists` is success. Any other failure goes into `errors`, so the run
   fails after RDS, ECS and NAT already stopped.
3. State machine (Standard): `Wait 60s`, then `Reclaim` (Lambda `{ kind: 'step', iteration, maxIterations: 120 }`), then
   a Choice: complete and not failed is Succeed. Complete and failed is Fail. Otherwise iteration+1, Wait 60s, Reclaim.
   A Lambda error after retries goes through a Catch to `Report` (Lambda `{ kind: 'report', error }`), then Fail. No
   execution-level timeout (a timed-out execution cannot run its Catch).
4. Each reclaim call observes, plans purely, runs the plan's actions and returns. On the last iteration with work left,
   or on `report`, it calls `announceSilentNoOp({ service: 'sandbox-reclaim', condition: 'stacks-left-behind' |
'reclaim-crashed' })`. The scheduler handler announces `nightly-stop-failed` when a `stop` run fails.

## Pure planner rules (`planReclaim(observation, iteration, max)`)

- Tier quiescent: at least one sandbox RDS instance and one sandbox NAT were found, and each is `stopping` or `stopped`.
  Finding none is an error. When the tier is not quiescent, make no new deletes, track deletes already in flight, and
  report "stood down".
- A stage owns a stack only when the name matches `^kitchensink-[a-z-]+-(pr-[0-9]+)$` AND the `Environment` tag is one
  of that token's values per `pr_scope_environment_tag_belongs`. Never touch a stack tagged `production` or named
  `-prod`. A name match with a wrong tag is left for its PR-close teardown, raises a warning, and still counts as live
  for the shared tier.
- Each stage, in order: a stack in a non-delete `*_IN_PROGRESS` state is pending. Otherwise an ACTIVE service gets
  `deleteService(force)`. Otherwise a task with desired status RUNNING gets `stopTask`. Otherwise a DRAINING service or
  a task not yet `lastStatus STOPPED` (list both desired statuses, then describe) is pending. Otherwise `deleteStack`
  (no RoleARN) for each stack not already `DELETE_IN_PROGRESS`. `DELETE_FAILED` is re-issued.
- Shared tier: kept while any live token exists, or while any `kitchensink-*` sandbox or pr stack is in a non-delete
  `*_IN_PROGRESS` state. Otherwise the first allowlist stack still present: pending if `DELETE_IN_PROGRESS`, else
  `deleteStack`. One at a time, in the mirror order.
- When there are no actions and nothing is pending, the reclaim is done.

## Reclaim role (asserted by set equality)

- Read on `*`: `cloudformation:DescribeStacks`, `rds:DescribeDBInstances`, `ec2:DescribeInstances`,
  `ecs:ListClusters`, `ecs:DescribeClusters`, `ecs:ListServices`, `ecs:DescribeServices`, `ecs:ListTasks`,
  `ecs:DescribeTasks`.
- Allow `cloudformation:DeleteStack` on `stack/kitchensink-*-pr-*/*` with `StringLike aws:ResourceTag/Environment:
pr-*`, and on the 3 exact shared-tier `stack/<name>/*` ARNs built from the TypeScript allowlist constant, with
  `StringEquals aws:ResourceTag/Environment: sandbox`.
- Allow `ecs:DeleteService` on `service/*-pr-*/*` and `ecs:StopTask` on `task/*-pr-*/*`.
- Deny `DeleteStack`, `DeleteService` and `StopTask` where `aws:ResourceTag/Environment = production`. Deny `DeleteStack`
  when `Null cloudformation:RoleArn = false`.
- No `iam:PassRole`, no Create, Update or ChangeSet action anywhere. Not VPC-attached.
- The scheduler role gains only `states:StartExecution` on the one state machine.

## Files

New:

- `packages/infra/global/lib/sandbox-scheduler/reclaim.ts`: the planner, the request parser,
  `SHARED_TIER_DELETE_ORDER`, `PER_PR_STACK_NAME`, `liveTokens`.
- `packages/infra/global/lib/sandbox-scheduler/invalidReclaimRequestError.ts`.
- `packages/infra/global/src/sandbox-scheduler/reclaimHandler.ts`.
- `packages/infra/global/src/sandbox-scheduler/awsAdapters.ts`: the RDS, EC2 and ECS adapters moved out of
  `handler.ts`, plus CloudFormation, task and SFN adapters. Keep the EventBridge client's adaptive retry.
- `docs/architecture/decisions/0061-midnight-stop-reclaims-what-nothing-uses.md`.

Modified:

- `packages/infra/global/lib/sandbox-scheduler/scheduler.ts`: the stop gains `scheduledTime?`, a new `reclaim` port,
  export `previewTokenOf`.
- `packages/infra/global/src/sandbox-scheduler/handler.ts`.
- `packages/infra/global/lib/platform/SandboxSchedulerStack.ts`: the reclaim function and its explicit drained log
  group, the state machine (logging `ALL` with `includeExecutionData: false` to an explicit log group,
  `tracingEnabled`), a `ReclaimStateMachineArn` export, `SENTRY_DSN` from the platform-dsn parameter on both functions,
  and the new schedule input.
- `packages/infra/global/src/observability/silentNoOp.ts`: widen `service` with `'sandbox-scheduler' |
'sandbox-reclaim'`.
- `packages/infra/global/esbuild.mjs`: add the entry.
- `packages/infra/global/package.json`: devDependencies `@aws-sdk/client-cloudformation` and `@aws-sdk/client-sfn` at
  `^3.935.0`.
- Log groups take `removalPolicy: stage === 'prod' ? RETAIN : DESTROY`, so the prod template does not change:
  `IngredientParserStack.ts`, `RecipeWorkersStack.ts`, `FoodServiceStack.ts` (3 groups), `RecipeServiceStack.ts`
  (1 group).
- `.github/scripts/sandboxScheduler.sh`: new verb `reclaim-status`: exit 0 idle, 3 RUNNING, 1 error. An absent export
  means idle, with a notice.
- `.github/workflows/sandboxUp.yml`: in the `start` job, after the headroom step, refuse the press while the reclaim
  is RUNNING.
- `docs/architecture/decisions/0042-log-drain-coverage.md` table and
  `packages/services/identity-webhooks/src/common/logDrainRegister.ts`: the two new log groups.
- `docs/architecture/decisions/README.md`: index row.
- `CLAUDE.md`: one sentence in the ADR-0060 bullet pointing to 0061.

## Tests (write first, see them fail, in this order)

1. `perPrLogGroupsDisposable.test.ts`: a source guard (reuse the `serviceSources.js` parser) that every `new
logs.LogGroup(` in the 7 per-PR apps states `removalPolicy`. Template assertions in the RecipeWorkers,
   IngredientParser, Food and Recipe stack tests: `pr-1` gives `Delete`, `prod` gives `Retain`.
2. `reclaim.test.ts`: a fixture table of hostile shapes (`pr-1` vs `pr-15`, `pr-091`, `-pr-91-old`, tag `pr-9-sandbox`
   on a `pr-91` name, `pr-91-sandboxx`, `production`, `-prod`, names from another application, the shared names, data,
   network, webhooks), the quiesce order, the stand-down when the tier is up, an unobservable tier, busy stages,
   `DELETE_FAILED` re-issue, shared-tier order one at a time, done and failed on the last iteration, and a property:
   actions are always a subset of the selected per-PR stacks plus the allowlist.
3. `reclaimShellParity.test.ts`: run the real `pr_scope_environment_tag_belongs`, `sandboxSharedTier.sh live-tokens` and
   `order` through `bash` over the same table and require the TypeScript answers to be equal.
4. `scheduler.test.ts`, `schedulerHandler.test.ts`: the stop calls StartExecution after RDS, ECS and NAT. The execution
   name comes from `scheduledTime`. `ExecutionAlreadyExists` is success. A failed start still leaves everything stopped
   and fails the run. Only a failed `stop` announces to Sentry, once, with a fingerprint.
5. `reclaimHandler.test.ts`: paging for DescribeStacks, ListTasks (both desired statuses) and DescribeTasks batches.
   `DeleteStack` is sent with no `RoleARN`.
6. `tests/sandboxReclaim.integration.test.ts`: the real handler and adapters, every SDK `send` intercepted by a stateful
   fake account that moves stack, service and task states between iterations. Drive the loop to completion. Assert the
   end state (per-PR and shared stacks gone, data, network, webhooks and prod untouched) and the call order (DeleteService
   and StopTask before that stage's DeleteStack. Identity, then schema, then ALB).
7. `SandboxSchedulerStack.test.ts`: still exactly one schedule. The state machine's loop, Catch, report and Fail shape.
   the exact action sets. DeleteStack resources come from the constant. The Deny statements. No PassRole. Reclaim not in
   a VPC. Log groups drained.
8. `tests/sandboxReclaimStatus.integration.test.ts`: `reclaim-status` against the stubbed `aws` (RUNNING, none, error),
   and a workflow-structure check that `sandboxUp.yml` calls it before the start.
9. Run these existing guards red to green: `logDrainRegister`, `cdkNagAttachment`, `nagRulesAtZero` (follow the
   scheduler stack's existing IAM5 path for the `*` read statement), `natEgressConsumers`, `reclaimableStackImports`,
   `sharedTierLifecycle`, `globalBootstrapBundle`, `adrHygiene`, `sandboxScheduler.integration`.

## ADR-0061

No "Update" or "Amended" headings, no dated stamps, no strike-through (adrHygiene). Status Accepted. Drivers: the
ruling, quoted. Supersedes ADR-0060 section 9's single definition of idle, and section 11 for per-PR stages. Relates to
0005, 0028, 0060. Decision: the stop then starts the reclaim. The keep/delete table. The two definitions of idle (GitHub
by day, a quiescent tier at night) and the parts they share (live tokens, the allowlist), pinned by parity. The
TypeScript-matcher exception to ADR-0005 and the parity test that holds it. IAM as the boundary. The stop-first argument
and its flip condition. Sentry issues as the failure channel. Consequences and residual risk: the risks below.

## Deploy path

Push. Press Sandbox Up for an open PR: its identity step deploys the global app, which holds the scheduler stack. Check
`aws stepfunctions describe-state-machine` and the schedule input. Prove it after the next midnight, or by hand once the
tier is down with `start-execution` and `{"iteration":0}`. Confirm a forced failure makes a Sentry issue. Rollback is a
revert and a Sandbox Up. IAM limits the worst a bug can do: it can only delete stacks that rebuild.

## Risks

- A Sandbox Up can straddle midnight (runs take 47 to 97 min, headroom is 45). Its stacks are deleted once its deploy
  finishes. Raising the headroom is a separate fix.
- A press after midnight while the reclaim runs is refused by the new step.
- Prior-count SSM parameters for force-deleted services stay stale (harmless, as after Sandbox Down).
- No dead-man switch: a night the schedule never fires stays silent.
- Unmeasured: the extra Sandbox Up time to rebuild the stacks each morning.

## Pattern register

Reconciler (`planReclaim` plus the state-machine loop). Process Manager (the state machine owns sequence, timer, bound
and failure route, and decides nothing). Specification, composed (stage owns stack, tier quiescent, shared tier may go).
Command (the `ReclaimAction` union, run by an exhaustive switch). Functional core and imperative shell. Ports and
Adapters (`awsAdapters.ts`). Mirrored Authority (TypeScript selection held to `prScope.sh` and `sandboxSharedTier.sh` by
an executed parity test). Idempotency Key (the execution name). `announceSilentNoOp` is the Notifier, reused.
