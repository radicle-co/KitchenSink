/**
 * Unit coverage for the per-PR database create/drop logic of the migration runner (ADR-0006):
 * name validation, base-name short-circuits, idempotent create, and force-drop. The maintenance pool
 * is a lightweight test double so no real Postgres is needed here (the DB-backed path is exercised in
 * `tests/migrate.integration.test.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';

import { BASE_FOOD_DATABASE_NAME, dropDatabase, ensureDatabaseExists, isValidFoodDatabaseName } from '../handler.js';
import { isFoodDatabaseCloneError, type FoodDatabaseCloneError } from '../migrate.errors.js';

/** Build a fake maintenance pool whose `query` returns the queued results in order. */
function fakePool(results: Array<{ rowCount: number }>): { pool: pg.Pool; query: ReturnType<typeof vi.fn> } {
    const query = vi.fn();

    for (const result of results) {
        query.mockResolvedValueOnce(result);
    }

    query.mockResolvedValue({ rowCount: 0 });

    return { pool: { query } as unknown as pg.Pool, query };
}

describe('isValidFoodDatabaseName', () => {
    it('accepts the base name and per-PR names', () => {
        expect(isValidFoodDatabaseName('kitchensink_food')).toBe(true);
        expect(isValidFoodDatabaseName('kitchensink_food_pr_7')).toBe(true);
        expect(isValidFoodDatabaseName('kitchensink_food_team_x')).toBe(true);
    });

    it('rejects anything outside the food naming contract (injection guard)', () => {
        expect(isValidFoodDatabaseName('postgres')).toBe(false);
        expect(isValidFoodDatabaseName('kitchensink_identity')).toBe(false);
        expect(isValidFoodDatabaseName('kitchensink_food"; DROP DATABASE x; --')).toBe(false);
        expect(isValidFoodDatabaseName('kitchensink_food_PR_7')).toBe(false);
    });
});

