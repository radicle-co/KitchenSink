# 0065 — CI deploys through KitchenSink-owned CDK bootstrap qualifiers

- **Status:** Accepted
- **Date:** 2026-10-16
- **Relates to:** [ADR-0063](0063-github-actions-aws-oidc-roles.md) — it names this as the way to close its largest residual
  risk, and is amended to say so. [ADR-0002](0002-vpc-consolidation-and-cidr-scheme.md) — no change here may replace the
  production database or a bucket. [ADR-0005](0005-environment-tagging-and-pr-cleanup.md) and [ADR-0061](0061-midnight-stop-reclaims-what-nothing-uses.md)
  — teardown still deletes by the per-PR names, so the execution policy must allow delete as it allows create.
  [ADR-0013](0013-cdk-nag-advisory-iac-security-linting.md) — templates must not drift except where this ADR says they do.

## Context

Every CI deploy runs as a CDK deploy role, and CloudFormation then acts as the bootstrap's execution role. The execution
role is the privilege: whatever it may do, a template can do. The only bootstrap in the account is the default one
(`CDKToolkit`, qualifier `hnb659fds`), which another application in the account owns. Its execution role is
`AdministratorAccess`, and its bootstrap roles trust the whole account. So any CI role that may assume them is, in effect,
an administrator of the account, and the tiers in ADR-0063 bound only who can become a role and what a mistaken command
reaches, not what a template can do.

Owner ruling, 2026-10-16: close this by giving KitchenSink bootstrap qualifiers of its own in the same account, not by
moving to a second account. Two facts from the owner shape the design: the other application shares no VPC, subnet or
security group with this one, and the account-scoped app keeps its own deploy workflow, gated by the `Production`
environment on `main`.

Facts the design rests on:

- CloudFormation generates physical names and truncates long ones, which can drop the stage token. A permission keyed on a
  name pattern alone therefore misses resources whose names have been shortened.
- A deploy role passes the execution role to CloudFormation whatever the stack is called. A condition on the stack name at
  the deploy role leaves a non-production caller holding a production-capable execution role.
- The CI roles themselves are CloudFormation resources in the account-scoped app. Whoever may deploy that app may change
  who can deploy everything else.
- The CDK CLI's stock bootstrap can set a qualifier, a toolkit stack name, the execution policies and a permissions
  boundary on the execution role. It cannot narrow who the bootstrap roles trust, scope the deploy role's CloudFormation
  actions to stack names, or replace the lookup role's `ReadOnlyAccess`.
- This repository creates no docker image assets. Images are built and pushed by CI into `kitchensink-*` repositories and
  referenced by name.

## Decision

**1. Three qualifiers: `ksnonprod`, `ksprod` and `ksaccount`.** `ksnonprod` serves the sandbox and every `pr-{N}` preview,
`ksprod` serves production, and `ksaccount` serves the stage-less account app. `qualifiers.ts` in
`@kitchensink/cdk-bootstrap` is the one authority for the names, the role ARNs, who may assume what, and which stack names
each qualifier may deploy. `qualifierForStage` selects `ksprod` only for the exact token `prod`; every other spelling
selects `ksnonprod`, whose execution policy cannot touch production names, so a typo fails with AccessDenied instead of
deploying production through a broad role.

**2. Why two stage qualifiers rather than one with a stack-name condition.** The deploy role cannot be stopped from handing
the execution role to CloudFormation, so the separation has to live in the execution role. With two execution policies,
the non-production one excludes production names and the production one excludes sandbox names, and the non-production
path cannot reach production where names are knowable. The deploy role's stack patterns are a second layer over it.

**3. Why a third qualifier for the account app.** The account app holds the CI roles, the cost guardrails and the policy
stack, which is the trust root of everything above. Its execution role needs rights over CI roles that neither stage
policy may hold, and it must be reachable by exactly one principal: the production CI role, which GitHub issues only to a
job bound to the `Production` environment on `main`. Branch and non-production roles cannot assume it. The account deploy
workflow stays, and its credentials reach `ksaccount` with no extra step: it signs in as the production role, which holds
`sts:AssumeRole` on the `ksaccount` bootstrap roles, and those roles trust that one principal.

