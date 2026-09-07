# 0035 — Each database's schema is a stack of its own, deployed and migrated ahead of everything that reads it

- **Status**: Accepted
- **Date**: 2026-09-06
- **Supersedes**: [ADR-0022](0022-in-stack-migration-trigger.md) — the in-stack `triggers.Trigger`, whose
  ordering guarantee this replaces with a stronger one.
- **Drivers**: The owner's question, verbatim: _"Why are migrations even part of an image deploy? They
  should be independent; that's why we have data versioning and other policies like backwards
  compatibility."_ Followed by the constraint that governs the shape: _"the migrations should not require us
  to manually add a migration to be ran as part of the whole migration; all migrations should automatically
  be picked up and ran in the proper order."_
- **Relates to**:
  [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md) — a per-PR logical database is
  CREATED by the migration run, so this stack precedes every resource for that stage, not only the ones that
  read a table;
  [ADR-0004](0004-minimize-nat-egress.md) — the runners are NAT consumers, and the consumer table moves with
  them;
  [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md) — the ensure-exists probes must name these stacks, or
  a stage with no schema reads as complete;
  [ADR-0028](0028-on-demand-sandbox.md) — the sandbox-stage schema stack is reclaimed with the shared tier;
  [ADR-0031](0031-sandbox-only-per-pr-database-reaper.md) — reclamation of a per-PR database belongs to the
  reaper, not to a runner output.

## Context

ADR-0022 answered a real and thrice-repeated defect. `cdk deploy` returns only once ECS has STABILISED, so
"deploy, then migrate" served the new image against the old schema for the whole stabilisation window —
`relation "food_nutrient_view" does not exist` on every nutrition read in prod, cached by CloudFront; a
failed SIGN-IN on identity, whose middleware read-through-creates the user row on every authenticated
request.

It also identified why the instinctive repair is worse. `esbuild.mjs` copies the ordered `*.sql` into the
runner's bundle at BUILD time, and that bundle ships WITH the deploy. Invoking the runner before the deploy
therefore invokes the PREVIOUS release's Lambda carrying the PREVIOUS migration set: it exits `0`, reports
`applied: []`, and applies nothing. That report is byte-identical to the one a runner with genuinely nothing
to do returns, so no caller can tell them apart.

The only seam in which the new SQL existed and the new tasks were not yet serving was therefore INSIDE one
deploy, between the runner's code update and the service's rollout — which is exactly where a
`triggers.Trigger` sits.

Two consequences followed from that placement, and both were accepted at the time.

**The schema became a hostage of the application's release.** It could not be applied without deploying the
application, so a stage whose schema was behind for a reason no code change explained — a restore, a stage
created later, a `deploy_webhooks`-only run — had no mechanism to catch up. The pipeline's idempotent invoke
was kept as a "safety net" for exactly that case, and it was gated on the same path diff as the deploy it
followed, so in the one case it existed for the flag read `false`.

**`DependsOn` cannot leave a stack.** A barrier ordered its own stack's constructs and nothing else. For a
database read from two CDK apps — recipe, whose workers must deploy FIRST because they publish the SSM
parameters the service resolves and because a queue's consumer must upgrade before its producer — the only
expressible answer was a SECOND runner: `RecipeWorkersStack` shipped a copy of recipe-service's bundle,
reaching across package boundaries into another package's `dist-lambda/`, purely so its eight DB-touching
Lambdas had something to be ordered behind. Two runners, one database, and neither barrier able to see the
other stack's consumers.

The blocking question was never ordering. It was **detectability**: a migrate step that exits `0` having
applied nothing is indistinguishable from one that had nothing to do, and any design that moves the apply
out of the deploy inherits that ambiguity unless it removes it.

## Decision

**A database's schema is applied by a stack that contains the migration runner and nothing that reads the
schema**, deployed and invoked by its own pipeline step ahead of every consumer.

- `kitchensink-identity-schema-{stage}`, `kitchensink-food-schema-{stage}`,
  `kitchensink-recipe-schema-{stage}`, each in its own service's existing CDK app so the asset is local and
  the stack inherits the app's tags, provenance stamp and nag aspects.
- Every pipeline runs, in order: deploy the schema stack, invoke the runner, deploy everything else. The
  four in-stack `triggers.Trigger` barriers are deleted.
