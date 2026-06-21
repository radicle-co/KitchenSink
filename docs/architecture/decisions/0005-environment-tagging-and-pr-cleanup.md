# 0005 — `Environment` tagging + tag/name-driven per-PR teardown

- **Status:** Accepted — _convention + cleanup implemented_. The four CDK apps tag at the `App` level (propagates to every resource); the **`cleanup` job in `.github/workflows/sandbox-deploy.yml`** runs on PR close. That job _replaced_ the prior name-only `*-pr-{N}` stack destroy with this tag/name-driven sweep — the per-PR feature workflow owns both deploy (templates) and teardown, so there is no separate cleanup workflow. Per-PR feature **deploy** (food etc.) is wired in the feature's deploy phase; until a feature deploys per-PR there is simply nothing for cleanup to match.
- **Date:** 2026-06-21
- **Area:** AWS resource lifecycle · cost · CDK tagging · CI teardown · global-vs-ephemeral split
- **Related:** `.github/workflows/sandbox-deploy.yml` (the `cleanup` job), `packages/infra/global/bin/app.ts`, `packages/services/identity{,-webhooks}/infra/bin/app.ts`, `packages/services/food-service/infra/bin/app.ts`, `docs/CI_ARCHITECTURE.md`, ADR-0002 (the global infra it protects)

## ⚠️ Before you change this — the trap

- **Never name or tag a persistent/global resource with `pr-{N}` (or `Environment=pr-{N}`).** The cleanup deletes by `Environment=pr-{N}` tag **or** a `pr-{N}` name match — there is deliberately **no denylist**; the precision of "only `pr-{N}` matches" is the entire safety model. A global resource that accidentally carries a `pr-{N}` name/tag will be deleted on PR close.
- **The match requires a delimiter:** a name belongs to PR _N_ only if it is exactly `pr-{N}` or starts with `pr-{N}-`. A plain `starts-with("pr-1")` would also match `pr-15` / `pr-100`. The `belongs`/`path_belongs` helpers in the workflow enforce this — do not relax them to a bare prefix.
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
3. **The `cleanup` job in `sandbox-deploy.yml` (on PR close) deletes anything matching `pr-{N}` — by tag OR by name — with no denylist.** It deletes the PR's CloudFormation stacks (feature stacks use the suffix `kitchensink-{service}-pr-{N}` convention and are caught by the `Environment=pr-{N}` tag), sweeps remaining `Environment=pr-{N}`-tagged resources (deleting log groups + ECR, reporting any other type for a future handler), and sweeps `pr-{N}`-named log groups + ECR repos.

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

- The `pr-{N}` match in the `cleanup` job of `.github/workflows/sandbox-deploy.yml` uses an exact-or-`pr-{N}-` delimiter (`belongs` / `path_belongs`), not a bare prefix.
- Global apps tag `Environment=global` at the `App` root (`Tags.of(app).add(...)`), verified by `cdk synth` (the tag appears on stack resources).
