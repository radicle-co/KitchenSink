# 0005 — `Environment` tagging + tag/name-driven per-PR teardown

- **Status:** Accepted
- **Date:** 2026-06-21
- **Area:** AWS resource lifecycle · cost · CDK tagging · CI teardown · global-vs-ephemeral split
- **Related:** `.github/workflows/sandbox-deploy.yml` (the `cleanup` + `reap-abandoned` jobs), `.github/scripts/teardown-sandbox-pr.sh` + `.github/scripts/pr-scope.sh` (+ its regression suite `packages/infra/global/__tests__/prScope.test.ts`), `packages/infra/global/__tests__/sandboxReclamationReachability.test.ts` (the reachability + export-lookup guards, _Update (2026-08-10)_), `.github/scripts/cfn-export.sh`, `packages/apps/commise/web/scripts/teardownPreviewDomain.ts`, ADR-0001 (the preview address this now reclaims), `packages/infra/global/bin/app.ts`, `packages/services/identity{,-webhooks}/infra/bin/app.ts`, `packages/services/food-service/infra/bin/app.ts`, `docs/CI_ARCHITECTURE.md`, ADR-0002 (the global infra it protects)

## ⚠️ Before you change this — the trap

- **Never name or tag a persistent resource with a `pr-{N}` token.** The cleanup deletes by an `Environment` tag value the PR owns **or** a `pr-{N}` name match — there is deliberately **no denylist**; the precision of "only a `pr-{N}` token matches" is the entire safety model. A persistent resource that accidentally carries a `pr-{N}` name/tag will be deleted on PR close.
- ⛔ **The persistent tag value is a TIER word (`sandbox` / `production`), and a tier word is not a protection word.** Nothing derives protection from the string itself. What protects the persistent tier is that every matcher is keyed on a `pr-{N}` token, a token always contains digits, and neither tier word contains one — so no token can produce either value under equality, the name-prefix rule, or the both-sides-anchored path rule. That is the property to preserve; a future tier word containing a digit would break it.
- ⚠️ **The per-PR value `pr-{N}-sandbox` CONTAINS the persistent value `sandbox`.** The earlier `pr-{N}` / `global` pair shared no substring, so "can a per-PR matcher reach a persistent value" was a question nobody had to ask. It is now asked and answered, in both directions, by `packages/infra/global/__tests__/environmentTagScheme.test.ts` — which reads the value out of each CDK app's own expression and feeds it to the real `bash` predicates.
- **The match requires a delimiter:** a name belongs to PR _N_ only if it is exactly `pr-{N}` or starts with `pr-{N}-`. A plain `starts-with("pr-1")` would also match `pr-15` / `pr-100`. `pr_scope_belongs` / `pr_scope_path_belongs` in **`.github/scripts/pr-scope.sh`** enforce this — do not relax them to a bare prefix, do not add a second matcher elsewhere, and do not add an "orphaned-looking" sweep. They are regression-tested by `packages/infra/global/__tests__/prScope.test.ts`, which executes the real shell functions (a TypeScript copy would be free to drift) and asserts that every persistent name — `kitchensink-identity-service-*`, `kitchensink-{data,network,alb,domain,global}-*`, `sandbox`, `prod` — answers **false**.
- **The persistent tier stays persistent.** Identity, networking, RDS, domain, the shared ALB, and the webhook lambdas are tagged with their tier (`sandbox` in the non-prod stages, `production` in prod) and named `kitchensink-*`. They must never be torn down per-PR (ADR-0002 — replacing the network/data stacks replaces the RDS).

## Context

- Stack teardown only removes what a CloudFormation stack owns. Per-deploy / out-of-band resources (ECR repos created by the deploy workflow, ECS Container Insights log groups) orphan and accumulate.
- We want **ephemeral feature services** (food, and every future non-global service/lambda) to be deployed per-PR and **fully cleaned up when the PR closes**, while the **shared platform** persists.
- A denylist of "things not to delete" is fragile (easy to forget a new global stack). An **allowlist-by-construction** — only ever delete what is explicitly marked `pr-{N}` — is safer and self-maintaining.

## Decision

