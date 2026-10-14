# 0061 — The midnight stop reclaims what nothing uses

- **Status**: Accepted
- **Date**: 2026-10-13
- **Drivers**: Owner ruling of 2026-10-13, recorded in `docs/plans/2026-10-13-002-feat-midnight-reclaim-plan.md`.
  Verbatim: _"The midnight stop should delete things if nothing else is using them."_
- **Supersedes**: [ADR-0060](0060-sandbox-starts-only-by-hand.md) §9 as the single definition of an idle shared tier,
  and ADR-0060 §11 for per-PR stages. The rest of ADR-0060 stands.
- **Relates to**: [ADR-0004](0004-minimize-nat-egress.md) (which Lambdas use the NAT),
  [ADR-0005](0005-environment-tagging-and-pr-cleanup.md) (teardown scope),
  [ADR-0028](0028-on-demand-sandbox.md) (the shared tier is rebuilt on demand),
  [ADR-0042](0042-log-drain-coverage.md) (the drained log groups).

## Context

The midnight stop stops things. It switches the scheduled rules off, stops the RDS instance, scales the ECS services to
zero and stops the NAT instance. It deletes nothing.

So a preview that stays open overnight keeps every stack it has. The shared tier stays too. That tier is the ALB, the
identity service and its schema stack. These stacks cost money while nothing runs in them. They also rebuild on demand. Sandbox Up creates them again as needed.

ADR-0060 decides how a stack goes away. A closed PR has its own stacks deleted (§8). The last PR to go takes the shared
tier with it (§9). Both need a person to close a PR or press Sandbox Down. Nothing deletes an open PR's stacks at
night. Nothing frees the shared tier at night, because nobody is there to press a button.

## Decision

### 1. The stop is unchanged, and it starts the reclaim last

The stop keeps its order and its failure handling. After the NAT it starts a Step Functions execution (a Standard state
machine). The execution name comes from the schedule's own time.

A failure to start the reclaim is recorded. It fails the run after everything else is stopped. It never undoes the
stop. The stop is the cost safety, and the reclaim is an improvement on it.

The stop function loads the Step Functions client lazily, inside the call that starts the loop. If the runtime cannot
load that package, the failure is one more reclaim error. A static import fails the whole function at init, and
nothing stops. The adapters of the reclaim live in their own module for the same reason.

The schedule passes `<aws.scheduler.scheduled-time>` to the function. The execution name is `nightly-` and that time with
its colons replaced. A retried invocation carries the same time, so it names the same night. Starting an execution whose
name exists already counts as success. A stop with no time (a hand-run stop) stops everything and starts no reclaim.

### 2. A loop calls one Lambda once a minute

The state machine waits 60 seconds. It calls the reclaim Lambda with the iteration and a bound of 120. Then it reads
the answer.

- Complete and not failed: the execution succeeds.
- Complete and failed: the execution fails.
- Anything else: the iteration goes up by one, and the loop waits again.

A step that throws is retried twice. Anything left after that goes through a Catch to a `report` call, and then to
`Fail`. The `report` call is retried too. The state machine decides nothing. It owns the sequence, the timer, the bound and the failure route. It has no
execution-level timeout, because a timed-out execution cannot run its Catch.

Each call observes the account, plans with a pure function, runs the plan's actions and returns. Every call is a
reconciliation pass, so a repeat is safe.

### 3. What is deleted and what is kept

| Resource                                                                                                           | Fate                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Every `kitchensink-<app>-pr-<N>` stack, with its ECS services, tasks, queues and log groups                        | Deleted                                                       |
| The shared tier: the identity service, its schema stack and the ALB (the `sandboxSharedTier.sh` list)              | Deleted, one at a time, after the last `pr-<N>` stack is gone |
| The RDS instance, and the network, data, domain, webhooks, scheduler, service-logs and remote-search-shared stacks | Kept                                                          |
| The shared ECR repositories                                                                                        | Kept                                                          |
| The per-PR logical databases                                                                                       | Kept. The reclaim does not drop them, and does not owe a drop |
| The preview DNS record and the Vercel binding                                                                      | Kept                                                          |
| Any stack tagged `production` or named `-prod`, and every stack of another application                             | Never touched                                                 |

