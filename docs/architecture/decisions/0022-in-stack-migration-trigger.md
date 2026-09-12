# 0022 — The schema migration runs INSIDE the deploy, ordered by a Trigger in every stack that touches the database

- **Status**: Superseded by 0035
- **Date**: 2026-08-19
- **Drivers**: The same defect rediscovered THREE times, each time from scratch, each time costing an
  incident or a silently-degraded preview:
    - `313e3000` (2026-08-17) — food and recipe: prod served `relation "food_nutrient_view" does not exist`
      through the whole ECS stabilisation window, and CloudFront cached the 500s;
    - `3cc7074b` (2026-08-17) — identity: the same window, but on the path that read-through-creates the
      user row, so it is a failed SIGN-IN rather than a degraded read;
    - `1e96ac08` (2026-08-19) — recipe-workers: six DB-touching Lambdas in a SEPARATE CDK app, updated
      ahead of the schema on every release, and addressing a database that did not yet exist on a
      first-ever `pr-{N}` deploy.

    Until now the reasoning lived only in code comments and test doc-blocks, which is precisely why each
    rediscovery started from zero. This ADR is the destination those comments point at.

- **Relates to**:
  [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md) — the per-PR logical database is
  CREATED by the migration run, which is what turns "schema skew" into "no database at all" on a first
  deploy;
  [ADR-0002](0002-vpc-consolidation-and-cidr-scheme.md) — the no-prod-template-diff discipline every change
  in this area is measured against;
  [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md) — prod is fronted by CloudFront, so a 500
  emitted during the window is not merely served, it is **cached**;
  [ADR-0004](0004-minimize-nat-egress.md) — every migration runner is a VPC-attached Lambda on the single
  NAT instance, which is where this decision's recurring cost lands.

## ⚠️ Before you change this — the two repairs that look obvious and are both wrong

**1. Do not move the migrate step above its `cdk deploy`.** It is not a smaller version of the fix; it is
strictly worse than the bug, because it fails **silently**. Each service's `esbuild.mjs` copies its
`migrations/*.sql` into the Lambda bundle at BUILD time, and that bundle ships **with** `cdk deploy`. So
invoking the runner first invokes the **previous release's** Lambda carrying the **previous** migration set:
it exits `0`, reports nothing pending, applies nothing, and the new tasks still meet the missing relation.
Nothing in the pipeline can distinguish "no migrations were needed" from "the runner had never heard of
them". Pinned by `packages/infra/global/__tests__/prodDeployMigrationOrder.test.ts`.

**2. Do not reorder the pipeline to put the schema-owning app first.** For recipe this was considered and
**rejected**, and the reason is not the one that first suggests itself. `RecipeWorkersStack` deploys before
`RecipeServiceStack` for two independent reasons: it publishes the `account-erasure-queue-{url,arn}` SSM
parameters the service resolves at **deploy** time (so the service cannot even synthesize first on a new
stage), and — independently — a queue's **CONSUMER must upgrade before its PRODUCER**. Swapping them trades
a schema-skew window for a **message-contract-skew window on the right-to-erasure path**. That is a
different defect on a GDPR request, not a fix.

## Context

`cdk deploy` returns only once the ECS service has **stabilised**. "Deploy, then invoke the migration
runner" therefore puts the new image in front of live traffic for the entire stabilisation window with the
old schema underneath it. That was tolerable while every migration was additive and unused; it stopped being
tolerable the moment a read path depended on a new relation.

Three properties of this repo make the window worse than it sounds:

- **Prod is behind CloudFront** (ADR-0020), so errors emitted during the window are cached and outlive it.
- **A rolling ECS deployment runs old and new tasks CONCURRENTLY.** Same-release destructive migrations were
  only ever safe by accident — because `cdk deploy` had already drained the old tasks by the time the
  pipeline's migrate step ran. That is a property of the pipeline, not of the change.
- **On a first-ever `pr-{N}` deploy there is no window, there is an absence.** Under ADR-0006 the per-PR
  logical database is created **by** the migration run, so any code deployed before it addresses a database
  that does not exist. This is how a preview came up with a recipe tier whose schema was never applied,
  behind entirely green checks.

