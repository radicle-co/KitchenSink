/**
 * ⛔ THE RECIPE MIGRATION RUNNER, AGAINST A REAL POSTGRES — the tier this package did not have.
 *
 * identity (`tests/migrate.integration.test.ts`) and food-service (same path) have both had one since
 * their runners landed. recipe-service — the largest schema in the repo, and the one whose runner is
 * deployed TWICE (`RecipeServiceStack` and `RecipeWorkersStack` each ship it, ADR-0022) — had none. So the
 * runner's own postcondition, `expectedTables()` derived from the Drizzle barrel, had never once been
 * executed against a migrated recipe database, and neither had ADR-0006's `ensureDatabaseExists` /
 * `dropDatabase` per-PR path.
 *
 * ## The owner's rule, and which mechanism actually satisfies it
 *
 * > "all migrations should always be executed on deploy, though every migration should ensure that it does
 * > not execute or change the database if that migration has been ran in the past and has been applied to
 * > the target database."
 *
 * The individual `.sql` files are NOT self-idempotent and deliberately so — `tests/globalSetup.ts` says as
 * much ("bare `CREATE TABLE` … so they must run against a clean schema"). The guarantee comes entirely from
 * the `schema_migrations` LEDGER: a recorded name is skipped, and the ledger insert shares the migration's
 * transaction so a partial apply can never be recorded as done. Hardening every file with `IF NOT EXISTS`
 * would be redundant noise against the real mechanism — and worse than redundant, because a handful of
 * historical migrations carry destructive DML that is unreachable on a re-run ONLY because a `CREATE TABLE`
 * / `ADD COLUMN` / `RENAME COLUMN` above it errors first, so hardening the loud half UNMASKS the quiet one.
 * The two that were unqualified whole-table wipes were scrubbed outright on the owner's ruling (2026-09-02);
 * `migrationDestructiveDml.test.ts` in `@kitchensink/infra-global` now fails any migration carrying one.
 *
 * That makes the ledger a load-bearing claim rather than an implementation detail, so it is asserted three
 * ways here: the second run applies nothing, the schema is byte-identical across it, and REMOVING a ledger
 * row makes that same migration re-execute and fail loudly. The third is the one that proves the ledger is
 * the mechanism rather than merely a mechanism.
 *
 * ## Why a database of its own
 *
 * These cases create, migrate and drop a whole logical database. `tests/globalSetup.ts` migrates and SEEDS
 * the shared integration database that every sibling spec reads, so doing this in place would leave the
 * rest of the run against a wiped, unseeded schema. Running on a private database also exercises the real
 * ADR-0006 per-PR creation path instead of simulating it.
 */
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { poolForDroppableDatabase } from './utils/droppableDatabasePool.js';
import pg from 'pg';

import {
    discoverMigrations,
    dropDatabase,
    ensureDatabaseExists,
    isValidRecipeDatabaseName,
    runMigrations,
} from '../../../src/lambdas/migrate/handler.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** The single source of truth for the recipe schema — the directory `esbuild.mjs` copies into the bundle. */
const sourceMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../src/database/migrations');

/**
 * This suite's own logical database.
 *
 * Shaped like a per-PR name so it also proves `isValidRecipeDatabaseName` accepts what the suite asks
 * `ensureDatabaseExists` to create — the two are one contract and a suite that used an unacceptable name
 * would be testing a path production cannot reach.
 */
const TEST_DATABASE = 'kitchensink_recipes_migrunner';

/**
 * The connection string for a database on the same server as {@link DATABASE_URL}.
 *
 * @param database - The logical database to address.
 * @returns The connection string.
 */
function urlFor(database: string): string {
    const url = new URL(DATABASE_URL ?? '');

    url.pathname = `/${database}`;

    return url.toString();
}

/**
 * The ordered migration names, read from the directory INDEPENDENTLY of `discoverMigrations` — so the
 * assertions test the runner rather than restate it, and adding a `.sql` never requires editing this file.
 *
 * @returns The expected tracking names, in apply order.
 * @sideEffect Reads the migrations directory.
 */
