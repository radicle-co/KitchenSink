# 0051 — The food catalog seed is a deploy step, and it writes as its own role

- **Status:** Accepted
- **Date:** 2026-09-30
- **Owner ruling (2026-09-26):** the seed connects as `food_seeder`, a fourth role in ADR-0039's model, for food
  only.
- **Extends:** [ADR-0039](0039-database-role-split.md): its role registry, its bootstrap and its runner.
- **Supersedes, in part:** [ADR-0039](0039-database-role-split.md): its three-role table and its "three roles per
  database" consequence, for food only; and its §5 clause that CONNECT is granted to the migrator and the service
  role only. CONNECT now goes to every login role.
- **Supersedes, in part:** [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): its rule that a schema
  stack holds the migration runner and nothing that reads the schema. The food schema stack also holds the seed
  function, which reads and writes the catalog. The rule becomes: nothing in a schema stack runs by itself; it runs
  only when the pipeline calls it.
- **Plan:** `docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md` (KTD-1, KTD-12, KTD-18, U18)

## Context

The curated food catalog is committed seed data, and every food database must hold it. Something must write it,
and ADR-0039 gives each database three roles. None of them fits the writer:

- The service role, `food_app`, serves user traffic. The catalog's ownership trigger (KTD-12) must tell a seed write
  from a user write by `session_user`, so the seed cannot write as `food_app`.
- The migrator holds DDL through the owner. A seed that writes as the migrator runs with the authority that changes
  the schema.
- The master is used by two functions only (ADR-0039 §4), and prod's master cannot connect into a service database.

This record covers the seeder role, the seed function that connects as it, and the ledger that records each applied
seed.

## Decision

1. **A fourth role, for food only.** `food_seeder` logs in through RDS IAM (`rds_iam`) and has no CREATEDB on any
   stage. Its only membership is `rds_iam`, and no role is a member of it. The registry names it as
   `DATABASE_ROLES.food.seeder`. Identity and recipe have no seeder.
2. **CONNECT and TEMPORARY on its database, and no CREATE.** The database ACL reset grants CONNECT to every login role
   and TEMPORARY to the seeder, which stages the seed in session temporary tables (KTD-1).
3. **Every role list is derived from the registry.** `databaseRoleNames`, `loginRoles` and `loginRolesByKey` in
   `@kitchensink/db-schema-guard` are the only lists. The `rds_iam` grant and its master-reach check, and the
   bootstrap's converge, probe rollback, census and postconditions, all iterate them. The master-reach check never
   examines a login role that a hand-written list misses. On RDS, the master reaching `rds_iam` is the lock-out
   (ADR-0039 §7).
4. **A migration refuses to run before its roles exist.** `applyMigrations` checks that every registry role of its
   database exists before it takes its lock, sets a role or grants anything. If one is missing, it fails with
   `RoleModelAbsentError`, which names the missing roles and says to deploy the global stack first.
5. **The seeder has postconditions of its own.** `applyRoleModel` asserts its attributes, its `rds_iam` membership,
   and that it reaches no other role and no role reaches it. The bootstrap asserts its CONNECT, its own TEMPORARY
   grant, and that it holds no CREATE.
6. **Its table rights come from food's table policy.** `tablePolicy.ts` names three sets: the catalog, the
   service-read-only tables (the seed ledger) and the dictionaries. The seeder holds DML on the catalog and SELECT
   and INSERT on the other two, granted explicitly with USAGE on `public`, so no right depends on a template default.
   The runner resets the seeder across the whole schema first, so it holds nothing on an unregistered table, and
   `auditSeederPrivileges` proves it after every run. A database with a seeder must name a policy.
