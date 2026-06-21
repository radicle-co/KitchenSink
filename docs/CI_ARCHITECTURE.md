# CI architecture — sandbox (PR) vs prod (main)

CI is one **reusable workflow** invoked by two thin **callers**, with all secret loading funneled
through one **composite action**. This is the GitHub-native equivalent of "extend a build template
per run-type": the callers supply the only thing that differs — the `stage`.

```
.github/
  workflows/
    ci-pr.yml      # pull_request → calls _ci.yml with stage=sandbox
    ci-main.yml    # push: main    → calls _ci.yml with stage=prod
    _ci.yml        # reusable (workflow_call, input: stage) — the whole pipeline
  actions/
    load-secrets/  # composite: configure AWS creds + load kitchensink/<stage>/identity/keys
```

## How the split works

- **PRs** run `ci-pr.yml` → `_ci.yml` with `stage: sandbox` → the composite reads
  `kitchensink/sandbox/identity/keys`.
- **Pushes to `main`** run `ci-main.yml` → `_ci.yml` with `stage: prod` → the composite reads
  `kitchensink/prod/identity/keys`.

**Exception — the web E2E always uses the sandbox (dev) Clerk keys, even on `main`.** Clerk
_production_ instances (`pk_live`) are domain-locked and refuse to initialize on any origin other than
their production domain. The web E2E runs ClerkJS in a browser against the Playwright dev server on
`http://localhost:3000`, so a `pk_live` key aborts with _"Production Keys are only allowed for domain
…"_ and `<SignIn>` never mounts. Only a _development_ instance (`pk_test`) permits localhost, so the
`e2e-web` job pins `load-secrets` to `stage: sandbox` regardless of pipeline stage. Backend/mobile E2E
don't run ClerkJS in a localhost browser, so they keep using the stage's own secrets.

The pipeline jobs (install, build-ui, lint, format, typecheck, test, build matrix, e2e) are defined
once in `_ci.yml`. There is no duplicated AWS/Clerk fetch logic — the composite is the single source
of truth and exports every alias the apps/tests consume (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`EXPO_PUBLIC_IDP_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `IDP_*`, webhook secret) from one secret.

Secrets live in AWS Secrets Manager scoped by stage (`kitchensink/{sandbox,prod}/identity/keys`, JSON
keys `PUBLISHABLE_KEY` / `SECRET_KEY` / `WEBHOOK_SIGNING_SECRET`). The web build statically
prerenders Clerk-wrapped pages, so it needs a real publishable key; the composite supplies the
stage-correct one. If AWS creds are unavailable (e.g. a fork PR), secret-dependent steps skip rather
than fail.

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

## Recommended hardening (needs repo/IAM setup — not yet done)

Current auth uses static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` repo secrets, and those creds
can read both sandbox and prod secrets — there is no AWS-side least-privilege boundary between PR and
main runs. To close that:

1. **OIDC with two stage-scoped IAM roles.** Add `permissions: id-token: write`, switch the composite
   to `role-to-assume`, and scope each role's trust policy by the OIDC `sub` claim — the sandbox role
   trusts `repo:radicle-co/KitchenSink:pull_request` / `environment:sandbox`, the prod role trusts
   `environment:production` / `ref:refs/heads/main`. Restrict each role's `secretsmanager:GetSecretValue`
   to its own `kitchensink/<stage>/*` ARNs. This makes prod secrets physically unreachable from a PR.
2. **GitHub Environments** (`sandbox`, `production`) declared on the secret-using jobs in `_ci.yml`
   (object form: `environment: { name: ... }`), with a deployment-branch rule restricting `production`
   to `main`. Note environment secrets cannot be forwarded via `workflow_call` — the `environment:`
   key must live in `_ci.yml`, not the callers.

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