describe('ensureDatabaseExists', () => {
    /**
     * The base is provisioned (and, per U38, SEEDED) by the platform bootstrap. The short-circuit is
     * what stops the runner asking PostgreSQL to clone `kitchensink_food` onto itself when a base stage
     * deploys — every prod and sandbox migration run takes this path.
     */
    it('short-circuits the shared base database — no SELECT, no CREATE, no self-clone', async () => {
        const { pool, query } = fakePool([]);

        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: BASE_FOOD_DATABASE_NAME }),
        ).resolves.toBe('skipped-base');
        expect(query).not.toHaveBeenCalled();
    });

    it('throws on an invalid database name before touching the database', async () => {
        const { pool, query } = fakePool([]);

        await expect(ensureDatabaseExists({ maintenancePool: pool, databaseName: 'not_a_food_db' })).rejects.toThrow(
            /invalid name/i,
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('returns "exists" without creating when the database is already present', async () => {
        const { pool, query } = fakePool([{ rowCount: 1 }]);

        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' }),
        ).resolves.toBe('exists');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toMatch(/pg_database/);
    });

    /**
     * U38 — a per-PR database is CLONED from the seeded base, not created empty. Before this, a fresh
     * `pr-{N}` came up with a migrated but EMPTY catalog and every ingredient search in that preview
     * answered `catalogAvailability: 'unavailable'` behind green checks.
     *
     * ⚠️ This REPLACES the previous `'created'` assertion rather than relaxing it: the old test proved
     * `CREATE DATABASE "…"` with no template, which is now precisely the defect (a silently-empty
     * catalog). It is restated as the clone, and the failure paths below are the guard the plan calls the
     * most important test in the unit.
     */
    it('clones the seeded base into the per-PR database (quoted identifiers) when absent', async () => {
        const { pool, query } = fakePool([{ rowCount: 0 }]);

        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' }),
        ).resolves.toBe('cloned');
        expect(query).toHaveBeenLastCalledWith('CREATE DATABASE "kitchensink_food_pr_7" TEMPLATE "kitchensink_food"');
    });

    it('treats a lost CREATE race (SQLSTATE 42P04) as "exists" instead of failing', async () => {
        // SELECT sees the DB missing, but a concurrent invocation CREATEs it first, so our CREATE
        // throws duplicate_database. The database now exists — the desired end state.
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rowCount: 0 })
            .mockRejectedValueOnce(
                Object.assign(new Error('database "kitchensink_food_pr_7" already exists'), {
                    code: '42P04',
                }),
            );
        const pool = { query } as unknown as pg.Pool;

        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' }),
        ).resolves.toBe('exists');
    });

    /**
     * ⛔ THE test of this unit. A session holding the template makes PostgreSQL refuse the clone
     * (`source database … is being accessed by other users`, SQLSTATE 55006). The only acceptable
     * outcome is a loud failure that fails the deploy: catching it and falling through to a plain
     * `CREATE DATABASE` would produce exactly the silently-empty catalog ADR-0010 exists to prevent,
     * and every check would stay green.
     */
    it('FAILS LOUDLY when a session holds the template, and creates nothing in its place', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rowCount: 0 })
            .mockRejectedValueOnce(
                Object.assign(new Error('source database "kitchensink_food" is being accessed by other users'), {
                    code: '55006',
                }),
            );
        const pool = { query } as unknown as pg.Pool;

        const error = await ensureDatabaseExists({
            maintenancePool: pool,
            databaseName: 'kitchensink_food_pr_7',
        }).catch((caught: unknown) => caught);

        expect(isFoodDatabaseCloneError(error)).toBe(true);
        expect((error as FoodDatabaseCloneError).reason).toBe('template-in-use');
        expect((error as FoodDatabaseCloneError).databaseName).toBe('kitchensink_food_pr_7');
        expect((error as FoodDatabaseCloneError).templateDatabase).toBe(BASE_FOOD_DATABASE_NAME);
        // No second, template-less CREATE — the empty database must never come into existence.
        const created = query.mock.calls.map(String).filter((sql) => sql.includes('CREATE DATABASE'));
        expect(created).toEqual(['CREATE DATABASE "kitchensink_food_pr_7" TEMPLATE "kitchensink_food"']);
    });

    it('FAILS LOUDLY when the base database is not there to clone (SQLSTATE 3D000)', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rowCount: 0 })
            .mockRejectedValueOnce(
                Object.assign(new Error('database "kitchensink_food" does not exist'), { code: '3D000' }),
            );
        const pool = { query } as unknown as pg.Pool;

        const error = await ensureDatabaseExists({
            maintenancePool: pool,
            databaseName: 'kitchensink_food_pr_7',
        }).catch((caught: unknown) => caught);

        expect(isFoodDatabaseCloneError(error)).toBe(true);
        expect((error as FoodDatabaseCloneError).reason).toBe('template-missing');
    });

    it('FAILS LOUDLY when the role may not copy the base (SQLSTATE 42501), naming what to grant', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rowCount: 0 })
            .mockRejectedValueOnce(Object.assign(new Error('permission denied to create database'), { code: '42501' }));
        const pool = { query } as unknown as pg.Pool;

        const error = await ensureDatabaseExists({
            maintenancePool: pool,
            databaseName: 'kitchensink_food_pr_7',
        }).catch((caught: unknown) => caught);

        expect(isFoodDatabaseCloneError(error)).toBe(true);
        expect((error as FoodDatabaseCloneError).reason).toBe('insufficient-privilege');
    });

    it('propagates an unclassified CREATE failure untouched (no diagnosis it cannot support)', async () => {
        const cause = Object.assign(new Error('could not write to file: No space left on device'), { code: '53100' });
        const query = vi.fn().mockResolvedValueOnce({ rowCount: 0 }).mockRejectedValueOnce(cause);
        const pool = { query } as unknown as pg.Pool;

        const error = await ensureDatabaseExists({
            maintenancePool: pool,
            databaseName: 'kitchensink_food_pr_7',
        }).catch((caught: unknown) => caught);

        expect(error).toBe(cause);
        expect(isFoodDatabaseCloneError(error)).toBe(false);
    });

    it('carries the underlying Postgres error as the cause, so the deploy log keeps the SQLSTATE', async () => {
        const cause = Object.assign(new Error('source database "kitchensink_food" is being accessed by other users'), {
            code: '55006',
        });
        const query = vi.fn().mockResolvedValueOnce({ rowCount: 0 }).mockRejectedValueOnce(cause);
        const pool = { query } as unknown as pg.Pool;

        const error = await ensureDatabaseExists({
            maintenancePool: pool,
            databaseName: 'kitchensink_food_pr_7',
        }).catch((caught: unknown) => caught);

        expect((error as FoodDatabaseCloneError).cause).toBe(cause);
    });
});

describe('dropDatabase', () => {
    it('never drops the shared base database', async () => {
        const { pool, query } = fakePool([]);

        await expect(dropDatabase({ maintenancePool: pool, databaseName: BASE_FOOD_DATABASE_NAME })).resolves.toBe(
            'skipped-base',
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('returns "absent" when the database does not exist', async () => {
        const { pool, query } = fakePool([{ rowCount: 0 }]);

        await expect(dropDatabase({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' })).resolves.toBe(
            'absent',
        );
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('force-drops an existing per-PR database', async () => {
        const { pool, query } = fakePool([{ rowCount: 1 }]);

        await expect(dropDatabase({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' })).resolves.toBe(
            'dropped',
        );
        expect(query).toHaveBeenLastCalledWith('DROP DATABASE IF EXISTS "kitchensink_food_pr_7" WITH (FORCE)');
    });

    it('refuses to drop an invalid name', async () => {
        const { pool } = fakePool([]);

        await expect(dropDatabase({ maintenancePool: pool, databaseName: 'postgres' })).rejects.toThrow(
            /invalid name/i,
        );
    });
});
