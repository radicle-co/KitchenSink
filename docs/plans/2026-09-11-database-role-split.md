# Database role split — per-database owner / migrator / service roles

Status: BUILT on the branch (P0–P7 + REVIEW fixes) and REHEARSED on sandbox (2026-09-11, see "Sandbox run"). P1
measured, no change (owner ruling). Reaper and reseed integration suites now run as the production roles. NOT merging
yet (owner, 2026-09-11); prod run and disarm commit follow the merge. Every service integration AND e2e tier now
runs as its service role (owner ruling, 2026-09-11): 144 integration suites across five packages plus food's and
recipe's e2e tiers, guarded by `integrationSubjectRole`.
ALL RULINGS MADE.

## Why

- Each service's database is migrated AND served by one role (`food_app`, `recipe_app`), which therefore owns
  every table: the live service holds full DDL over its own schema.
- The per-PR database reaper connects as the RDS master and gets `must be owner of database …` — 14 orphaned
  per-PR databases on the shared sandbox instance (9 for merged PRs).
- Identity is worse: the identity service, five identity-webhooks Lambdas and the identity runner all connect
  as the RDS MASTER (`identity_app`, `rds_superuser`, password) behind a public ALB.

## ⛔ The constraint that shapes everything

The RDS master login is `identity_app` (`packages/infra/global/lib/platform/DataStack.ts:103`, password auth).
AWS: granting `rds_iam` to a user — **including via nested membership**, "including the RDS master user" — makes
IAM auth take precedence. So the master must NEVER be on an `rds_iam` chain, or every password client (and every
in-VPC tool that could undo it) is locked out. This rules out `GRANT <svc>_app TO <master>` and any design where
the master joins a role that holds `rds_iam`. The master username is permanent (changing it replaces the
instance, ADR-0002).

## Owner rulings already made (2026-09-11)

1. Nothing is live — outages during the change are acceptable → ONE release, no expand/handover/contract.
2. Prod data is disposable → RECREATE the three databases with the right owner; no REASSIGN, no temporary prod
   CREATEDB.
3. Identity is in scope now (off the master login).
4. Three roles per database accepted.
5. Sandbox food base stays COLD after the recreate (no base migrate/seed door); previews migrate from scratch and
   seed themselves via `POST /foods/batch` as e2e already does.
6. NO prod catalog reseed — "there's nothing in prod to reseed and we shouldn't be reseeding prod". P6 (the
   Fargate seed task, `datasetFetch.ts`, `deployedReseedMain.ts`, `run-catalog-seed.sh`,
   `food-catalog-seed.yml`, `yauzl`) is DROPPED from this plan. Prod's food catalog is empty afterwards.
7. Prod master's owner membership is SET-only (no INHERIT); no in-database operator executor in prod.
8. Accepted: `REVOKE ALL … FROM PUBLIC`; identity erasure tombstones discarded; the disarm commit is a mandatory
   second prod deploy. NOT selected: the pre-change prod snapshot (data is disposable) — do not take it.

## Decision (Option B)

| service  | owner (NOLOGIN, no `rds_iam`) | migrator (LOGIN, `rds_iam`) | service role (LOGIN, `rds_iam`) |
| -------- | ----------------------------- | --------------------------- | ------------------------------- |
| identity | `identity_owner`              | `identity_migrator`         | `identity_service`              |
| food     | `food_owner`                  | `food_migrator`             | `food_app`                      |
| recipe   | `recipe_owner`                | `recipe_migrator`           | `recipe_app`                    |

- The owner owns the database (so `public`, via `pg_database_owner`) and every object in it.
- `GRANT <owner> TO <migrator> WITH INHERIT TRUE, SET TRUE`; the runner `SET ROLE <owner>` for DDL. Migrator has
  CREATEDB outside prod only.
- Service role: DML only (grants + `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>`), SELECT-only on
  `schema_migrations`, no CREATEDB anywhere.
- Master: `GRANT <owner> TO <master> WITH SET TRUE`, plus INHERIT outside prod so the reaper can drop. After this
  release the master is used only by `DataStack`'s bootstrap and reaper Lambdas.
- Recursive postcondition on every bootstrap run, every stage: no path from the master to `rds_iam`; plus a
  fresh-connection master-password login probe with scoped rollback of what the run granted.
- `REVOKE ALL ON DATABASE … FROM PUBLIC`; CONNECT granted to the migrator and service role only.
- The reaper stays the ONLY thing that drops a per-PR database; the runners' `action: 'drop'` doors are deleted.

