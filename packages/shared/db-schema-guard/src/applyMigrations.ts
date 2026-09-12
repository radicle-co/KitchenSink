/**
 * The migration APPLY ENGINE — one implementation for every schema in the monorepo.
 *
 * ## Why this is here and not three times over
 *
 * `identity`, `food-service` and `recipe-service` each carried a private copy of this loop: the same
 * advisory-lock key, the same `lock_timeout` dance, the same ledger, the same rollback, the same post-run
 * validation. Three copies of one piece of knowledge, already drifting in their accounts of WHY. The
 * manifest assertion this release adds would have been a fourth thing written three times.
 *
 * What legitimately differs per service is injected: the migrations directory, the tables the drizzle
 * schema says must exist afterwards, the table policy, and the label that makes a failure readable.
 *
 * ## What the ledger cannot do, and what closes it
 *
 * `schema_migrations` is keyed by FILENAME with no checksum, and the runner skips on a name match. So the
 * ledger cannot see an edited migration, and — the failure ADR-0022 records — it cannot tell "everything is
 * applied" from "this runner has never heard of the new migrations", which is what a PREVIOUS release's
 * bundle reports. {@link ApplyMigrationsOptions.expectManifestSha} is the caller stating which set it wants;
 * a runner holding a different one fails loudly instead of returning an empty `applied[]`.
 */
import { readdirSync } from 'node:fs';

import pg from 'pg';

import { assertManifestMatches } from './assertions.js';
import type { MigrationManifest } from './manifestFile.js';
import { readMigrationManifest } from './manifestFile.js';
import type { MigrationClient, MigrationPool } from './port.js';
import type { DatabaseRoles } from './roles/databaseRoles.js';
import { auditObjectOwners, auditSeederPrivileges, auditServicePrivileges } from './roles/ownershipAudit.js';
import {
    migrationLedgerReadOnly,
    privilegesAfterApply,
    privilegesBeforeApply,
    tablePolicyStatements,
} from './roles/privilegeStatements.js';
import { assertRoleModelPresent } from './roles/roleModelPresence.js';
import { assertTablePolicyFits, policyTables, type TablePolicy } from './roles/tablePolicy.js';

/** A discovered migration: its tracking `name` (filename without `.sql`) and the `.sql` filename. */
export interface DiscoveredMigration {
    /** The `schema_migrations` tracking key (filename without the `.sql` suffix). */
    readonly name: string;
    /** The `.sql` filename within the migrations directory. */
    readonly file: string;
}

/** The structured result of a migration run, returned to whoever invoked the runner. */
export interface MigrateResult {
    /** Migrations applied this run, in order. */
    readonly applied: string[];
    /** Migrations skipped because already recorded, in order. */
    readonly skipped: string[];
    /** Post-run validation counts. */
    readonly validated: { readonly migrations: number; readonly tables: number };
    /**
     * The manifest digest of the set this run actually held.
     *
     * Returned unconditionally, including when no expectation was supplied, so the deploy log records WHICH
     * migration set produced the result rather than only that a result was produced.
     */
    readonly manifestSha: string;
}

/** Options for {@link applyMigrations}. */
export interface ApplyMigrationsOptions {
    /** A pool connected to the target database. */
    readonly pool: MigrationPool;
    /** The directory holding the ordered `.sql` migrations. */
    readonly migrationsDir: string;
    /** Which schema this is — used only to make failures readable. */
    readonly label: string;
    /** The tables the schema must expose once every migration has been applied. */
    readonly expectedTables: readonly string[];
    /**
     * The manifest digest the caller expects this runner to hold.
     *
     * ⛔ REQUIRED, and ADR-0035 rejects the optional form by name: "an optional expectation is one a caller
     * forgets, and a forgotten one is indistinguishable from the behaviour it replaces". It was briefly
     * optional here, because the in-stack `triggers.Trigger` sent a custom-resource payload carrying none.
     * That mechanism is gone, so the last reason to tolerate its absence went with it — and while it stood,
     * the property the whole change rests on was enforced by one argument check in one shell script rather
     * than by the runner.
     */
    readonly expectManifestSha: string;
    /**
     * The database being migrated — the one the pool is connected to. REQUIRED: the before-privileges close it to
     * PUBLIC and admit its two logins, which needs its name.
     */
    readonly database: string;
    /**
     * The database's three roles (`DATABASE_ROLES`). REQUIRED, for ADR-0035's reason: an optional role is one a
     * caller forgets, and a runner that forgets it creates objects owned by whoever connected — the exact shape
     * the role split exists to end. The runner connects as `roles.migrator` and does every DDL statement AS
     * `roles.owner` (`docs/plans/2026-09-11-database-role-split.md`).
     */
    readonly roles: DatabaseRoles;
    /**
     * The database's table policy (curated catalog plan KTD-13): which tables the seeder writes and the service role
     * may only partly write. `NO_TABLE_POLICY` for a database with no seeder. REQUIRED for the reason `roles` is: a
     * policy a food migrate forgets leaves the seeder with no table right, and the seed finds out at its first write.
     */
    readonly tablePolicy: TablePolicy;
}

