# 0039 — Each database has an owner, a migrator and a service role, and nothing a service runs connects as the RDS master

- **Status:** Accepted
- **Date:** 2026-09-11
- **Owner rulings (2026-09-11):** nothing is live, so the change ships in ONE release with no expand/contract;
  prod data is disposable, so the three databases are RECREATED owned by the new owner roles rather than
  transferred; identity is in scope; three roles per database are accepted; the sandbox food base stays cold;
  _"there's nothing in prod to reseed and we shouldn't be reseeding prod"_; the prod master's owner membership is
  SET-only; revoking CONNECT from PUBLIC, losing identity's erasure tombstones and a mandatory disarm deploy are
  accepted; the pre-change prod snapshot was offered and NOT selected.
- **Supersedes:** [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md) — its clause that a
  per-PR database is created by, and owned by, `food_app` (with `CREATEDB` granted by the bootstrap), and the
  per-service `action: 'drop'` doors it records as still existing. The rest of ADR-0006 stands.
- **Relates to:** [ADR-0031](0031-sandbox-only-per-pr-database-reaper.md) — the reaper stays the only thing that drops a per-PR
  database, and can now do so; [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md) — the runner it
  describes now applies as the owner; [ADR-0013](0013-cdk-nag-advisory-iac-security-linting.md) §3 — the master
  secret's rotation blocker; [ADR-0004](0004-minimize-nat-egress.md) — the NAT-consumer table;
  [ADR-0002](0002-vpc-consolidation-and-cidr-scheme.md) — why the master username cannot change.
- **Plan:** `docs/plans/2026-09-11-database-role-split.md`

## Context

Three problems with one cause — a database's single role did everything:

1. `food_app` and `recipe_app` migrated their databases AND served them, so each owned every table: the running
   service held full DDL over its own schema.
2. The per-PR reaper (ADR-0031) connects as the RDS master and was refused with `must be owner of database`, because
   the app roles owned the per-PR databases. Fourteen per-PR databases leaked on the shared sandbox instance.
3. Identity was worse. Its ECS service, five webhook Lambdas and its migration runner all logged in as the RDS master
   (`identity_app`, a member of `rds_superuser`, by password) — behind a public ALB. A SQL injection anywhere in them
   reached every database on the instance.

The constraint that shapes every option: AWS documents that granting `rds_iam` to a user — "including the RDS master
user", and through nested membership — makes IAM authentication take precedence. A master that reaches `rds_iam`
through ANY chain is locked out, together with every in-VPC tool that could undo it, because they all connect as the
master. And the master username is permanent: changing it replaces the instance (ADR-0002).