function expectedMigrationNames(): readonly string[] {
    return readdirSync(sourceMigrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => file.replace(/\.sql$/u, ''));
}

/**
 * A structural fingerprint of the whole schema — every table's every column, plus every index and
 * constraint definition.
 *
 * ⛔ This is what "the second run changed nothing" is asserted against, and it has to be the SCHEMA rather
 * than the runner's own return value. `applied: []` is the runner reporting on itself; a runner that
 * re-executed a file and swallowed the error would still say `[]`. Two identical fingerprints across a
 * second run is the claim an outside observer can make.
 *
 * @param pool - A pool on the database to fingerprint.
 * @returns A stable, ordered description of the schema.
 * @sideEffect Reads the database catalog.
 */
async function schemaFingerprint(pool: pg.Pool): Promise<string> {
    const columns = await pool.query<{ line: string }>(
        `SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                || ' notnull=' || a.attnotnull
                || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') AS line
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY 1`,
    );
    const indexes = await pool.query<{ line: string }>(
        `SELECT indexdef AS line FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`,
    );
    const constraints = await pool.query<{ line: string }>(
        `SELECT c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) AS line
           FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = 'public'
          ORDER BY 1`,
    );

    return [...columns.rows, ...indexes.rows, ...constraints.rows].map((row) => row.line).join('\n');
}