/**
 * The session advisory-lock key every migration run serializes on.
 *
 * ⛔ WHY THIS EXISTS. Idempotency comes from `schema_migrations`, and that ledger is CHECKED-then-APPLIED,
 * which is not atomic: two runners starting together both read "unapplied" and both execute the file. The
 * loser then fails on a `CREATE TABLE`/`CREATE EXTENSION` the winner just committed, and because the
 * runner's throw surfaces as a Lambda `FunctionError` that failure is a RED DEPLOY, not a retry. It
 * reproduces on the first attempt — see recipe-service's
 * `__tests__/integration/database/migrationRunner.integration.test.ts`.
 *
 * ⚠️ It changes deploy behaviour: a second runner WAITS instead of racing. That is the intended trade — a
 * bounded wait ending in "everything skipped" beats a fast failure against a schema that was already right.
 *
 * Advisory locks are scoped to the DATABASE, so one constant serves every schema: identity's runner and
 * food's hold the same key over different databases and never meet. The value is an arbitrary fixed 64-bit
 * constant; the digits carry no meaning beyond being stable.
 */
const MIGRATION_ADVISORY_LOCK_KEY = '7412200228220022';

/**
 * How long a runner waits for the lock before failing with a Postgres lock error.
 *
 * Sized under the runners' own Lambda timeout on purpose: without it, a runner blocked behind a stuck peer
 * is killed by Lambda with no diagnostic at all. With it, the deploy fails saying it could not take the
 * migration lock, which names the actual problem.
 */
const MIGRATION_LOCK_TIMEOUT_MS = 240_000;

/**
 * Discover the ordered `.sql` migrations in a directory — sorted by filename, so the numeric prefix drives
 * a deterministic order. NO hardcoded list: drop a `.sql` file in and it is picked up automatically.
 *
 * @param migrationsDir - The directory to scan.
 * @returns The discovered migrations in apply order.
 * @sideEffect Reads the migrations directory.
 */
export function discoverMigrations(migrationsDir: string): DiscoveredMigration[] {
    return readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => ({ name: file.replace(/\.sql$/u, ''), file }));
}

/**
 * The same list, derived from a manifest already read — so the apply loop does not scan the directory a
 * second time and cannot disagree with the set it just digested.
 *
 * @param manifest - A manifest read from the migrations directory.
 * @returns The discovered migrations in apply order.
 */
function migrationsOf(manifest: MigrationManifest): DiscoveredMigration[] {
    return manifest.migrations.map((file) => ({ name: file.replace(/\.sql$/u, ''), file }));
}

/** Which of the policy's tables exist. The marker lets a test double recognise the query. */
const POLICY_TABLES_PRESENT = `/* table-policy */
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1::text[])`;

/**
 * Run `work` in one transaction: COMMIT when it settles, ROLLBACK and rethrow when it throws.
 *
 * ⛔ The ROLLBACK is not optional. Without it the runner's `finally` would issue `RESET ROLE` and the unlock inside an
 * aborted transaction, where both fail and are swallowed, and the session would go back to its pool holding the lock.
 *
 * @param client - The runner's connection.
 * @param work - The statements.
 * @returns What `work` returned.
 * @sideEffect Executes BEGIN, `work`'s statements and COMMIT or ROLLBACK.
 */