1. **Tag everything with `Environment`, at the CDK `App` level** (so it propagates to every taggable resource). The value names the TIER a resource lives in, and — for an ephemeral one — the PR that owns it:
    - **`production`** — anything deployed at the prod stage, persistent by definition.
    - **`sandbox`** — anything deployed at a persistent non-prod stage: `kitchensink-{network,data,domain,global,alb}-sandbox` (global infra app), `kitchensink-identity-service-sandbox`, `kitchensink-identity-webhooks-sandbox`, the sandbox router singleton.
    - **`pr-{N}-sandbox`** — a non-global feature service deployed for an open PR (`stage = pr-{N}`). Ephemeral, and the only class the cleanup deletes. It carries the tier as well as the token because a preview IS inside the sandbox tier, and because the resulting value is then readable without knowing this document.
    - **`global`** — ACCOUNT-scoped infrastructure: one for the whole AWS account, with no stage at all. Today that is `kitchensink-cost-guardrails` — the monthly budget and the cost anomaly monitor, which watch every stage's spend including sandbox's (ADR-0008).
      ⛔ **This is a third CATEGORY, not a third tier word.** `sandbox` and `production` name a stage; there is one shared platform per stage. `global` names the account; there is one, ever. Collapsing them is what put an account-scoped stack inside the per-stage app behind `if (stage === 'prod')` — which produced the right NUMBER of copies by the wrong mechanism, made the account's cost monitoring untouchable without a production deploy, and labelled an account-wide resource `production`. The two now have separate apps (`bin/account.ts` and `bin/app.ts`) and separate pipelines, and the account app declares no `stage` variable at all, so a per-stage deploy of it is not refused — it is unrepresentable.
      ⚠️ It is safe for the same reason the tier words are, not for a different one: `global` carries no digits, so no `pr-{N}` token can produce it under any matcher. `environmentTagScheme.test.ts` derives all three categories from the apps' own expressions and asserts that in both directions.
    - Every CDK app resolves the value from its stage rather than hardcoding it — except an account-scoped app, which HAS no stage to resolve from and states the constant `global`. A per-PR-capable app sets
      ``stage.startsWith('pr-') ? `${stage}-sandbox` : stage === 'prod' ? 'production' : 'sandbox'``, and an app
      that only ever deploys persistent infrastructure sets `stage === 'prod' ? 'production' : 'sandbox'`. The
      two forms are deliberately distinct: an app that cannot express a per-PR value cannot mis-tag the shared
      tier as ephemeral, and the guard that requires ADR-0028's expiry tag derives its population from exactly
      that distinction. The roster is not enumerated here — it has grown twice — and what matters is that a new
      app adopts the rule; `environmentTagCoverage.test.ts` discovers every app by content, so it cannot opt out.
    - **A teardown accepts BOTH the current and the pre-change spelling.** Resources tagged `pr-{N}` before the
      scheme moved are still live and still that PR's to reclaim, so `pr_scope_environment_tag_belongs` accepts
      the bare token as well, and the sweeps' `Values=` filter enumerates both. This is a property of the rule,
      not a migration step to remove: accepting a value the scheme no longer emits costs nothing (no persistent
      resource can carry it), while refusing it would make every already-deployed preview unreapable.
    - ⚠️ The web router app tags with `Tags.of(app)` while every other app is told NOT to, and that is
      deliberate rather than an inconsistency: the aspect form would rewrite every taggable resource on
      every commit, which matters for the apps whose stacks churn. `Environment` is invariant for a given
      stack — it can only move when the stage does, which is a different stack — so the rewrite it would
      cause never happens here. The app's own comment carries the reasoning.

