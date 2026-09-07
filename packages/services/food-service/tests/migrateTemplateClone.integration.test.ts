/**
 * Integration suite for the WARM-START clone of a per-PR food database (U38), against real PostgreSQL.
 *
 * ADR-0006 gives every `pr-{N}` its own logical database, created by the migration run itself
 * (ADR-0022's in-stack Trigger). Creating it EMPTY meant every preview came up with a migrated but
 * unpopulated catalog: ingredient search answered `catalogAvailability: 'unavailable'` while every check
 * stayed green — the failure ADR-0010 exists to prevent. The database is now cloned from the seeded base
 * with `CREATE DATABASE … TEMPLATE "kitchensink_food"`.
 *
 * ⚠️ That clone is viable ONLY because the base carries no sessions — PostgreSQL refuses to copy a
 * database anything is connected to. The plan calls the loud-failure case the single most important test
 * in this unit, and a mocked pool cannot prove it: SQLSTATE 55006 is PostgreSQL's own refusal, and the
 * claim being made is "nothing was created in its place", which only a real catalog can answer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { ensureDatabaseExists, dropDatabase, runMigrations } from '../src/lambdas/migrate/handler.js';
import { isFoodDatabaseCloneError, type FoodDatabaseCloneError } from '../src/lambdas/migrate/migrate.errors.js';
import { DATABASE_URL, migrationsDir } from './support/db.js';
import {
    BASE_MARKER_FOOD,
    connectionStringFor,
    ensureSeededBaseDatabase,
    makeMaintenancePool,
} from './support/maintenanceDb.js';

// The digest of the very directory each call migrates. `expectManifestSha` is REQUIRED (ADR-0035), so
// passing it here is not ceremony: it makes these tests exercise the contract the deployed runner enforces
// rather than a laxer one that only exists in the test.
import { readMigrationManifest } from '@kitchensink/db-schema-guard';

/** The per-PR database this suite owns; distinct from every other suite's so they cannot interfere. */
const CLONE_TARGET = 'kitchensink_food_pr_u38';

/** A second target, used to prove two previews can deploy at the same time. */
const SECOND_CLONE_TARGET = 'kitchensink_food_pr_u38b';

