---
title: 'feat: move every CI workflow from the root access key to the OIDC roles'
type: feat
date: 2026-10-13
---

# CI workflows on the OIDC roles

## Owner rulings (2026-10-13)

- CI must stop using the root access key. The owner approved the plan "as long as the plan only touches GitHub and
  does not break cdk", and approved the one AWS change: the `kitchensink-github-actions-access` stack.
- The owner's machine and the default AWS profile stay on the root account. Do not propose an SSO profile.
- The root key ending NYUH serves both CI and the owner's machine, so it stays active. The last step deletes the
  GitHub secrets only. The second root key, ending 3MEB, is unused since 2021-12-30. Deleting it is the owner's call.

## Done

- Commit A (`e2e7c0692`): `githubOidcTrust.ts`, `GithubActionsAccessStack.ts`, the account app wiring, their guards and
  ADR-0063.
- The stack is deployed. It holds the GitHub OIDC provider and the roles `kitchensink-gha-nonprod`,
  `kitchensink-gha-prod-read` and `kitchensink-gha-prod`.

## Facts that shape the work

- Root cannot assume roles, so CI's CDK deploys never used the `cdk-hnb659fds-*` deploy, publishing or lookup roles.
  The first OIDC deploy runs a path CI never ran. Prove it on sandbox before prod.
- The `cdk-hnb659fds` cfn-exec role is `AdministratorAccess` and armoury shares it. Any role that can assume the deploy
  role is account admin in practice. Phase 2 (a KitchenSink qualifier, or KitchenSink's own AWS accounts) is a separate
  owner decision recorded in ADR-0063.
- `reclamationNeverGated.test.ts`: teardown jobs bind no environment, so the non-prod role trusts any job of the repo.
- `reusableWorkflowPermissions.test.ts`: if a caller does not grant what a called workflow asks for, the guard fails.
- The `id-token: write` headers in `zizmor.yml`, `prod-deploy.yml`, `sandbox-deploy.yml` and
  `sandbox-identity-deploy.yml` say no job assumes a role. They become false and are rewritten.

## Commit B: non-prod

1. Write the guards first and watch them fail:
    - `__tests__/awsCredentialsFederated.test.ts` discovers every workflow and composite action. It refuses
      `secrets.AWS_*KEY*`, `configure-aws-credentials` outside `awsAuth`, an `awsAuth` job without job-level
      `id-token: write`, a workflow-level `id-token` grant, a prod tier on a job that does not bind `Production` and a
      non-prod tier on one that does, a teardown job on a prod tier, any `cdk bootstrap`, a role name the stack does not
      define, and an `awsAuth` job without `timeout-minutes`. It carries a fixture table of shapes that must fail.
    - `__tests__/awsAuthPredicate.test.ts` runs the action's real bash over a table. A same-repo run with no OIDC
      request URL fails red. A fork or Dependabot run reports `authenticated=false`. A run with the URL continues.
2. Add `.github/actions/awsAuth/action.yml`, an Adapter over `configure-aws-credentials` and the one way CI signs in.
   Its `tier` input maps to a role name. After it assumes the role, it runs `sts get-caller-identity` and if the role is
   not the expected one, it fails. The session is one hour by default, named `gha-<run_id>-<attempt>`.
3. `.github/actions/load-secrets/action.yml` loses its key inputs and its credential step, and reads Secrets Manager
   after `awsAuth`.
4. Move every non-prod job to `awsAuth` with tier `nonprod` and a job-level `id-token: write`, and grant `id-token` in
   every caller. Replace the credential-presence checks with `awsAuth`'s output, because a step that reads
   `secrets.AWS_ACCESS_KEY_ID` otherwise turns into a permanent green skip.
5. Delete the per-deploy `cdk bootstrap` steps (`prod-deploy.yml`, `sandbox-identity-deploy.yml`). The bootstrap is at
   version 32 already, and the step rewrites a stack armoury depends on.
6. Rewrite the guards that read the old shape, each with a doc comment saying what it now proves:
   `maestroRerunLiveness.test.ts`, `maestroIosTier.test.ts` (keep its `xcodebuild` leak guard over the three `AWS_*`
   names, which `configure-aws-credentials` still exports), and `deployedE2eTiers.test.ts`.
7. Prove on PR 91: a PR run, Sandbox Up and Down, the preview domain, a reap of closed PRs, and a sandbox deploy. This
   also proves that `valueForStringParameter` and `{{resolve:secretsmanager}}` resolve under the deploy role.

## Commit C: prod

Move `prod-deploy.yml`, `deployInfra.yml` at prod, `accountDeploy.yml`, `ci-main.yml`'s prod checks and the manual
prod-target runs to tiers `prod` and `prod-read`. A manual run that targets prod now binds `Production` and waits for
the owner's approval. These cannot be proven before merge, because the prod trust requires `refs/heads/main`.

## After merge

1. Watch `ci-main`, the owner approves the first prod deploy, and `accountDeploy` shows no diff.
2. If the prod tier fails, revert commit C on `main`. The root key still works, so the old path comes back.
3. After one green prod deploy, a green `ci-main` and a green PR run, delete the repo secrets `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY`.

## Open owner questions

- Phase 2: a KitchenSink CDK qualifier, or KitchenSink's own AWS accounts.
- Whether `main` must require pull requests. Today the prod-read trust rests on write access alone.

## Pattern register

`awsAuth` is an Adapter over `configure-aws-credentials` and a Facade, with its availability check as a
Specification. `load-secrets` stays a Facade composed over `awsAuth`. `githubOidcTrust` is a Policy module and Factory.
The stack's tier map is a typed `Record` registry. The guards keep the house Specification-over-workflow-graph shape.