The reclaim has no Vercel token and no Route 53 code. A PR that closes still frees its DNS record, its Vercel binding
and its database through `teardownSandboxPr.sh`, as before.

Per-PR queues and their parked messages are deleted with their stacks. This replaces ADR-0060 §11 for per-PR stages. A
parked message used to wait for its stage to return. A deleted stage has nothing to return to. Nothing is live, so this
loses nothing.

### 4. The stop runs first, then the reclaim

The reclaim uses the proven quiesce order of `ecsQuiesce.sh` before it calls `DeleteStack`. It force-deletes the
services and stops the tasks. It waits until the services are inactive and the tasks are stopped. Then it deletes the
stacks, and CloudFormation has nothing to drain.

The stop goes first because the state of the tier is the signal that nothing uses the sandbox. A delete that ran first
leaves the tier looking up for the whole reclaim. CI then deploys previews into stacks that are about to go.

Flip condition: a stack delete can wedge because a service does not drain. In that case, move the RDS and NAT stop
to the end of the state machine. No delete is known to wedge, so the order stays.

### 5. Two definitions of idle, and the parts they share

By day, ADR-0060 §9 decides. First, the last `pr-<N>` stack must be gone. Second, no workflow that can stand up a
preview is in the queue or running. A person is acting, and GitHub shows it.

At night nobody is acting, and a Lambda has no GitHub token. The reclaim decides from the tier. It acts only after it
finds a sandbox RDS instance and a sandbox NAT, and each one is `stopping` or `stopped`. Sandbox Up starts the database
first. So a press makes the tier non-quiescent, and the reclaim stands down and starts no new delete. The reverse is
covered too. Sandbox Up refuses a press while a reclaim execution runs (`sandboxScheduler.sh reclaim-status`).

A tier that cannot be found is an error, not a quiet success. If the planner finds no database or no NAT, it throws.

The database match needs the `kitchensink-` prefix as well as `-sandbox`. Without the prefix, a running instance of the
other application holds the tier up for ever, and nobody is told. The real identifier starts with
`kitchensink-data-sandbox-`. The NAT match still reads the `Name` tag for `sandbox` and the disabled source check. A
foreign NAT with that tag has the same effect. This is a residual risk below.

The reclaim also keeps the shared tier while any `pr-<N>` stack exists in any state except deleted. It keeps the tier
while any sandbox or per-PR stack is being created or updated.

Both definitions share two pieces of knowledge. One is the stack-name pattern that yields a live `pr-<N>` token. The
other is the allowlist of shared-tier stacks, in delete order. The reclaim holds TypeScript copies, and a test holds
the copies to the shell (§6).

A stood-down run with nothing in flight is a finished run, and its execution succeeds. A deliberate stand-down is a
decision, not a failure. A stood-down run that still tracks a delete it started earlier waits for that delete.

### 6. The TypeScript matchers are an exception to ADR-0005, held by a test

ADR-0005 allows one matcher for the scope of a PR. A second copy can drift. The reclaim runs inside a Lambda, which
cannot source a shell file. So it carries TypeScript copies of three things: the stack-name pattern, the rule that an
`Environment` tag belongs to a token, and the allowlist of the shared tier with its order.

This is the only exception. `reclaimShellParity.test.ts` runs the real `prScope.sh` and `sandboxSharedTier.sh` over the
same table of names, tokens and tags. It requires equal answers. A change to one side alone fails the test.

The table holds `pr-1` next to `pr-15`, a leading zero and a name that contains a token. It holds a tag that is a
prefix of another tag. It holds the persistent tier, production and another application.

### 7. A stage owns a stack only when the name and the tag agree

A stack belongs to a stage on two conditions. Its name matches `kitchensink-<app>-pr-<N>`. Its `Environment` tag is
exactly `pr-<N>` or `pr-<N>-sandbox`.

A name that matches with another tag is left for its PR-close teardown. It raises a warning and still counts as live,
so the shared tier stays. A stack in `REVIEW_IN_PROGRESS` holds a change set that nobody executed. It is not a deploy.
The reclaim deletes it, and it does not hold the shared tier. The planner never names a stack tagged `production` or named `-prod`. A shared-tier stack
must carry `Environment=sandbox`, the same condition the IAM grant sets.