async function inTransaction<T>(client: MigrationClient, work: () => Promise<T>): Promise<T> {
    await client.query('BEGIN');

    try {
        const result = await work();

        await client.query('COMMIT');

        return result;
    } catch (err) {
        await client.query('ROLLBACK');

        throw err;
    }
}

/**
 * Which of `tables` exist in `public`, read inside the caller's transaction so a migration's own tables are seen.
 *
 * @param client - The runner's connection.
 * @param tables - The policy's tables.
 * @returns The ones that exist.
 * @sideEffect One read of `pg_class`.
 */
async function presentTables(client: MigrationClient, tables: readonly string[]): Promise<ReadonlySet<string>> {
    const result = await client.query<{ relname: string }>(POLICY_TABLES_PRESENT, [[...tables]]);

    return new Set(result.rows.map((row) => row.relname));
}

/**
 * Assert, WITHOUT connecting to anything, that this bundle holds the migration set the caller expects.
 *
 * ⛔ For callers that do work before {@link applyMigrations} — food's and recipe's runners CREATE a per-PR
 * logical database first (ADR-0006) — because "refuse before any side effect" is a property `applyMigrations`
 * claims and cannot deliver on its own. Without this, a stale runner creates an empty, unmigrated database
 * and only then refuses on the digest.
 *
 * @param options - The label, the migrations directory, and the caller's expectation.
 * @throws {EmptyMigrationSetError} when the directory holds no `.sql`.
 * @throws {SchemaManifestMismatchError} when the expectation names a different set.
 * @sideEffect Reads the migrations directory.
 */
export function assertBundleMatches(options: {
    readonly label: string;
    readonly migrationsDir: string;
    readonly expectManifestSha: string;
}): void {
    const manifest = readMigrationManifest(options.migrationsDir);

    assertManifestMatches({
        label: options.label,
        expected: options.expectManifestSha,
        actual: manifest.sha,
        migrations: manifest.migrations,
    });
}

/**
 * Apply the ordered migrations idempotently against a pool, then validate the result.
 *
 * The manifest is checked FIRST, before a connection is taken: a runner holding the wrong set must fail
 * without taking the advisory lock, or it blocks the correct runner behind it for the whole lock timeout
 * and turns a clear "wrong bundle" failure into a slow, confusing one.
 *
 * @param options - The pool, the migrations directory, the label, the expected tables, the expectation, the
 *   database, its roles and its table policy.
 * @returns The applied/skipped lists, the validation counts and the manifest that ran.
 * @throws {EmptyMigrationSetError} when the directory holds no `.sql`.
 * @throws {SchemaManifestMismatchError} when the caller's expectation names a different set.
 * @throws {TablePolicyOverlapError | TablePolicySeederMismatchError} when the policy does not fit the roles, before
 *   connecting.
 * @throws {Error} when no expected tables were supplied, the lock cannot be acquired, a migration's SQL
 *   fails, a discovered migration is not recorded, or an expected table is missing after the run.
 * @sideEffect Reads the migrations directory, connects to PostgreSQL, takes a session advisory lock, and
 *   executes DDL.
 */
