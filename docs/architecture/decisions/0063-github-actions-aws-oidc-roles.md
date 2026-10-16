# 0063 — GitHub Actions reaches AWS through one OIDC provider and three tiered roles, not an access key

- **Status:** Accepted
- **Date:** 2026-10-13
- **Relates to:** [ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md) — the new stack lives in the
  account-scoped app that ADR describes, for the same reason the budget does. [ADR-0005](0005-environment-tagging-and-pr-cleanup.md)
  — teardown is keyed on `pr-{N}`, and the non-prod role's delete rights follow the same names.
  [ADR-0060](0060-sandbox-starts-only-by-hand.md) and [ADR-0061](0061-midnight-stop-reclaims-what-nothing-uses.md) — the
  teardown and reclaim jobs bind no GitHub environment, which decides the non-prod trust.

## Context

CI authenticates to AWS with a long-lived access key stored as repository secrets. That key belongs to the account's root
user. Root cannot assume an IAM role, so CI's CDK runs have never used the deploy, publishing or lookup roles the CDK
bootstrap creates, and every run is a full-power session that anything able to read the secret can replay from anywhere,
indefinitely.

Facts the design rests on:

- The account is the organisation's management account. Service control policies never apply to it, so a boundary here has
  to be an IAM boundary.
- The CDK bootstrap (`CDKToolkit`, qualifier `hnb659fds`) is shared with another application in the same account, and its
  CloudFormation execution role is `AdministratorAccess`.
- The other application's stacks also carry `Environment=production`. A condition keyed on that tag would reach them.
- The repository is public. GitHub's OIDC provider issues a token to any workflow on GitHub, so everything depends on the
  trust policy refusing every token that is not this repository's.
- GitHub environments in use: `Production` (required reviewer, `main` only) and `Sandbox` (no rules). Teardown and reclaim
  jobs bind no environment by design.
- The existing hosted zone for previews also holds the apex, the sandbox wildcard and the shared identity host.

## Decision

**1. One OIDC provider and three roles, in a stack of their own in the account-scoped app.** `kitchensink-github-actions-access`
is built by `bin/account.ts`, which takes no stage and tags `Environment=global`. There is one provider per issuer per
account, so the stack cannot be per stage. The provider is `iam.OidcProviderNative`: no custom-resource Lambda, and no
thumbprint to keep correct.

**2. Three tiers, each with a fixed role name.**

| Tier        | Role                        | Trusted jobs                                                                                      |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `nonprod`   | `kitchensink-gha-nonprod`   | Any job of this repository: pull-request checks, previews, Sandbox Up and Down, reclaim, teardown |
| `prod-read` | `kitchensink-gha-prod-read` | A job on `main` that binds no environment, for read-only checks against production                |
| `prod`      | `kitchensink-gha-prod`      | A job bound to the `Production` environment, on `main`                                            |

The non-prod tier cannot require the `Sandbox` environment, because the jobs that tear a sandbox down bind none.

Every workflow signs in through one composite action, `.github/actions/awsAuth`, and no workflow reads an access key.
A job's tier follows what it does:

- `prod`: the production deploys (`prod-deploy.yml`, `accountDeploy.yml`, `deployInfra.yml` deploying at `prod`) and the
  manual runs that read production (`deployedE2e.yml`'s `resolve`, the remote-search and queue-guarantee tiers of
  `deployedE2eTiers.yml`, `food-loadtest.yml`). Each binds `Production` exactly when it targets production, so each
  waits for the reviewer, once per job.
- `prod-read`: `deployInfra.yml` at `prod` with `deploy: false`, which is `main`'s checks (`ci-main.yml`) and a
  `ci-full.yml` run at `prod`. These bind no environment, so `main`'s checks cost no reviewer wait.
- `nonprod`: everything else.

`awsCredentialsFederated.test.ts` evaluates each job's tier and environment over every combination of the inputs they
read, and refuses an access-key reference anywhere in `.github/`.

**3. Trust is built and judged by one pure module.** `githubOidcTrust.ts` names the tier union once, builds each tier's
conditions and judges them. Every tier pins `aud`, `repository_id` and `repository_owner_id` by exact equality. The
`sub` is trusted in both of GitHub's spellings (the classic `repo:owner/repo:…` and the id-bearing form GitHub may move
to), each as an exact prefix; a tier that trusted only one would switch off the day GitHub changes, and a pattern wide
enough to cover both would admit more than this repository. The production tiers use exact `sub` strings with no wildcard
and also require `ref = refs/heads/main`; `prod` also requires `environment = Production`. The module throws on a trust
with no `sub`, a bare or owner-wide `sub`, no repository id, or a production tier missing its `ref` or `environment`, and
the builder runs its own output through that judge.

