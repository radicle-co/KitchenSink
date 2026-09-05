# 0028 — On-demand sandboxes: a button in GitHub, and midnight teardown

- **Status:** Accepted
- Date: 2026-08-27
- Deciders: owner, platform
- Related: [0005](0005-environment-tagging-and-pr-cleanup.md), [0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md), [0007](0007-sandbox-cost-controls.md), [0010](0010-ensure-exists-per-pr-deploy-gate.md), [0032](0032-deployed-ecosystem-test-tier.md)

## Context

The product is not launched and has no users, yet two complete environments run around the clock. A
measured run-rate of **$398/month** (20–27 Aug 2026) went largely to capacity nobody was using: per-PR
previews standing for nineteen days at a time, a sandbox tier idling overnight and at weekends, and
ADR-0007's nightly shutdown returning everything to full price at 09:00 every morning whether or not
anyone wanted it.

ADR-0010 made previews deploy **automatically**, on every push, and ADR-0007 made the sandbox tier sleep
rather than stop. Both were right for a team expecting the environment to be there. Neither matches "give
me a preview when I ask for one, and stop charging me when I am done."

## Decision

**1. A preview is started by a button, not by a push.** `sandbox-up.yml` is a `workflow_dispatch`
workflow — GitHub renders it as _Run workflow_ in the Actions tab. It labels the PR `sandbox-up`, stamps an
expiry, and dispatches the deploys.

**2. A preview dies at midnight America/New_York of the day it was started.** The expiry is computed
**once**, at the press of the button, by `.github/scripts/sandbox-lifetime.sh`, and carried from then on as
an absolute epoch in the `SandboxExpiresAt` stack tag. Nothing downstream recomputes it.

**3. An hourly reconciler converges reality to intent.** `sandbox-reconcile.yml` reaps anything past its
expiry and — ~~when no sandbox is live at all — stops the shared sandbox tier~~.

> ⚠️ STALE (2026-09-04): only the FIRST half of §3 still holds. **The reconciler stops nothing.** The
> `{"action":"stop"}` invocation was WITHDRAWN by the owner ruling recorded in "Update (2026-09-03)" at the
> bottom of this ADR. What the last step of `sandbox-reconcile.yml` does now is invoke
> `.github/scripts/sandbox-shared-tier.sh down` — a DELETE of the ALB + identity stacks, not a stop of the
> RDS/NAT/ECS tier (`.github/workflows/sandbox-reconcile.yml:212-247`, whose own comment records the
> withdrawal). `sharedTierLifecycle.test.ts` asserts the absence in both directions: no `{"action":"stop"}`
> and no hand-rolled `stop-db-instance` / `--desired-count 0` equivalent.

**4. ADR-0010's ensure-exists gate gains a precondition.** `deploy-gate.sh decide` takes `<intent>` as a
new REQUIRED first parameter; absence of a stack no longer deploys on its own.

> ⚠️ AMENDED (2026-09-04, owner ruling): **this still governs DEPLOYMENT and no longer governs
> VALIDATION.** [ADR-0032](0032-deployed-ecosystem-test-tier.md) §6 records the ruling — _"Absent is fatal
> because a PR with no deployed target cannot be validated."_ The gate is untouched: `intent = false` still
> returns `deploy=false`, and a validation tier may NOT conjure its own target by re-arming ensure-exists.
> What changes is what an absent stack means to the deployed-ecosystem test tier: not "reaped, carry on"
> but "there is nothing to validate" — so that tier SKIPS, and a skip is not a pass. Two questions, two
> answers, both correct.
>
> ⚠️ REAFFIRMED and WIDENED (2026-09-05, owner ruling): _"all end to end tests (playwright, e2e, maestro,
> etc) … should be skipped if the sandbox for the PR is not running."_ The same two-questions reading holds;
> what grew is the set of jobs on the validation side — it is now **every** e2e tier, because there is no
> longer a locally-booted e2e tier to fall back to (ADR-0032 §1, superseded 2026-09-05).

~~**5. ADR-0007's 09:00 start schedule is deleted.** The 00:00 stop survives.~~

