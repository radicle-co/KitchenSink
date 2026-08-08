# 0005 — `Environment` tagging + tag/name-driven per-PR teardown

- **Status:** Accepted — _convention + cleanup implemented_. The four CDK apps tag at the `App` level (propagates to every resource); the **`cleanup` job in `.github/workflows/sandbox-deploy.yml`** runs on PR close. That job _replaced_ the prior name-only `*-pr-{N}` stack destroy with this tag/name-driven sweep — the per-PR feature workflow owns both deploy (templates) and teardown, so there is no separate cleanup workflow. Per-PR feature **deploy** (food etc.) is wired in the feature's deploy phase; until a feature deploys per-PR there is simply nothing for cleanup to match.
- **Date:** 2026-06-21
- **Area:** AWS resource lifecycle · cost · CDK tagging · CI teardown · global-vs-ephemeral split
- **Related:** `.github/workflows/sandbox-deploy.yml` (the `cleanup` + `reap-abandoned` jobs), `.github/scripts/teardown-sandbox-pr.sh` + `.github/scripts/pr-scope.sh` (+ its regression suite `packages/infra/global/__tests__/pr-scope.test.ts`), `packages/apps/commise/web/scripts/teardownPreviewDomain.ts`, ADR-0001 (the preview address this now reclaims), `packages/infra/global/bin/app.ts`, `packages/services/identity{,-webhooks}/infra/bin/app.ts`, `packages/services/food-service/infra/bin/app.ts`, `docs/CI_ARCHITECTURE.md`, ADR-0002 (the global infra it protects)

## ⚠️ Before you change this — the trap

- **Never name or tag a persistent/global resource with `pr-{N}` (or `Environment=pr-{N}`).** The cleanup deletes by `Environment=pr-{N}` tag **or** a `pr-{N}` name match — there is deliberately **no denylist**; the precision of "only `pr-{N}` matches" is the entire safety model. A global resource that accidentally carries a `pr-{N}` name/tag will be deleted on PR close.
- **The match requires a delimiter:** a name belongs to PR _N_ only if it is exactly `pr-{N}` or starts with `pr-{N}-`. A plain `starts-with("pr-1")` would also match `pr-15` / `pr-100`. `pr_scope_belongs` / `pr_scope_path_belongs` in **`.github/scripts/pr-scope.sh`** enforce this — do not relax them to a bare prefix, do not add a second matcher elsewhere, and do not add an "orphaned-looking" sweep. They are regression-tested by `packages/infra/global/__tests__/pr-scope.test.ts`, which executes the real shell functions (a TypeScript copy would be free to drift) and asserts that every persistent name — `kitchensink-identity-service-*`, `kitchensink-{data,network,alb,domain,global}-*`, `sandbox`, `prod` — answers **false**.
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

## Alternatives considered

- **Denylist of global stacks** — rejected; fragile (forget to add a new global stack → it gets deleted) and the opposite of fail-safe.
- **Delete by stage name only (`*-pr-{N}`)** — insufficient; misses out-of-band/auto-created resources (ECR, Container Insights log groups) that the stack does not own.
- **Rely on CloudFormation stack deletion alone** — insufficient for the same reason; the orphan audit (2026-06-21) found ~30 orphaned log groups + 3 empty ECR repos that stack teardown left behind.

## Implementation guards

- The `pr-{N}` match lives once, in `.github/scripts/pr-scope.sh`, and uses an exact-or-`pr-{N}-` delimiter, not a bare prefix. The token itself must be exactly `pr-{N}` (`^pr-[0-9]+$`) — the older `pr-[0-9]*` glob also admitted e.g. `pr-1x`.
- The DNS scope (`previewHostForPrToken` / `prTokenForPreviewRecordName`, `packages/apps/commise/web/scripts/previewDomainScope.ts`) is exact **label equality**, lives in ONE module that both the creation and teardown commands import — there is deliberately no second matcher — and every Route 53 and Vercel adapter in both re-asserts it. `__tests__/teardownPreviewDomain.test.ts` and `__tests__/createPreviewDomain.test.ts` each assert the apex, the `*`/`\052` wildcard, the ACM validation records and `identity.sandbox.…` are never touched — including when they arrive on the same `ListResourceRecordSets` page as the preview record — and that the cross-provider call order cannot be swapped.
- The daily `reap-abandoned` job additionally discovers candidate tokens from **Route 53 record names**. Without that source, a PR that only ever had a web preview owns no stack, ECR repo or log group and its dangling CNAME would be invisible to the reaper forever.
- Global apps tag `Environment=global` at the `App` root (`Tags.of(app).add(...)`), verified by `cdk synth` (the tag appears on stack resources).