**4. Direct permissions are scoped by name, never by the `Environment` tag alone.** Every pattern starts `kitchensink-` or
sits under `/kitchensink/`. Anything that creates or changes infrastructure goes through the CDK bootstrap roles, so each
role's own policy covers only what a job does itself: publish images, invoke and describe functions, read its stage's
parameters and secrets, read stacks. Each action set the non-prod and prod roles share is named once in the stack.

The non-prod role's stack, service and task deletes are not written in its own stack. They come from `teardownGrants`
(`lib/sandbox-scheduler/teardownGrants.ts`), the same function the midnight reclaim role is built from
([ADR-0061](0061-midnight-stop-reclaims-what-nothing-uses.md)): a `kitchensink-*-pr-*` stack tagged `Environment=pr-*`;
exactly the stacks in `SHARED_TIER_DELETE_ORDER`, tagged `sandbox`; services and tasks under a `kitchensink-*-pr-*`
cluster; and a Deny on anything tagged `production` and on any delete that names a role. So `kitchensink-data-sandbox`,
`kitchensink-network-sandbox` and `kitchensink-identity-webhooks-sandbox` stay out of reach, as `sandboxSharedTier.sh`
requires. The non-prod role may also delete log groups and image repositories, but only under the same per-PR name
pattern. It writes parameters only under `/kitchensink/sandbox/owed-per-pr-database-drops/`, the ledger
`perPrDatabaseDrop.sh` keeps, and it may change DNS only for `pr-*.sandbox.commise.app` as a `CNAME`, by IAM condition on
the record name and type. Those conditions are the boundary, so the grant names `hostedzone/*` rather than a zone id.

