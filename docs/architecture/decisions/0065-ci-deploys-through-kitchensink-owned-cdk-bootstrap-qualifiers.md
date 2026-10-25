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
name pattern, and every modify and delete requires the `kitchensink:tier` tag to match (Decision 5a), because truncated
names defeat a name-only rule. READS are the exception: a read-only action (the Service Authorization Reference's access
level Read or List, carried in the committed catalogue, not guessed from the verb) is granted by name alone, in a
`<Sid>Reads` statement beside the gated one. CloudFormation's resource handlers read before they create, a read of a
resource that does not exist yet has no tag to match, and a read gated on the tag is denied at create time. A read
changes nothing, and the name patterns and tier Denies still refuse the other tier's names. Role creation, role policy writes and boundary attachment are allowed only
with the qualifier's boundary attached, and removing a boundary is denied. `iam:PassRole` is limited to this repository's
roles and a list of services. No user, access key, login profile, organization or account action is granted, and the
bootstrap roles and the policies themselves cannot be edited by what they govern. The boundary is the capability cap on
every role a stack creates, and it bounds resources as well as actions. Each action that has a resource-level form is
allowed only on KitchenSink names: `kitchensink-*` queues, topics, tables, functions, buckets and repositories, the
`/kitchensink/*` parameters, the log groups that carry `kitchensink`, the Nova models, and the registry's database
logins. A role whose own policy says `secretsmanager:GetSecretValue` on `*` can therefore still read only KitchenSink's
secrets, not the other application's. Some resources cannot be matched by name. CloudFormation names a generated secret
or a state machine with no stack prefix, an EC2 instance has an id, and it truncates a generated function name to 64
characters, which can drop the stage token and leave a production function matching `kitchensink-*` but not the production
Deny. Those four are allowed only under a condition on the `kitchensink:tier` tag (Decision 5a); a resource of the other
application is untagged, and the condition fails closed. Each execution role may also
read the SSM parameters its stacks declare as template parameters, because CloudFormation resolves an SSM-typed
parameter with the stack's execution role before the change set exists: the qualifier's own bootstrap-version parameter
and, for the stage tiers, the public AMI parameter family. `ecs:RunTask` names a task
definition whose family is generated, so it is bounded by the cluster it runs in. Actions with no resource-level form stay
on `*` as a named list that says, for each, whether it reads or writes and what a write can do to the other application.
The boundary also carries an explicit Deny on assuming
bootstrap roles and, for non-production, on production names, so a role created by a branch cannot read production
independently of the execution policy. The allowed resource types and the (action, resource) pairs that roles really use
are derived by synthesizing every app at several stages and committed as a manifest; a new resource type or a new
resource fails a test until someone scopes it.

**5a. Ownership is the `kitchensink:tier` tag, not CloudFormation's `aws:cloudformation:stack-name`.** The first
`ksnonprod` deploy failed with `cdk-ksnonprod-cfn-exec-role ... not authorized to perform: acm:AddTagsToCertificate`.
Measured cause: CloudFormation does not put its system tags on ACM certificates, ECS task definitions and services,
DynamoDB tables, CloudFront distributions and some older SQS queues, so a condition on the system tag matched nothing for
those types and failed closed on the very first modify. App-level user tags DO reach those resources (they already carry
`Environment` and `CommitSha`), so `@kitchensink/cdk-bootstrap` owns a tag, `kitchensink:tier` = `nonprod` | `prod` |
`account`, and every CDK entrypoint applies it to its whole tree (`Tags.of(app).add(TIER_TAG_KEY, ...)`, the value from
`tierTagValueForStage(stage)` by the same rule as the qualifier, `account` for the stage-less app).
`tierTagCoverage.test.ts` discovers every entrypoint and holds the call, the key and the value per stage.
`Environment` is never used to authorize: the other application in this account sets `Environment=sandbox` too, so a
match on it would admit that application's resources. The rules the execution policy is built to:

- A **modify, delete or configuration read** requires `aws:ResourceTag/kitchensink:tier` to equal the qualifier's value.
  Reads of existing resources stay name-scoped (Decision 5).