A cluster belongs to a stage on the same two conditions. Its tag names the token, and its name starts with
`kitchensink-`. The account also hosts another application. A tag alone does not say whose cluster it is, and a service
that is deleted is gone. The nightly stop uses the same rule before it scales a cluster to zero.

### 8. IAM is the boundary

A `DeleteStack` call that names no role runs with the saved role of the stack. Every stack in scope was deployed by the
CDK bootstrap. Its CloudFormation execution role is that saved role. So the reclaim Lambda needs no `iam:PassRole`. The
only boundary is which stacks it can name. The delete statements are one function, `teardownGrants.ts`, and the CI role
of ADR-0063 attaches the same function, so the two teardown paths share one boundary. The grant is:

- Read-only discovery on `*`: `cloudformation:DescribeStacks`, `cloudformation:ListStacks`, `rds:DescribeDBInstances`,
  `ec2:DescribeInstances`, and the ECS list and describe calls for clusters, services and tasks. The code never calls
  `ListStacks`. It calls `DescribeStacks` with no `StackName`, because only that call returns each stack's tags, and AWS
  authorizes that call as `ListStacks` on `stack/*/*` as well. Without `ListStacks` the reclaim is denied before it
  reads a single stack.
- `cloudformation:DeleteStack` on `kitchensink-*-pr-*` stacks tagged `Environment=pr-*`.
- `cloudformation:DeleteStack` on the three exact shared-tier stack ARNs tagged `Environment=sandbox`. The code builds
  them from the same constant the planner reads.
- `ecs:DeleteService` on services under a `kitchensink-*-pr-*` cluster, and only for a service tagged `Environment=pr-*`.
  Every service of this repository carries that tag from the App, and the stack tests hold it.
- `ecs:StopTask` on tasks under a `kitchensink-*-pr-*` cluster. This grant has no tag condition, because a task carries
  no tag of its own. The cluster-name pattern is the only wall for tasks.
- An explicit Deny of `DeleteStack`, `DeleteService` and `StopTask` on anything tagged `Environment=production`. This
  Deny does nothing for `StopTask`, because tasks are untagged. For tasks, only the cluster-name pattern keeps out a
  production cluster, and `-prod-` never matches `-pr-`.
- An explicit Deny of any `DeleteStack` call that names a role.

The role holds no Create, Update or change-set action. It is not in a VPC, so it is not a NAT consumer. The scheduler
function gains only `states:StartExecution` on the one state machine. The scheduler's own `ecs:UpdateService` grant for
per-PR clusters carries the same `kitchensink-` prefix.

`SandboxSchedulerStack.test.ts` holds the grant by set equality against the synthesized template. A bug in the planner
can delete only stacks that rebuild. `lambdaRolesCoverTheirSdkCalls.test.ts` holds the same role to the code: it reads
every AWS SDK call the reclaim handler can reach, maps each to the IAM actions AWS authorizes it under, and fails when
the role misses one or grants one the code does not use. The scheduler function's role is held the same way.

### 9. A failure is a Sentry issue

The sandbox alarm topic has no subscriber, so an alarm reaches nobody. A failure creates a Sentry issue through
`announceSilentNoOp` and the platform DSN. Four conditions exist, and each fires at most once per execution:

- `nightly-stop-failed`: the stop recorded an error or crashed. Only a stop announces. A failed start or sync fails a
  workflow, and a person already watches that.
- `stacks-left-behind`: the loop reached its bound with work left. The last step announces, and the execution fails.
- `stacks-refused`: the run ended, and the planner refused at least one stack because its tag did not match. The refusal
  repeats every minute, so only the final step announces. The execution still succeeds, because the refusal is a
  decision, but a refused stack is a leak that nobody else reports.
- `reclaim-crashed`: a step threw after its retries. The `report` step announces, and the execution fails.

Every path to `Fail` follows one announcement. A path to `Succeed` follows none, except a refusal. The sentence that reaches Sentry is
fixed text. The cause goes in the context, which reaches the log drain and never the envelope.

There is no dead-man monitor in this change. A night on which the schedule never fires stays silent.