describe.skipIf(!hasDatabaseUrl)('recipe migration runner (ADR-0022, ADR-0006)', () => {
    let maintenancePool: pg.Pool;
    let pool: pg.Pool;

    beforeAll(async () => {
        maintenancePool = new pg.Pool({ connectionString: urlFor('postgres') });
        await dropDatabase({ maintenancePool, databaseName: TEST_DATABASE });
        await ensureDatabaseExists({ maintenancePool, databaseName: TEST_DATABASE });
        pool = poolForDroppableDatabase(urlFor(TEST_DATABASE));
    });

    afterAll(async () => {
        await pool.end();
        await dropDatabase({ maintenancePool, databaseName: TEST_DATABASE });
        await maintenancePool.end();
    });

    beforeEach(async () => {
        await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    });

    it('accepts the per-PR database name it was asked to create — ADR-0006', () => {
        // The accepting side of `recipeDatabaseNameForStage`. A suite running on a name the runner would
        // refuse in production would be exercising a path production cannot reach.
        expect(isValidRecipeDatabaseName(TEST_DATABASE)).toBe(true);
    });

    it('discovers every .sql in filename order, with no hardcoded list', () => {
        expect(discoverMigrations(sourceMigrationsDir).map((migration) => migration.name)).toStrictEqual([
            ...expectedMigrationNames(),
        ]);
    });

    it('applies the whole set on a clean database and validates every table the barrel declares', async () => {
        // The runner's postcondition — `expectedTables()` derived from the Drizzle schema — has never been
        // executed against a real recipe database before this line. A table the barrel declares and no
        // migration creates makes `runMigrations` throw, which surfaces as a Lambda FunctionError and fails
        // the deploy rather than letting the new image meet a schema that is missing a relation.
        const result = await runMigrations({ pool, migrationsDir: sourceMigrationsDir });

        expect(result.applied).toStrictEqual([...expectedMigrationNames()]);
        expect(result.skipped).toStrictEqual([]);
        expect(result.validated.migrations).toBe(expectedMigrationNames().length);
        expect(result.validated.tables).toBeGreaterThan(20);
    });

    it('⛔ RE-RUNS THE WHOLE SET AND CHANGES NOTHING — the owner’s idempotency rule', async () => {
        // ⛔ The headline claim, and it is asserted from OUTSIDE the runner. `applied: []` alone is the
        // runner reporting on itself; the fingerprint is what an observer can check. Both are here because
        // they fail differently: a runner that skipped correctly but a migration that had somehow been
        // applied twice would move the fingerprint, and a runner that re-executed while swallowing the
        // error would move `applied`.
        await runMigrations({ pool, migrationsDir: sourceMigrationsDir });
        const before = await schemaFingerprint(pool);

        const second = await runMigrations({ pool, migrationsDir: sourceMigrationsDir });
        const after = await schemaFingerprint(pool);

        expect(second.applied).toStrictEqual([]);
        expect(second.skipped).toStrictEqual([...expectedMigrationNames()]);
        expect(after).toBe(before);
    });

    it('⛔ shows the LEDGER is the mechanism — remove a row and that migration re-executes, loudly', async () => {
        // ⛔ The claim nobody had written down. The `.sql` files are NOT self-idempotent: they are bare
        // `CREATE TABLE` / `ADD COLUMN`, and re-running one against a database that already has it is an
        // error. That is fine — and the reason it is fine is `schema_migrations`, not the SQL.
        //
        // Asserting it this way matters because the alternative reading ("the files must be idempotent") is
        // the one that leads someone to sprinkle `IF NOT EXISTS` over 68 files, which would UNMASK the
        // destructive DML that four of them carry below their first failing statement.
        await runMigrations({ pool, migrationsDir: sourceMigrationsDir });
        const [first] = expectedMigrationNames();

        await pool.query('DELETE FROM schema_migrations WHERE name = $1', [first]);

        await expect(runMigrations({ pool, migrationsDir: sourceMigrationsDir })).rejects.toThrow(
            new RegExp(`Migration ${first ?? ''} failed`, 'u'),
        );
    });

    it('rolls a failing migration back and leaves it UNRECORDED, so a half-applied schema never reads as done', async () => {
        // The other half of the ledger's contract. The tracking insert shares the migration's transaction,
        // so a file that dies partway leaves neither its DDL nor its ledger row — and the next run retries
        // it rather than skipping past a schema that is half there.
        const scratch = mkdtempSync(join(tmpdir(), 'recipe-migrations-'));

        writeFileSync(join(scratch, '0001_ok.sql'), 'CREATE TABLE ok_table (id integer PRIMARY KEY);');
        writeFileSync(
            join(scratch, '0002_broken.sql'),
            'CREATE TABLE half_applied (id integer PRIMARY KEY); SELECT * FROM a_relation_that_does_not_exist;',
        );

        await expect(runMigrations({ pool, migrationsDir: scratch })).rejects.toThrow(/0002_broken failed/u);

        const recorded = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
        const halfApplied = await pool.query<{ count: string }>(
            `SELECT count(*) AS count FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'half_applied'`,
        );

        expect(recorded.rows.map((row) => row.name)).toStrictEqual(['0001_ok']);
        expect(halfApplied.rows[0]?.count).toBe('0');
    });

    it('⛔ SERIALIZES two runners racing the same database — check-then-apply is not atomic on its own', async () => {
        // ⛔ ADR-0022 records this as an unmitigated residual risk: "two runners starting simultaneously can
        // both decide a migration is unapplied". It stopped being purely theoretical when the owner ruled
        // that migrations must run on EVERY deploy — more invocations against one database is exactly the
        // condition, and recipe's SQL already has TWO deployed runners (RecipeServiceStack and
        // RecipeWorkersStack) plus the pipeline's safety-net invoke.
        //
        // Without a lock the loser of the race re-executes a `CREATE TABLE` the winner just committed and
        // fails the deploy. With one, the second runner waits and then skips everything — which is exactly
        // "does not execute or change the database if that migration has been applied".
        const other = poolForDroppableDatabase(urlFor(TEST_DATABASE));

        try {
            const [a, b] = await Promise.all([
                runMigrations({ pool, migrationsDir: sourceMigrationsDir }),
                runMigrations({ pool: other, migrationsDir: sourceMigrationsDir }),
            ]);
            const names = [...expectedMigrationNames()];

            // Exactly one runner applied each migration and the other skipped every one of them: the
            // sets partition cleanly, in whichever order the two happened to acquire the lock.
            expect([...a.applied, ...b.applied].sort()).toStrictEqual(names);
            expect(a.applied.length === 0 ? a.skipped : b.skipped).toStrictEqual(names);
        } finally {
            await other.end();
        }
    });
});
