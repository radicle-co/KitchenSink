/**
 * LOCAL e2e: a per-PR food database is created empty from `template0`, migrated from nothing, and seeded, against a
 * real PostgreSQL, by the production principals (curated catalog plan U7, KTD-5, ADR-0006, ADR-0051).
 *
 * What only a real catalog can prove:
 *
 * - the MIGRATOR, not a superuser, may create the database from `template0` and hand it to the owner;
 * - the database starts with nothing in it, so the run that follows applies every migration;
 * - the first migration's `pg_trgm` is created by the owner, which PostgreSQL allows because the extension is trusted;
 * - the runner's ACL reset leaves the SEEDER able to connect and stage in temporary tables, so the real committed seed
 *   applies and its independent verifier passes inside the transaction (`DatabaseRightsUnmetError` would stop the
 *   migration first);
 * - two previews can be created at the same moment.
 *
 * ⛔ The master only cleans up: `DROP DATABASE … WITH (FORCE)` needs `pg_signal_backend`, which the migrator lacks.
 */
import { resolve } from 'node:path';

import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_ROLES, readMigrationManifest } from '@kitchensink/db-schema-guard';
import { poolForDroppableDatabase, type RdsLikeDatabase } from '@kitchensink/service-test-harness';

import { runCatalogSeed } from '../../src/foods/seed/catalog/catalogSeedTransaction.js';
import { createCatalogVerifier } from '../../src/foods/seed/verify/catalogVerifier.js';
import { ensureDatabaseExists, runMigrations } from '../../src/lambdas/migrate/handler.js';
import { ensureFoodRoleModel } from '../support/maintenanceDb.js';
import { migrationsDir } from '../support/roleDb.js';

/** The per-PR databases this suite owns, distinct from every other suite's. */
const TARGET = 'kitchensink_food_pr_u7';
const SECOND_TARGET = 'kitchensink_food_pr_u7b';

const SEED_DATA_DIR = resolve(import.meta.dirname, '..', '..', 'src', 'foods', 'seed', 'data');
const VERIFIER_SQL_DIR = resolve(import.meta.dirname, '..', '..', 'src', 'foods', 'seed', 'verify', 'sql');

/** A digest the ledger accepts; the real one comes from the built asset (`seedFunction.e2e.test.ts`). */
const SEED_SHA = 'e'.repeat(64);

/** The full seed applies in about half a minute locally; the verifier runs inside the same transaction. */
const SEED_TIMEOUT_MS = 600_000;

describe('a per-PR food database is created empty, migrated and seeded (LOCAL e2e)', () => {
    let base: RdsLikeDatabase;
    let maintenancePool: pg.Pool;
    let master: pg.Pool;

    /** Run `work` on a short-lived pool into `database` as `role`, closed before the drop that follows. */
    async function asRole<T>(role: string, database: string, work: (pool: pg.Pool) => Promise<T>): Promise<T> {
        const pool = poolForDroppableDatabase(base.urlFor(role, database));

        try {
            return await work(pool);
        } finally {
            await pool.end();
        }
    }

    /** Migrate `database` as the migrator, exactly as the deployed runner does. */
    async function migrate(database: string): Promise<Awaited<ReturnType<typeof runMigrations>>> {
        return asRole(DATABASE_ROLES.food.migrator, database, (pool) =>
            runMigrations({
                pool,
                migrationsDir,
                expectManifestSha: readMigrationManifest(migrationsDir).sha,
                database,
            }),
        );
    }

    beforeAll(async () => {
        base = await ensureFoodRoleModel();
        maintenancePool = new pg.Pool({ connectionString: base.migratorMaintenanceUrl, max: 1 });
        master = new pg.Pool({ connectionString: base.masterUrl, max: 1 });
    });

    afterEach(async () => {
        for (const name of [TARGET, SECOND_TARGET]) {
            await master.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        }
    });

    afterAll(async () => {
        await maintenancePool.end();
        await master.end();
    });

    it('creates the database from template0 as the migrator, owned by the owner, with nothing in it', async () => {
        expect(await ensureDatabaseExists({ maintenancePool, databaseName: TARGET })).toBe('created');

        const owner = await master.query<{ owner: string }>(
            'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
            [TARGET],
        );
        const relations = await asRole(DATABASE_ROLES.food.migrator, TARGET, (pool) =>
            pool.query<{ count: string }>(
                "SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'",
            ),
        );

        expect(owner.rows).toEqual([{ owner: DATABASE_ROLES.food.owner }]);
        expect(relations.rows).toEqual([{ count: '0' }]);
    });

    it('migrates it from nothing, and the owner creates pg_trgm', async () => {
        await ensureDatabaseExists({ maintenancePool, databaseName: TARGET });

        const result = await migrate(TARGET);
        const extension = await asRole(DATABASE_ROLES.food.migrator, TARGET, (pool) =>
            pool.query<{ owner: string }>(
                "SELECT pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname = 'pg_trgm'",
            ),
        );

        expect(result.skipped).toEqual([]);
        expect(result.applied.length).toBeGreaterThan(0);
        expect(extension.rows).toEqual([{ owner: DATABASE_ROLES.food.owner }]);
    });

    it(
        'lets the seeder apply the committed seed, and the independent verifier passes',
        async () => {
            await ensureDatabaseExists({ maintenancePool, databaseName: TARGET });
            await migrate(TARGET);

            const seeder = new pg.Client({ connectionString: base.urlFor(DATABASE_ROLES.food.seeder, TARGET) });
            await seeder.connect();

            try {
                const result = await runCatalogSeed({
                    client: seeder,
                    dataDir: SEED_DATA_DIR,
                    seedSha: SEED_SHA,
                    verify: createCatalogVerifier({ dataDir: SEED_DATA_DIR, sqlDir: VERIFIER_SQL_DIR }),
                    log: () => undefined,
                });

                expect(result.outcome).toBe('applied');
            } finally {
                await seeder.end();
            }

            const ledger = await asRole(DATABASE_ROLES.food.migrator, TARGET, (pool) =>
                pool.query<{ seed_sha: string }>('SELECT seed_sha FROM catalog_seed_ledger'),
            );
            const roots = await asRole(DATABASE_ROLES.food.migrator, TARGET, (pool) =>
                pool.query<{ count: number }>(
                    'SELECT count(*)::int AS count FROM food WHERE seed_key IS NOT NULL AND retired_at IS NULL',
                ),
            );

            expect(ledger.rows).toEqual([{ seed_sha: SEED_SHA }]);
            expect(roots.rows[0]?.count).toBeGreaterThan(0);
        },
        SEED_TIMEOUT_MS,
    );

    it('finds the database on a re-invocation and leaves it alone', async () => {
        await ensureDatabaseExists({ maintenancePool, databaseName: TARGET });
        await migrate(TARGET);

        expect(await ensureDatabaseExists({ maintenancePool, databaseName: TARGET })).toBe('exists');
        expect((await migrate(TARGET)).applied).toEqual([]);
    });

    it('creates two previews at the same moment', async () => {
        const results = await Promise.all([
            ensureDatabaseExists({ maintenancePool, databaseName: TARGET }),
            ensureDatabaseExists({ maintenancePool, databaseName: SECOND_TARGET }),
        ]);

        expect(results).toEqual(['created', 'created']);
    });

    it('never creates the base database', async () => {
        expect(await ensureDatabaseExists({ maintenancePool, databaseName: 'kitchensink_food' })).toBe('skipped-base');
    });
});