- A **create** requires `aws:RequestTag/kitchensink:tier` to equal the value, but only for actions the Service
  Authorization Reference says honour that key (the committed catalogue now carries, per action, whether it honours
  `aws:RequestTag` and `aws:ResourceTag`). A key an action does not honour is absent from the request, so asking for it
  would deny every create, and `executionPolicyTierTag.test.ts` refuses that offline. An action that honours only the
  resource tag and acts on a resource this deploy just made (`iam:PutRolePolicy` after `iam:CreateRole`) is gated by the
  resource tag in `<Sid>Existing`. `ec2:RunInstances` and `ec2:CreateNetworkInterface` are exempt on purpose: one request
  creates several resources and CloudFormation tags only one of them.
- A **tag-adding action** cannot require the tag it adds, so it is allowed on two paths: the resource already carries the
  tier tag, or the request adds it (`TagNew`, one statement over the NAMED resources the grants it replaces already
  named). The second path is also what lets a stack re-tag a legacy resource on its next update. Resources addressed only
  by `*` (EC2 `CreateTags`) get no request path, because a request-added tag on `*` would let a stack claim any resource
  of the account; they take the tag at creation or from the admin re-tag below.
  EC2 tag edits have one more path, because of rollback (next bullet): `ec2:CreateTags` and `ec2:DeleteTags` are also
  allowed on a resource whose `aws:ResourceTag/aws:cloudformation:stack-name` matches the tier's stack patterns
  (`STACK_TAG_PATTERNS`, `Ec2TagByStack`). EC2 is the one family where the system tag is reliable (measured on the VPC
  and the internet gateway), a user cannot set an `aws:` tag, and the patterns name only `kitchensink-*` stacks, so the
  other application's `Armoury-*` stacks are outside them. `DenyOtherTierTag` still outranks it.
- **A rollback can strip the tier tag.** A stack whose forward update fails rolls back to its OLD template. Across the
  migration boundary that template has no tier tag, so CloudFormation's tag reconciliation first removes the tier tag
  (allowed) and then re-adds the old tags (refused for every type without a fallback, because the resource no longer
  carries the tag). The EC2 fallback above covers EC2. For any other service the stack lands in `UPDATE_ROLLBACK_FAILED`
  and is recovered with `aws cloudformation continue-update-rollback --resources-to-skip <logical ids>`, then re-tagged
  by the runbook's step 3. Once a stack has deployed once with the tier tag in its template, a rollback returns to a
  template that has it, and the tag is kept; the exposure is the migration window only.
- `DenyOtherTierTag` refuses every action on a resource tagged with another tier's value, in the execution policy and in
  the boundary, so the request path cannot overwrite production's tag from a branch and a role a branch creates cannot
  touch a production-tagged resource. The tier-name Denies stay.
- `iam:PassRole` requires the role to carry this tier's tag, except a role passed to EC2. EC2 checks an instance
  profile's role with no role tags in its context, so the tag can never match there. Measured on 2026-10-24: a dry-run
  `ec2:RunInstances` with the production NAT instance profile was refused while the role carried the tag, and its
  decoded context held only `iam:RoleName`. A role passed to `ec2.amazonaws.com` is therefore allowed by the tier's own
  role names (`role/kitchensink-*-prod*`, or the sandbox and `pr-` names), and that grant passes to nothing else.
- In IAM names, a preview's token is `pr-` followed by a digit, never `pr-` alone. IAM caps a role or instance-profile
  name at 64 characters, so CloudFormation cuts the stack-name part short. `kitchensink-food-service-prod` became
  `kitchensink-food-service-pr-FoodApiTaskRole…`, and the production guard refused production's own role as a preview's
  (prod deploy 40147809293, 2026-10-25). A preview token always carries its number (ADR-0005), so the IAM name Denies
  and the EC2 grant above match `pr-1*` to `pr-9*`. A preview role cut the same way loses its number and matches no
  name, so its tier tag is what keeps it out of production.

**Migration.** Resources that exist today carry no tier tag, so nothing can modify them until they are tagged. In order:
(1) the owner deploys the policy stack, which adds `kitchensink-ci-exec-<qualifier>-tags` and the new conditions;
(2) the owner runs the one-shot re-tag from `docs/runbooks/cdkBootstrapQualifiers.md` over KitchenSink resources only
(selected by the `Environment` tag AND a `kitchensink` name, never by `Environment` alone; IAM roles and EC2 resources are
enumerated per owning stack, because the Resource Groups Tagging API does not return IAM roles); (3) app deploys run, each of
which also writes the tag through the stack. A resource missed by (2) fails loudly on its next modify with the action
named, and the request path of `TagNew` heals the named types on that same deploy.

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