> ⛔ FALSE (2026-09-04): **the 09:00 start schedule EXISTS.** It was restored under its original construct id
> by the owner ruling recorded in "Update (2026-09-03)" below — _"The RDS should still be stopped and started
> on the original schedule."_ Proof:
> `packages/infra/global/lib/platform/SandboxSchedulerStack.ts:200-207` —
> `new scheduler.Schedule(this, 'SandboxStartSchedule', { schedule: dailyAt('9'), … { action: 'start' } })`,
> `TimeZone.AMERICA_NEW_YORK`, beside `SandboxStopSchedule` at `dailyAt('0')`
> (`SandboxSchedulerStack.ts:188-195`). `SandboxSchedulerStack.test.ts` pins both cron expressions and the
> pairing of each action to its own hour. ADR-0007 §"stop at 00:00 ET, start at 09:00 ET, daily" is therefore
> the accurate description of the live schedule, not this line.

## Why each of these, and what breaks without it

### Expiry is stamped once, not derived twice

America/New_York is UTC-4 for eight months and UTC-5 for four. Any second component that recomputes
"midnight ET" can disagree with the first across a changeover, and the disagreement is invisible until a
sandbox dies an hour early in November. Computing it once and comparing a number thereafter removes the
class. `sandboxLifetime.test.ts` asserts both 2026 transitions in both directions.

**A minimum lifetime is part of the rule, not a rounding convenience.** "Midnight of the day created", read
literally, gives someone who presses the button at 23:50 a ten-minute environment — less time than the
deploy that builds it. Below two hours the expiry rolls to the following midnight.

### ⛔ The gate amendment MUST ship with the reaper, and shipping either alone is a defect

ADR-0010 made an ABSENT stack a reason to **deploy**, because a preview missing one of its services is
broken behind a green check. Under on-demand, ~~absent stops meaning "broken" and starts meaning
"deliberately reaped at midnight"~~ — so ensure-exists, left alone, **rebuilds every environment on the first
push after the reaper ran**. Silently. Behind a green check. That is ADR-0010's own failure mode running
backwards, and it would restore the entire bill while every signal stayed green.

> ⚠️ AMENDED (2026-09-04, owner ruling) — **the struck clause is true of the DEPLOY question and FALSE of
> the VALIDATE question, and it was written as though there were only one question.** The owner's ruling is
> verbatim: _"Absent is fatal because a PR with no deployed target cannot be validated."_
>
> | question                          | absent means                             | outcome                          |
> | --------------------------------- | ---------------------------------------- | -------------------------------- |
> | should I build this preview?      | deliberately reaped — do not rebuild it  | skip the deploy (this ADR, kept) |
> | may I claim this PR is validated? | **fatal** — there is nothing to validate | skip the tier, claim NOTHING     |
>
> The paragraph's own conclusion is UNWEAKENED — rebuilding a reaped environment because a test wanted one
> is the same silent rebuild behind a green check — which is why
> [ADR-0032](0032-deployed-ecosystem-test-tier.md) §6 resolves the second question with a SKIPPED job rather
> than a deploy. ⛔ Do not read that skip as a pass, and do not make the tier a required check that a skip
> would satisfy silently.

So `intent` is a REQUIRED first parameter rather than a defaulted one: a default is a position, silently
asserted on behalf of every caller that never considered it. Intent is carried by the `sandbox-up` PR
label — visible in the GitHub UI, readable by the gate without an AWS call, and removed by the same action
that tears the environment down. A manual dispatch still deploys unconditionally, because pressing the
button **is** the declaration of intent.

⚠️ The converse is equally true: **the label wiring must not land without the button.** With the gate
requiring intent and nothing applying it, every preview silently stops deploying.

### Hourly, not once at midnight

GitHub's scheduled workflows are best-effort: delayed under load, skipped entirely, and auto-disabled after
60 days of repository inactivity. A nightly run that silently does not happen is indistinguishable from one
that found nothing to do. Asking "is anything past due?" every hour is self-healing — a missed run costs an
hour, not a month.

### It reconciles; it does not merely delete

A one-shot deleter fixes only the case it was written for. The reconciler also catches a teardown that died
halfway, a stack created out of band, and — the one nobody would think of — **the RDS instance AWS
auto-restarts after 7 days stopped**, which would otherwise come back by itself and bill until a human
noticed.

