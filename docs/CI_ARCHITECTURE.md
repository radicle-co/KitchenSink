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
*production* instances (`pk_live`) are domain-locked and refuse to initialize on any origin other than
their production domain. The web E2E runs ClerkJS in a browser against the Playwright dev server on
`http://localhost:3000`, so a `pk_live` key aborts with *"Production Keys are only allowed for domain
…"* and `<SignIn>` never mounts. Only a *development* instance (`pk_test`) permits localhost, so the
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