**9. Every `cdk deploy` runs with `--no-previous-parameters`.** The CDK CLI reuses a stack's previous value for every
parameter its template still has. A stack first deployed through the default bootstrap would keep
`BootstrapVersion=/cdk-bootstrap/hnb659fds/version` for ever, and a deploy through a KitchenSink qualifier would resolve
the other application's parameter with a role that may not read it, or silently check the wrong bootstrap. The flag takes
the template's defaults instead. It is safe only while every parameter a stack carries is an SSM-path parameter whose
default is the value it needs, and a guard asserts that premise over the synthesized templates. The flag stays after the
migration: it costs nothing and keeps a parameter from freezing at a stale value.

**10. The `ksaccount` boundary is also a ceiling over the three GitHub CI roles.** The account app creates those roles
with the `ksaccount` boundary attached, so what they may do is the intersection of their own policies and that boundary.
Every Allow of every CI role policy must therefore be contained in the rendered boundary, and
`accountAppQualifier.integration.test.ts` holds that containment. Two consequences follow. The boundary is the union of
what the non-production, production and production-read roles need. A change to a CI role's permissions is two changes:
the boundary policy, which only the owner deploys (Decision 6), first, and the role stack after it. An Allow added to a
role before the boundary carries it is ignored by IAM's intersection, with no error from the deploy.

**11. Migration is expand, then contract, in two commits that can be deployed apart.**

1. The owner bootstraps `ksnonprod`, `ksprod` and `ksaccount` and deploys the policy stack.
2. The expand commit lets each CI role assume its new roles and keeps the default-qualifier Allow, so the repository is
   coherent and green with either set of stacks.
3. Sandbox stacks deploy under `ksnonprod`, the existing deployment verification passes, and a probe confirms the
   non-production role is refused when it assumes a production or default deploy role.
4. Production stacks move on the next production deploy.
5. The contract commit removes the default-qualifier Allow and adds the Deny. Reverting that one commit is its rollback.

The account qualifier's boundary denies the default bootstrap roles, so the first deployment of the CI role stack under
`ksaccount` cuts the old path for the CI roles. The owner deploys that stack by hand, with administrator credentials, as
soon as `ksaccount` exists and before any workflow deploys through the new qualifiers, because only that deploy gives the
CI roles the right to assume the new deploy roles (`docs/runbooks/cdkBootstrapQualifiers.md`, section 4). This is safe
because every CDK entrypoint on the branch already synthesizes against the new qualifiers, so no deploy from it needs the
old path. The cost is that older code, such as `main` before this change merges, can no longer deploy: its stacks name the
default qualifier, and the CI roles are refused the default deploy roles. That is accepted while production is not live.
Later account deploys are workflow runs on `main` approved by the `Production` reviewer, and nothing in the workflow checks
that order: the reviewer and the runbook are the ordering control.

## Consequences

- **The execution role is no longer an administrator, so the CI roles are bounded by what a template can do.** A malicious
  workflow on a trusted ref can still change this project's resources within the policy; it can no longer touch the other
  application's named resources, create an unbounded role, read another tier's secrets through a role it creates, or assume
  the default bootstrap roles. The `Production` environment's required reviewer remains the control for the production and
  account qualifiers.
