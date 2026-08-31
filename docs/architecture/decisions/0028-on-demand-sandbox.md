# 0028 — On-demand sandboxes: a button in GitHub, and midnight teardown

- Status: Accepted
- Date: 2026-08-27
- Deciders: owner, platform
- Related: [0005](0005-environment-tagging-and-pr-cleanup.md), [0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md), [0007](0007-sandbox-cost-controls.md), [0010](0010-ensure-exists-per-pr-deploy-gate.md)

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
expiry and — when no sandbox is live at all — stops the shared sandbox tier.

**4. ADR-0010's ensure-exists gate gains a precondition.** `deploy-gate.sh decide` takes `<intent>` as a
new REQUIRED first parameter; absence of a stack no longer deploys on its own.

**5. ADR-0007's 09:00 start schedule is deleted.** The 00:00 stop survives.

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
broken behind a green check. Under on-demand, absent stops meaning "broken" and starts meaning
"deliberately reaped at midnight" — so ensure-exists, left alone, **rebuilds every environment on the first
push after the reaper ran**. Silently. Behind a green check. That is ADR-0010's own failure mode running
backwards, and it would restore the entire bill while every signal stayed green.

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

The start would resurrect the whole tier every weekday morning regardless of intent, silently undoing the
reaper. The stop is kept for a **different** reason than "backstop": it is the thing that catches the 7-day
RDS auto-restart in the weeks when GitHub Actions does not run at all. The scheduler Lambda keeps its
`start` action — that is how the button wakes the tier — only the _schedule_ is removed.

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
- Expected saving **$30–45/month**, on top of the $101 already recovered from Container Insights.
- **A sandbox can expire mid-session.** Press the button again — it re-stamps the expiry and redeploys,
  which is also how you extend one you are still working in.
- **The residual floor is the sandbox ALB (~$16.43/mo) and its RDS storage.** An ALB cannot be stopped, only
  deleted, and deleting it requires tearing down every stack importing its listener ARN first — ADR-0002's
  export-in-use deadlock. Deliberately out of scope.
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

**That was measured, and the deadlock is one stack deep.** With the per-PR stacks reaped, all three live
exports of `kitchensink-alb-sandbox` have exactly ONE importer: `kitchensink-identity-service-sandbox`
(`SharedAlbArn` has none at all). Together the ALB and its two public IPv4 addresses cost **$23.73/month**,
billed around the clock for a tier that is live a few hours a week.

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
- **Sandbox identity CloudWatch log groups are destroyed and recreated**, so log history no longer survives
  across sandboxes.
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