Rejected (record in the ADR so nobody re-proposes): status quo + reaper fix; migrator-as-owner; one shared
migrator; migrator that only creates/drops per-PR DBs; `GRANT <app> TO <master>` while the app holds `rds_iam`;
per-PR DBs owned by the master; `ALTER DATABASE OWNER` as master; owner as member of the app role;
`ALTER ROLE … SET role`; REASSIGN-based transfer.

## Components (paths)

### `@kitchensink/db-schema-guard` — single authority for the role model

- NEW `src/roles/databaseRoles.ts` — `DatabaseService`, `DatabaseRoles`, `DATABASE_ROLES` registry,
  `MIGRATION_LEDGER_TABLE`; names asserted `^[a-z_]+$`.
- NEW `src/roles/roleStatements.ts` — pure `roleModelStatements(roles, { master, isProd })` and
  `databaseAclStatements(roles, database)`; `GRANT rds_iam` emitted last.
- NEW `src/roles/privilegeStatements.ts` — `privilegesBeforeApply` / `privilegesAfterApply` (incl. the ledger
  revoke); re-applied every run (recipe per-PR DBs are created empty, food's are TEMPLATE clones).
- NEW `src/roles/roleGraph.ts` — `MembershipEdge`, `edgeConfersMembership` (default `inherit || set`, Step 0
  decides), `pathsToRole`, `readMembershipEdges(pool)` (find `rds_iam` by name, not `::regrole`).
- NEW `src/roles/applyRoleModel.ts` — impure applier; returns what it granted the master.
- NEW `src/roles/assertRoleModel.ts` — replaces `infra/global/src/db-bootstrap/postconditions.ts`.
- NEW `src/roles/ownershipAudit.ts` — catalog (`pg_class`/`pg_proc`/`pg_type`/`pg_extension`/`pg_namespace`,
  never `information_schema`) ownership + privilege audit.
- CHANGE `src/applyMigrations.ts` — REQUIRED `database` + `roles`; after the lock: `SET ROLE owner` → before
  privileges → ledger → migrations → after privileges → validate (incl. audit) → `RESET ROLE` in `finally`
  before unlock (same shape as `lock_timeout`).
- NEW `src/testing/rdsLikeInstance.ts` (`./testing` export, dev only) — `provisionRdsLikeInstance(...)`: stand-in
  `rds_iam`, a NOSUPERUSER master-like role, runs the REAL `applyRoleModel` as it, returns master/migrator/app URLs.

### NEW `packages/shared/rds-iam-auth` (`@kitchensink/rds-iam-auth`)

One adapter over `@aws-sdk/rds-signer` (replaces four copies of `new Signer(`): `rdsIamPoolConfig(...)`
(password is a FUNCTION, one token per connection) and `poolConfigFromEnv(defaultUsername)`. Consumers: identity
service + webhooks (new), food, recipe, recipe-workers. Dockerfiles COPY its dist.

### `packages/infra/global`

- NEW `src/db-bootstrap/handler.ts` (one handler for all three DBs), `bootstrapPass.ts`, `legacyRecreate.ts`
  (one-shot, stage-scoped arming token `role-split-2026-09:<stage>`, deleted by a disarm commit),
  `adoptEmpty.ts` (permanent: re-owns the empty `kitchensink_identity` RDS creates on a new stage),
  `masterLoginProbe.ts`.
- DELETE `src/food-db-bootstrap/`, `src/recipe-db-bootstrap/`, `src/db-bootstrap/postconditions.ts`.
- CHANGE `src/db-reaper/handler.ts` — `count` also reports the master's role edges (this is Step 0's executor).
- CHANGE `lib/platform/DataStack.ts` — one bootstrap function; three serialized custom resources
  (identity → food → recipe); `roleModelDigest` property so a code change actually re-runs them.
- CHANGE ADR-0004's `nat-consumers` table + CLAUDE.md copy (two bootstrap functions become one).

### Runners

- food / recipe migrate handlers: username → `<svc>_migrator`; `CREATE DATABASE … OWNER <svc>_owner` (food with
  TEMPLATE); pass `database` + `roles`; delete `action: 'drop'`.
- identity migrate handler: drop Secrets Manager; IAM as `identity_migrator`.

### Identity service + webhooks

- Identity service: `src/database/poolConfig.ts` via `poolConfigFromEnv('identity_service')`; remove
  `DB_PASSWORD` from the env schema.
- Webhooks: `src/common/db.ts`, `src/config/env.ts`, `handlerPipeline.ts` off `DB_SECRET_ARN`;
  `infra/scripts/localstack-bootstrap.sh` → `DATABASE_URL`.

### Stacks — IAM only via `database.grantConnect(fn, '<role>')`, never a hand-built ARN