7. **The seed runs in a pipeline-only function in the food schema stack.** `FoodSeedFunction` has its own execution
   role, which holds `rds-db:connect` for `food_seeder` alone, and its own drained log group. Nothing starts it except
   the pipeline: no event source, schedule, URL or invoke grant. The pipeline applies the seed after the migrate step
   and before anything that reads the catalog deploys, so the apply reads the schema only after the migration it
   depends on. The function's `describe` is read-only, and the deploy gate may call it at any time, before the
   migration included (ADR-0010's seed amendment). `dbTouchingStackBarrier.test.ts` registers it as the one
   pipeline-only handler beside the runner and refuses anything that could start it by itself.
8. **The ledger records a seed only after the verifier passes.** `catalog_seed_ledger` is insert-only. The apply
   writes its row last, in the same transaction as the catalog writes and the independent verification, so a failed
   verification leaves the previous seed and its row in place.
9. **The runner re-reads a database's rights after it resets the ACL.** The bootstrap proves the rights only on the
   databases it creates. A per-PR food database is created by the runner, and the seeder writes there, so the runner
   applies the same policy (`roles/loginRights.ts`) and refuses with `DatabaseRightsUnmetError` before any migration.

### Rejected alternatives

- **The seed writes as `food_app`.** The running service then holds the seed's writes, and the ownership trigger
  cannot tell the two kinds of write apart.
- **The seed writes as the migrator.** The seed then holds DDL, and a defect in the seed can change the schema.
- **A NOLOGIN seeder that the migrator sets its role to.** `session_user` is then the migrator for both seed writes
  and migrations, so the trigger cannot tell them apart, and the migrator can write seed rows.
- **CREATE on the database for staging tables.** Staging tables then outlive a failed run, and the seed holds DDL.

## Consequences

**Positive**

- A seed write and a user write have different `session_user` values, so the ownership trigger can tell them apart.
- The running service's authority does not grow.
- A migrate that runs before the global stack fails with a message that names the cause.

**Negative, accepted**

- Food has four roles and a fourth IAM principal. Whatever connects as the seeder needs its own `rds-db:connect`
  grant through `grantConnect` (ADR-0039 §11).
- A future login role must be added to `loginRolesByKey`, and the bootstrap's rights table names a rule per login
  key, so the new role does not compile until it has one.
- The registry is read at two deploys that nothing orders on a preview. A `pr-{N}` preview migrates food on the
  shared sandbox instance, and the sandbox bootstrap runs in a separate workflow on the same pull request event. The
  first preview migrate after a role is added can therefore fail with `RoleModelAbsentError`, and a re-run passes
  once the sandbox bootstrap finishes. Prod is ordered: `prod-deploy.yml` deploys the global app before it migrates.
- A change to a workspace library that the global app imports starts the global deploy in both workflows, so a
  registry change alone still reaches the bootstrap. `deployLegsWatchTheirLibraries.test.ts` derives the list.

**Guards**

- `packages/shared/db-schema-guard/src/__tests__/databaseRoles.test.ts`: the projections, read against each registry
  entry's own keys.
- `packages/shared/db-schema-guard/src/__tests__/applyRoleModel.test.ts`: a master membership in any role that
  `iamLoginStatements` grants to refuses before any `rds_iam` grant.
- `packages/shared/db-schema-guard/src/__tests__/loginRights.test.ts`: each login role's database rights, the policy
  the bootstrap and the runner share.
- `packages/infra/global/__tests__/dbTouchingStackBarrier.test.ts`: the seed function is the one registered
  pipeline-only handler, and nothing in a schema stack can start a function by itself.
- `packages/infra/global/__tests__/seedVerifierOwed.test.ts`: no workflow runs the seed while the verifier owes a
  column.
- `packages/infra/global/__tests__/seedStepOrder.test.ts`: in both pipelines, the seed step follows the food migration,
  precedes the deploy that reads the catalog, never continues on error, and applies the bundle the pipeline built.
- `packages/infra/global/tests/e2e/seederBootstrap.e2e.test.ts`: the bootstrap and the runner against a real
  PostgreSQL.
- `packages/services/food-service/tests/e2e/seederRole.e2e.test.ts`: what the seeder can and cannot do on a
  migrated food database.
- `packages/services/food-service/tests/e2e/seedFunction.e2e.test.ts`: the function's core applies and describes over
  a seeder connection.