2. **Name ephemeral resources with a `pr-{N}` prefix** where the resource type allows it (stacks, ECR repos), so the cleanup can find resources that could not be tagged (auto-created log groups, etc.) by name as well as by tag.
3. **The `cleanup` job in `sandbox-deploy.yml` (on PR close) deletes anything matching `pr-{N}` — by tag OR by name — with no denylist.** All of it lives in `.github/scripts/teardown-sandbox-pr.sh`, which both `cleanup` and the daily `reap-abandoned` job call so the two cannot drift. It deletes the PR's CloudFormation stacks (feature stacks use the suffix `kitchensink-{service}-pr-{N}` convention and are caught by the `Environment` tag — **not** by `belongs`, which is a prefix rule), sweeps the resources carrying one of this PR's `Environment` values (deleting log groups + ECR, reporting any other type for a future handler), and sweeps `pr-{N}`-named log groups + ECR repos.
    - ⛔ **A tag is matched by EQUALITY against a closed set, never by the name prefix rule.** The values come
      from what the CDK apps emit, and the tagging API's `--tag-filters Key=…,Values=…` can only express exact
      values anyway, so the two halves of the same question — the per-stack read and the account-wide sweep —
      are one definition in `pr-scope.sh` (`pr_scope_environment_tag_belongs` / `…_tag_values`). Applying
      `pr_scope_belongs` to a tag would newly admit `pr-{N}-anything`, widening the one match this ADR says
      must never widen.
    - ⚠️ **A tag sweep that matches nothing reports success.** That is why the filter is not allowed to be a
      literal: `ecs-quiesce.sh`'s exact `Values=$pr` would have drained nothing under a changed value, and the
      only symptom would have been per-PR stacks failing to delete on their capacity-provider association for a
      reason no code change explained.
    - ⚠️ The script does more than the sweep. `.github/scripts/teardown-sandbox-pr.sh` runs, in order:
      §0 the preview address (ADR-0001), §0b the legacy `sandbox-preview/pr-{N}` GitHub Environment (a
      draining, finite reclamation — no new ones are created, and the block is marked for deletion once the
      last drains), §0c a wake of the on-demand sandbox tier (ADR-0028) so the in-VPC drop door is
      reachable, §1 the per-PR logical-database drop via ADR-0031's `PerPrDatabaseReaperFunction`,
      `.github/scripts/ecs-quiesce.sh`, then §2–§4 the stacks, tagged sweep and named sweep. Read the
      script's section headers, not this bullet, before changing
      the order.
4. **The preview's PUBLIC ADDRESS is created AND reclaimed here, because CloudFormation owns neither** (added 2026-07-28; ADR-0001's _Update (2026-07-28)_ items 1 and 3). A sandbox web preview is reachable through a Route 53 `CNAME pr-{N}.sandbox.{domain} → cname.vercel-dns.com`, a Vercel project-domain binding and a per-deployment alias, none of which is a stack resource — so before this, a closed PR left the CNAME pointing at a provider where the hostname was no longer claimed, i.e. a **subdomain-takeover vector**. `packages/apps/commise/web/scripts/teardownPreviewDomain.ts` removes all of it (releasing the project domain drops the alias bound through it), and the teardown script runs it **first**, before any stack delete (which can hang for many minutes). Its mirror, `createPreviewDomain.ts`, provisions the same address from the `preview-domain` job on every non-closed PR event, in the **inverse** order — claim, then publish DNS, then alias — for the reason in the first bullet below. Both import their `pr-{N}` scope from the one shared `previewDomainScope.ts`. Two properties are load-bearing:
    - **DNS is deleted BEFORE the Vercel claim is released** — and, symmetrically, the claim is taken BEFORE DNS is created. The takeover window is exactly "record still points at Vercel, nobody claims the name", so an interrupted run in either direction may only ever leave the safe half-state (claimed, not resolving).
    - **The DNS scope is stricter than the name scope: exact label equality.** The preview zone also holds `sandbox.{domain}` (apex), the `*.sandbox` wildcard alias, ACM validation CNAMEs, and `identity.sandbox.{domain}` — the single **shared, persistent** identity service every preview authenticates against. A record belongs to PR _N_ only when its first label is exactly `pr-{N}`; `pr-{N}-…` does **not** qualify in DNS. Both adapters re-assert that at the point of action rather than trusting the caller, because an over-broad DNS delete would take every preview down at once — strictly worse than the dangling record it fixes.
5. **Failures are errors, not warnings.** Both jobs exit non-zero when any step could have left a resource behind; a green run that quietly warned about a dangling CNAME is how the hole stays open.

## Consequences

**Positive**

- Ephemeral feature infra is reclaimed automatically on PR close — no orphan accumulation, no per-PR cost creep.
- The safety model is self-maintaining: a new global stack is safe by default (it is `kitchensink-*` / `Environment=global` and simply never matches `pr-{N}`).

**Negative / costs**

