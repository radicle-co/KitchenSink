# 0005 — `Environment` tagging + tag/name-driven per-PR teardown

- **Status:** Accepted — _convention + cleanup implemented_. The four CDK apps tag at the `App` level (propagates to every resource); the **`cleanup` job in `.github/workflows/sandbox-deploy.yml`** runs on PR close. That job _replaced_ the prior name-only `*-pr-{N}` stack destroy with this tag/name-driven sweep — the per-PR feature workflow owns both deploy (templates) and teardown, so there is no separate cleanup workflow. Per-PR feature **deploy** (food etc.) is wired in the feature's deploy phase; until a feature deploys per-PR there is simply nothing for cleanup to match.
- **Date:** 2026-06-21
- **Area:** AWS resource lifecycle · cost · CDK tagging · CI teardown · global-vs-ephemeral split
- **Related:** `.github/workflows/sandbox-deploy.yml` (the `cleanup` + `reap-abandoned` jobs), `.github/scripts/teardown-sandbox-pr.sh` + `.github/scripts/pr-scope.sh` (+ its regression suite `packages/infra/global/__tests__/prScope.test.ts`), `packages/infra/global/__tests__/sandboxReclamationReachability.test.ts` (the reachability + export-lookup guards, _Update (2026-08-10)_), `.github/scripts/cfn-export.sh`, `packages/apps/commise/web/scripts/teardownPreviewDomain.ts`, ADR-0001 (the preview address this now reclaims), `packages/infra/global/bin/app.ts`, `packages/services/identity{,-webhooks}/infra/bin/app.ts`, `packages/services/food-service/infra/bin/app.ts`, `docs/CI_ARCHITECTURE.md`, ADR-0002 (the global infra it protects)

## ⚠️ Before you change this — the trap

- **Never name or tag a persistent/global resource with `pr-{N}` (or `Environment=pr-{N}`).** The cleanup deletes by `Environment=pr-{N}` tag **or** a `pr-{N}` name match — there is deliberately **no denylist**; the precision of "only `pr-{N}` matches" is the entire safety model. A global resource that accidentally carries a `pr-{N}` name/tag will be deleted on PR close.
- **The match requires a delimiter:** a name belongs to PR _N_ only if it is exactly `pr-{N}` or starts with `pr-{N}-`. A plain `starts-with("pr-1")` would also match `pr-15` / `pr-100`. `pr_scope_belongs` / `pr_scope_path_belongs` in **`.github/scripts/pr-scope.sh`** enforce this — do not relax them to a bare prefix, do not add a second matcher elsewhere, and do not add an "orphaned-looking" sweep. They are regression-tested by `packages/infra/global/__tests__/prScope.test.ts`, which executes the real shell functions (a TypeScript copy would be free to drift) and asserts that every persistent name — `kitchensink-identity-service-*`, `kitchensink-{data,network,alb,domain,global}-*`, `sandbox`, `prod` — answers **false**.
- **Global stays global.** Identity, networking, RDS, domain, the shared ALB, and the webhook lambdas are `Environment=global` and named `kitchensink-*` even in the sandbox stage. They are persistent and must never be torn down per-PR (ADR-0002 — replacing the network/data stacks replaces the RDS).

## Context

- Stack teardown only removes what a CloudFormation stack owns. Per-deploy / out-of-band resources (ECR repos created by the deploy workflow, ECS Container Insights log groups) orphan and accumulate.
- We want **ephemeral feature services** (food, and every future non-global service/lambda) to be deployed per-PR and **fully cleaned up when the PR closes**, while the **shared platform** persists.
- A denylist of "things not to delete" is fragile (easy to forget a new global stack). An **allowlist-by-construction** — only ever delete what is explicitly marked `pr-{N}` — is safer and self-maintaining.

## Decision

1. **Tag everything with `Environment`, at the CDK `App` level** (so it propagates to every taggable resource):
    - **`global`** — `kitchensink-{network,data,domain,global,alb}-{stage}` (global infra app), `kitchensink-identity-service-{stage}`, `kitchensink-identity-webhooks-{stage}`. Persistent; never per-PR.
    - **`pr-{N}`** — a non-global feature service deployed for an open PR (`stage = pr-{N}`). Ephemeral.
    - food's app sets `Environment = stage.startsWith('pr-') ? stage : 'global'`.
2. **Name ephemeral resources with a `pr-{N}` prefix** where the resource type allows it (stacks, ECR repos), so the cleanup can find resources that could not be tagged (auto-created log groups, etc.) by name as well as by tag.
3. **The `cleanup` job in `sandbox-deploy.yml` (on PR close) deletes anything matching `pr-{N}` — by tag OR by name — with no denylist.** All of it lives in `.github/scripts/teardown-sandbox-pr.sh`, which both `cleanup` and the daily `reap-abandoned` job call so the two cannot drift. It deletes the PR's CloudFormation stacks (feature stacks use the suffix `kitchensink-{service}-pr-{N}` convention and are caught by the `Environment=pr-{N}` tag — **not** by `belongs`, which is a prefix rule), sweeps remaining `Environment=pr-{N}`-tagged resources (deleting log groups + ECR, reporting any other type for a future handler), and sweeps `pr-{N}`-named log groups + ECR repos.
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