describe.skipIf(!DATABASE_URL)('per-PR database warm start (U38)', () => {
    const maintenancePool = makeMaintenancePool();

    /**
     * Count rows in the cloned catalog through a short-lived pool, closed before returning so the clone
     * never keeps a session that a later `DROP DATABASE` would have to force.
     */
    async function inClone<T>(database: string, run: (pool: pg.Pool) => Promise<T>): Promise<T> {
        const pool = new pg.Pool({ connectionString: connectionStringFor(database), max: 1 });

        try {
            return await run(pool);
        } finally {
            await pool.end();
        }
    }

    /** Whether a database exists, asked of the catalog rather than inferred from a return value. */
    async function databaseExists(name: string): Promise<boolean> {
        const found = await maintenancePool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

        return (found.rowCount ?? 0) > 0;
    }

    beforeAll(async () => {
        await ensureSeededBaseDatabase();
    });

    afterEach(async () => {
        await dropDatabase({ maintenancePool, databaseName: CLONE_TARGET });
        await dropDatabase({ maintenancePool, databaseName: SECOND_CLONE_TARGET });
    });

    afterAll(async () => {
        await maintenancePool.end();
    });

    it('clones the base, so the per-PR catalog STARTS with the base rows', async () => {
        expect(await ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET })).toBe('cloned');

        const marker = await inClone(CLONE_TARGET, (pool) =>
            pool.query<{ normalized_name: string }>('SELECT normalized_name FROM food WHERE id = $1', [
                BASE_MARKER_FOOD.id,
            ]),
        );

        expect(marker.rows).toEqual([{ normalized_name: BASE_MARKER_FOOD.normalizedName }]);
    });

    it('carries the base migration history, so the run that follows applies nothing and skips everything', async () => {
        await ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET });

        const result = await inClone(CLONE_TARGET, (pool) =>
            runMigrations({ pool, migrationsDir, expectManifestSha: readMigrationManifest(migrationsDir).sha }),
        );

        expect(result.applied).toEqual([]);
        expect(result.skipped.length).toBeGreaterThan(0);
        expect(result.validated.migrations).toBe(result.skipped.length);
    });

    it('is idempotent — a re-invocation finds the database and does not re-clone over it', async () => {
        await ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET });
        await inClone(CLONE_TARGET, (pool) => pool.query('DELETE FROM food WHERE id = $1', [BASE_MARKER_FOOD.id]));

        expect(await ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET })).toBe('exists');

        // A second clone would have restored the marker; 'exists' must mean the database was left alone.
        const remaining = await inClone(CLONE_TARGET, (pool) =>
            pool.query('SELECT 1 FROM food WHERE id = $1', [BASE_MARKER_FOOD.id]),
        );

        expect(remaining.rowCount).toBe(0);
    });

    /**
     * ⛔ THE test of this unit. Catching PostgreSQL's refusal and falling through to a plain
     * `CREATE DATABASE` would hand the preview an EMPTY catalog behind a green deploy. The assertion is
     * therefore in two parts: the failure is loud AND classified, and nothing was created in its place.
     */
    it('FAILS LOUDLY when a session holds the template, and leaves no database behind', async () => {
        const holder = new pg.Client({ connectionString: connectionStringFor('kitchensink_food') });
        await holder.connect();

        try {
            // Prove the session is real and connected to the template before relying on it.
            const held = await holder.query<{ current_database: string }>('SELECT current_database()');
            expect(held.rows).toEqual([{ current_database: 'kitchensink_food' }]);

            const error = await ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET }).catch(
                (caught: unknown) => caught,
            );

            expect(isFoodDatabaseCloneError(error)).toBe(true);
            expect((error as FoodDatabaseCloneError).reason).toBe('template-in-use');
            expect(await databaseExists(CLONE_TARGET)).toBe(false);
        } finally {
            await holder.end();
        }
    });

    it('succeeds again once the holding session goes away (the refusal is transient, not sticky)', async () => {
        const holder = new pg.Client({ connectionString: connectionStringFor('kitchensink_food') });
        await holder.connect();
        await ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET }).catch(() => undefined);
        await holder.end();

        expect(await ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET })).toBe('cloned');
    });

    /**
     * Several previews deploy at once in this repo, and each runs its own migration Lambda. Cloning takes
     * a SHARE lock on the template rather than a session on it, so concurrent clones are expected to
     * succeed — asserted rather than assumed, because the failure mode would be an intermittently red
     * deploy that only appears when two PRs land together.
     */
    it('allows two per-PR clones from the same template at the same time', async () => {
        const results = await Promise.all([
            ensureDatabaseExists({ maintenancePool, databaseName: CLONE_TARGET }),
            ensureDatabaseExists({ maintenancePool, databaseName: SECOND_CLONE_TARGET }),
        ]);

        expect(results).toEqual(['cloned', 'cloned']);

        const second = await inClone(SECOND_CLONE_TARGET, (pool) =>
            pool.query('SELECT 1 FROM food WHERE id = $1', [BASE_MARKER_FOOD.id]),
        );

        expect(second.rowCount).toBe(1);
    });

    it('still skips the base database itself — a base stage never clones onto itself', async () => {
        expect(await ensureDatabaseExists({ maintenancePool, databaseName: 'kitchensink_food' })).toBe('skipped-base');

        const marker = await inClone('kitchensink_food', (pool) =>
            pool.query('SELECT 1 FROM food WHERE id = $1', [BASE_MARKER_FOOD.id]),
        );

        expect(marker.rowCount).toBe(1);
    });
});