Measured on sandbox before the design was fixed (PostgreSQL 18.3, the reaper's census): the master is NOSUPERUSER,
CREATEDB, CREATEROLE and holds `pg_signal_backend`. Its only `pg_auth_members` row is to `rds_superuser`, and
`rds_superuser`'s own rows reach only PostgreSQL's predefined roles, `rds_password` and `rds_replication` — no row
anywhere reaches `rds_iam` or the app roles. Yet `pg_has_role(… 'MEMBER WITH ADMIN OPTION')` is true for both: RDS
confers that ADMIN without a catalog row. The app roles were created by the master on PostgreSQL 16, which on vanilla
PostgreSQL records an irrevocable ADMIN-only row for the creator (measured locally) — no such row exists here.

What the census could NOT settle is whether RDS's `rds_iam` precedence rule counts an ADMIN-only row, because the
master holds none. PostgreSQL's own `is_member_of_role` does.

## Decision

| database | owner (NOLOGIN, no `rds_iam`) | migrator (LOGIN, `rds_iam`) | service role (LOGIN, `rds_iam`) |
| -------- | ----------------------------- | --------------------------- | ------------------------------- |
| identity | `identity_owner`              | `identity_migrator`         | `identity_service`              |
| food     | `food_owner`                  | `food_migrator`             | `food_app`                      |
| recipe   | `recipe_owner`                | `recipe_migrator`           | `recipe_app`                    |

1. **The owner owns the database and every object in it.** It cannot log in and never holds `rds_iam`, which is what
   lets the master be a member of it safely. Identity's service role is `identity_service` because `identity_app`
   is the master.
2. **The migrator** holds INHERIT and SET on the owner and `SET ROLE`s to it for DDL, so every object a migration
   creates is the owner's. It may create databases only outside prod (per-PR databases).
3. **The service role** holds data privileges only — DML on every table, USAGE on sequences, SELECT-only on the
   migration ledger — granted after every migration run and by `ALTER DEFAULT PRIVILEGES` for objects created later.
4. **The master** holds SET on each owner everywhere (to create a database `OWNER` it), and INHERIT only outside
   prod, which is what lets the reaper drop an owner-owned per-PR database. After this decision the master is used
   by exactly two functions: `DataStack`'s role-model bootstrap and the non-prod reaper.
5. **Each database is closed to PUBLIC.** CONNECT is granted to its migrator and service role only.
6. **One registry.** `DATABASE_ROLES` and `RDS_MASTER_USERNAME` in `@kitchensink/db-schema-guard` are the only
   place a role is named; stacks, handlers and pools import them.
7. **Every lock-out question counts every `pg_auth_members` row**, ADMIN-only included — the conservative reading
   of an unmeasured rule, because a refusal is an outage and a lock-out is not recoverable from inside the VPC. The
   relaxed reading (INHERIT or SET only) exists solely for a vanilla-PostgreSQL stand-in master, whose ADMIN is
   recorded as rows RDS holds without one.
8. **One bootstrap.** A single master-connected function runs three custom resources in series — identity, food,
   recipe — each re-run when a digest of its statements or its handler bundle changes, and every pass holds one
   session advisory lock (shared with the reaper) for its whole length. Its pass: census; take the master out of the
   login roles, proven by a re-read; apply the role model, granting `rds_iam` only after a re-read shows the master
   cannot reach it; a fresh master login — BEFORE anything destructive — whose failure revokes `rds_iam` from the
   login roles on the still-authenticated session; decide the database's disposition; create, adopt or (armed)
   recreate; the role model and the login probe again; the database ACL reset as the owner; and postconditions read
   from `pg_database`.
9. **The runner applies as the owner.** `applyMigrations` requires the database's roles, `SET ROLE`s to the owner
   after taking its advisory lock, applies the privilege statements before and after, audits object ownership and
   that the service role holds data access and nothing more, and `RESET ROLE`s before unlocking.
10. **The reaper is the only thing that drops a per-PR database.** The runners' `action: 'drop'` doors are deleted.
11. **Every `rds-db:connect` grant goes through `IDatabaseInstance.grantConnect` with a registry name** — never a
    hand-built ARN (the hand-built one denied every recipe worker, #121).
12. **The recreate is one-shot.** It is armed per stage by a literal list in `DataStack`, which sets BOTH the custom
    resources' token and the function's own environment flag; the handler arms only when the two agree with its
    `STAGE`, so a hand-crafted invoke cannot arm an unarmed deploy. It drops only a database owned by a role it can name as the
    legacy owner (the master for identity, `<svc>_app` for food and recipe); an empty master-owned database is
    adopted instead; a database already owned by `<svc>_owner` is left alone, so it cannot repeat. For food and
    recipe the master must briefly INHERIT the legacy app role, so `rds_iam` is revoked from it first — including
    grants made by another grantor — and the pass refuses before the master joins if any path to `rds_iam` remains.
    The disarm commit DELETES the recreate path with the list, so no event — forged or re-sent by a rollback — can
    reach it; an unarmed stage whose database is still legacy then fails its deploy.

### Rejected alternatives

- **The status quo plus a reaper fix.** It leaves the service holding DDL and identity on the master.
- **Migrator-as-owner.** The migrator holds `rds_iam`, so the master could never join it and the reaper could never
  drop.
- **One shared migrator for every database.** One IAM principal with DDL everywhere is the blast radius this removes.
- **A migrator that only creates and drops per-PR databases.** It splits the owner's authority across two roles
  without removing the service role's DDL.
- **`GRANT <app> TO <master>` while the app holds `rds_iam`.** The lock-out.
- **Per-PR databases owned by the master.** The master would own data the service reads, and prod's master would
  need INHERIT everywhere.
- **`ALTER DATABASE … OWNER` as the master.** It needs ownership of the old owner first — the same membership
  problem.
- **The owner as a member of the app role.** The owner would reach `rds_iam`.
- **`ALTER ROLE … SET role`.** A session default, trivially reset by the connecting client; not an authority.
- **A REASSIGN-based transfer.** It needs the same membership in the legacy owner and buys nothing when the data is
  disposable.

## Consequences

**Positive**

- A running service can read and write its data and do nothing else. A flaw in a service no longer reaches its
  schema, and a flaw in identity no longer reaches every database on the instance.
- The master password is read by two functions. Rotating it (ADR-0013 §3's SMG4 finding) no longer takes a running
  service down, because no running service holds it.
- The reaper can drop every per-PR database it is asked to.
- Ownership, privileges and the role graph are asserted from the catalog on every bootstrap and every migration run,
  so drift fails a deploy instead of surfacing as a permission error in another service.

**Negative, accepted**

- Three roles per database, and every future principal needs an explicit CONNECT.
- Prod's master cannot connect into the service databases at all (SET-only, and PUBLIC holds no CONNECT). There is
  no in-database operator executor in prod.
- Recreating the databases destroyed their data, with no snapshot — including identity's erasure tombstones. That
  door was taken once, by ruling, and the disarm commit closes it.
- The `DatabaseSecretArn` export remains until a later release: the previous service stacks import it, and
  CloudFormation refuses to delete an export in use.

**Guards** (`packages/infra/global/__tests__/`)

- `databaseRoleLiterals` — no production file spells a role name outside the registry.
- `dbUserGrantRegister` — which stack logs in as which role, by exact equality; no owner grant; no one-argument grant
  (which defaults to the master); no hand-built ARN.
- `masterSecretConsumers` — the master secret's readers are exactly the bootstrap and the reaper.
- `dropDatabaseAuthority` — exactly the reaper and the armed recreate issue `DROP DATABASE`, in any language.
- `lockOutReading` — the relaxed lock-out reading appears only in its definition and the test harness.
- `integrationSubjectRole` — a service integration suite connects its subject as the service role: no tier file
  names a connection variable or a superuser credential, and the master-bearing surface has an exact consumer set.
- `roleSplitLegacyRecreateArmed` — names the stages the recreate is armed on, in its own title.
- `tests/dbBootstrap.integration.test.ts` — the pass, run by a NOSUPERUSER stand-in master against real PostgreSQL,
  including every refusal and a failure injected between the master joining the app role and the `DROP`.
