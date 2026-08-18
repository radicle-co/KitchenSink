# CI architecture — sandbox (PR) vs prod (main)

CI is **two reusable workflows** — a BASE tier and a HEAVY tier — invoked by thin **callers**, with all
secret loading funneled through one **composite action**. This is the GitHub-native equivalent of "extend
a build template per run-type": the callers supply the only thing that differs — the `stage`.

```
.github/
  workflows/
    ci-pr.yml         # pull_request → _ci.yml       (stage=sandbox)
    ci-main.yml       # push: main   → _ci.yml       (stage=prod)
    heavy-e2e.yml     # nightly / dispatch / `heavy-e2e`-labelled PR → _ci-heavy.yml
    recipe-loadtest.yml # weekly / dispatch → _ci-heavy.yml (k6 only)
    ci-full.yml       # dispatch → BOTH, concurrently
    _ci.yml           # reusable: BASE tier — install, lint, format, typecheck, test,
                      #   integration, build matrix, e2e (backend / web / food / mobile-vitest)
    _ci-heavy.yml     # reusable: HEAVY tier — mobile Maestro (~50 min emulator + APK),
                      #   recipe k6, food k6
  actions/
    load-secrets/  # composite: configure AWS creds + load kitchensink/<stage>/identity/keys
```

## Why the tiers are two FILES and not two flags

The heavy jobs used to live in `_ci.yml` behind `run_mobile_maestro` / `run_load_test` inputs defaulting
to false. That worked, but **GitHub renders every job of a called workflow in every caller's run graph
regardless of its `if:`** — so each ordinary PR run displayed three permanently-`skipped` jobs. Clicking
one shows a job that never runs, with no explanation, which reads as a broken pipeline rather than a
deliberate tier. No `if:` can hide it; only moving the jobs to a workflow those callers do not call.

The split also deleted a third input, `run_base_jobs`, which existed so a heavy-only caller could switch
the base tier off. That was not merely duplicated compute: re-running the base tier from `heavy-e2e.yml`
started a **second concurrent `e2e-web`** on the same commit, and two Playwright suites against the shared
sandbox Clerk instance tear down each other's sign-in fixture (proof: commit `bbf7ea7c`, where ci-pr's
`e2e-web` passed 78/1 while the identical job in the other workflow failed). That collision is now
structurally impossible — `heavy-e2e.yml` cannot re-run a job that is not in the file it calls.

`_ci-heavy.yml` keeps its own copy of the `install` job, because a reusable workflow cannot `needs:` a job
in another workflow. On a labelled PR both files run `install` concurrently against the same cache key,
which is a benign no-op for whichever loses.

## How the split works

- **PRs** run `ci-pr.yml` → `_ci.yml` with `stage: sandbox` → the composite reads
  `kitchensink/sandbox/identity/keys`.
- **Pushes to `main`** run `ci-main.yml` → `_ci.yml` with `stage: prod` → the composite reads
  `kitchensink/prod/identity/keys`.

**Exception — the web E2E always uses the sandbox (dev) Clerk keys, even on `main`, and so does the web
BUILD.** Clerk _production_ instances (`pk_live`) are domain-locked and refuse to initialize on any origin
other than their production domain. The web E2E runs ClerkJS in a browser against a Playwright-managed
server on `http://localhost:3000`, so a `pk_live` key aborts with _"Production Keys are only allowed for
domain …"_ and `<SignIn>` never mounts. Only a _development_ instance (`pk_test`) permits localhost, so the
`e2e-web` job pins `load-secrets` to `stage: sandbox` regardless of pipeline stage. Backend/mobile E2E
don't run ClerkJS in a localhost browser, so they keep using the stage's own secrets.

The `build` job's `@commise/web` leg pins the same `stage: sandbox` for the same reason, one step earlier:
`NEXT_PUBLIC_*` is inlined by the bundler, so the Clerk instance is frozen into the bundle at build time —
and since `e2e-web` now **serves that build** (see below), a stage-scoped key there would bake `pk_live`
into the very artifact the localhost suite must sign into. `webE2eProductionBuild.test.ts` fails if either
job's stage, key or API origins drift from the other's.

