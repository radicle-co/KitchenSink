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
- Commit B (`83d06a875`): every non-prod job on `awsAuth`.
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

Built. Every production job signs in through `awsAuth`, and the guard has no exception list left.

- Tier `prod`, bound to `Production`: `prod-deploy.yml`, `accountDeploy.yml`, `deployInfra.yml` deploying at prod, and
  at a prod target `deployedE2e.yml`'s `resolve`, the remote-search and queue-guarantee tiers, and `food-loadtest.yml`.
  Each waits for the owner's approval, once per job.
- Tier `prod-read`, no environment: `deployInfra.yml` at prod with `deploy: false`, which is `ci-main`'s checks and a
  `ci-full.yml` run at prod. `ci-full` is not bound to `Production`: its only AWS path is that checks run, and binding
  it would also gate `ci-main` (the 2026-09-11 ruling). From a branch it is red, because `prod-read` trusts only `main`.
- New grants on `kitchensink-gha-prod`, each from a call a moved job makes: `s3:ListBucket` on `kitchensink-*-prod-*`;
  `secretsmanager:DescribeSecret` on `DatabaseCredentialsSecret*` tagged `kitchensink-data-prod`; `GetSecretValue` and
  `DescribeSecret` on `SigningKey*` tagged `kitchensink-remote-search-shared-prod`; `lambda:GetFunctionUrlConfig` on
  `kitchensink-remote-search-prod`; `iam:ListRolePolicies`, `ListAttachedRolePolicies` and `GetRolePolicy` on
  `kitchensink-*QueueCheckRole*`; `iam:GetPolicy` and `GetPolicyVersion` on `arn:aws:iam::aws:policy/*`;
  `cloudwatch:GetMetricStatistics`. `prod-read` gains nothing. ADR-0013's `IAM5` census rises by 5, from a synth of the
  access stack before and after.
- `prod-deploy.yml`'s job now has `timeout-minutes: 180`, the session ceiling. `accountDeploy.yml` installs its CDK app
  with `npm install` in the package directory: the package has no lockfile, so its old `npm ci` could never run.

## After merge

0. Before merge, deploy `kitchensink-github-actions-access` with commit C's grants. Without them the first prod
   deploy's verification and remote-search smoke are refused. `accountDeploy.yml`'s `paths:` does not list the access
   stack's sources, so a merge does not deploy it.
1. Watch `ci-main` (its infra checks are the first `prod-read` sign-in), the owner approves the first prod deploy (the
   first `prod` sign-in), and `accountDeploy` shows no diff. None of these can run before merge: both production roles
   trust only `refs/heads/main`.
2. If the prod tier fails, revert commit C on `main`. The root key still works, so the old path comes back.
3. What only a live run proves: the two secret grants conditioned on the `aws:cloudformation:stack-name` tag (the IAM
   simulator does not apply a context value to that key; the tag values were read from the live secrets, and about
   sixty other representative calls simulated as expected), that the CDK lookup role answers `prod-read`'s synth, and
   that a prod deploy finishes inside 180 minutes.
4. After one green prod deploy, a green `ci-main` and a green PR run, delete the secrets `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY`. ⚠️ `zizmor.yml` records them as ORGANIZATION secrets, not repository ones. Check where they
   live first: deleting an organization secret removes it from every repository in `radicle-co`.

## Open owner questions

- Phase 2: a KitchenSink CDK qualifier, or KitchenSink's own AWS accounts.
- Whether `main` must require pull requests. Today the prod-read trust rests on write access alone.

## Pattern register

`awsAuth` is an Adapter over `configure-aws-credentials` and a Facade, with its availability check as a
Specification. `load-secrets` stays a Facade composed over `awsAuth`. `githubOidcTrust` is a Policy module and Factory.
The stack's tier map is a typed `Record` registry. The guards keep the house Specification-over-workflow-graph shape.