**An untagged sandbox is treated as EXPIRED.** That is the fail-safe direction: the tag is missing when a
deploy died before stamping one, and reaping something reproducible by one button press is the cheap
mistake. The expensive one is infrastructure no process will ever collect — which is exactly what ADR-0005
was written after.

### Why the 00:00 stop survives while the 09:00 start goes

> ⛔ FALSE (2026-09-04) — THIS WHOLE SUBSECTION IS REVERSED. Both schedules exist
> (`SandboxSchedulerStack.ts:188-207`). The argument below is preserved because its _premise_ is the
> instructive part and it expired rather than being wrong: it held while the shared ALB and identity service
> were merely STOPPED, and this ADR's own Update of 2026-08-30 made them DELETED STACKS — a schedule cannot
> create a stack, so a 09:00 `start` can now resurrect only the two resources that were ever stoppable (the
> sandbox RDS instance and the NAT EC2 instance). See "Update (2026-09-03) — the 09:00 start is RESTORED"
> below for the ruling and the reasoning.

~~The start would resurrect the whole tier every weekday morning regardless of intent, silently undoing the
reaper.~~ The stop is kept for a **different** reason than "backstop": it is the thing that catches the 7-day
RDS auto-restart in the weeks when GitHub Actions does not run at all. ~~The scheduler Lambda keeps its
`start` action — that is how the button wakes the tier — only the _schedule_ is removed.~~ ⚠️ STALE
(2026-09-04): the scheduler Lambda keeps its `start` action AND its schedule.

### One teardown implementation, still

The reconciler shells out to `teardown-sandbox-pr.sh`, the same script the on-close cleanup and the
abandoned-preview reaper use. `sandboxReclamationReachability.test.ts` pins the set of jobs allowed to
invoke it by **set equality**, and this ADR adds the third rather than loosening the assertion — the set is
what stops a fourth copy of "what belongs to `pr-{N}`" being written somewhere nobody is guarding.

That guard also caught a real defect in the first draft of the reconciler: its teardown step was gated on
`steps.find.outputs.expired != ''` alone, so a failure in discovery would have skipped reclamation
entirely — the 2026-07-28 incident, reproduced. The teardown step now carries `!cancelled()`, and the
discovery step deliberately omits `set -e` so one stack's hiccup cannot cancel the sweep.

## Consequences

- **Previews no longer appear on their own.** A push to a PR with no live sandbox deploys nothing and says
  so. This is the intended behaviour and the largest workflow change here.

    > ⚠️ AMENDED (2026-09-04, owner ruling): this consequence STANDS, and it now has a second half this
    > bullet never stated. A PR with no live sandbox also gets **no deployed-ecosystem test result** —
    > k6 and the deployed e2e suite SKIP rather than run against a locally booted stand-in
    > ([ADR-0032](0032-deployed-ecosystem-test-tier.md) §§1, 6). So "deploys nothing and says so" is
    > completed by "validates nothing and says so"; neither is a green check for work that did not happen.
    >
    > ⚠️ WIDENED (2026-09-05, owner ruling): the second half is now **every** end-to-end tier, not just the
    > API-level pair this bullet named — _"all end to end tests (playwright, e2e, maestro, etc) … should be
    > skipped if the sandbox for the PR is not running."_ A PR with no live sandbox therefore runs **no
    > end-to-end test of any kind** and is green on that basis, which is the ruled outcome. ⚠️ The `§§1, 6`
    > citation above should now be read as **§6 alone**: ADR-0032 §1's two-tier split (a local-booting
    > "hermetic" tier kept beside the deployed one) was superseded by the same ruling. The skip rule is
    > unchanged and its reach is larger.

- Expected saving **$30–45/month**, on top of the $101 already recovered from Container Insights.
- **A sandbox can expire mid-session.** Press the button again — it re-stamps the expiry and redeploys,
  which is also how you extend one you are still working in.
- ~~**The residual floor is the sandbox ALB (~$16.43/mo) and its RDS storage.** An ALB cannot be stopped, only
  deleted, and deleting it requires tearing down every stack importing its listener ARN first — ADR-0002's
  export-in-use deadlock. Deliberately out of scope.~~
  ⚠️ STALE (2026-09-04): superseded by "Update (2026-08-30)" in this same ADR — the ALB and the shared
  identity service ARE reclaimed (`.github/scripts/sandbox-shared-tier.sh`, `sandboxSharedTier.test.ts`).
  What remains of the floor is the RDS gp3 storage (~$11.13/mo).
