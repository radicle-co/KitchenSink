# Runbook — PostgreSQL 16 → 18 major upgrade of the shared RDS instance

Operational procedure for plan `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` **U13**
(requirements R48–R56, R62). Read alongside
`docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md` (the data stack's standing hazards)
and `docs/architecture/decisions/0006-per-pr-feature-deploys-base-stage-and-logical-db.md` (per-PR logical databases, which live on this same instance).

> ## ⛔⛔ READ THIS FIRST — three facts that change how you must work
>
> **1. Merging the PR IS the production maintenance action.** `.github/workflows/prod-deploy.yml` triggers on
> a push to `main` touching `packages/infra/global/**` and runs
> `cdk deploy --app "node packages/infra/global/dist/bin/app.js" --all --require-approval never`.
> CloudFormation's `ApplyImmediately` **defaults to `true`**, so the engine change is applied the moment the
> change set executes — unattended, from CI, whenever the merge button is pressed. There is no separate
> "now do the upgrade" step to schedule. **Do not merge U13 outside the agreed window** (Phase 4).
>
> **2. There is no way back.** AWS: _"After an upgrade is complete, you can't revert to the previous version
> of the DB engine. If you want to return to the previous version, restore the DB snapshot that was taken
> before the upgrade to create a new database."_ ADR-0002's standing **"fix forward only"** posture for this
> stack **does not apply to this property** — there is no forward for a major version. The only recovery is
> **Phase 6**, and Phase 6 must be rehearsed (Phase 2) before Phase 4 is attempted.
>
> **3. This instance carries live production user data.** `kitchensink_identity`, plus `kitchensink_food`,
> `kitchensink_recipes` and every per-PR logical database. It is single-AZ, has no read replica,
> `removalPolicy: DESTROY` and takes **no safety snapshot** on delete. `deletionProtection: true` is the only
> thing between an accidental replacement and total loss.

Run everything on Node 24 (`nvm use`). Every `aws` command below resolves identifiers rather than assuming
names — do not paste in a guessed instance id.

---

## Phase 0 — Decisions already taken (do not re-litigate mid-window)

| Question                    | Ruling                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Blue/Green deployment?      | ⛔ **Unavailable.** AWS lists **CloudFormation** among the unsupported features. Blue/Green also uses logical replication, which does **not** replicate DDL — and our in-stack migration Triggers (ADR-0022) and per-PR `CREATE DATABASE` are DDL, so the green environment would enter `Replication degraded`. In-place is the only path. |
| In-place, or dump/restore?  | **In-place.** RDS runs `pg_upgrade`.                                                                                                                                                                                                                                                                                                       |
| Pin the minor (`VER_18_3`)? | **No — major-only (`VER_18` → `EngineVersion: '18'`).** With `autoMinorVersionUpgrade: true` RDS tracks the 18 series' patches; pinning would make every security patch a code change. ⚠️ The cost is that RDS resolves the prefix at deploy time — **A2 below is the check that the resolved target is legal from our source minor.**     |
| Custom parameter group?     | **None, deliberately.** `DataStack` sets no `parameterGroup`, so RDS uses the default group for the engine version and moves it with the engine. This is what makes the bump a one-property change. `engineVersionDiff.test.ts` fails if one appears — see Phase 0a.                                                                       |
| `allowMajorVersionUpgrade`  | **`true`, and left on.** Required _in the same deployment_ as the version change. It only permits; the trigger is the version, which `engineVersionDiff.test.ts` pins to a reviewed constant.                                                                                                                                              |
| Downgrade path              | ⛔ None. **Phase 6** (snapshot restore into a new instance) is the entire recovery story.                                                                                                                                                                                                                                                  |

### Phase 0a — Why the parameter group deserves its own line

AWS's own upgrade runbook makes "have a version-compatible parameter group ready" step one, and
`ModifyDBInstance` constrains `DBParameterGroupName` to be _"in the same DB parameter group family as the DB
instance"_. Families are version-pinned (`postgres16` vs `postgres18`) and `Family` on
`AWS::RDS::DBParameterGroup` is **immutable**, so a custom group must be **replaced at a new logical id in the
same change set** as the version bump. Get it wrong and the deploy fails **after the outage has begun**.

We have no custom group, so this does not bite — and `engineVersionDiff.test.ts` asserts
`DBParameterGroupName` stays absent precisely so that whoever adds one is forced to read this section.

### Phase 0b — The local/CI Docker image moved its data directory (already handled; know why)

R62 makes "local Postgres tracks the RDS major" a continuous invariant, so the 12 CI service containers and
four compose files moved to `postgres:18` in the same change. That move carries a trap that has nothing to do
with RDS, **verified locally against both images**:

|                   | `postgres:16`              | `postgres:18`                   |
| ----------------- | -------------------------- | ------------------------------- |
| `PGDATA`          | `/var/lib/postgresql/data` | `/var/lib/postgresql/18/docker` |
| declared `VOLUME` | `/var/lib/postgresql/data` | `/var/lib/postgresql`           |

A compose file that keeps a mount at the old path makes `postgres:18` **refuse to start** — the entrypoint
detects the legacy mount and exits with _"The suggested container configuration for 18+ is to place a single
mount at /var/lib/postgresql"_. Confirmed by running it. All three mounts were moved
(`docker-compose.yml`, `docker-compose.test.yml`, `packages/services/identity/infra/docker/docker-compose.yml`);
the CI `services:` containers declare no volumes and are unaffected.

⛔ **Developers with an existing `postgres_data` volume must drop it** (`docker compose down -v`) before their
first `up` after this change. The old volume holds a PG 16 cluster; the image fails loudly rather than
discarding it, but it will not start until the volume is gone.

### Phase 0c — PostgreSQL 18 incompatibilities checked against THIS codebase

From the PG 18 release notes' _Migration to Version 18_ list. Recorded so nobody re-derives them, and so a
future reader can tell "checked, does not apply" from "never considered".

✅ **All three integration tiers were run against a real `postgres:18` (18.6) on 2026-08-22 and passed:**
food-service 35 files / 416 tests, recipe-service 49 / 320, identity 7 / 43. That exercises every migration
applying on 18 (including the two `STORED` generated `tsvector` columns and their GIN indexes), the `pg_trgm`
search paths, the `recipe_ratings` `AFTER`-trigger lost-update guard, and the planner access-path margin — so
the SCHEMA and the APPLICATION are known good on 18. ⛔ It says nothing about the DATA MIGRATION: a local
container starts empty and runs migrations forward, which is not `pg_upgrade` over a populated instance.
Phases 2–5 remain mandatory.

| Change in 18                                                                            | Applies here?                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Generated columns default to `VIRTUAL`; a virtual column cannot be indexed**          | ⛔ **YES — the biggest code-level risk.** Both our generated columns exist only to carry a GIN index. Both already declare `STORED`; `generatedColumnStorage.test.ts` binds future ones.  |
| FTS/`pg_trgm` now use the cluster's default collation provider instead of always `libc` | Only if `datlocprovider` ≠ `c`. **A6 is the check**; if it is not `c`, add an FTS/trigram reindex to D5.                                                                                  |
| `COPY FROM` no longer treats `\.` as EOF in CSV                                         | **No.** No `COPY FROM` anywhere in the tree (grepped).                                                                                                                                    |
| `AFTER` triggers run as the role active when the event was QUEUED                       | **No effect.** The three `recipe_ratings` aggregate triggers run inside one transaction as one role; nothing switches role mid-transaction. Their integration tier re-runs on 18 in CI.   |
| `initdb` enables data checksums by default                                              | Local/CI Docker only — RDS manages `initdb`. No action.                                                                                                                                   |
| `VACUUM`/`ANALYZE` recurse into inheritance children (new `ONLY`)                       | **No.** No inheritance hierarchies; partitioning is not used.                                                                                                                             |
| `md5` password auth deprecated (warns, not removed)                                     | **No.** The master uses SCRAM; `food_app`/`recipe_app` use RDS IAM tokens.                                                                                                                |
| Wire protocol 3.2 / 256-bit cancel keys                                                 | **No.** The server still speaks 3.0, which `pg` 8.x uses.                                                                                                                                 |
| `pg_trgm` version                                                                       | **Unchanged at 1.6** in both 16 and 18 — `similarity`/`word_similarity` and every threshold identical, so the `flor` case at 0.600 survives. Do **not** `ALTER EXTENSION pg_trgm UPDATE`. |

---

## Phase 1 — Pre-flight against the LIVE instance (do not skip; run for prod **and** sandbox)

Resolve the instance first. Everything downstream uses `$DB`.

```bash
! STACK=kitchensink-data-prod    # or kitchensink-data-sandbox
! DB=$(aws cloudformation describe-stack-resources --stack-name "$STACK" \
      --query "StackResources[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId" --output text)
! echo "$DB"
```

### A1. Record the exact current state

```bash
! aws rds describe-db-instances --db-instance-identifier "$DB" \
    --query 'DBInstances[0].{Ver:EngineVersion,Class:DBInstanceClass,PG:DBParameterGroups[0],AZ:AvailabilityZone,MultiAZ:MultiAZ,Backup:BackupRetentionPeriod,Prot:DeletionProtection,Endpoint:Endpoint.Address}'
```

Write the output into the change ticket. Two fields decide later steps:

- **`Backup` (retention) must be > 0.** RDS takes its two automatic snapshots (pre- and post-upgrade) _only_
  if retention is greater than zero. We set `backupRetention: Duration.days(7)`, so it should be `7` — but
  **verify, and take the manual snapshot in Phase 4 regardless.** Never let the automatic one be the plan.
- **`Endpoint`** — record it. Phase 6 compares against it.

### A2. ⛔ Confirm our source minor can actually reach 18 in ONE hop

This is the check the major-only pin makes mandatory. Not every 16.x minor lists an 18.x target — 16.4, 16.5
and 16.7 publish **no 18.x target at all** and can only reach 17.x first.

```bash
! SRC=$(aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].EngineVersion' --output text)
! aws rds describe-db-engine-versions --engine postgres --engine-version "$SRC" --region us-east-1 \
    --query 'DBEngineVersions[0].ValidUpgradeTarget[?starts_with(EngineVersion,`18`)].{V:EngineVersion,Major:IsMajorVersionUpgrade}' --output table
```

**Halt conditions:**

- The table is **empty** → our minor cannot reach 18 in one hop. Bump the minor first (a separate, low-risk
  change), then restart this runbook.
- The table lists targets → note them. `EngineVersion: '18'` is a **prefix**; RDS resolves it at deploy time
  and the resolved version **must be one of these**. If the only listed target is (say) `18.3` while RDS's
  default for the `18` prefix has moved on to `18.4`, the deploy fails. If that is the case, do **not** guess
  — pin `VER_18_3` for the hop as a documented, reviewed exception (updating `EXPECTED_ENGINE_VERSION` and
  the `it('fails a MINOR-pinned version', …)` control together) and relax it afterwards.

### A3. Invalid databases — a pure, avoidable outage

`pg_upgrade` dumps **every** database on the instance. A database left invalid by an interrupted
`DROP DATABASE` blocks the upgrade.

```sql
-- run in the instance's default database
SELECT datname FROM pg_database WHERE datconnlimit = -2;

-- generate the drops (review before running):
SELECT 'DROP DATABASE ' || quote_ident(datname) || ';' FROM pg_database WHERE datconnlimit = -2;
```

### A4. Drop stale per-PR logical databases

Every abandoned `pr-{N}` database is dump-and-restore time spent for nothing, and the window scales with the
**number of databases and objects**, not just bytes.

```sql
SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database WHERE datname LIKE '%\_pr\_%' OR datname LIKE 'pr\_%'
ORDER BY datname;
```

Cross-check each against the open PR list before dropping.

⛔ **Do NOT assume a closed PR's database was reclaimed. Until 2026-09-03 half of them never were.**
`teardown-sandbox-pr.sh` §1 hardcoded food's migration-runner output, so `kitchensink_food_pr_{N}` was
dropped and `kitchensink_recipes_pr_{N}` was not — on every reaped recipe preview, silently, since recipe
shipped. §1 now discovers every `*MigrationFunctionName` output across the PR's own stacks
(`perPrDatabaseDropDoors.test.ts` asserts that in both directions), and the teardown wakes the shared tier
first, which it also never did — so a preview reaped inside the 00:00–09:00 ET stop window was invoking an
in-VPC Lambda against a stopped database. **Every `kitchensink_recipes_pr_*` row this query returns, and any
`kitchensink_food_pr_*` row from a PR closed overnight, is expected backlog rather than a fresh anomaly.**
Treat the list as a to-drop list, not as evidence of a new fault.

⚠️ **This SQL still has no execution mechanism.** Nothing schedules it and nothing alerts on it; running it
is a manual step of this runbook. The partial answer is `packages/infra/global/src/db-bootstrap/perPrInventory.ts`,
which emits the same census as a structured log line from both DB bootstrap Lambdas on every `DataStack`
deploy — enough to see whether the backlog is bounded and shrinking, not enough to page anyone. A persistent
`DROP DATABASE`-capable reaper is a one-way door and is deliberately unbuilt pending an owner decision.

### A5. Other precheck blockers

```sql
SELECT count(*) AS prepared_xacts FROM pg_catalog.pg_prepared_xacts;   -- must be 0
SELECT count(*) AS large_objects  FROM pg_largeobject_metadata;        -- expect ~0; millions => memory risk
SELECT slot_name, plugin, active FROM pg_replication_slots;            -- expect none
SELECT extname, extversion FROM pg_extension ORDER BY 1;               -- expect citext, pg_trgm, pgcrypto
```

**Extensions.** `citext` (1.8), `pg_trgm` (1.6) and `pgcrypto` (1.4) are all available on RDS PostgreSQL 18 —
`pg_trgm` stays at **1.6**, byte-identical between 16 and 18 (`similarity`, `word_similarity` and every
threshold unchanged), so the `flor` case at 0.600 survives. ⛔ Anything present that is **removed** in RDS 18
must be dropped **before** the upgrade or it fails; check the full list above against the RDS 18 extension
table rather than assuming our three are all that is installed.

### A6. Collation baseline — capture BEFORE, for the after comparison

Run in **each** database (`kitchensink_identity`, `kitchensink_food`, `kitchensink_recipes`) and keep the
output.

```sql
SELECT datname, datcollate, datctype, datlocprovider, datcollversion FROM pg_database ORDER BY 1;

SELECT collname, collprovider, collversion, pg_collation_actual_version(oid) AS actual
FROM pg_collation WHERE collversion IS NOT NULL;
```

⛔ **The reindex condition is about collation _version_, not provider, and it targets btrees.** Trigram and
tsvector indexes decompose text into trigrams and lexemes; they do not depend on collation. The
collation-sensitive indexes are the **text btrees** — including `food_normalized_name_unique`, whose
correctness underwrites the catalog's dedup key. Gating on "non-libc" inverts the risk: `libc` is the
provider whose version _can_ shift.

⚠️ **Two mitigating facts, both worth knowing before you panic post-upgrade.** RDS ships an _independent
default collation library_ pinned to glibc `2.26-59.amzn2`, so `collversion` is **not expected** to change
across an RDS major upgrade. And PostgreSQL 18's change that makes full-text search use the cluster's default
collation provider instead of always `libc` — which _would_ require reindexing FTS and `pg_trgm` indexes —
applies only where `datlocprovider` is **not** `c`. A6's output is what tells you which case we are in.
**If `datlocprovider` is anything other than `c`, add a `pg_trgm`/FTS reindex to Phase 5.**

### A7. Baseline the things a planner change can move

Capture these _before_ the upgrade so a post-upgrade difference can be attributed:

1. **The relevance judgement set** (R56/R57) — record precision@1 and the full ordered result per query.
2. **`foodSearchAccessPath.integration.test.ts`** — its cost margins were measured on PG **16**. Record the
   current `EXPLAIN` output for `raw chicken breast`.
3. `SELECT relname, n_live_tup, last_analyze, last_autoanalyze FROM pg_stat_user_tables ORDER BY 2 DESC;`

---

## Phase 2 — ⛔ THE DRY RUN (mandatory; exercises the RESTORE, not only the upgrade)

**Purpose is threefold:** measure the real window, read the precheck log, **and rehearse Phase 6 end to end.**
A restore leg that has never been executed is not a rollback plan; it is a paragraph.

Do this in the **prod account against a clone**, never against prod itself.

### B1. Restore the most recent prod snapshot to a throwaway instance

```bash
! SNAP=$(aws rds describe-db-snapshots --db-instance-identifier "$DB" --snapshot-type automated \
      --query 'sort_by(DBSnapshots,&SnapshotCreateTime)[-1].DBSnapshotIdentifier' --output text)
! SUBNET=$(aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].DBSubnetGroup.DBSubnetGroupName' --output text)
! SG=$(aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)

! aws rds restore-db-instance-from-db-snapshot \
    --db-instance-identifier pg18-rehearsal \
    --db-snapshot-identifier "$SNAP" \
    --db-instance-class db.t4g.small \
    --db-subnet-group-name "$SUBNET" \
    --vpc-security-group-ids "$SG" \
    --no-multi-az --no-publicly-accessible
! aws rds wait db-instance-available --db-instance-identifier pg18-rehearsal
```

### B2. Upgrade the clone, and TIME it

```bash
! date -u +%FT%TZ | tee /tmp/pg18-start
! aws rds modify-db-instance --db-instance-identifier pg18-rehearsal \
    --engine-version 18 --allow-major-version-upgrade --apply-immediately
! aws rds wait db-instance-available --db-instance-identifier pg18-rehearsal
! date -u +%FT%TZ | tee /tmp/pg18-end
```

The elapsed time is the number that sizes the Phase 4 window. It scales with the number of databases and
objects, so it is only representative if A4's cleanup was applied to the source of this snapshot too — if it
was not, note that the real window will be **shorter**, never longer.

### B3. Read the precheck log

There is **no** precheck-only API and no `--dry-run`; this rehearsal _is_ the dry run. RDS still writes one:

```bash
! aws rds describe-db-log-files --db-instance-identifier pg18-rehearsal \
    --query "DescribeDBLogFiles[?contains(LogFileName,'pg_upgrade')].LogFileName" --output text
! aws rds download-db-log-file-portion --db-instance-identifier pg18-rehearsal \
    --log-file-name <pg_upgrade_precheck.log...> --output text
```

Also fetch `pg_upgrade_internal.log` and `pg_upgrade_server.log`. Any warning here is a warning you will get
in prod.

### B4. Run Phase 5's whole verification against the clone

Everything in Phase 5, against `pg18-rehearsal`. This is where a surprise is cheap.

### B5. ⛔ REHEARSE PHASE 6 — restore the PG 16 snapshot and repoint a stack at it

Do not skip this because B2 succeeded. The point is to find out whether the recovery works **while nothing is
broken**. Execute Phase 6 against a second throwaway (`pg18-rollback-rehearsal`) and a **sandbox** stack, and
record:

- how long the restore takes;
- whether the restored instance's **endpoint address** differs from the original's;
- what `cdk diff` actually prints for the repointed stack (Phase 6 C3) — **including whether CloudFormation
  reports a REPLACEMENT**, which is the outcome that must be understood before it is ever attempted for real.

### B6. Tear the rehearsal instances down

```bash
! aws rds delete-db-instance --db-instance-identifier pg18-rehearsal --skip-final-snapshot
! aws rds delete-db-instance --db-instance-identifier pg18-rollback-rehearsal --skip-final-snapshot
```

---

## Phase 3 — Sandbox first, with the full suite green (R54)

Sandbox is **not** disposable — it hosts the single shared identity service every PR preview signs in
against. Treat it as a small production.

1. Run Phase 1 against `kitchensink-data-sandbox`.
2. Deploy the U13 branch to sandbox
   (`STAGE=sandbox DOMAIN_NAME=commise.app npx cdk deploy --app "node packages/infra/global/dist/bin/app.js" --all`).
3. Run Phase 5 in full.
4. **Soak.** Leave sandbox on 18 for at least one full nightly cycle before Phase 4, so the scheduled jobs
   (reconciliation, change-refresh, the nightly shutdown/wake) run at least once against the new engine.
5. Re-run the judgement set and the access-path guard on sandbox and compare to A7.

⛔ **Do not shorten the soak to fit a window.** The whole value of sandbox-first is elapsed time on the new
engine, not a single green test run.

---

## Phase 4 — Production window

### C1. Suppress unrelated CI deploys, and control the merge

Because the merge **is** the deploy (see the banner), the window is scheduled around the merge itself:

- Announce the window. Expect **full unavailability of every service on this instance** — identity, food and
  recipe all share it — for the B2 duration plus ECS stabilisation.
- Ensure no other `packages/infra/global/**` change is queued to land in the same push.
- Have someone watching the CloudFormation console for the duration. Do not merge and walk away.

### C2. Take the manual snapshot, against the resolved id

Do not rely on the automatic pre-upgrade snapshot even though retention is 7.

```bash
! SNAPID=kitchensink-data-prod-pre-pg18-$(date -u +%Y%m%d%H%M)
! aws rds create-db-snapshot --db-instance-identifier "$DB" --db-snapshot-identifier "$SNAPID"
! aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAPID"
! aws rds describe-db-snapshots --db-snapshot-identifier "$SNAPID" \
    --query 'DBSnapshots[0].{Status:Status,Ver:EngineVersion,Created:SnapshotCreateTime,Size:AllocatedStorage}'
```

⛔ **Record `$SNAPID` in the change ticket.** It is the only input to Phase 6. Confirm `Status: available` and
`Ver` is the 16.x you recorded in A1 — a snapshot taken after the upgrade is worthless for rollback.

### C3. Gate on `cdk diff` before merging (the ADR-0002 gate)

```bash
! STAGE=prod DOMAIN_NAME=commise.app npx cdk diff --app "node packages/infra/global/dist/bin/app.js" kitchensink-data-prod
```

**Read every line.** The only acceptable changes are:

- `AWS::RDS::DBInstance` → `EngineVersion: 16 → 18`
- `AWS::RDS::DBInstance` → `AllowMajorVersionUpgrade: → true`

⛔ **Any resource showing `[-]` (destroy), `replace`, or a VPC/subnet/security-group change is a HALT.**
ADR-0002 exists because a construct-id or CIDR change replaces the VPC and takes the RDS with it. An empty
diff for the network stack is part of this gate, not an assumption:

```bash
! STAGE=prod DOMAIN_NAME=commise.app npx cdk diff --app "node packages/infra/global/dist/bin/app.js" kitchensink-network-prod
```

### C4. Merge, and watch

Merge the PR. `prod-deploy.yml` runs the deploy. Watch:

```bash
! aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].DBInstanceStatus'
# available -> upgrading -> available
```

⚠️ **If CloudFormation times out while RDS is still `upgrading`,** the stack lands in
`UPDATE_ROLLBACK_FAILED` while the upgrade continues underneath — and CloudFormation **cannot** roll the
engine version back. Do not fight the stack: let RDS finish, confirm the instance reaches `available` on 18,
then reconcile the stack (`continue-update-rollback --resources-to-skip`, or re-deploy forward). Going to
Phase 6 from here is a decision about the **data**, not about the stack's status.

⚠️ **PITR is unavailable for the duration of the upgrade.** The C2 snapshot is the only restore point.

---

## Phase 5 — Post-upgrade verification (run in FULL; sandbox and prod)

### D1. The engine actually moved

```bash
! aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].{Ver:EngineVersion,Status:DBInstanceStatus,PG:DBParameterGroups[0].DBParameterGroupName}'
```

### D2. Every database survived, with its data (R53)

```sql
SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY 1;
```

Then, in each of `kitchensink_identity`, `kitchensink_food`, `kitchensink_recipes` **and every live per-PR
database**:

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;
SELECT count(*) FROM users;        -- kitchensink_identity: compare against the A7 figure
SELECT count(*) FROM food;         -- kitchensink_food
SELECT count(*) FROM recipes;      -- kitchensink_recipes
```

⛔ A row-count difference in `kitchensink_identity` is a **Phase 6 trigger**, not a note.

### D3. `ANALYZE` — run it regardless of what the docs say

⚠️ **The sources conflict.** The RDS user guide states _"Optimizer statistics aren't transferred during a
major version upgrade, so you need to regenerate all statistics to avoid performance issues."_ PostgreSQL 18's
`pg_upgrade` documentation states it _"will transfer most optimizer statistics"_ unless `--no-statistics` is
given. Statistics transfer is **new in 18**, and the AWS text appears not to have been revised for it —
whether RDS's managed wrapper passes `--no-statistics` is **unverified**.

Running `ANALYZE` is correct under both readings and costs only time. Run it in **every** database:

```sql
ANALYZE VERBOSE;
```

Then settle the question empirically for our instance and record the answer:

```sql
SELECT relname, last_analyze, last_autoanalyze FROM pg_stat_user_tables ORDER BY 1;
```

### D4. Extensions

```sql
SELECT extname, extversion FROM pg_extension ORDER BY 1;
SELECT name, default_version, installed_version FROM pg_available_extensions
WHERE name IN ('citext','pg_trgm','pgcrypto');
```

A major upgrade does **not** upgrade extensions. `citext` and `pgcrypto` updates are optional and
behaviourally empty for us; `pg_trgm` must remain **1.6**. If you choose to update:

```sql
ALTER EXTENSION citext UPDATE;
ALTER EXTENSION pgcrypto UPDATE;
```

⛔ Do **not** update `pg_trgm` speculatively — its 1.6 behaviour is what the ranking baselines were measured
against.

### D5. Collation — compare against A6, and reindex only if the VERSION moved

```sql
SELECT datname, datcollate, datctype, datlocprovider, datcollversion FROM pg_database ORDER BY 1;

SELECT collname, collprovider, collversion, pg_collation_actual_version(oid) AS actual
FROM pg_collation WHERE collversion IS NOT NULL AND collversion <> pg_collation_actual_version(oid);
```

**If the second query returns nothing, there is nothing to reindex — stop here.** If it returns rows, find
the dependent objects and the btree candidates:

```sql
-- what depends on a stale collation
SELECT pg_describe_object(refclassid, refobjid, refobjsubid) AS collation,
       pg_describe_object(classid, objid, objsubid)          AS object
FROM pg_depend d JOIN pg_collation c
  ON refclassid = 'pg_collation'::regclass AND refobjid = c.oid
WHERE c.collversion <> pg_collation_actual_version(c.oid) ORDER BY 1, 2;

-- btree indexes on collatable columns: the REINDEX candidate set
SELECT i.indexrelid::regclass::text AS index_name
FROM pg_index i
JOIN pg_class  c  ON c.oid = i.indexrelid AND c.relkind = 'i'
JOIN pg_opclass o ON i.indclass[0] = o.oid
JOIN pg_am     am ON o.opcmethod = am.oid AND am.amname = 'btree'
WHERE 0 <> ANY(i.indcollation) ORDER BY 1;
```

Then, **rebuild before refreshing the recorded version** — refreshing first erases the only signal that says
which indexes are suspect:

```sql
REINDEX INDEX CONCURRENTLY <name>;   -- every index from the query above, incl. food_normalized_name_unique
ALTER DATABASE <db> REFRESH COLLATION VERSION;
```

⚠️ Also re-read A6's `datlocprovider`. If it is **not** `c`, PostgreSQL 18's FTS collation-provider change
means the `pg_trgm` and tsvector indexes need rebuilding too — which is the one case where the "trigram and
tsvector indexes do not depend on collation" rule above does not hold.

### D6. Re-run the judgement set and the ranking baselines (R56)

Re-run the Golden Relevance Judgement Set and compare to A7.

⚠️ **A difference traceable to a tiebreak or a planner change is RE-BASELINED AND RECORDED, not silently
accepted, and not treated as a regression.** U1 measured that **99.7% of `name ASC` tiebreak positions move
with collation** — tiebreak position is exactly what collation moves. So when a judgement entry changes:

1. Compare A6's `datcollate` / `datlocprovider` / `datcollversion` before and after. **Unchanged collation
   rules out the collation cause** and points at the planner.
2. Re-run the query with `EXPLAIN` and compare the plan to A7's.
3. Record the cause, the old value and the new value in the change ticket, then move the baseline.
4. ⛔ A difference you **cannot** attribute to a tiebreak or a plan change is a genuine regression. Do not
   re-baseline it.

### D7. The access-path guard

`packages/services/food-service/tests/foodSearchAccessPath.integration.test.ts` encodes cost margins measured
on PG 16. If it fires, the first hypothesis is a changed cost model. Re-run the `EXPLAIN`, compare to A7, and
re-baseline the table in that file's docstring — do **not** raise the row count reflexively.

### D8. Repo-wide guards and the application tiers

```bash
! cd packages/infra/global && npx vitest run     # engineVersionDiff, localPostgresParity, generatedColumnStorage
! npm run test && npm run typecheck && npm run lint
```

Then the integration and e2e tiers against the upgraded database, and a smoke of each service's health
endpoint.

### D9. The three release figures (U15)

⚠️ U15's committed numbers — resolution rate, adjudicated accuracy, correction-surfacing share — must be
**re-measured on the sandbox soak after this upgrade**. Committing PG 16 figures for a release that ends on
PG 18 describes a database production no longer runs.

---

## Phase 6 — ⛔ THE RESTORE LEG (the only rollback that exists)

**Trigger:** data loss or corruption discovered post-upgrade (D2 row-count mismatch), or a defect that cannot
be fixed forward. **Not** a trigger: a slow query (run `ANALYZE`), a moved judgement entry (re-baseline per
D6), or a wedged CloudFormation stack with healthy data (reconcile the stack).

**Cost, stated plainly:** every write committed since the C2 snapshot is lost. Confirm that is acceptable, with
the owner, before starting.

### E1. Restore the pre-upgrade snapshot to a NEW instance

```bash
! aws rds restore-db-instance-from-db-snapshot \
    --db-instance-identifier kitchensink-data-prod-restored \
    --db-snapshot-identifier "$SNAPID" \
    --db-instance-class db.t4g.small \
    --db-subnet-group-name "$SUBNET" \
    --vpc-security-group-ids "$SG" \
    --no-multi-az --no-publicly-accessible
! aws rds wait db-instance-available --db-instance-identifier kitchensink-data-prod-restored
```

⚠️ **A restore always creates a NEW instance.** RDS will not restore over an existing identifier, and
CloudFormation does not own what you just created. Verify the data _before_ touching any stack:

```sql
SELECT datname FROM pg_database ORDER BY 1;
SELECT count(*) FROM users;   -- in kitchensink_identity
```

### E2. Revert the code, in the same change as the repoint

`DataStack.ts` → `VER_16`; `engineVersionDiff.test.ts` → `EXPECTED_ENGINE_VERSION = '16'`. `localPostgresParity`
follows automatically, so the `postgres:18` pins must go back to `postgres:16` in the same commit — the gate
will name all 16 sites if you miss one.

### E3. Repoint the stack (owner ruling 2026-08-21)

Give `DataStack`'s instance an explicit `instanceIdentifier` and `snapshotIdentifier` so CloudFormation adopts
the restored instance rather than the upgraded one.

### E4. ⛔ Re-verify `cdk diff` against ADR-0002 before executing

```bash
! STAGE=prod DOMAIN_NAME=commise.app npx cdk diff --app "node packages/infra/global/dist/bin/app.js" kitchensink-data-prod
! STAGE=prod DOMAIN_NAME=commise.app npx cdk diff --app "node packages/infra/global/dist/bin/app.js" kitchensink-network-prod
```

**Read it as a hostile reviewer.** Introducing `DBSnapshotIdentifier` on an existing `AWS::RDS::DBInstance` is
a **replacement-forcing** property change. Two consequences follow, and B5 is where you learned which one
applies:

- CloudFormation will create the new instance and then **delete the old one** — and `deletionProtection: true`
  makes that delete **fail**, wedging the stack. Expect to disable protection deliberately on the instance
  being retired, as an explicit act, exactly as `DataStack`'s comment describes.
- The network stack diff must be **empty**. A VPC or subnet change here replaces the VPC and takes the RDS
  with it.

### E5. The variant B5 may show is safer — decide from the rehearsal, not in the incident

An alternative that avoids the template edit entirely: **rename the broken instance out of the way and restore
the snapshot under the ORIGINAL physical identifier**, leaving CloudFormation's resource mapping untouched
(only E2's code revert is then needed).

```bash
! aws rds modify-db-instance --db-instance-identifier "$DB" \
    --new-db-instance-identifier "${DB}-pg18-broken" --apply-immediately
# then restore $SNAPID using --db-instance-identifier "$DB"
```

⚠️ **This is written as a variant, not the default, because it was not verified at authoring time.** The open
question is whether the restored instance's **endpoint address** matches the original's — the identifier is
the same, but the endpoint carries an instance-specific component. **B5 must answer this**, because if the
endpoint changes, every consumer (identity, food, recipe, the webhook Lambdas) must be redeployed to pick it
up, and that cost belongs in the decision, not in the incident. Record B5's answer here.

### E6. Redeploy consumers and verify

```bash
! STAGE=prod DOMAIN_NAME=commise.app npx cdk deploy --app "node packages/services/identity/infra/dist/bin/app.js" --all --require-approval never
! STAGE=prod DOMAIN_NAME=commise.app npx cdk deploy --app "node packages/services/identity-webhooks/infra/dist/bin/app.js" --all --require-approval never
```

Then Phase 5's D2 and D8 against the restored instance, and a health smoke of every service.

### E7. Retire the upgraded instance — only after a clean soak

Keep `${DB}-pg18-broken` (or the orphaned upgraded instance) **stopped, not deleted**, until the restored
instance has served cleanly for at least 24 hours. Take a final snapshot before deleting.

---

## Appendix — one-line status checks

```bash
# engine + status
! aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].{V:EngineVersion,S:DBInstanceStatus}'
# pending modifications (did the change actually apply, or is it queued?)
! aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].PendingModifiedValues'
# every snapshot for this instance, newest last
! aws rds describe-db-snapshots --db-instance-identifier "$DB" --query 'sort_by(DBSnapshots,&SnapshotCreateTime)[].{Id:DBSnapshotIdentifier,V:EngineVersion,T:SnapshotCreateTime}' --output table
```

## What the gates in the repo enforce, so you do not have to remember

| Gate                                                             | What it fails on                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/infra/global/__tests__/engineVersionDiff.test.ts`      | The synthesized `EngineVersion` drifting from the reviewed constant; a missing `AllowMajorVersionUpgrade`; a frozen minor; a custom parameter group; prod and sandbox diverging. |
| `packages/infra/global/__tests__/localPostgresParity.test.ts`    | Any `postgres:` image pin in the repo whose major disagrees with `DataStack` — 12 CI service containers and four compose files — or any `-alpine` (musl `C` collation) variant.  |
| `packages/infra/global/__tests__/generatedColumnStorage.test.ts` | Any generated column in any migration that omits `STORED`, which PostgreSQL 18 silently reads as `VIRTUAL`.                                                                      |
| `packages/infra/global/__tests__/cdkNagTemplateParity.test.ts`   | ⛔ **Not this.** It compares the same source against itself and structurally cannot fire on an engine-version change — the reason `engineVersionDiff.test.ts` exists.            |