- Food/Recipe/Identity `*SchemaStack.ts` → `<svc>_migrator`.
- `IdentityServiceStack.ts`, `WebhooksStack.ts` → `identity_service`; remove master-secret reads.
- Food/recipe service + workers keep `<svc>_app`, now via `DATABASE_ROLES.*.app`.

### Food catalog seed — DROPPED (ruling 6)

### Pool connection-establishment timeouts (found 2026-09-11) — MEASURED; no change, by owner ruling

The deployed k6 tier's remaining 500s (run 34602175395: parse-job create 15/528, pull-from-source 5/207) are
`DrizzleQueryError` → `Connection terminated due to connection timeout` (pg-pool) → `Connection terminated
unexpectedly` (pg): the pool could not OPEN a new RDS-IAM connection inside its 5s `connectionTimeoutMillis`.

Measured 2026-09-11 (no ECS exec exists and PostgreSQL 18's `log_connections = setup_durations` needs the custom
parameter group ADR-0002/the PG18 runbook forbid, so the probes were the in-VPC Lambdas):

- **One IAM connection is fast at rest.** Eight warm no-op invokes of pr-91's food runner — each opens TWO fresh
  IAM connections, then runs the ledger read, privilege statements and ownership audit — took 318–774 ms. The
  password-authenticated reaper `count` took 164–262 ms warm. 5 s is not close.
- **The sandbox instance is memory-starved, all day.** `db.t4g.micro` (1 GiB): FreeableMemory 90–145 MB and
  SwapUsage 250–480 MB across the whole prior 24 h and through the k6 window (CPU ≤ 25 %, ≤ 30 connections).
  Prod's `db.t4g.small`: ~690 MB free, ~22 MB swap. AWS: IAM DB authentication "requires compute resources on the
  database instance. You must have between 300 and 1000 MiB extra memory on your database for reliable
  connectivity" (UsingWithRDS.IAMDBAuth, Limitations).