- Discipline required: every **feature** service MUST tag `Environment=pr-{N}` (the food app does — this is what catches its suffix-named `kitchensink-{service}-pr-{N}` stacks); untaggable resources (auto-created log groups, out-of-band ECR repos) should additionally be named with a `pr-{N}` prefix so the name sweep finds them. A shared helper is worth extracting when the second feature service lands.
- A resource type that the sweep does not yet know how to delete is **reported, not deleted** (it shows as a `::warning::`) — extend the `case` in step 2 when a new taggable-but-not-stack-owned type appears.
- Pre-existing orphans (created before this convention) carry no `Environment` tag and are not matched — they need a one-off manual sweep.
- **Changing the tag's VALUE is an in-place update for every resource type in these stacks except two.** `AWS::CE::AnomalyMonitor` and `AWS::CE::AnomalySubscription` (ADR-0008's cost guardrails) take their tags through `ResourceTags`, which CloudFormation documents as `Update requires: Replacement` on both types — every other property of the monitor is replacement-only too, so that resource is effectively immutable. The replacement is safe rather than merely tolerable: the monitor's identity is its generated `MonitorArn` (what `Ref` returns), `MonitorName`/`SubscriptionName` are labels with a documented minimum length of 0 and `CreateAnomalyMonitor` declares no conflict error, and the only reference to either is the intra-stack `Fn::GetAtt` between them. What it does cost is detection continuity: AWS states that after a monitor is created you "might start receiving alerts within 24 hours", so a rename of the tier words puts a bounded ramp between the deploy and the next anomaly alert. Any future change to the tag scheme pays that again.
  ⚠️ **This scheme does not pay it.** The account-scoped stack keeps `Environment=global`, which is the value
  it already carries in the live account, so its two Cost Explorer resources are not replaced and no
  detection gap opens. That was not luck: an earlier draft of this scheme retagged it `production` — treating
  account-scope as a tier — and the replacement was the cost of that mistake rather than of the rename.

## Amendment — reclamation must be REACHABLE, and a silent reaper is not a working reaper

Both reclamation paths were dead for 13 days and neither said so in a way anyone read. Two merged PRs' stacks
sat in `DELETE_FAILED` from 2026-07-05; nine more (73, 77–83, 90) were never even _attempted_, leaving **27
live Fargate tasks** billing for closed work behind green-looking checks.