**4. The bootstrap template is generated, not hand-edited.** The package commits the stock template as the CDK CLI emitted
it and a pure transform over it, `customizeBootstrapTemplate`, with one golden file per qualifier that a test pins. The
transform: narrows trust on the assumable roles to the named CI role ARNs by `ArnEquals` on `aws:PrincipalArn` (not by
naming the roles as principals, because a recreated role gets a new principal id and the trust would break silently),
limits the deploy role's CloudFormation actions and reads to the qualifier's stack patterns, replaces the lookup role's
`ReadOnlyAccess` with the context-provider reads alone, adds a confused-deputy guard on the execution role's service trust,
and removes the administrator fallback so the execution role has exactly the policies it is given. Image-publishing
resources stay in the template, to keep the diff from stock small, and nobody is granted the right to assume that role.

**5. Each execution role is a scoped policy plus a permissions boundary.** The policy is generated from tables, split into
managed policies under the size limit, never assembled by hand. A resource that CloudFormation names is created under a
name pattern, and every modify, delete and configuration read requires the `aws:cloudformation:stack-name` tag to match,
because truncated names defeat a name-only rule. Role creation, role policy writes and boundary attachment are allowed only
with the qualifier's boundary attached, and removing a boundary is denied. `iam:PassRole` is limited to this repository's
roles and a list of services. No user, access key, login profile, organization or account action is granted, and the
bootstrap roles and the policies themselves cannot be edited by what they govern. The boundary is the capability cap on
every role a stack creates: the union of what the synthesized roles need, with an explicit Deny on assuming bootstrap roles,
and, for non-production, on production names. A role created by a branch therefore cannot read production, independently
of the execution policy. The allowed resource types are derived by synthesizing every app at several stages and committed
as a manifest; a new resource type fails a test until someone scopes it.

**6. The policy documents and the bootstrap itself are deployed only by the owner.** The managed policies and boundary
must exist before the bootstrap, and a role that could change them could widen its own limits. So the policy stack, the
CI role stack, the `cdk bootstrap` runs and the first account-qualifier deploy are run by the owner with administrator
credentials, from the runbook `docs/runbooks/cdkBootstrapQualifiers.md`. No workflow runs `cdk bootstrap`:
`awsCredentialsFederated.test.ts` refuses it against any qualifier. A `cdk bootstrap` is re-run only when a golden file
changes.

**7. The CI roles' assume sets are enumerated and the default qualifier ends up denied.** The non-production role may assume
the `ksnonprod` deploy, file-publishing and lookup roles. The production role may assume the same three of `ksprod` and
`ksaccount`. The read-only production role may assume only the `ksprod` lookup role. No tier may assume an image-publishing
role, and a guard asserts the synthesized assets contain no docker image, so one added later fails loudly. After the
migration, all three CI roles carry an explicit Deny of `sts:AssumeRole` on `cdk-hnb659fds-*`, so a later broad Allow cannot
reopen the old path, and none holds `iam:PassRole`, so a CI role cannot hand the old administrator execution role to
`cloudformation:CreateStack`.

**8. One seam wires the qualifier into every stage app.** A single helper returns the app props: the synthesizer for the
stage's qualifier and the permissions boundary on every role. Discovery of every `new App(` makes the helper mandatory, with
the account app as the one named exception that selects its own qualifier. Logical ids derive from construct paths, not
from the synthesizer, so no stack changes identity. Only the bootstrap version parameter, the asset references and the
boundary property differ in the templates, and a parity test normalizes exactly those three and requires the rest to be
identical.

**9. Migration is expand, then contract, in two commits that can be deployed apart.**

1. The owner bootstraps `ksnonprod`, `ksprod` and `ksaccount` and deploys the policy stack.
2. The expand commit lets each CI role assume its new roles and keeps the default-qualifier Allow, so the repository is
   coherent and green with either set of stacks.
3. Sandbox stacks deploy under `ksnonprod`, the existing deployment verification passes, and a probe confirms the
   non-production role is refused when it assumes a production or default deploy role.