- Per-PR logical databases (ADR-0006) are destroyed with the preview. Acceptable, and the reason a logical
  seed template is a prerequisite for treating sandbox data as reproducible.

## Residual risk

- **Nothing yet asserts the button's YAML end-to-end.** The expiry clock and the gate are unit- and
  integration-tested; the workflow wiring that connects them has been parsed and reasoned about, not
  executed. The first real press is the test.
- **`SandboxExpiresAt` is applied by the CDK app**, so a preview whose deploy fails before tagging is
  reaped within the hour rather than retried. Fail-safe, but it will surprise someone.
- **The reconciler's discovery reads CloudFormation stack names**, so a per-PR resource that is not part of
  a `kitchensink-*-pr-{N}` stack is invisible to it and relies on `teardown-sandbox-pr.sh`'s tag matching.
- Sandbox storage is still 100 GB against a modelled full-scope need of ~10–11 GB; shrinking it needs a
  deliberate instance replacement (`allocatedStorage` is hardcoded, `deletionProtection` is on).

## Update (2026-08-30) — the ALB was not an immovable floor, and the shared tier joins the lifecycle

This ADR recorded the sandbox ALB (~$16.43/mo) and its RDS storage as "the residual floor … deliberately out
of scope", on the grounds that deleting an ALB requires tearing down every stack importing its listener ARN
first (ADR-0002's export-in-use deadlock).

**That was measured.** With the per-PR stacks reaped, all three live exports of `kitchensink-alb-sandbox`
have exactly ONE importer: `kitchensink-identity-service-sandbox` (`SharedAlbArn` has none at all). Together
the ALB and its two public IPv4 addresses cost **$23.73/month**, billed around the clock for a tier that is
live a few hours a week.

> ⛔ **CORRECTION (2026-08-31) — an earlier revision of this section claimed "the deadlock is one stack
> deep". THAT IS FALSE, and the first real run of the reclaim proved it.** Only the ALB's _inbound_ edge was
> measured. `kitchensink-identity-service-sandbox` has nine exports of its own, and one of them is imported:
>
> ```
> Delete canceled. Cannot delete export
>   kitchensink-identity-service-sandbox:IdentityServiceLogGroupName
> as it is in use by kitchensink-identity-webhooks-sandbox.
> ```
>
> `WebhooksStack` builds a `SubscriptionFilter` on the identity service's ECS log group to drain it to the
> log-forwarder Lambda, importing the group name with `Fn.importValue`. So the chain is two deep, and the
> second link lands on the ONE sandbox stack that must not be deleted — the webhook `e2e-web`'s Clerk fixture
> blocks on. **Reclamation is therefore BLOCKED until that edge is removed.** See "The log-group edge" below.
>
> Nothing was damaged: CloudFormation cancelled the delete before removing any resource, and
> `sandbox-shared-tier.sh` refused to continue to the ALB — so the ALB was never left with its importer gone.
> The mirror-order abort earned its place on its first run.

### Decision

**The shared sandbox ALB and identity service are reclaimable, not merely stopped.** They are deleted with
the tier and rebuilt by the button, joining the per-PR previews in ADR-0028's lifecycle. The RDS instance and
the NAT are unchanged — the scheduler still stops and starts those, because they _can_ be stopped and
because the data must survive.

|       | Create                                                                    | Destroy                                                                 |
| ----- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Owner | `sandbox-up.yml` → dispatches `sandbox-identity-deploy.yml` and **waits** | `sandbox-reconcile.yml` → `.github/scripts/sandbox-shared-tier.sh down` |
| Order | ALB, then the identity service that imports it                            | identity service, then the ALB                                          |

### The three things an implementer must not discover the hard way

**1. `e2e-web` does NOT need the ALB — this was the premise that decided viability.** The obvious objection
is that the Playwright suite depends on the shared tier and would break. It does depend on the tier, but
`sandbox-wake.sh` **excludes ECS by construction** ("ECS is excluded for a reason rather than by omission"),
and the suite's Clerk fixture blocks on the sandbox `user.created` **webhook Lambda** backfilling
`external_id`. So its dependency is RDS + NAT + `kitchensink-identity-webhooks-sandbox` — none of which is
touched here. Had the coupling been read from the workflow's name rather than from what the script actually
wakes, this change would have been abandoned as blocked.

**2. The scheduler must not be what restores the identity service.** `priorCountParamName` keys its SSM
bookkeeping on `/kitchensink/sandbox-scheduler/ecs/{cluster}/{service}` — both CloudFormation-GENERATED
names. Delete and recreate the stack and both change, so `runStart` finds no stored prior count, skips the
service, and `sandbox-up.yml` (which greps for exactly that string) exits 1. **The button would fail on
every press after the first reap.** The resolution is ordering, not a code change: the delete happens before
the scheduler's stop, so it never records a count for a service that is about to vanish, and the rebuild
creates the service at its CDK desired count. The scheduler's ECS half is not dead — it is a general
mechanism whose subject set is now empty, and it remains the fallback if a delete fails.

**3. The deploy gate probed the wrong stack.** `sandbox-identity-deploy.yml` decides to redeploy the
global-sandbox app when `kitchensink-network-sandbox` is missing. That was correct while the ALB was
permanent. It is now the stack that can vanish, while the network stack — owning the VPC and the NAT the RDS
needs — deliberately outlives it. The old probe would answer `global_missing=false` after a reap, skip the
deploy that recreates the ALB, and fail the identity deploy on an unresolvable `SharedAlbHttpsListenerArn`.
Both stacks are now probed.

### This supersedes the 2026-07-12 "never delete the shared identity service" requirement

That requirement (task #12) said teardown must remove everything ephemeral **except** the shared identity
services and the RDS cluster, because "wiping it or the DB cluster breaks all open previews and loses data."

Half of that premise has expired and half has not:

- **"Loses data" no longer applies.** The RDS instance and every per-PR logical database live in
  `kitchensink-data-sandbox`, a different stack, which stays and is still merely stopped.
  `kitchensink-identity-webhooks-sandbox` also stays.
- **"Breaks all open previews" still applies while a preview is live** — which is why the delete runs only
  when `steps.find.outputs.live == ''` and no wake consumer is mid-flight. The invariant changes from
  _"identity always exists"_ to _"identity exists exactly while a preview does"_, enforced by the same
  reconciler that owns preview lifetime.

⛔ `pr-scope.sh` and `prScope.test.ts` are **unchanged and still correct**: those two stack names remain
forbidden to the `pr-{N}` matcher, which is about that matcher's precision. This is a separate, explicitly
named path — the ONE place in the repository that deletes `*-sandbox` stacks — so its safety is an explicit
pinned allowlist of two exact names plus a refusal for everything else, fired in `sandboxSharedTier.test.ts`
at the shared database, the VPC, the webhooks, the scheduler and both prod stacks. Mutation-checked in both
directions: adding `kitchensink-data-sandbox` to the allowlist fails 3 assertions, and reversing the delete
order fails 1.

### Consequences

- **Saving $23.73/month**, on top of this ADR's original $30–45 and the $101 from Container Insights.
- **A button press now costs ~5–8 minutes more** — ALB creation plus DNS — and fails loudly if the rebuild
  fails, rather than deploying previews nobody can sign into.
- ~~**Sandbox identity CloudWatch log groups are destroyed and recreated**, so log history no longer survives
  across sandboxes.~~
  ⚠️ STALE (2026-09-04): retired by "The log-group edge" section below, which this ADR already says retires
  it. `ServiceLogsStack` owns the group under the stable name `/kitchensink/identity-service/{stage}`
  (`packages/infra/global/lib/platform/ServiceLogsStack.ts:71-73`) and `IdentityServiceStack` imports it
  (`IdentityServiceStack.ts:263-267`), so log history now DOES survive a sandbox teardown.
- `continue-on-error` is deliberately absent from the reclaim step. The first draft had one so a failed ALB
  delete would not block stopping the RDS; that bought it by reporting the job GREEN, which is how an ALB
  that never deletes bills forever behind a passing check. `workflowInvariants` invariant 4 caught it. It was
  also unnecessary — the scheduler step already carries `!cancelled()`.

### Residual risk

- ⚠️ **Reclamation begins when this MERGES, not now.** `workflow_dispatch` and `schedule` resolve the
  workflow from the DEFAULT branch, so until then the reconciler on `main` has no reclaim step and
  `sandbox-identity-deploy.yml` on `main` has no ALB probe. Deleting the ALB before the merge would strand
  the shared identity service, because the rebuild path that knows about it does not exist on `main` yet.
  This is why the stacks were left standing rather than reclaimed by hand the day the change was written.
- **Nothing asserts the button end-to-end**, which is this ADR's original residual risk, now carrying more
  weight: the create half is a dispatch-and-watch of another workflow, and the first real press is still the
  test. The delete half's predicates and the workflow ordering are unit-asserted; the AWS calls are not.
- **A failed delete leaks an SSM parameter.** If the reclaim fails and the scheduler's fallback scales the
  service to zero, it writes a prior-count parameter that a later successful delete orphans. Free, and
  harmless to `runStart`, but it accumulates one per cycle.
- The ~$11.13/month of sandbox RDS gp3 storage remains, as does this ADR's note that shrinking it needs a
  deliberate instance replacement (`6056779c` reverted an attempt that wedged the data stack).

## The log-group edge — the blocker, and the fix that shipped (option C)

The reclaim could not complete while a PERSISTENT stack imported from an EPHEMERAL one. That direction was
the defect, not the symptom: `WebhooksStack` (which stays) reached into `IdentityServiceStack` (which now
comes and goes) for `IdentityServiceLogGroupName`.

Three ways out were weighed:

|     | Approach                                                                                                                 | Verdict                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Invert the import: the identity stack creates the `SubscriptionFilter`, importing the forwarder Lambda ARN from webhooks | ⛔ Reverses the prod deploy order of two stacks. ADR-0022 is explicit that reordering that pipeline trades schema skew for message-contract skew. Rejected.                            |
| B   | Reference the log group by a shared literal NAME instead of `Fn.importValue`                                             | ⛔ Removes the CFN edge, but the group is still DELETED with the identity stack, so the surviving filter points at nothing and the drain dies silently after the first reap. Rejected. |
| C   | **A persistent stack owns the log group; both consumers import it**                                                      | ✅ Shipped.                                                                                                                                                                            |

### What shipped

`ServiceLogsStack` (`kitchensink-service-logs-{stage}`) is a new child of `GlobalStack`, which already
deploys before both consumers — so **no deploy order changed**. It owns
`/kitchensink/identity-service/{stage}` with the same one-month retention the old group had.

An explicit name matters twice: a CDK-generated name embeds the creating stack's logical id, which is the
coupling being removed; and a stable path means **log history now survives a sandbox teardown**, retiring the
"log history no longer survives" consequence recorded above.

### ⚠️ It ships as an EXPAND step, and the vestigial resource is deliberate

`WebhooksStack` still imports `kitchensink-identity-service-{stage}:IdentityServiceLogGroupName` at the
moment the identity stack deploys, because prod-deploy runs identity BEFORE webhooks. CloudFormation refuses
both to **delete** an export in use and to **change its value** while in use. So in this release the identity
stack keeps the old log group and keeps the export pointing at it, unchanged, while its container logging
moves to the imported group. After webhooks deploys later in the same run, the export has no importers and
the stack is deletable.

The contracting release — deleting `IdentityServiceLogGroup` and its `CfnOutput` — ships LATER, which is
ADR-0022's expand-first rule applied to an export instead of a column. `stacks.test.ts` asserts the remnant
is still there, so "tidying" it away early fails a test instead of failing the identity deploy.

### The guard that would have caught this

`reclaimableStackImports.test.ts` asserts the DIRECTION from CDK source: no stack under
`packages/infra/global/lib` or `identity-webhooks/infra/lib` may pass a `kitchensink-identity-service-*` or
`kitchensink-alb-*` export to `Fn.importValue`. Its prefix list is checked against
`sandbox-shared-tier.sh`'s own allowlist so the two cannot drift.

⛔ It **parses** rather than greps, and the first draft of it grepped — which flagged the very comment in
`WebhooksStack` documenting the fix. `natEgressConsumers.test.ts` records that exact trap ("parsing means
comments are comments"); the same parser is reused, and a test now asserts a comment quoting a reclaimable
export name is ignored.

⚠️ The negative alone is not enough: a guard that only forbids the old import would pass just as happily if
the drain were deleted outright. `WebhooksStack.test.ts` therefore also asserts the POSITIVE — three
subscription filters still exist, and the imported one names `kitchensink-service-logs-`. Both directions
mutation-checked: pointing the drain back at the identity service fails 1 synth assertion and 2 source ones.

### Consequences of C

- **Prod templates change** on three stacks, deliberately. Keeping prod on a different shape is how ADR-0007's
  cost problem came to hide in the exempted half; the cdk-nag byte-parity proof was extended to the new stack
  rather than excused, and `cdkNagTemplateParity` now pins eight platform stacks plus cost guardrails.
- The identity task definition gets a new revision on the next prod deploy — routine, but a real deploy
  rather than a config flag.
- `prScope.test.ts` gains `kitchensink-service-logs-{prod,sandbox}` to its never-claim list.

### Residual risk

- ⚠️ **The reclaim is unblocked in CODE but not yet PROVEN end-to-end.** The blocking import is gone and the
  guards hold, but the sequence "deploy the three stacks, then delete" has not been executed. The first run
  of the reclaim is still the test — which is exactly how the log-group edge was found, so this note is not
  a formality.
- **The reclaim must not run between merging and the first deploy of these three stacks.** Until
  `kitchensink-service-logs-{stage}` exists and webhooks has repointed, the old import is still live and the
  delete still fails — loudly, and the hourly pass retries, so the cost is a red run rather than damage.
- The contracting release is owed. Until it ships, the identity stack carries an unused log group and an
  unimported export.
- The ~$11.13/month of sandbox RDS gp3 storage remains, as does the note that shrinking it needs a deliberate
  instance replacement (`6056779c` reverted an attempt that wedged the data stack).

## Update (2026-09-03) — the 09:00 start is RESTORED, and the reconciler stops nothing

Owner ruling, verbatim:

> "when the sandbox goes down, we shouldn't take all of RDS down; just clean up the current PR sandbox
> tables. The RDS should still be stopped and started on the original schedule."

### What changes, and what explicitly does not

| §                                                 | Status                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| §1 button, §2 midnight expiry, §4 gate            | **Unchanged.** A preview still starts by a press and dies at midnight ET of the day it started.                    |
| §3 first half (hourly reaping)                    | **Unchanged.**                                                                                                     |
| §3 second half ("stops the shared sandbox tier")  | **WITHDRAWN.** The reconciler no longer invokes `{"action":"stop"}`.                                               |
| §5 ("ADR-0007's 09:00 start schedule is deleted") | **REVERSED.** `SandboxStartSchedule` is restored under its original construct id, `hour: '9'`, `America/New_York`. |
| Update (2026-08-30), ALB + identity reclamation   | **Unchanged, and load-bearing to this decision** — see below.                                                      |

The RDS instance and the NAT are back on ONE clock: stop 00:00 ET, start 09:00 ET, both owned by
`SandboxSchedulerStack`. Nothing else in the repository stops them.

### The premise that expired

§5's whole argument was that a daily start "would resurrect the whole tier every weekday morning regardless
of intent, silently undoing the reaper". That was true on 2026-08-27, when the shared ALB and identity
service were merely STOPPED and a `start` therefore brought the entire environment back.

The Update of 2026-08-30 — in this same ADR — made them **deleted stacks**. **A schedule cannot create a
stack.** So the set of things a 09:00 start can now resurrect is exactly the two resources that were only
ever stoppable: the sandbox RDS instance and the NAT EC2 instance. The reaper is not undone by that, because
the reaper's subjects (per-PR stacks, the ALB, the identity service) are not things a `StartDBInstance` or
`StartInstances` call can bring back. §5 was correct reasoning applied to a fact that its own successor
amendment retired six days later — the same shape as ADR-0004's four-consumer list, and the reason
`natEgressConsumers.test.ts` exists.

### Why the reconciler's stop goes, rather than merely being narrowed

Leaving the reconciler with a stop and adding a schedule with a start gives the pair two different triggers:
a stop that fires whenever no preview happens to be live, and a start that fires at 09:00. Those disagree
constantly — a preview reaped at 02:00 stops the database, 09:00 starts it, and the hourly reconciler stops
it again at 09:17. Worse, they disagree ASYMMETRICALLY on the ECS bookkeeping: `runStop` writes each
service's prior desired count to SSM and `runStart` deliberately refuses to guess when it is missing, so a
stop that fires on a schedule the start does not mirror is what leaves that bookkeeping half-applied.

⛔ The removed step's ORDERING constraint is discharged, not dropped. The 2026-08-30 amendment required the
ALB/identity delete to run BEFORE the scheduler's stop, because draining ECS tasks into an environment with
no database is what produced the `NotStabilized` wedge. With no stop in that workflow, the delete cannot be
followed by one. `sharedTierLifecycle.test.ts` asserts the absence in both directions: no `{"action":"stop"}`
invocation, and no hand-rolled `stop-db-instance` / `--desired-count 0` equivalent — the latter because
reimplementing the stop by hand is the exact defect this ADR records in the reconciler's first draft.

`steps.inuse` is KEPT. It still gates the ALB and identity reclaim, which is a stack delete and not an RDS
operation, and which the ruling does not touch.

### Cost

The sandbox RDS (`db.t4g.micro`) and the `t4g.nano` NAT now run 09:00–00:00 daily instead of only when
someone presses the button. **+$8–9/month**, against this ADR's measured $398/month baseline — about 2%,
and accepted by the owner as the price of a database that is up when someone reaches for it.

The offsetting benefit is not only convenience. `sandbox-wake.sh` exists because ADR-0007's stop window and
ADR-0022's in-stack migration Trigger compose into `UPDATE_ROLLBACK_FAILED`: a deploy landing between 00:00
and 09:00 ran its migration against a stopped instance, failed, and then failed its ROLLBACK for the same
reason — a state that needed a human with `continue-update-rollback --resources-to-skip`. Restoring the
start shrinks the window in which that is reachable at all from "any hour the reconciler last stopped it"
back to the documented 00:00–09:00, which is what the wake script was written and tested against.

### Consequences

- **The shared sandbox database is up 09:00–00:00 ET every day**, whether or not a preview is live. This is
  the ruling, stated plainly: it is no longer coupled to preview lifetime in either direction.
- ADR-0007's original "cold start each morning" consequence returns, unchanged: the instance takes a few
  minutes to become `available` at 09:00 ET.
- The ALB and identity service remain on the ON-DEMAND lifecycle of the 2026-08-30 amendment. The tier is
  therefore no longer uniform — two resources on a clock, two on a button — and that asymmetry is deliberate:
  one pair can be stopped and the other can only be deleted.

### Residual risk

- ⚠️ **The reclaim can now run against a stopped database, and that was already true.** The ALB/identity
  delete fires on any hourly pass where nothing is live, including between 00:00 and 09:00 when the schedule
  has stopped the instance — draining ECS tasks into an environment with no database, the `NotStabilized`
  shape. This change does not introduce it (the previous ordering only protected against the stop issued in
  the SAME run, not against one issued eight hours earlier) and does not fix it. The cure, if it bites, is
  `sandbox-wake.sh ensure` ahead of the reclaim, exactly as the teardown script now does.
- **Nothing asserts the restored schedule end-to-end.** `SandboxSchedulerStack.test.ts` pins both cron
  expressions, both actions, and the PAIRING of each action to its own hour (a start at midnight and a stop
  at nine synthesizes cleanly and would otherwise pass). The AWS-side behaviour — that EventBridge fires it
  and `runStart` finds its SSM parameters — is unexercised until 09:00 ET after the next deploy of
  `packages/infra/global` at stage `sandbox`.
- **The 7-day RDS auto-restart backstop is now redundant but still correct.** The stop remains the thing
  that catches it in weeks when GitHub Actions does not run; the start simply means the instance was not
  going to be stopped for seven days anyway.
- The per-PR logical databases are reclaimed by `teardown-sandbox-pr.sh` (see its §1), which is the "just
  clean up the current PR sandbox tables" half of the ruling. That path was broken for recipe previews until
  this same change; the census in `db-bootstrap/perPrInventory.ts` is what will say whether the backlog it
  left is bounded.