**Cause.** `a75bdcd7` (2026-07-28) added a preview-DNS prerequisite step, `Resolve the sandbox hosted zone`,
ahead of the teardown step in **both** the `cleanup` and `reap-abandoned` jobs, ending in `exit 1` when the
lookup came back empty. The lookup then failed permanently: it used the unpaginated
`list-exports … --query "Exports[?Name=='…'].Value | [0]"` idiom, which the AWS CLI applies **per page**, so
with 196 exports in the account it returned the two-line `"Z0474…\nNone"`. The `= "None"` guard compares the
whole two-line string and does not match, so the multi-line value reached `$GITHUB_OUTPUT` and GitHub rejected
it — `Invalid format 'None'`. The step failed, and a failed step skips the rest of the job, so
`teardown-sandbox-pr.sh` never executed. The daily reaper reached `main` (via PR #73) already carrying the
defect and **failed all 11 runs it has ever made**, which also meant the only retry path for the two
`DELETE_FAILED` stacks never ran. Both were reclaimed on the first plain retry once it did.

**Two things were wrong, and only one of them was the bug.**

1. The trigger — the unpaginated idiom — was already fixed once, in `.github/scripts/cfn-export.sh`.
2. The **coupling** was the real defect: a prerequisite for ONE part of teardown (the DNS record) could cancel
   _all_ of it, including the stacks, ECR repos and log groups that need no hosted zone whatsoever. Worse, the
   script was already written to degrade correctly here — section 0 records an `::error::`, sets
   `teardown_failed=1` and carries on — so the workflow bypassed the script's own robustness.

**Decided.**

- **No step preceding the teardown invocation may deliberately abort.** An unmeetable prerequisite is reported
  and passed to the script as an EMPTY value; the script then reclaims everything it can and exits non-zero,
  which fails the job just as loudly without leaking. Both zone steps use `cfn-export.sh --optional`, and
  neither may regain an `exit`.
- **Each teardown step carries `if: ${{ !cancelled() }}`.** The rule above removes _deliberate_ aborts; this
  removes the consequence of any other failure, because GitHub skips every remaining step once one fails — and
  the fatal step here failed by writing a malformed `$GITHUB_OUTPUT` line, not by exiting. The teardown now runs
  on its own merits and reports its own outcome. `!cancelled()` rather than `always()` on purpose: a cancelled
  run must not start deleting infrastructure. Same double protection as the deploy ordering in ADR-0010 — a
  structural rule AND an explicit condition, so neither alone is load-bearing.
- **The reaper fails when it had to repair something the on-close path owed it.** A CloudFormation stack for a
  PR closed more than `STALE_ORPHAN_DAYS` (2) ago is proof `cleanup` did not work, so the sweep reports it as
  an error even though the reap itself succeeded. Previously "the reaper found nothing to do" and "the reaper
  never ran" were indistinguishable from outside — which is precisely how this stayed invisible. The signal is
  keyed on a **stack**, not on any leftover token, so it reports real un-reclaimed infrastructure and stays
  silent in steady state.
- All of it is enforced by `packages/infra/global/__tests__/sandboxReclamationReachability.test.ts`, which
  parses the workflow YAML: analyzer 1 removes the _coupling_, analyzer 2 removes the _trigger_ (every export
  lookup is pinned to the shared helper), analyzer 3 removes the _consequence_. Neither `actionlint` nor
  `zizmor` can see any of these failures — the YAML is valid and the shell is well-formed.

**The second independent reason teardown never worked: a per-PR stack CANNOT delete its own ECS cluster, and no
number of retries fixes it.** Every per-PR service stack delete failed on:

```
AWS::ECS::ClusterCapacityProviderAssociations  DELETE_FAILED
  "The specified capacity provider is in use and cannot be removed."  (AmazonECS, 400, ResourceInUseException)
```

CloudFormation deletes the ECS _service_ before the association, but `DeleteService` returns while the tasks are
still DRAINING — so the association delete arrives while `FARGATE_SPOT` is still referenced, and the cluster, and
therefore the whole stack, lands in `DELETE_FAILED`. Nine stacks across five merged PRs (73, 77, 78, 79, 80 —
food and recipe) were sitting on exactly this, some since 2026-07-05.

**This is non-prod-only, and it is a cost-lever regression.** ADR-0008 puts non-prod Fargate tasks on
`FARGATE_SPOT`; binding a service to a capacity provider requires the cluster to advertise it, so the CDK sets
`enableFargateCapacityProviders: useSpot` — which emits the association resource **only when spot is on**.
Verified against the live account: `kitchensink-food-service-prod` has no such resource,
`kitchensink-food-service-pr-81` does. So the association exists exclusively in the stages that get torn down,
and prod — the one stage never deleted — is the only stage that cannot hit it. The code path that breaks is the
one no prod deploy exercises, which is why it went unseen.

**The fix is ORDERING, not retrying** — a retry re-fails for as long as the reference stands, so
`DELETE_FAILED` in the reaper's status filter was never going to be enough on its own.
`.github/scripts/ecs-quiesce.sh` (called by `teardown-sandbox-pr.sh` before any stack delete) force-deletes every
service in the PR's clusters, stops standalone tasks — the food change-refresh `RunTask` binds `FARGATE_SPOT`
too — and then WAITS on the CLI's own `services-inactive` / `tasks-stopped` waiters. Clusters are discovered only
by an exact `Environment=pr-{N}` tag, the same authority that already licenses deleting whole stacks, so nothing
is widened; the per-PR cluster NAME is deliberately not used, because `pr_scope_belongs` is a prefix rule and
loosening it is what this ADR forbids. Proven live: pr-82, pr-83 and pr-90 deleted all three stacks cleanly with
no `DELETE_FAILED` at all, where every earlier PR had left two. Covered by
`packages/infra/global/tests/ecsQuiesce.integration.test.ts` (an integration tier, so it lives in `tests/` rather than `__tests__/`), which executes the real script against a
stubbed AWS CLI and asserts the call ORDER (a wait that ran before the deletes, or not at all, is the whole bug).

**Pattern worth naming: `list-exports` + `--query` is broken per-page, and it has now bitten twice.**
`ListExports` pages at 100 items and the AWS CLI applies `--query` to EACH page, printing one result per page.
`cfn-export.sh` was created after the first outbreak (ten call sites, a sandbox deploy aborting on an export that
demonstrably existed); the reclamation jobs were the **second** confirmed instance, and there the two-line value
did not merely mislead a guard — it produced an `Invalid format 'None'` `$GITHUB_OUTPUT` write that killed the
step. Treat any new `aws cloudformation list-exports … --query` as a defect on sight; analyzer 2 of
`sandboxReclamationReachability.test.ts` now enforces that across every workflow.

**Two leaks found while reclaiming have since been closed**, and are recorded here only because the shape
recurs — both were cases where the sweep looked correct and matched nothing.

- **ECS Container Insights log groups went unmatched.** `pr_scope_path_belongs` now anchors the token on
  BOTH sides (`[[ ${2-} =~ (^|[/-])"$1"([/-]|$) ]]`), so it matches mid-segment while `pr-5` still cannot
  claim `…-pr-57-…` and `pr-57` cannot claim `…-pr-570-…`. `prScope.test.ts` pins three real live
  log-group names plus a suffix-confusion negative.
- **A failed per-PR database drop was only a `::warning::`, and irreversible.** Both halves are closed: a
  failed drop is now an `::error::` plus `teardown_failed=1` (owner ruling — the severities disagreed, and
  backwards), the stderr is printed rather than discarded, and the script greps the invoke response for
  `FunctionError` because a Lambda that threw still exits 0. The "no second chance" argument no longer
  holds either — the drop door moved out of the per-PR stack into ADR-0031's `PerPrDatabaseReaperFunction`
  in `DataStack`, which outlives every per-PR stack, so a failed drop is retryable by the daily reaper.

## Alternatives considered

- **Denylist of global stacks** — rejected; fragile (forget to add a new global stack → it gets deleted) and the opposite of fail-safe.
- **Delete by stage name only (`*-pr-{N}`)** — insufficient; misses out-of-band/auto-created resources (ECR, Container Insights log groups) that the stack does not own.
- **Rely on CloudFormation stack deletion alone** — insufficient for the same reason; the orphan audit (2026-06-21) found ~30 orphaned log groups + 3 empty ECR repos that stack teardown left behind.

## Implementation guards

- The `pr-{N}` match lives once, in `.github/scripts/pr-scope.sh`, and uses an exact-or-`pr-{N}-` delimiter, not a bare prefix. The token itself must be exactly `pr-{N}` (`^pr-[0-9]+$`) — the older `pr-[0-9]*` glob also admitted e.g. `pr-1x`.
- The DNS scope (`previewHostForPrToken` / `prTokenForPreviewRecordName`, `packages/apps/commise/web/scripts/previewDomainScope.ts`) is exact **label equality**, lives in ONE module that both the creation and teardown commands import — there is deliberately no second matcher — and every Route 53 and Vercel adapter in both re-asserts it. `__tests__/teardownPreviewDomain.test.ts` and `__tests__/createPreviewDomain.test.ts` each assert the apex, the `*`/`\052` wildcard, the ACM validation records and `identity.sandbox.…` are never touched — including when they arrive on the same `ListResourceRecordSets` page as the preview record — and that the cross-provider call order cannot be swapped.
- The daily `reap-abandoned` job additionally discovers candidate tokens from **Route 53 record names**. Without that source, a PR that only ever had a web preview owns no stack, ECR repo or log group and its dangling CNAME would be invisible to the reaper forever.
- Every app tags `Environment` at the `App` root (`Tags.of(app).add(...)`) rather than on the stack, because the sweep in step 3 reads RESOURCE-level tags and a stack-only tag is invisible to it. `environmentTagCoverage.test.ts` asserts the call by AST over every discovered app; `environmentTagScheme.test.ts` asserts the VALUE it produces — evaluating each app's own expression per stage and putting the result through the real shell predicates, in both the "every preview value is reclaimed" and "no persistent value is ever claimed" directions. A stack-level `Tags.of(this)` override is permitted only for a stack with no stage to derive from (`CostGuardrailsStack`, account-scoped) and only when it names a tier word; that too is asserted rather than trusted.
- The nightly sandbox scheduler (ADR-0007/ADR-0028) selects a per-PR cluster by the same tag, and its own anchored pattern accepts both spellings. It keeps matching the SHARED sandbox tier by NAME: a tier word cannot distinguish the shared tier from a preview inside it, and widening the tag door to the bare word would put both classes through one predicate with the prod interlock as the only remaining guard.