- **The invoke states which migration set it expects.** `run-migrations.sh run` takes the migrations
  directory as a required argument, digests it, and sends `expectManifestSha`; a runner holding a different
  set throws instead of reporting a clean run. This is what makes hoisting the step safe — it converts the
  hazard ADR-0022 identified from undetectable into loud.
- **The digest is computed twice, by two independent implementations** — `@kitchensink/db-schema-guard` in
  the shipped bundle, and `sha256sum` in the shell. A single shared helper can be wrong identically on both
  sides and still agree; two cannot, because sha256 has exactly one right answer.
- **Discovery is unchanged.** Migrations remain ordered `.sql` found by `readdir` + `sort`, tracked in
  `schema_migrations` keyed by filename. Nothing is registered by hand, which is the owner's constraint.
- **Each service checks at boot that its database is current for its release**, before it listens. The
  pipeline covers the release path; this covers the paths that are not a release — a database restored from
  a snapshot taken before a migration, a task scaling out long afterwards, a stack deployed by hand. ⛔ It
  ships in `warn`, because a boot assertion that fails closed can crash-loop a service; the flip is
  `SCHEMA_CURRENCY_MODE=enforce` once the reports read clean, and an unrecognised value resolves to `warn`
  rather than arming a check on a typo.
- **The schema deploy and the migrate step are ungated**, for the reason the safety net's own history
  records: a path-diff gate skips precisely the case the step exists for.

### What ordering the barrier is made of now

| Was                                                | Is                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `executeBefore` derived from `this.node.findAll()` | Pipeline position: the schema step precedes every consumer's `cdk deploy`, in every workflow |
| Reaches only its own stack                         | Reaches every consumer in every app, because a pipeline step has no stack boundary           |
| A stale bundle is invisible (`applied: []`)        | A stale bundle throws, naming both digests and the set it holds                              |
| Two runners for the recipe database                | One runner per database                                                                      |

## Consequences

**Positive**

- The schema can be applied without deploying an application, which is the property the owner asked for.
- One runner per database. Recipe's second runner and its cross-package `dist-lambda/` reach are gone.
- Food's sandbox deploy is one pass rather than two. The scale-0 pass existed only because the runner shared
  a stack with the services it had to precede.
- `WebhooksStack`'s ordering — five DB-touching Lambdas against the identity schema, ordered only by
  deploying later — is now ASSERTED over the workflow text rather than stated in prose.
- "Nothing was pending" is provable. An empty `applied[]` from a runner whose digest matched the caller's
  expectation genuinely means the ledger is current for exactly that set.

**Negative / costs**

- Three more CloudFormation stacks per stage, and one more `cdk deploy` per service per pipeline run.
- The ordering is no longer expressed in the artifact CloudFormation deploys. A hand-run `cdk deploy` that
  skips the pipeline gets no barrier at all — which was already true across apps, and is now true within one.
  The boot check reports that case rather than preventing it, and only once it is moved to `enforce`.
- Each service image carries a copy of its own `.sql`, so the boot check has something to compare against.
  That is a Docker build change in three services for a check that, in `warn`, only writes a log line.
- The runner's placement in the pipeline is a property of YAML, so it is guarded by a test over the workflow
  text rather than by the type system.

**Preconditions that do not change**

- **EXPAND-FIRST migrations.** Every migration must be safe to apply while the previous release is still
  serving, so a contracting change ships a release LATER than the code that stopped reading the column. This
  was ADR-0022's precondition and it is now the whole of the contracting rule.
- The runner takes a session advisory lock across its apply loop, because the `schema_migrations` ledger is
  checked-then-applied and that is not atomic.

**Residual risk, stated rather than implied**

- The manifest proves the runner's SQL matches the working tree. It does NOT prove the tree matches what was
  reviewed — a migration edited after approval still applies.
- It proves the **SQL**, not the runner. A runner whose ENGINE is a release behind — a different
  `expectedTables()` derivation, a different pool config — passes the assertion whenever the SQL set is
  unchanged. In practice the schema deploy ships both together, so this is a limit on what the digest
  claims rather than a gap; it is recorded because "a runner holding a different set throws" reads as a
  claim about the runner.