The only moment at which the NEW migrations exist and the NEW code is not yet serving is **inside** the
deploy, between the runner Lambda's code update and the compute rollout. That is exactly the seam
`aws-cdk-lib/triggers` occupies.

## Decision

### 1. The barrier is an in-stack `triggers.Trigger`, in every stack that deploys compute reading that schema

Each such stack deploys its **own** migration runner — carrying **this release's** SQL — and a
`triggers.Trigger` over it:

```ts
new triggers.Trigger(this, '<Service>SchemaMigrations', {
    handler: migrationFn,
    timeout: <runner timeout> + headroom,   // this is the trigger's SOCKET timeout, default 2 min
    executeAfter: [migrationFn],            // wait for the runner's own role policy
    executeBefore: orderedBehindTheSchema,  // derived — see 2
});
```

Three properties are load-bearing and each has a named failure mode if changed:

- **`executeAfter: [migrationFn]`** — the runner's `rds-db:connect` / `secretsmanager:GetSecretValue` grant
  lands on its **own role**, inside the function's construct subtree, and the custom resource only
  _references_ the version. Without this edge CloudFormation may invoke the trigger before the policy
  exists, and a new stage's first deploy dies on an auth error.
- **`timeout`** — derived from the runner's own timeout, never a second literal. It is the custom
  resource's **socket** timeout and defaults to two minutes while the runners are allowed five; a migration
  that outlives the socket fails a deploy whose schema was already applied.
- **`executeOnHandlerChange`** (left at its `true` default) — the trigger keys on the handler's
  `currentVersion`, so it re-executes exactly when the bundled migration set changes. Turning it off would
  apply nothing on the one deploy that introduces a migration.

**`triggers.Trigger`, never a hand-rolled `AwsCustomResource` calling `lambda:Invoke`.** The triggers
framework handler skips on `Delete` and **throws** on `FunctionError`. A raw `lambda:Invoke` returns HTTP
`200` with `FunctionError` set in the response body, which a custom resource reads as success — which is the
silent no-op above, arriving by a different road.

**A missing bundle must THROW, not resolve.** Every runner falls back to an inline placeholder when
`dist-lambda/` is absent. That placeholder throws. It used to resolve `{ ok: false, reason: 'asset-not-built' }`,
which is a _successful_ invocation: the trigger passed, the deploy went green, and the schema was never
touched.

### 2. `executeBefore` is DERIVED from the construct tree, never a hand-kept list

```ts
// Read BEFORE the Trigger is constructed, so CDK's own custom-resource provider Lambda —
// created inside it, and no consumer of this schema — is not swept in.
const orderedBehindTheSchema = this.node
    .findAll()
    .filter(
        (construct): construct is Construct =>
            construct instanceof lambda.Function || construct instanceof ecs.BaseService,
    )
    .filter((construct) => construct !== migrationFn);
```

This is the half that keeps being got wrong, and it is the reason this ADR exists rather than a fourth
comment. Three of the four barriers originally named their subjects literally — `[apiService]`,
`[apiService, workerService]`, `[service]`. Each was correct **when written** and each had no way of staying
correct: a DB-touching Lambda or a second Fargate workload added to any of those stacks would deploy **ahead
of the schema with every existing guard green**, because the per-stack template gates assert over
`AWS::ECS::Service` and cannot see a new function. A copied list is not a check; a copied list is exactly
what let `handle-sync-worker` ship unbundled past two guards.

The derivation must also accept **every class of compute the stack constructs** — a filter naming only
`lambda.Function` in a stack that also runs Fargate reads as complete and is not.

### 3. The standing precondition: migrations are EXPAND-FIRST

The barrier applies the schema **while the previous release is still serving**. So every migration must be
safe against the previous release, and anything destructive — `DROP COLUMN`, `DROP TABLE`, a narrowing type
change — ships in a **LATER** release than the code that stopped reading it. Never both halves in one
deploy.