4. Production stacks move on the next production deploy.
5. The contract commit removes the default-qualifier Allow and adds the Deny. Reverting that one commit is its rollback.

The account qualifier's boundary denies the default bootstrap roles, so the first deployment of the CI role stack under
`ksaccount` would cut the old path for the CI roles before the stage stacks have moved. The owner therefore deploys the
expand change to the CI role stack with administrator credentials, and the stack is first deployed under `ksaccount` only
after step 4.

## Consequences

- **The execution role is no longer an administrator, so the CI roles are bounded by what a template can do.** A malicious
  workflow on a trusted ref can still change this project's resources within the policy; it can no longer touch the other
  application's named resources, create an unbounded role, read another tier's secrets through a role it creates, or assume
  the default bootstrap roles. The `Production` environment's required reviewer remains the control for the production and
  account qualifiers.
- **Named residuals, stated rather than hidden.**
    - Some resource kinds cannot be tied to a stack by tag at the point of modification: S3 buckets, EventBridge Scheduler,
      SSM and Secrets Manager names, alarms and dashboards, instance profiles, CloudFront policies and functions, Application
      Auto Scaling, the API Gateway account settings and tags, log deliveries and Lambda event-source mappings. They are
      scoped by name pattern only, and the structural guard lists each as a named residual.
    - `ecs:RegisterTaskDefinition` can add a revision to any task family in the account.
    - Actions without resource-level permissions (several `ec2:Describe*` and some `Create*` actions) stay on `*`.
    - `rds-db:connect` cannot be separated by tier by IAM.
    - The action lists are reviewed against the AWS Service Authorization Reference and are not proven by a deploy. A scope
      that is too narrow fails loudly and rolls the stack back. The first sandbox deploy also proves whether CloudFormation
      populates `aws:SourceAccount` on the execution role's trust; if it does not, every deploy fails until the guard is
      adjusted.
    - The account qualifier can change the CI roles within its boundary, so a change to the role stack is a production-grade
      change gated by the reviewer, not by IAM.
    - A mis-scoped DELETE in the production policy could strand a stack in `DELETE_FAILED`.
    - The other application shares no VPC, subnet or security group with this one (owner-verified). If that changes, the EC2
      and load balancer reach in the execution policy must be reviewed.
- **A rename of a qualifier or a toolkit stack is a one-way door.** The qualifier is in every bootstrap role name, the asset
  bucket and every synthesized asset reference, so renaming means re-bootstrapping and redeploying every stage.
  `qualifiers.test.ts` pins the values for that reason.
- **Each qualifier brings its own asset bucket and an image repository that stays empty.** Lambda bundles are small and
  content-addressed, so the cost is negligible. The `kitchensink-*` repositories CI pushes images to are unaffected.
- **Existing per-PR stacks keep running as the old execution role until they are redeployed.** Teardown of such a stack runs
  as that role, and teardown of a migrated stack runs as the new one, so the execution policy allows delete symmetrically
  with create and the non-production teardown grants are unchanged.
- **The default qualifier is never touched.** Nothing here bootstraps, updates or deletes `CDKToolkit` or any
  `cdk-hnb659fds-*` role; the only change is that CI roles are denied them.

## Alternatives considered

- **One qualifier for both stage tiers, separated by a stack-name condition on the deploy role.** Rejected: the execution role
  is what a template acts as, and one execution role would hold production and sandbox names alike.
- **The stock bootstrap with `--cloudformation-execution-policies` and a custom boundary only.** Rejected: it leaves the
  bootstrap roles trusting the whole account and the lookup role reading every function's environment, which is the
  access ADR-0063 worked to deny.
- **Retire the account deploy workflow and deploy the account app by hand.** Rejected by the owner: the app stays automated
  behind the `Production` environment and `main`, and a third owner-gated qualifier carries it.
- **A separate AWS account for this project.** Still the strongest boundary and still an owner decision. It is the largest
  change, and this ADR does not preclude it.
- **A service control policy as the limit.** Not available: the account is the organization's management account, where
  service control policies never apply (ADR-0063).