export async function applyMigrations(options: ApplyMigrationsOptions): Promise<MigrateResult> {
    const { pool, migrationsDir, label, expectedTables, expectManifestSha, database, roles, tablePolicy } = options;

    if (expectedTables.length === 0) {
        throw new Error(
            `[${label}] refusing to migrate with no expected tables — the table check is the only thing ` +
                'between "every migration is recorded" and "the schema they were supposed to produce exists", ' +
                'and an empty list passes vacuously',
        );
    }

    const manifest = readMigrationManifest(migrationsDir);

    assertManifestMatches({
        label,
        expected: expectManifestSha,
        actual: manifest.sha,
        migrations: manifest.migrations,
    });

    // Built and checked BEFORE a connection is taken: an unquotable database name, or a policy that does not fit the
    // roles, must fail without holding the lock.
    const before = privilegesBeforeApply(roles, database);

    assertTablePolicyFits(roles, tablePolicy);

    const tables = policyTables(tablePolicy).map(({ table }) => table);
    const migrations = migrationsOf(manifest);
    const applied: string[] = [];
    const skipped: string[] = [];
    const client = await pool.connect();
    let holdsLock = false;
    let actsAsOwner = false;

    try {
        // ⛔ FIRST: every grant below names a role the global stack's bootstrap creates, and a migrate that ran before
        // that bootstrap must say so rather than fail on its first GRANT.
        await assertRoleModelPresent(client, { label, database, roles });

        // ⛔ BEFORE the ledger is even created, so two runners cannot both create it and both read it empty.
        // `lock_timeout` is RESET immediately after: it is a session setting and this client goes back to a
        // pool, so leaving it set would silently shorten every later statement's lock wait.
        await client.query(`SET lock_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`);

        try {
            await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
            holdsLock = true;
        } finally {
            await client.query('RESET lock_timeout');
        }

        // ⛔ Every statement from here runs AS THE OWNER, so everything a migration creates is owned by
        // `<svc>_owner` and never by the migrator login that connected. RESET in the `finally` below, before the
        // unlock: this client goes back to a pool, and a session left as the owner would hand DDL to whatever
        // borrows it next.
        await client.query(`SET ROLE ${pg.escapeIdentifier(roles.owner)}`);
        actsAsOwner = true;

        // ⛔ One transaction: the ACL reset revokes CONNECT and TEMPORARY before it grants them back, so a connection
        // lost between the two would leave the service role unable to connect until the next good run.
        await inTransaction(client, async () => {
            for (const sql of before) {
                await client.query(sql);
            }
        });

        // ⛔ One transaction: the grant-on-create hook gives the service role DML on the ledger as it is created, and on
        // a fresh database a migration that failed below would otherwise leave that DML until the next good run.
        await inTransaction(client, async () => {
            await client.query(
                'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
            );
            await client.query(migrationLedgerReadOnly(roles));
        });

        for (const migration of migrations) {
            const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration.name]);

            if ((existing.rowCount ?? 0) > 0) {
                skipped.push(migration.name);
                continue;
            }

            const sql = manifest.bodies.get(migration.file);

            if (sql === undefined) {
                // ⛔ NOT a fallback to the empty string, which is what this was. An empty statement SUCCEEDS,
                // so the loop would `INSERT` the name and `COMMIT` — recording a migration as applied having
                // executed nothing, permanently, with no re-run able to repair it. That is the exact failure
                // class this file exists to abolish, and it is unreachable today only because `migrationsOf`
                // and `bodies` come from one read. A refactor that separates discovery from reading makes it
                // reachable, and the fallback would hide it.
                throw new Error(`[${label}] manifest and migration list disagree — no body for ${migration.file}`);
            }

            try {
                // ROLLED BACK on any failure: the migration's own DDL must not survive, and its name must stay
                // UNRECORDED so the next run retries it rather than skipping a half-applied change.
                await inTransaction(client, async () => {
                    await client.query(sql);

                    // ⛔ The policy, INSIDE the transaction that creates its tables (curated catalog plan U4a). The
                    // grant-on-create hook hands the service role DML on every new table; on a read-only table that
                    // DML must never be committed, or a later migration that fails leaves it in place, and KTD-12's
                    // trigger reads a holder of INSERT on the seed ledger as the seeder.
                    if (tables.length > 0) {
                        for (const statement of tablePolicyStatements(
                            roles,
                            tablePolicy,
                            await presentTables(client, tables),
                        )) {
                            await client.query(statement);
                        }
                    }

                    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
                });
                applied.push(migration.name);
            } catch (err) {
                throw new Error(`Migration ${migration.name} failed`, { cause: err });
            }
        }

        // Ownership FIRST: the grants below fail with a bare "permission denied" on an object the owner does not
        // own, which names the symptom and hides the cause.
        const misowned = await auditObjectOwners(client, roles);

        if (misowned.length > 0) {
            throw new Error(`[${label}] post-migration validation failed — ownership:\n  - ${misowned.join('\n  - ')}`);
        }

        // ⛔ ONE transaction: between the blanket grant and the policy's reset the service role holds DML on every
        // read-only table, and only a transaction keeps that state from being seen or from outliving a failure
        // (curated catalog plan U4a).
        await inTransaction(client, async () => {
            if (tables.length > 0) {
                const present = await presentTables(client, tables);
                const missing = tables.filter((table) => !present.has(table));

                if (missing.length > 0) {
                    throw new Error(
                        `[${label}] post-migration validation failed — the table policy names tables that do not ` +
                            `exist: ${missing.join(', ')}`,
                    );
                }
            }

            for (const sql of privilegesAfterApply(roles, tablePolicy)) {
                await client.query(sql);
            }
        });

        await validate({ client, label, migrations, expectedTables, roles, tablePolicy });

        return {
            applied,
            skipped,
            validated: { migrations: migrations.length, tables: expectedTables.length },
            manifestSha: manifest.sha,
        };
    } finally {
        // ⛔ Released EXPLICITLY, not left to the connection dying. A session advisory lock outlives the
        // statement that took it, and `release()` returns the session to the pool still holding it — which
        // would deadlock the very next runner on a pool that outlives one call.
        //
        // ⛔ Each step is INDEPENDENT, and `release()` is in a `finally` of its own. These statements ran in
        // bare sequence, so a `RESET ROLE` that rejected — a connection reset, a terminated backend, the
        // very conditions a failing run is already in — skipped the unlock AND the release: the lock then
        // outlived the session, the connection never returned to the pool, and `pool.end()` hung behind it.
        // Worse, a throw from a `finally` REPLACES the exception being unwound, so the migration failure
        // that caused all this was destroyed and the operator saw only the cleanup error. Cleanup is
        // BEST-EFFORT and must never be the reported cause.
        // ⚠️ Swallowed rather than reported, and this module logs nothing by design (it communicates only by
        // throwing or returning). A cleanup statement can only fail on a connection that is ALREADY broken —
        // and that is also why swallowing is safe rather than merely convenient: PostgreSQL drops a session
        // advisory lock when the backend goes away, so the lock this could not release is released by the
        // same event that stopped it releasing.
        try {
            if (actsAsOwner) {
                await client.query('RESET ROLE').catch(() => undefined);
            }

            if (holdsLock) {
                await client
                    .query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY])
                    .catch(() => undefined);
            }
        } finally {
            client.release();
        }
    }
}