So the timeouts are a sandbox capacity symptom under load bursts, not a pool setting — raising
`connectionTimeoutMillis` would only hide it. **Owner ruling (2026-09-11): no RDS upsize** ("I don't want to upgrade
unless it's the difference between not being able to use the sandbox DB or not") — and it is not: every deployed
e2e tier passed against this instance. Pool settings stay as they are. Per-PR k6 5xx on sandbox read as this
capacity limit, consistent with the ruling that per-PR k6 is a regression detector, not a capacity number.

If pool settings ever move, two traps: `rdsPoolConfigFromEnv`'s `DATABASE_URL` branch returns before the adapter
could add them, and pools are built in more places than the three `database.module.ts` files (recipe's DAL,
identity-webhooks' and recipe-workers' `common/db.ts`, the food seed CLIs) — so a guard, not a convention.

## Bootstrap pass (per service, serialized, as master on `postgres`)

1. Census (`readMembershipEdges`) — logged; this is also Step 0's output.
2. Converge an interrupted run (master in `<app>` → revoke; re-read; re-grant `rds_iam` to `<app>` only if the
   master has no path into it).
3. `applyRoleModel` (`GRANT rds_iam` only after a re-read shows no master→app edge).
4. Legacy recreate (armed + owner is legacy): food/recipe — `REVOKE rds_iam FROM <app>` → re-read (refuse if a
   path remains) → `GRANT <app> TO <master> WITH INHERIT TRUE, SET FALSE` → `DROP DATABASE <base> WITH (FORCE)`
   (+ non-prod: re-own legacy per-PR DBs to `<owner>` for the reaper) → `finally` revoke, re-read, re-grant
   `rds_iam`. Identity — master owns it, drop directly.
5. Create `<db> OWNER <owner>` if absent (identity: adopt-empty).
6. Database ACL under `SET ROLE <owner>`.
7. `assertRoleModel` + master-login probe.

## Build order (all one release)

- P0 Step 0 probe (sandbox): reaper `count` gains the roles block; deploy; invoke `{"action":"count"}`.
- P1 `@kitchensink/rds-iam-auth` + refactor the four existing callers (no behaviour change).
- P2 db-schema-guard role model + unit tests.
- P3 `applyMigrations` roles; three runners; schema-stack grants; every service's integration harness onto
  `provisionRdsLikeInstance`.
- P4 identity service + webhooks on IAM.
- P5 infra/global bootstrap + serialized custom resources + digest; ADR-0004 table; CLAUDE.md.
- ~~P6 catalog seed task~~ — dropped (ruling 6).
- P7 static guards; ADR-0039; pointers from ADR-0006 / ADR-0031.
- Then sandbox run → merge (prod run) → disarm commit.

## Tests owed

- Unit: registry pattern; exact statement lists per stage; folded-graph "no master→rds_iam" per stage;
  `pathsToRole` violating fakes (direct, two hops, via owner, via app, cycle, ADMIN-only); privileges incl.
  ledger revoke; `applyMigrations` roles required + SET/RESET pairing + ownership validation;
  `legacyRecreate` ordering and failure paths; `adoptEmpty` refusal; login-probe rollback; stack templates
  (three chained resources + digest, `:dbuser:<id>/<svc>_migrator`, no `DatabaseSecretArn` in identity/webhooks); runners reject `{"action":"drop"}`; `rds-iam-auth` password is a function.
- Integration (real Postgres, NEVER connecting as superuser): `dbRoleModel`, `dbLegacyRecreate`, rewritten
  `perPrDatabaseReaper` (fixtures created by the migrator; NEGATIVE CONTROL: an app-owned DB is refused with
  42501 — the test the old suite could not fail), `runMigrations` with roles, per-service harness via
  `provisionRdsLikeInstance`, `databasePrivileges` per service, and the existing food `catalogReseed` suite moved to run as `food_app` (proves DML-only suffices).
  `_ci.yml`: superuser URL renamed `DATABASE_ADMIN_URL`; role URLs derived. DONE — plus every other service
  integration and e2e suite, through `@kitchensink/service-test-harness`'s `provisionRoleDatabase`. What that
  found, which a superuser tier could not: `ANALYZE` as the service role WARNS AND SKIPS (three food suites were
  asserting query plans over statistics nothing had gathered), recipe's atomicity suite issued fixture DDL
  through the SUBJECT's own handle, and food's e2e tier — unrunnable locally until now — still asserted a
  moderation ladder whose routes were deleted on 2026-09-08.
- Static guards: `dbUserGrantRegister`, `masterSecretConsumers`, `databaseRoleLiterals`,
  `dropDatabaseAuthority`; update `perPrDatabaseDropDoors`, `globalBootstrapBundle`.
- Deployed: existing `deployed-e2e.yml` + prod smokes; no new k6.

## Runbook

- Step 0 (sandbox): invoke the reaper `count` (local AWS CLI v1 → `--payload file://`); record the master's edges
  and flags. Prod has no on-demand executor — measured by the release's own census; every prod unknown fails
  before the first `DROP`.
- Sandbox — DONE 2026-09-11: `sandbox-identity-deploy.yml` (armed bootstrap recreates the three bases, re-owns
  legacy per-PR DBs) → reaper `count` + `drop` per token (cleared all 14) → previews redeployed by the PR's own CI
  run → its deployed e2e tier. Results under "Sandbox run".
- Prod: confirm nothing live (no snapshot — ruling 8); merge → `prod-deploy.yml` order (global → identity
  schema/migrate/service/webhooks → food → recipe); NO reseed (ruling 6); DISARM commit (mandatory second prod
  deploy); follow-up: master secret rotation (ADR-0013 SMG4).

### Lock-out: what now prevents it, and what is left (staff-architect REVIEW, 2026-09-11)

- **Unmeasured rule, conservative reading.** Step 0 showed the master holds NO ADMIN-only row (its ADMIN is implicit
  through `rds_superuser`), so whether RDS's `rds_iam` precedence counts such a row is unknown; PostgreSQL's
  `is_member_of_role` does. Every lock-out question therefore counts every `pg_auth_members` row. If RDS ever records
  a creator row the way vanilla PostgreSQL does, the pass REFUSES before any `rds_iam` grant — an outage.
- **Probe before destruction, rollback on the held session.** A fresh master login is probed after each role-model
  step, BEFORE the recreate; on failure the still-authenticated session revokes `rds_iam` from the login roles
  (cutting every path whatever carried it) and releases the master, then fails the deploy.
- **One advisory lock** (`ROLE_CATALOG_LOCK_KEY`) serializes every bootstrap pass and the reaper; the function timeout
  (600 s) sits below the provider framework's (900 s).
- **Residual — break-glass not built.** A lock-out survives only if the Lambda dies between a harmful grant and the
  probe on the same session. Recovery then needs the master to log in by IAM token from inside the VPC
  (`rds-db:connect` on `dbuser:<id>/identity_app` for a prepared principal, plus an in-VPC client), which nothing
  provides today; resetting the master password through RDS is the other lever and is UNVERIFIED as a cure for
  `rds_iam` precedence. The sandbox run did not settle the rule either — creating the new roles on RDS recorded no
  ADMIN-only row for the master, so there was still no such row to count — but it showed RDS does not create the
  row that would make the conservative reading refuse.

## One-way doors

Recreating the three databases destroys their data, with no way back (no snapshot, ruling 8; identity erasure
tombstones go with it). Ownership by NOLOGIN roles is the lasting door. `REVOKE … FROM PUBLIC` is reversible but every
future principal needs an explicit CONNECT. No in-database operator SQL executor remains afterwards.

## Open rulings (owner)

None — all resolved 2026-09-11 (rulings 1–8 above).

## Step 0 — measured on sandbox (2026-09-11, PostgreSQL 18.3, via the reaper's `count` census)

- Master `identity_app`: NOSUPERUSER, CREATEDB, CREATEROLE, holds `pg_signal_backend` (via `rds_superuser`).
- Its ONLY membership edge: `identity_app → rds_superuser` (INHERIT, SET). **No edge to `food_app`/`recipe_app` —
  not even the ADMIN-only edge PostgreSQL 16+ records for a role a CREATEROLE user creates** (the roles predate it,
  or were created another way). The blueprint's "master holds ADMIN-only edges to the app roles" is FALSE.
- No path from the master to `rds_iam` (safe today).
- `food_app → rds_iam` and `recipe_app → rds_iam` (INHERIT, SET).
- Owners: 16 databases owned by the app roles (`kitchensink_food` + 3 per-PR by `food_app`, `kitchensink_recipes` +
  11 per-PR by `recipe_app`); `kitchensink_identity` by the master. Census total 14 per-PR databases.

- **ADMIN is held implicitly** (second census, `pg_has_role(… 'MEMBER WITH ADMIN OPTION')`): the master holds ADMIN
  on `food_app`, `recipe_app`, `rds_iam` and `rds_superuser` — through `rds_superuser`, which is why
  `pg_auth_members` shows no edge. So the legacy recreate's `GRANT <app> TO <master> WITH INHERIT TRUE, SET FALSE`
  (issued only after `REVOKE rds_iam FROM <app>` and a re-read) IS available on sandbox, and the master can
  `GRANT rds_iam` to the new migrator/service roles. Prod is assumed identical (same engine, same RDS role model)
  and is measured by the release's own first step, which fails before any `DROP` if it is not.

## Sandbox run — measured (2026-09-11, `sandbox-identity-deploy` run 34637565030, then 34640830410)

- **Master kept its password login throughout.** Each pass's census logged `currentUserPathsToRdsIam: []`, and the
  food and recipe passes logged in with the password after identity's had granted `rds_iam` to two new roles.
- **RDS records no creator row.** After the identity pass the master's edges were `rds_superuser` and
  `identity_owner` (INHERIT, SET — non-prod) only: no ADMIN-only row on `identity_migrator`/`identity_service`,
  unlike vanilla PostgreSQL. Whether RDS's `rds_iam` rule would count such a row remains unmeasured, and moot here.
- **Recreate, all three bases.** `kitchensink_identity` (legacy owner the master), `kitchensink_food` (`food_app`,
  3 per-PR children re-owned) and `kitchensink_recipes` (`recipe_app`, 11 re-owned); `revokeIamFrom` cleared the
  app roles' `rds_iam` rows (which revoke path it took was not logged), the master joined and left, and the next
  census showed `rds_iam` back on the app roles and no master row to either.
- **`DROP DATABASE` works through INHERIT on the owner.** The reaper dropped all 14 per-PR databases; its census
  then read 0. (Re-owning a database does not re-own its tables, so the re-owned per-PR databases had to go.)
- **`CREATE DATABASE … OWNER` as the master works** — but sandbox's master holds INHERIT and SET, so SET-alone is
  proven only by `dbBootstrap.integration.test.ts`'s prod-shaped case on PostgreSQL 18. Prod's first run measures it.
- **Identity migrates from scratch as `identity_migrator` by IAM**, and the service and webhooks run as
  `identity_service`. The preview's food and recipe migrators created fresh per-PR databases owned by `<svc>_owner`.
- **Deployed e2e green** on the role-split sandbox: identity (both), food, recipe, recipe↔food, web ×8, k6.
- **Found by the run, fixed:** `run-migrations.sh` still sent `"action":"migrate"` to runners that now parse
  `.strict()` (every schema step failed); the harness's undeclared `db-schema-guard`; a synth guard for the retired
  compiled entrypoint; ADR-0013's IAM4/IAM5 counts. The shared deploy ran from the PR event, not a dispatch.

## Still assumed

ADMIN-only edges don't count for RDS IAM precedence (unmeasured — RDS created none); prod's master holds the same
implicit ADMIN as sandbox's; `CREATE DATABASE … OWNER` needs only SET on RDS (vanilla-proven, prod measures it).