**The web E2E serves the PRODUCTION build, not `next dev`.** The `build` job publishes `.next` as a
GitHub **artifact** (not an `actions/cache` entry — a per-SHA cache entry would feed the eviction problem
described above), and each of the eight `e2e-web` shards downloads it and runs `next start`
(`E2E_WEB_SERVER: start`, resolved by `packages/apps/commise/web/tests/e2e/utils/webServerMode.ts`).
Under `next dev`, Next compiles each route the first time it is _requested_ — inside the assertion that
triggered it — which put link-and-heading specs at 18.3 s / 14.4 s / 10.6 s, i.e. at their assertion
budgets, and produced navigation "failures" that were really unfinished compilations. Local runs keep
using `next dev`; the mode defaults off `CI`.

The base pipeline jobs (install, build-ui, lint, format, typecheck, test, build matrix, e2e) are defined
once in `_ci.yml`, and the heavy ones once in `_ci-heavy.yml`. There is no duplicated AWS/Clerk fetch logic — the composite is the single source
of truth and exports every alias the apps/tests consume (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`EXPO_PUBLIC_IDP_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `IDP_*`, webhook secret) from one secret.

Secrets live in AWS Secrets Manager scoped by stage (`kitchensink/{sandbox,prod}/identity/keys`, JSON
keys `PUBLISHABLE_KEY` / `SECRET_KEY` / `WEBHOOK_SIGNING_SECRET`). The web build statically
prerenders Clerk-wrapped pages, so it needs a real publishable key; the composite supplies it — the
**sandbox** one for the web build and the web E2E (see the exception above), the stage-correct one
everywhere else. If AWS creds are unavailable (e.g. a fork PR), secret-dependent steps skip rather
than fail — and the web build and `e2e-web` skip on the same condition, so the artifact and its consumer
stay consistent.

## Per-PR ephemeral lifecycle — deploy + teardown (ADR-0005)

The CI pipeline above (`_ci.yml`) only **tests**; it never deploys. Deploys are separate workflows,
split by whether the infra is **persistent** or **ephemeral**:

- **Persistent / global** — networking, RDS, domain, the shared ALB, and the identity service +
  webhooks. These deploy via `prod-deploy.yml` (on `main`) and `sandbox-identity-deploy.yml`
  (the persistent shared sandbox env, `STAGE=sandbox`). Every one of these CDK apps tags
  **`Environment=global`** at the `App` level and is named `kitchensink-*`. They are **never** torn
  down per-PR.
- **Ephemeral / per-PR feature services** — food and every future non-global service. These deploy
  via `sandbox-deploy.yml` on PR open/update (`stage=pr-{N}`, tagged **`Environment=pr-{N}`**), and
  are **torn down when the PR closes** by the `cleanup` job in that same workflow.

**Teardown (the `cleanup` job in `sandbox-deploy.yml`, on `pull_request: closed`).** It deletes
everything belonging to the closing PR — a resource belongs if it is tagged `Environment=pr-{N}`
**or** its name is `pr-{N}` / starts with `pr-{N}-`. It removes the PR's CloudFormation stacks, then
sweeps any remaining `Environment=pr-{N}`-tagged resources (log groups + ECR; other types are
reported), then sweeps `pr-{N}`-named log groups + ECR repos that no stack owned.

There is deliberately **no denylist**: global infra is `Environment=global` / `kitchensink-*`, so it
can never match a `pr-{N}` tag or prefix — that precision _is_ the safety. The match is
**delimiter-aware** (`pr-{N}` exactly or `pr-{N}-…`), so `pr-1` cannot match `pr-15` / `pr-100`.
Feature stacks keep the existing suffix naming (`kitchensink-{service}-pr-{N}`) and are caught by the
**tag**; the `pr-{N}` name-prefix is the fallback for resources that cannot be tagged (auto-created
ECS Container Insights log groups, out-of-band ECR repos). See
`docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md`.

> Until a feature service actually deploys per-PR, the `cleanup` job has nothing to match. Pre-existing
> orphans created before this convention carry no `Environment` tag and need a one-off manual sweep.

## Recommended hardening (step 2 DONE for deploys; step 1 still open)

Current auth uses static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, and those creds can read both
sandbox and prod secrets — there is no AWS-side least-privilege boundary between PR and main runs. To
close that:

1. **OIDC with two stage-scoped IAM roles — STILL OPEN, and it is now the load-bearing half.** Add
   `permissions: id-token: write`, switch the composite to `role-to-assume`, and scope each role's trust
   policy by the OIDC `sub` claim — the sandbox role trusts
   `repo:radicle-co/KitchenSink:pull_request` / `environment:Sandbox`, the prod role trusts
   `environment:Production` / `ref:refs/heads/main`. Restrict each role's `secretsmanager:GetSecretValue`
   to its own `kitchensink/<stage>/*` ARNs. This makes prod secrets physically unreachable from a PR.

    ⚠️ The environment bindings in step 2 do NOT achieve that on their own, and the reason is specific:
    `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are **organization** secrets (verified via
    `gh api repos/:owner/:repo/actions/organization-secrets`), and an org secret **cannot** be scoped to a
    GitHub Environment — environment secrets are repo-level only. So every job in every workflow here can
    still read the one key pair that serves both stages, whatever its `environment:` key says. The trust
    boundary moves only when the credential itself becomes per-stage: either these OIDC roles, or two
    distinct IAM users held as `Sandbox` / `Production` **environment** secrets with the org secret
    removed from this repo's scope.

2. **GitHub Environments — DONE for the deploy surface (2026-08-11, PR #91).** `Production` exists with a
   required reviewer (`gooftroop`) and a `main`-only branch policy, bound to `prod-deploy.yml`'s `deploy`
   job; `Sandbox` exists with **zero** protection rules, bound to the 6 sandbox **deploying** jobs across
   `sandbox-deploy.yml`, `sandbox-identity-deploy.yml`, `sandbox-router-deploy.yml` and
   `sandbox-web-preview.yml`. `Sandbox` must STAY unprotected: those jobs run unattended on every
   non-closed `pull_request`, so any rule would stall previews.

    ⛔ **Reclamation is never gated.** `sandbox-deploy.yml`'s `cleanup` and `reap-abandoned` are
    deliberately **unbound**. They were briefly bound while wiring this, which was a mistake: an
    Environment binding is a place a run can be made to WAIT, and the failure modes are not symmetric — a
    stalled deploy is loud and free, while a stalled cleanup silently leaks AWS spend, which is the exact
    leak `teardown-sandbox-pr.sh` exists to prevent. Documenting "never protect `Sandbox`" was not
    sufficient, because that setting lives in repo configuration where no test can see it and any admin can
    change it from a UI that gives no hint a scheduled reaper depends on it. The invariant is enforced in
    code by `packages/infra/global/__tests__/reclamationNeverGated.test.ts`.

    The **CI** workflows (`_ci`, `ci-pr`, `ci-main`, `ci-full`, `heavy-e2e`, the loadtests, `claude*`) are
    deliberately left **unbound** too: none is a deployment, binding them to a zero-protection environment
    would silence zizmor's `secrets-outside-env` without moving any boundary, and binding them to a
    protected one would make every PR wait on a human. The residual — **12** findings, 8 reclamation and 4
    CI/automation — is recorded as residual in `zizmor.yml`'s ledger rather than annotated away. Note for whoever does step 1: environment secrets cannot be forwarded via
    `workflow_call`, so an `environment:` key intended to scope a secret must live in `_ci.yml` itself,
    not in its callers.

## Notes for whoever updates branch protection / rulesets

- **Required status-check names changed.** With CI now in a reusable workflow, checks report as
  `ci / <job>` (e.g. `ci / Lint`, `ci / Build @commise/web`) under "CI — PR (sandbox)". Update any
  required-check rules that referenced the old `Lint` / `Format check` / `@commise/web` names.
- **A repository ruleset is currently blocking pushes** to feature branches ("Waiting for Code
  Scanning results" / "Changes must be made through a pull request"). Code Scanning appears configured
  only for the default branch, which is also why `main` itself shows red CI. Scope that rule to the
  default branch (or enable Code Scanning for all branches) so feature-branch pushes can land.

## Not carried over from the old workflows (decide if wanted)

The previous `002-user-auth.yml` had three extra jobs not brought into `_ci.yml`: the macOS Maestro
**iOS** and **Android** mobile e2e jobs, and the **Test Distribution Metric Gate** (min-test-count
check). They were experimental and credentials-gated; re-add them to `_ci.yml` if they should be part
of standard CI.
