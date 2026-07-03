/**
 * Unit coverage for the per-PR database create/drop logic of the migration runner (ADR-0006):
 * name validation, base-name short-circuits, idempotent create, and force-drop. The maintenance pool
 * is a lightweight test double so no real Postgres is needed here (the DB-backed path is exercised in
 * `tests/migrate.integration.test.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';

import { BASE_FOOD_DATABASE_NAME, dropDatabase, ensureDatabaseExists, isValidFoodDatabaseName } from '../handler.js';

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
    it('short-circuits the shared base database (never CREATEs it)', async () => {
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

    it('creates the database (quoted identifier) when absent', async () => {
        const { pool, query } = fakePool([{ rowCount: 0 }]);

        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' }),
        ).resolves.toBe('created');
        expect(query).toHaveBeenLastCalledWith('CREATE DATABASE "kitchensink_food_pr_7"');
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
        expect(query).toHaveBeenLastCalledWith('CREATE DATABASE "kitchensink_food_pr_7"');
    });

    it('propagates a non-duplicate CREATE failure', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rowCount: 0 })
            .mockRejectedValueOnce(Object.assign(new Error('permission denied to create database'), { code: '42501' }));
        const pool = { query } as unknown as pg.Pool;

        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' }),
        ).rejects.toThrow(/permission denied/i);
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