- **The expand-first window widened, materially.** Under ADR-0022 the interval between "schema applied" and
  "new code serving" was one stack's rollout inside one `cdk deploy`, enforced by CloudFormation. It is now
  the rest of the pipeline — identity, webhooks, food, recipe workers, recipe service — and it is UNBOUNDED
  if any step in between fails, because the schema step already succeeded and the pipeline stops. Expand-first
  is what makes that safe, and it is now doing considerably more work than it was: a migration that is only
  NEARLY expand-first (a `NOT NULL` with a default, a unique index the previous release's writes can violate)
  had minutes of exposure and now has hours. Prose is the only thing enforcing it; a check over migration SQL
  for narrowing operations is owed.
- **A wedged schema stack now blocks every service's deploy**, not just its own. The three schema deploys are
  sequential in one prod job, so a `kitchensink-food-schema-prod` stuck in `UPDATE_ROLLBACK_FAILED` reds an
  identity-only release. `kitchensink-recipe-service-pr-91` reached that state in practice, so this is
  observed behaviour rather than a hypothetical.
- **Concurrent pipeline runs against one stage fail loudly rather than silently**, which is the manifest
  working: run A deploys M1, run B overwrites with M2, A's invoke expects M1 and refuses. Recorded because it
  will present as a flake to whoever meets it first.
- Nothing orders two CDK apps except the pipeline. That was true under ADR-0022 as well; what changed is
  that the pipeline now carries the schema, so the gap no longer needs a second runner to paper over.
- A stage deployed by hand, outside a pipeline, has no barrier.

## Alternatives considered

- **Keep the in-stack Trigger and hoist nothing.** Rejected: it is the coupling the owner asked to remove,
  and it cannot order anything outside its own stack, which is why recipe needed two runners.
- **Hoist the pipeline's migrate step above `cdk deploy`, with no other change.** Rejected as strictly worse
  — this is ADR-0022's own finding. It invokes the previous release's runner, exits `0`, and applies nothing.
- **Make the manifest expectation optional.** Rejected. An optional expectation is one a caller forgets, and
  a forgotten one is indistinguishable from the behaviour it replaces.
- **One `kitchensink-schema-{stage}` stack holding all three runners.** Rejected: it would couple three
  services' schema deploys, and the stack would have to live in one CDK app while reaching into the other
  two packages' build output — the coupling recipe-workers just shed, tripled.
- **A boot check that fails closed from day one.** Rejected for the soak's duration: a wrong assertion at
  boot takes a whole service down, and the failure it guards against (a restore) is rare enough that
  observing first costs nothing.
- **A checksum column in `schema_migrations`.** Rejected as insufficient rather than wrong: it detects an
  EDITED migration, which the manifest also does, but it cannot detect a runner that has never heard of a
  migration — the actual failure — because a set it does not know about produces no row to compare.

## Implementation guards

- `packages/infra/global/__tests__/dbTouchingStackBarrier.test.ts` — one apply path per database: a schema
  stack holds the runner and nothing that reads the schema, no other stack ships a runner, no stack
  constructs an in-deploy Trigger.
- `packages/infra/global/__tests__/prodDeployMigrationOrder.test.ts` — the pipeline half: the schema stack
  deploys before the migrate step that invokes it, and every consumer deploys after that database's own
  migrate step, in every workflow.
- `packages/infra/global/__tests__/migrationManifestAgreement.test.ts` — the two digest implementations
  agree, on the rendered text as well as the digest, over fixtures and over every real migrations directory.
- `packages/infra/global/__tests__/migrationBundleIntegrity.test.ts` — every bundler refuses to ship a
  migration Lambda carrying no `.sql`, and refuses before emptying its output directory.
- `packages/infra/global/__tests__/migrationRunnerLock.test.ts` — the one engine acquires, bounds and
  releases the advisory lock, and every runner routes through it.
- `packages/infra/global/__tests__/migrationSafetyNetCoverage.test.ts` — one runner output per database, and
  every one of them invoked from prod and from a sandbox deploy.
- `packages/infra/global/__tests__/stackProbeCoverage.test.ts` — the ensure-exists probes name the schema
  stacks, so a stage without one cannot read as complete.
- `packages/services/recipe-service/infra/__tests__/recipeDatabaseNameParity.test.ts` — the API, the workers
  and the schema runner resolve the same per-PR database name across three templates.
- `packages/infra/global/__tests__/bootSchemaGuardPackaging.test.ts` — the boot check can find its own
  migrations: the module resolves them as its own sibling, they exist, the Dockerfile copies them to the
  path the compiled module will resolve, and the check runs before `listen`. Without that last mile the
  check reports a packaging fault on every start and, in `warn`, nobody notices.