This **inverts an explicit prior statement** and the inversion is recorded here rather than only in a PR
description: `packages/services/recipe-service/src/database/migrations/0019_drop_duplicated_nutrition.sql`
carries a header saying "Production deploys CODE BEFORE MIGRATING", which was true for the order in force
when it was written. It is no longer true. `0019` is already applied in production so nothing about it
changes; what changes is the discipline for the next one, and that header is now stale.

⛔ **One fixed order cannot serve both disciplines.** Expand-first is not a preference that came along with
the trigger — it is the _price_ of the trigger, and the reason the pipeline's order could not simply be
flipped. Choosing "migrate first" means accepting expand-first forever; choosing "migrate last" means
accepting that new code meets an old schema. There is no ordering that makes a same-release contraction
safe, because a rolling deployment runs both releases at once.

### 4. The pipeline's migrate step stays — as a SAFETY NET, not as the mechanism

Each deploy workflow keeps its idempotent `aws lambda invoke` of the runner, **after** the deploy that ships
its bundle. It is not redundant: it catches a stage whose schema is behind for a reason no code change
explains — a restore, a stage created later, a `deploy_webhooks`-only run. What it must never become again
is the thing that is relied upon.

The invoke is **unconditional** on prod, which is the repair rather than an oversight: it used to carry a
path-diff gate, and a path diff is derived from the change-set, so it is false in exactly the scenario this
net exists for — a schema behind for a reason no code change explains. All call sites go through
`.github/scripts/run-migrations.sh`, the one definition of "did the runner succeed", which reads BOTH
`FunctionError` and the payload's `errorType` (an UNHANDLED failure sets the first, a HANDLED one can report
only the second, and reading one is how a leg once stayed green through a failure).

⚠️ Sandbox keeps an ensure-exists gate, and the asymmetry is deliberate: `deploy` is TRUE whenever the stack
is absent or the origin is not serving (ADR-0010), so it cannot skip the case this net is for.

### 5. A stack with no runner of its own must be DEPLOYED after one that has

`DependsOn` cannot leave a stack, and no CloudFormation primitive spans two CDK apps invoked as two CLI
commands. So a DB-touching stack is safe in exactly one of two ways, and both are accepted:

1. it carries its own in-stack barrier (§1–2); or
2. every job that deploys it deploys it **after** the `cdk deploy` that applies the schema.

Route 2 is a property of the pipeline and therefore has to be _asserted_, which is what
`prodDeployMigrationOrder.test.ts` now does — see "How this is enforced" below.

### 6. Every runner holds a session advisory lock across the apply loop

Migrations run on every deploy, and recipe's SQL has TWO deployed runners (`RecipeServiceStack` and
`RecipeWorkersStack`) plus a pipeline invoke — so concurrent runs are the normal case, not a hypothetical.
Observed on the first attempt: two `runMigrations` calls started together against one clean database fail
with `Key (extname)=(pgcrypto) already exists` — a RED DEPLOY of a schema that was already correct, because
the loser's throw is a `FunctionError` the Trigger rethrows.

All three runners therefore take a session `pg_advisory_lock` for the whole apply loop, bounded by
`lock_timeout` and released explicitly before the client returns to the pool. ⚠️ This changes deploy
behaviour: a second runner WAITS rather than racing. That is the intended trade — a bounded wait ending in
"everything skipped" beats a fast failure on a correct schema.

**The ledger is the idempotency mechanism, and hardening the SQL is the DANGEROUS repair.** Audited
statement by statement, zero of the migrations across the three services would silently double-apply data;
most would error loudly and the rest are already re-runnable. The guarantee is entirely `schema_migrations`,
never the SQL — which is why the files are deliberately bare `CREATE TABLE` and must stay that way. Four
files carry destructive DML that is unreachable only because a `CREATE TABLE` / `ADD COLUMN` /
`RENAME COLUMN` above it errors first and takes it down in the same rollback, and two of those are
unqualified whole-table `DELETE`s. Adding `IF NOT EXISTS` to the loud half would make those reachable.

## The audit: every stack that touches a database, and what it does