- **Named residuals, stated rather than hidden.**
    - Some resource kinds cannot be tied to a tier by tag at the point of modification: S3 buckets (CloudFormation tags a
      bucket after creating it), EventBridge Scheduler (untaggable), SSM and Secrets Manager names, alarms and dashboards,
      instance profiles (untaggable), CloudFront cache, origin-request and response-headers policies, access controls, key
      groups and public keys (none honours a request tag in the reference), Application Auto Scaling, the API Gateway
      account settings and tags, log deliveries, Lambda event-source mappings, EventBridge bus permissions
      (`events:PutPermission`, `events:RemovePermission`) and `ecs:DeregisterTaskDefinition`. They are scoped by name
      pattern only, and the structural guard lists each as a named residual.
    - `ecs:DeregisterTaskDefinition` has no resource type in the reference, so it authorizes on `*`: the execution role can
      deregister (mark INACTIVE, which stops NEW tasks starting from it) a revision of the other application. Under the
      old stack-name condition this grant never matched anything, so a task definition replacement could not complete;
      it is allowed now because a stack must be able to replace its own, and `executionPolicyScoping.test.ts` records
      that it is reachable.
    - `ec2:RunInstances` and `ec2:CreateNetworkInterface` are not asked for a request tag (Decision 5a), so an instance can
      be launched without the tier tag; it then cannot be modified or terminated, which fails loudly rather than open.
    - A tag-adding action on a resource addressed by `*` (EC2) has no request path (Decision 5a). A resource of an
      untagged legacy stack in that class needs the admin re-tag.
    - The request path of `TagNew` lets a stack add the tier tag to an UNTAGGED resource. For named types the name
      (`kitchensink-*`) bounds it, and that is a convention. For types addressed by an id pattern (ACM certificates,
      CloudFront distributions, functions and key-value stores, ECS task definitions, generated Secrets Manager names) it
      does not: the grant could tag a resource of the other application, and the tier-tag Allows would then let a stack
      modify or delete it. Only CloudFormation makes these calls, on resources a stack declares, so the way in is a
      resource IMPORT of a foreign resource into a stack. Whether the deploy roles can run import change sets is not
      restricted by this change and is the control to review next.
    - `ecs:RegisterTaskDefinition` can add a revision to any task family in the account.
    - Actions without resource-level permissions stay on `*` in the execution policy (several `ec2:Describe*` and some
      `Create*` actions). In the permissions boundary the same applies to a named list, each entry marked READ or WRITE.
      The reads return names, tags, stack parameters and outputs, export values, or configuration for the whole account.
      The writes reach the other application too: a VPC Lambda's network-interface verbs can delete an unattached
      interface, move addresses or use up the addresses of any subnet, the CloudWatch Logs delivery calls can redirect or
      stop any log delivery, and `PutResourcePolicy` can replace any log resource policy. None is a data-plane action.
    - The boundary admits a few actions on the other application's resources because the resource id carries no name:
      invalidating a CloudFront distribution, the CloudFront key-value store calls and the Route 53 record calls of the
      account tier, and the `Describe` calls of RDS. The test that judges the boundary against a table of the other
      application's ARNs lists exactly these and fails if the list grows or if an entry admits nothing.
    - Reads are scoped by name, not by tag (Decision 5). Where CloudFormation truncated a generated name and dropped the
      stage token, a non-production execution role can read a production resource whose name still matches
      `kitchensink-*`: a function's configuration and so its environment variables, a secret's metadata and resource
      policy, an SSM parameter's value. A template author cannot make that call, since CloudFormation makes it, but a
      stack that reads a resource it created under a truncated name would see the other tier's.
    - The execution roles may read the SSM parameters that their stacks take as template parameters (Decision 5), the
      public AMI family among them.
    - The `ksaccount` boundary is the ceiling of all three CI roles (Decision 10), so it is wider than the account app
      alone needs, and a role-permission change that is not mirrored in it is ineffective without a deploy error.
    - `--no-previous-parameters` (Decision 9) discards any parameter value set by hand on a stack; a stack that needs one
      must carry it as a template default.
    - Name-only separation of production from non-production is best effort for the types whose generated names
      CloudFormation truncates and where no tag condition is available: S3 buckets, SQS queues, EventBridge rules and
      IAM roles. A truncated production name that lost its stage token matches `kitchensink-*` and not the production
      Deny. Functions and state machines are covered by the tag; for the rest the execution policy's tier-tag scoping
      is what keeps a branch from creating or changing a production resource, and the explicit production names the
      stacks use today carry the token.
    - Whether Lambda and Step Functions evaluate `aws:ResourceTag` on invoke and start is taken from the Service
      Authorization Reference and is not proven by a deploy. If it does not hold, the first invocation under a bounded
      role fails closed.
    - `rds-db:connect` is bounded to the registry's login prefixes, but the database resource id in front of the login is
      opaque, so IAM cannot separate production from non-production database access.
    - Log groups are matched by the word `kitchensink` anywhere in the name, which covers every group the stacks make.
      A group of the other application that contains the word is reachable; none is known.
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

- **Authorize by CloudFormation's `aws:cloudformation:stack-name` tag.** Tried first and rejected by measurement: it is
  absent from ACM certificates, ECS task definitions and services, DynamoDB tables, CloudFront distributions and some SQS
  queues, so the first deploy failed on a tag action. It also needs the stack-name patterns kept in step with the tag.
- **Authorize by the `Environment` tag.** Rejected: the other application in the account sets `Environment=sandbox` and
  `Environment=production` too, so a match on it admits that application's resources.
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