/**
 * Post-migration validation. Throwing surfaces as a Lambda `FunctionError`, so nothing rolls out against a
 * partially-applied or drifted schema. Both sides are DERIVED — the migration files it found, and the
 * drizzle schema its caller read — so nothing here is hardcoded.
 *
 * @param input - The connected client, the label, the migrations run, the tables expected, the roles and the policy.
 * @throws {Error} when a migration is unrecorded, an expected table is absent, or the service role or the seeder holds
 *   more or less than its rights.
 * @sideEffect Queries the database.
 */
async function validate(input: {
    readonly client: MigrationClient;
    readonly label: string;
    readonly migrations: readonly DiscoveredMigration[];
    readonly expectedTables: readonly string[];
    readonly roles: DatabaseRoles;
    readonly tablePolicy: TablePolicy;
}): Promise<void> {
    const { client, label, migrations, expectedTables, roles, tablePolicy } = input;
    const recorded = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const recordedNames = new Set(recorded.rows.map((row) => row.name));
    const unrecorded = migrations.map((migration) => migration.name).filter((name) => !recordedNames.has(name));

    if (unrecorded.length > 0) {
        throw new Error(
            `[${label}] post-migration validation failed — migrations not recorded: ${unrecorded.join(', ')}`,
        );
    }

    const present = await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
        [[...expectedTables]],
    );
    const presentTables = new Set(present.rows.map((row) => row.table_name));
    const missingTables = expectedTables.filter((table) => !presentTables.has(table));

    if (missingTables.length > 0) {
        throw new Error(`[${label}] post-migration validation failed — tables missing: ${missingTables.join(', ')}`);
    }

    const problems = await auditServicePrivileges(client, roles, tablePolicy);

    if (problems.length > 0) {
        throw new Error(
            `[${label}] post-migration validation failed — service privileges:\n  - ${problems.join('\n  - ')}`,
        );
    }

    const seederProblems = await auditSeederPrivileges(client, roles, tablePolicy);

    if (seederProblems.length > 0) {
        throw new Error(
            `[${label}] post-migration validation failed — seeder privileges:\n  - ${seederProblems.join('\n  - ')}`,
        );
    }
}