| Stack                                                     | DB-touching compute                                  | Ordered by                                     |
| --------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `IdentityServiceStack` (`packages/services/identity`)     | 1 Fargate service, 1 runner                          | **in-stack Trigger**, `executeBefore` derived  |
| `FoodServiceStack` (`packages/services/food-service`)     | 2 Fargate services, 1 runner                         | **in-stack Trigger**, `executeBefore` derived  |
| `RecipeServiceStack` (`packages/services/recipe-service`) | 1 Fargate service, 1 runner                          | **in-stack Trigger**, `executeBefore` derived  |
| `RecipeWorkersStack` (`packages/services/recipe-workers`) | DB-touching Lambdas, 1 runner (recipe-service's SQL) | **in-stack Trigger**, `executeBefore` derived  |
| `WebhooksStack` (`packages/services/identity-webhooks`)   | 5 Lambdas, **no runner**                             | route 2 — deploys after `identity` (see below) |
| `DataStack` (`packages/infra/global`)                     | 2 bootstrap Lambdas (custom-resource providers)      | **N/A — it CREATES the databases** (see below) |

⚠️ **This table is a snapshot, not a check, and it must not be read as current.** Its counts have already
rotted once: `RecipeWorkersStack` grew four DB-touching Lambdas and the barrier swept every one of them with
no edit, which is §2's derivation working — the table is simply what fell behind. It is also not a census of
stacks; the ones absent from it touch no database. What IS a check is
`packages/infra/global/__tests__/dbTouchingStackBarrier.test.ts`.

Two stacks deliberately do not carry a barrier.

### `WebhooksStack` — route 2, and why a second runner was rejected

`WebhooksStack` deploys five DB-touching Lambdas (`webhook`, `deletion-worker`, `reconciliation`,
`tombstone-sweep`, `erasure-reconciliation`) against the identity schema, from a separate CDK app, and has
no runner of its own. It could be made to carry one — the mechanism is `RecipeWorkersStack`'s, verbatim. It
was not, for three reasons:

1. **The direction is already safe.** Both workflows that deploy it (`prod-deploy.yml`,
   `sandbox-identity-deploy.yml`) `cdk deploy` it **after** the identity service — i.e. after the deploy
   whose trigger applied the schema. Recipe's case is the opposite: its workers deploy **first**, and must.
2. **A webhooks-only deploy cannot introduce a migration.** The identity migration SQL lives under
   `packages/services/identity/**`, and both workflows' path filters set `deploy_service=true` for any
   change there. There is no change-set that ships new SQL without also redeploying the stack that applies
   it.
3. **A second runner is not free and not neutral.** It is another VPC-attached Lambda and role per stage
   (ADR-0004: VPC Lambdas are the NAT's only consumers), and it would make **two** functions able to apply
   DDL to the identity schema with no advisory lock between them — the residual risk below, doubled, in
   exchange for an ordering the pipeline already provides.

⚠️ Reason 1 was **unasserted** until this ADR. `prodDeployMigrationOrder.test.ts` derived "these two stacks
share a database" only from imports of a `…/database-name` module — an authority food and recipe have and
identity does not, because identity's runner resolves host, database and credentials from a Secrets Manager
secret at runtime. So identity + identity-webhooks were **not discovered as a pair at all**, and hoisting
that one workflow step would have put new webhook code on the previous release's schema with every gate
green. The derivation now also reads the `kitchensink-data-{stage}:DatabaseSecretArn` / `:DatabaseName`
export, and `sandbox-identity-deploy.yml` was added to the workflows it reads.

### `DataStack` — the layer below, correctly exempt

`DataStack`'s two Lambdas (`FoodDbBootstrapFunction`, `RecipeDbBootstrapFunction`) are custom-resource
providers that **create** the databases and roles the runners then migrate into. There is no schema for them
to be behind; they are the reason one exists. A barrier here would be circular. They are covered by
`dbBootstrapPostconditions.test.ts`, `foodDbBootstrap.test.ts` and `recipeDbBootstrap.test.ts`, not by this
decision.

## How this is enforced

A stack with DB-touching compute and **no runner at all** was invisible to every guard, because each one
started from a runner it could see — the `1e96ac08` defect verbatim.
`packages/infra/global/__tests__/dbTouchingStackBarrier.test.ts` asserts the missing direction: a stack that
names a DB connection variable or an `rds-db:connect` / `grantConnect` grant AND constructs compute must ship
a runner behind a barrier, or be a recorded exemption carrying a reason and a citation that must exist on
disk. `WebhooksStack` and `DataStack` are the two exemptions.

Three layers, each asserting something the others structurally cannot see:

| Layer                                                                                                                                     | What it pins                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/infra/global/__tests__/prodDeployMigrationOrder.test.ts`                                                                        | The PIPELINE: no migrate step precedes the deploy that ships its bundle; a shared-database peer is either deployed later or barriered              |
| `packages/infra/global/__tests__/schemaMigrationBarrier.test.ts`                                                                          | The SHAPE: `executeBefore` is read off the construct tree, its predicate covers every compute class the stack builds, exactly 1 trigger per runner |
| each service's own infra suite (`FoodServiceStack.test.ts`, `stacks.test.ts`, `RecipeServiceStack.test.ts`, `RecipeWorkersStack.test.ts`) | The TEMPLATE: one `Custom::Trigger`, keyed on the runner CI invokes, with every `AWS::ECS::Service` / DB-bound Lambda carrying a `DependsOn` on it |

The split is not arbitrary. Coverage is a property of the synthesized template and is asserted where the
template is; `@kitchensink/infra-global` deliberately depends on no service package, so a repo-wide gate
cannot synthesize four service stacks without inverting the infra tier's dependency direction. What it can
read is the source — and "the list is derived" is a statement about the code, not about the output.

Nothing in any of the three enumerates services: they are discovered from each service's own manifest and
from the workflows themselves, so a fifth stack with a runner is covered the day it lands.

## Consequences

**Positive**

- New code never meets an old schema within a stack, and CloudFormation — not a workflow author — enforces
  it.
- A first-ever `pr-{N}` deploy creates its logical database before anything addresses it (ADR-0006).
- A DB-touching resource added to a barriered stack is covered **the day it is added**, with no edit to the
  barrier and nobody having to remember this file.
- All four barriers now synthesize byte-identical templates to the literal lists they replaced — verified
  for `prod` and non-prod on identity, food and recipe-service, so the ADR-0002 no-prod-diff guarantee
  holds.

**Negative / accepted costs**

- **Nothing orders two separate CDK apps.** This is the whole reason the barrier is in-stack, and it remains
  true for any pair of apps: `RecipeWorkersStack` and `RecipeServiceStack` each apply the same SQL from
  their own runner because neither can depend on the other.
- **One extra VPC Lambda + role per barriered stack, per stage — including every open PR.** `recipe-workers`
  added the fourth. VPC Lambdas are the NAT instance's only consumers (ADR-0004), so this is where the cost
  lands, and it multiplies by open previews.
- **More than one function can now apply DDL to a schema.** recipe's SQL is applied by `recipe-service`'s
  runner **and** by `recipe-workers`' own copy of it. They are sequential within a pipeline run, and the
  `schema_migrations` tracking table makes a second run a no-op — but see the residual risk below.
- **`recipe-workers` now depends on `recipe-service`'s Lambda bundle.** Its barrier ships the _owner's_
  runner, so a workflow that deploys the workers must build recipe-service's bundle first. The failure is
  loud (the placeholder throws, failing the deploy) rather than silent, and it is pinned — but it is a red
  prod deploy discovered at the worst moment.
- **Expand-first is now mandatory**, and it costs a release of latency on every contraction. §3.

## Residual risk — stated plainly, not mitigated

- **`RecipeSchemaMigrationRunner` has no pipeline safety-net invoke.** Its in-stack Trigger is the
  mechanism and runs on every deploy of this stack, so the schema is migrated; what it lacks is the §4 net
  for the case no code change explains. ⚠️ It DOES publish `RecipeWorkersMigrationFunctionName` — an
  earlier version of this bullet said otherwise and was wrong — but nothing outside its own stack test
  reads that output, because ADR-0031's per-PR reaper superseded the per-stack drop door it was added for
  and covers that case strictly more completely (the reaper needs no stack, so it also reclaims a database
  when every stack is gone). The output is therefore vestigial rather than missing, and the gap is narrow:
  recipe-service's runner applies the same SQL under the same barrier.
- **The barrier cannot order an EventBridge `RunTask`.** Food's 6-hourly change-refresh task is an
  EventBridge target rather than a deployed service, so CloudFormation has no ordering to give it. It
  retries on its own schedule, which is the mitigation by default rather than by design.
- **Route 2's guarantee is only as strong as the workflows it reads.** The gate asserts ordering in
  `prod-deploy.yml`, `sandbox-deploy.yml` and `sandbox-identity-deploy.yml`. A fourth workflow that deploys
  a DB-touching stack, or a deploy run by hand, is outside it.
- **`carriesMigrationBarrier` requires the barrier and the database name in the SAME file.** That is
  deliberate — a `Trigger` elsewhere in the package would satisfy a looser scan while ordering nothing
  against this schema — but it means a stack that receives its database identity through props (as
  `WebhooksStack` does) would not be _credited_ for a barrier it later added. Should webhooks ever take
  route 1, that derivation needs widening at the same time.
- **The repo-wide shape gate reads source, not templates.** It can prove the derivation is written; it
  cannot prove CDK resolved it into the `DependsOn` edges you expect. That is the per-stack template suites'
  job, and a new service that ships a stack with no infra suite of its own would have the shape checked and
  the coverage unchecked.

## Alternatives considered

- **Reorder the pipeline (migrate before deploy).** Rejected — silently applies nothing. The "⚠️ Before you
  change this" section is this rejection.
- **Reorder the pipeline (schema-owning app first).** Rejected for recipe — trades schema skew for
  message-contract skew on the erasure path, and is impossible anyway while `RecipeWorkersStack` publishes
  SSM parameters `RecipeServiceStack` resolves at deploy time.
- **One migration runner for the whole account, invoked by every app.** Rejected — it reintroduces the
  original defect exactly: at the moment a _second_ app runs it, that function still carries whichever
  release last deployed it. A runner must ship WITH the SQL it applies.
- **Have `RecipeWorkersStack`'s trigger invoke `RecipeServiceStack`'s existing runner by name.** Same
  rejection, in miniature, and the cheapest-looking one — at that point in the pipeline the named function
  still carries the previous release's bundle, so it exits 0 having applied nothing.
- **A shared `@kitchensink/infra-migrations` package exporting the derivation.** Considered, and rejected on
  cost against a duplication the tests already close. The shared infra packages export **built** JS (ADR-0013),
  which means a new one is hand-listed in `_ci.yml`'s "build the infra packages the substrate synth imports"
  step and aliased in the service vitest configs; the derivation is three lines, and
  `schemaMigrationBarrier.test.ts` proves every barrier writes it and that its predicate is total. Revisit
  if a fifth barrier lands.
- **Give `WebhooksStack` its own runner.** Rejected — see the audit above.

## Implementation guards

- `packages/services/identity/infra/lib/IdentityServiceStack.ts`,
  `packages/services/food-service/infra/lib/FoodServiceStack.ts`,
  `packages/services/recipe-service/infra/lib/RecipeServiceStack.ts`,
  `packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts` — each carries a
  `// ⚠️ DELIBERATE — see docs/architecture/decisions/0022-in-stack-migration-trigger.md` guard comment at
  the derivation, which is the exact line an agent would "simplify" back into a list.
- `packages/infra/global/__tests__/schemaMigrationBarrier.test.ts` — the shape gate, fired at four
  deliberately-violating fake stacks so it cannot rot into a vacuous pass.
- `packages/infra/global/__tests__/prodDeployMigrationOrder.test.ts` — the pipeline gate, now covering
  identity + identity-webhooks.