The `report` call runs in the same function as the step. A function that fails at init, such as a bad bundle or a missing
module, fails both, and nothing is announced. The retry narrows this for a transient fault and no more. So the
forced-failure proof at deploy time has two parts. First, force a failure in a step and see the Sentry issue. Second,
force a failure at init and record what is seen. The expected result is a failed execution and no issue. If so, that is the
known limit, and the execution history is the only signal.

### 10. The log groups of a preview are deleted with its stack

A log group that outlives its stack costs one group each night. A named group is worse. It makes the next deploy of that
stack fail with `AlreadyExists`.

Every log group of a per-PR app now takes `RETAIN` at the prod stage and `DESTROY` at every other stage. The production
template does not change. `perPrLogGroupsDisposable.test.ts` finds the per-PR apps from their entrypoints and holds all
their log groups to that rule.

A log group is not the only way a preview can outlive its stack. So each per-PR app also synthesizes every stack at
`pr-1` and asserts two things. No resource has a `Retain` or snapshot deletion policy. No resource is a custom resource,
because it runs code on delete that the reclaim cannot repair. The same test file checks that every stack class an app
constructs has this assertion.

## Alternatives rejected

- **Delete first, stop after.** The tier looks up during the reclaim, and CI deploys previews into doomed stacks.
- **Decide at night from GitHub.** The Lambda needs a token for that. A person who presses Sandbox Up already shows as
  a running tier.
- **Do the reclaim inside the stop Lambda.** A delete can take an hour. The stop must finish in minutes, and a reclaim
  failure must not undo it.
- **A second schedule or a Sentry cron monitor.** ADR-0060 §7 keeps the midnight stop as the one scheduled job. The
  stop starts the loop, and the loop ends on its own.
- **Run the shell scripts from the Lambda.** A shell and the AWS CLI inside a function add more surface than a tested
  copy.
- **Give the role `iam:PassRole` and name an execution role.** The saved role of the stack already does the delete. A
  granted role is a grant that someone can misuse.

## Consequences

- A night with no use leaves no per-PR stack and no shared-tier stack. Only the kept resources bill.
- Sandbox Up pays the time to rebuild the stacks each morning. That time is not measured.
- A person who presses Sandbox Up during the reclaim is refused and told to press again later.
- The reclaim function group is drained to Sentry. The log group of the state machine is registered and not drained.
  `0042-log-drain-coverage.md` lists both groups, and `logDrainRegister.ts` carries them.

## Residual risk

- **A Sandbox Up can straddle midnight.** A run takes 47 to 97 minutes, and the pre-midnight headroom is 45. The stop
  stops the tier under it. The reclaim then deletes the stacks of that PR after its deploy ends. A longer headroom is a
  separate change.
- **A straddling Sandbox Up can lose the shared tier it just built.** Sandbox Up builds the shared tier in its identity
  job, then the previews. Midnight can fall between the identity job and the first per-PR create. Then the stop stops the
  tier. The reclaim finds no `pr-<N>` stack and deletes the shared tier. The previews then fail on missing imports.
  The headroom check is the only guard, and a longer headroom is a separate change.
- **A foreign NAT instance named for the sandbox** holds the tier up for ever. Only the database match is tightened.
- **Prior-count SSM parameters go stale** for deleted services. This is harmless, as after Sandbox Down.
- **No dead-man switch.** A night on which the schedule never fires is not reported.
- **The Sentry issue is the only channel.** A wrong DSN falls back to a log line on the drain.
- **The IAM wall is wider than the planner.** The pattern `kitchensink-*-pr-*` also matches names the planner refuses,
  such as `…-pr-91-old`. The anchored pattern of the planner is the narrow rule. The tag condition is the second wall.
- **Guards.** `reclaim.test.ts` holds the planner with a fixture table and a generated property.
  `reclaimShellParity.test.ts` holds the copies to the shell. `reclaimHandler.test.ts` and
  `sandboxReclaim.integration.test.ts` hold the adapters and the whole loop against a fake account.
  `SandboxSchedulerStack.test.ts` holds the IAM boundary and the shape of the state machine.
  `sandboxReclaimStatus.integration.test.ts` holds `reclaim-status` and its place in `sandboxUp.yml`.