## Update (2026-08-10) — reclamation must be REACHABLE, and a silent reaper is not a working reaper

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
`packages/infra/global/__tests__/ecsQuiesce.integration.test.ts`, which executes the real script against a
stubbed AWS CLI and asserts the call ORDER (a wait that ran before the deletes, or not at all, is the whole bug).

**Pattern worth naming: `list-exports` + `--query` is broken per-page, and it has now bitten twice.**
`ListExports` pages at 100 items and the AWS CLI applies `--query` to EACH page, printing one result per page.
`cfn-export.sh` was created after the first outbreak (ten call sites, a sandbox deploy aborting on an export that
demonstrably existed); the reclamation jobs were the **second** confirmed instance, and there the two-line value
did not merely mislead a guard — it produced an `Invalid format 'None'` `$GITHUB_OUTPUT` write that killed the
step. Treat any new `aws cloudformation list-exports … --query` as a defect on sight; analyzer 2 of
`sandboxReclamationReachability.test.ts` now enforces that across every workflow.

**Known residues found while reclaiming, NOT fixed here** — each is a real leak, each deserves its own change:

- **ECS Container Insights log groups are never matched.** `/aws/ecs/containerinsights/kitchensink-{service}-pr-{N}-…Cluster…/performance` survives even a clean stack delete: it is untagged, and `pr_scope_path_belongs`
  requires the `pr-{N}` token to START a `/`-delimited segment while ECS puts it mid-segment. pr-61's group
  outlived its stack by a month. Note the predicate's own docstring names this exact log group as its reason
  for existing, and its closing clause (`… and out of /…/service-pr-1`) deliberately excludes the real shape —
  so the intent and the implementation disagree, and reconciling them means amending a **documented security
  decision**. Deliberately left for the owner rather than widened unilaterally; a bare suffix match here is
  exactly what ADR-0005 warns against. Cost is small (empty performance groups) but it is unbounded growth.
- **A failed per-PR food DB drop is only a `::warning::` — and that failure is IRREVERSIBLE.** This contradicts
  decision 5 above ("failures are errors, not warnings"), and it is worse here than the phrase suggests. The
  drop must run _before_ the stack delete because the in-VPC migration Lambda is the only thing that can reach
  the `PRIVATE_ISOLATED` RDS — and that Lambda is destroyed with the stack seconds later. So a swallowed drop
  failure has **no second chance**: the reaper cannot retry it, because the tool is gone. The database is then
  orphaned in the shared instance with no in-band way to remove it.
  Observed live on pr-73: its drop failed with PostgreSQL 53300 `sorry, too many clients already`, the run
  emitted a warning, the stack deleted, and `kitchensink_food_pr_73` is now unreachable. Connections on the
  shared `db.t4g.micro` were ~22–25 steady and spiked to 45 during teardown, so the drop is competing for
  connection slots with the very orphans it is cleaning up — though the exact ceiling being hit (instance
  `max_connections`, which is the RDS default formula, versus a role/database `CONNECTION LIMIT`) was **not**
  determined and should be confirmed before sizing any fix.
  pr-57 and pr-59 are in the same state. Every later PR dropped cleanly (`{"dropped":"dropped"}`), so the
  mechanism is sound — it is the error handling that is not. `teardown-sandbox-pr.sh` also sends the invoke's
  stderr to `/dev/null`, hiding the reason. Both branches should be `::error::` + `teardown_failed=1`, and the
  drop should be retried before the stack delete proceeds. Not changed here on purpose: the script was in use
  by the reclamation running at the time, and a behaviour change to it needs a shim-based test of its own.

## Alternatives considered

- **Denylist of global stacks** — rejected; fragile (forget to add a new global stack → it gets deleted) and the opposite of fail-safe.
- **Delete by stage name only (`*-pr-{N}`)** — insufficient; misses out-of-band/auto-created resources (ECR, Container Insights log groups) that the stack does not own.
- **Rely on CloudFormation stack deletion alone** — insufficient for the same reason; the orphan audit (2026-06-21) found ~30 orphaned log groups + 3 empty ECR repos that stack teardown left behind.

## Implementation guards

- The `pr-{N}` match lives once, in `.github/scripts/pr-scope.sh`, and uses an exact-or-`pr-{N}-` delimiter, not a bare prefix. The token itself must be exactly `pr-{N}` (`^pr-[0-9]+$`) — the older `pr-[0-9]*` glob also admitted e.g. `pr-1x`.
- The DNS scope (`previewHostForPrToken` / `prTokenForPreviewRecordName`, `packages/apps/commise/web/scripts/previewDomainScope.ts`) is exact **label equality**, lives in ONE module that both the creation and teardown commands import — there is deliberately no second matcher — and every Route 53 and Vercel adapter in both re-asserts it. `__tests__/teardownPreviewDomain.test.ts` and `__tests__/createPreviewDomain.test.ts` each assert the apex, the `*`/`\052` wildcard, the ACM validation records and `identity.sandbox.…` are never touched — including when they arrive on the same `ListResourceRecordSets` page as the preview record — and that the cross-provider call order cannot be swapped.
- The daily `reap-abandoned` job additionally discovers candidate tokens from **Route 53 record names**. Without that source, a PR that only ever had a web preview owns no stack, ECR repo or log group and its dangling CNAME would be invisible to the reaper forever.
- Global apps tag `Environment=global` at the `App` root (`Tags.of(app).add(...)`), verified by `cdk synth` (the tag appears on stack resources).