The `prod` role has no teardown action. Besides publishing and invoking, it holds the reads its jobs verify with, each
named for production: `head-bucket` on `kitchensink-*-prod-*` buckets and `DescribeSecret` on the database master
secret of `kitchensink-data-prod` (`verifyDeployment.sh`; the secret's value stays unreadable, as ADR-0039 requires),
the remote-search signing key of `kitchensink-remote-search-shared-prod` and the function URL of
`kitchensink-remote-search-prod` (the remote-search smoke and its deployed tier), the policies of a
`kitchensink-*QueueCheckRole*` role and of an AWS managed policy (the queue-guarantee tier), and
`cloudwatch:GetMetricStatistics` (the load test's collector). The `prod-read` role may assume only the lookup role, and it carries one Deny with
`NotAction` over exactly the reads it is granted. Everything else is denied, `kms:Decrypt` included, so a policy added to
it later cannot turn it into a writer. No role holds `iam:*` or `organizations:*`.

**5. Sessions last at most three hours**, and each role's ARN is a stack output. A job that signs in states a
`timeout-minutes` no longer than the session it asks for.

## Consequences

- **No credential in a repository secret once the workflows move.** A token lives for one job, can be minted only for a job
  that matches the trust, and is bound to a repository id that a deleted-and-recreated repository does not inherit.
- **Residual risk, and the largest one: any role that may assume the CDK deploy role is account administrator.** The
  bootstrap's execution role is `AdministratorAccess`, so a template can do anything. The tiers bound who can become a
  role and what a mistaken command can reach directly; they do not bound a malicious workflow that runs on a trusted ref.
  Until the bootstrap is split, the real protection for `prod` is the `Production` environment's required reviewer and the
  `main`-only rule, not IAM.
- **A function's configuration is its environment, so the non-prod role reaches a Lambda only through a tag-conditioned Allow.**
  `lambda:InvokeFunction`, `GetFunctionConfiguration` and `GetFunctionUrlConfig` are allowed on `kitchensink-*` functions
  only when the function's `aws:cloudformation:stack-name` tag matches `kitchensink-*-sandbox` or `kitchensink-*-pr-*`.
  CloudFormation stamps that tag with the full stack name, which a truncated generated function name cannot shorten, and a
  function without the tag matches nothing, so the grant fails closed: if Lambda ever stops supplying the tag, the sandbox
  deploy checks fail loudly, where a Deny on the same tag would silently stop applying. A name Deny on `kitchensink-*-prod*`
  and an `Environment=production` Deny sit over it as extra layers, not as the boundary. `lambda:ListFunctions` returns the
  environment of every function in the account, the other application's included, and cannot be scoped, so no role holds it
  (it was in the shared observe list); `GetFunction` and `ListVersionsByFunction` are denied outright. Production's webhook
  functions carry plaintext secrets in their environment, so the prod role still reads them. The scope is held by
  `nonprodLambdaScope.test.ts`, which judges the pattern against every stack name the sources assign.
- **Follow-up: move the webhook secrets out of Lambda environment variables.** Defence in depth only: every principal that
  can still read the production environment can read the secret itself.
- **Follow-up: `logs:GetLogEvents` and `logs:FilterLogEvents` on `*` for the non-prod role** can read production log
  groups. Scope them to the sandbox and per-PR log-group names.
- **Residual risk: the router's key-value store is addressed by an id CloudFormation generates**, so the non-prod role names
  the store by a wildcard within the account.
- **Residual risk: the non-prod role writes the image repositories production pulls from.** Every preview pushes into
  `kitchensink-identity`, `kitchensink-food` and `kitchensink-recipes`, and `ecrEnsureRepo.sh` applies their retention
  policy on every run, so the role holds `ecr:PutLifecyclePolicy` there. A job on any branch could replace that policy with
  one that expires the images production runs. It may not delete those repositories or change who may read them.
- **Residual risk: the record-name condition also matches deeper names.** `StringLike` on `pr-*.sandbox.commise.app`
  matches `pr-1.anything.sandbox.commise.app` too, because `*` crosses dots. Such a name cannot reach the apex, the
  wildcard or the identity host, but it is wider than one label. The grant names `hostedzone/*`, but Route 53 accepts a
  record only inside its zone's domain, so these names fit only a zone for `commise.app` or below. A `Null` condition
  requires both keys, because `ForAllValues` is true when its key is absent.
- **Residual risk: the production-tag Denies match nothing live until PR 91 deploys.** Production stacks still carry
  the pre-change tag `Environment=global` from `main`. Until the first production deploy of this tagging scheme, the
  name patterns alone keep production out, and the guards' fixture tables prove those patterns.
- **Residual risk: a mis-tagged per-PR stack has no automatic teardown.** Both teardown roles require a `pr-*` tag on a
  per-PR stack. A `kitchensink-*-pr-N` stack with another tag, or none, is refused by IAM for both the PR-close teardown
  and the reclaim, and has to be deleted by hand. The App-level tag that prevents this is guarded by
  `environmentTagScheme.test.ts`.
- **Both subject spellings are trusted.** A repository that opts into the id-bearing form keeps working, and the numeric
  ids stay required either way.
- **No workflow uses the root key, and it stays valid until the repository secrets are deleted.** The secrets are
  deleted after the first green production deploy, the first green `main` checks and a green pull-request run. Until
  then, reverting the move on `main` restores the old path.
- **Residual risk: the production tiers cannot be proven before merge.** Both trust only `refs/heads/main`, so the first
  run of each is on `main`. Before merge, `iam simulate-custom-policy` judged the synthesized policies on about sixty
  representative (action, resource) pairs the moved jobs make, and every one decided as expected except the two secret
  grants conditioned on the `aws:cloudformation:stack-name` tag: the simulator does not apply a context value to that
  key. The tag values those two name were read from the live secrets, so only the evaluation is unproven.
- **Residual risk: a production deploy may run for at most three hours.** The session ceiling bounds `prod-deploy.yml`'s
  job; one that runs longer is cancelled while CloudFormation may still be working. The first deploy after the move
  carries every stack production has not deployed yet. It carries no database major upgrade: production already runs
  PostgreSQL 18.
- **A production run dispatched from a branch is red, not refused politely.** `Production` admits only `main`, and both
  production roles trust only `main`, so a prod-target dispatch, a `ci-full.yml` run at `prod` or a `deployInfra.yml`
  run at `prod` from any other ref fails at sign-in.
- **A manual production run waits for the reviewer once per job that reads production.** A `deployedE2e.yml` run at
  `prod` binds `Production` in `resolve` and again in the two tiers that read AWS.

## Alternatives considered

- **Keep the access key and rotate it.** Rejected: rotation shortens a window and does not remove the credential, and a root
  key cannot be scoped.
- **One role for everything.** Rejected: production deploys would then be reachable from any pull request's job, and the
  `Production` environment's reviewer would guard nothing.
- **Trust the `Environment` tag to separate production from the rest.** Rejected: another application in the account is
  tagged `production` too, so the tag does not mean this project's production.
- **A custom bootstrap qualifier for this project (OPEN, owner decision).** Would give this project its own, narrower
  CloudFormation execution role and end the shared administrator path. It means re-bootstrapping and redeploying every
  stack against the new qualifier, so it is a separate piece of work with its own risk.
- **A separate AWS account for this project (OPEN, owner decision).** The strongest boundary: a trust failure here could not
  reach the other application. It is also the largest change, and the owner has not decided it.
- **A custom-resource provider (`OpenIdConnectProvider`).** Rejected: it ships a Lambda and needs thumbprints; the native
  resource needs neither.
