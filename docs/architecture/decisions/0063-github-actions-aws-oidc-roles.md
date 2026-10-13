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

**3. Trust is built and judged by one pure module.** `githubOidcTrust.ts` names the tier union once, builds each tier's
conditions and judges them. Every tier pins `aud`, `repository_id` and `repository_owner_id` by exact equality. The
`sub` is trusted in both of GitHub's spellings (the classic `repo:owner/repo:…` and the id-bearing form GitHub may move
to), each as an exact prefix; a tier that trusted only one would switch off the day GitHub changes, and a pattern wide
enough to cover both would admit more than this repository. The production tiers use exact `sub` strings with no wildcard
and also require `ref = refs/heads/main`; `prod` also requires `environment = Production`. The module throws on a trust
with no `sub`, a bare or owner-wide `sub`, no repository id, or a production tier missing its `ref` or `environment`, and
the builder runs its own output through that judge.

**4. Direct permissions are scoped by name, never by the `Environment` tag.** Every pattern starts `kitchensink-` or sits
under `/kitchensink/`. Anything that creates or changes infrastructure goes through the CDK bootstrap roles, so each role's
own policy covers only what a job does itself: publish images, invoke and describe functions, read and write its stage's
parameters, read its stage's secrets, read stacks. The non-prod role may delete only stacks, services and clusters whose
names end in `-sandbox` or carry a `-pr-` token, and may change DNS only for `pr-*.sandbox.commise.app` as a `CNAME`, by
IAM condition on the record name and type. The `prod` role has no teardown action. The `prod-read` role may assume only
the lookup role and carries an explicit deny on `kms:Decrypt` and every write verb, so a policy added to it later cannot
quietly turn it into a writer. No role holds `iam:*` or `organizations:*`.

**5. Sessions last at most three hours**, and each role's ARN is a stack output.

## Consequences

- **No credential in a repository secret once the workflows move.** A token lives for one job, can be minted only for a job
  that matches the trust, and is bound to a repository id that a deleted-and-recreated repository does not inherit.
- **Residual risk, and the largest one: any role that may assume the CDK deploy role is account administrator.** The
  bootstrap's execution role is `AdministratorAccess`, so a template can do anything. The tiers bound who can become a
  role and what a mistaken command can reach directly; they do not bound a malicious workflow that runs on a trusted ref.
  Until the bootstrap is split, the real protection for `prod` is the `Production` environment's required reviewer and the
  `main`-only rule, not IAM.
- **Residual risk: Lambda invoke on the non-prod role is `kitchensink-*`.** Function names are not uniformly stage-suffixed, so
  the explicit deny on names ending in `prod` is defence in depth and cannot be claimed to cover every production function.
- **Residual risk: the router's key-value store is addressed by an id CloudFormation generates**, so the non-prod role names
  the store by a wildcard within the account.
- **Both subject spellings are trusted.** A repository that opts into the id-bearing form keeps working, and the numeric
  ids stay required either way.
- **The root key stays in use until the workflows are moved and the secrets are deleted.** Creating these roles changes
  nothing for a job that does not assume them.

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
