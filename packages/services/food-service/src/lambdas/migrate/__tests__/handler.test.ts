/**
 * Unit coverage for the per-PR database create/drop logic of the migration runner (ADR-0006):
 * name validation, base-name short-circuits, idempotent create, and force-drop. The maintenance pool
 * is a lightweight test double so no real Postgres is needed here (the DB-backed path is exercised in
 * `tests/migrate.integration.test.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';

import { BASE_FOOD_DATABASE_NAME, ensureDatabaseExists, handler, isValidFoodDatabaseName } from '../handler.js';
import { isFoodDatabaseCreateError, type FoodDatabaseCreateError } from '../migrate.errors.js';

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
     * The base is provisioned by the platform bootstrap. The short-circuit stops the runner creating
     * `kitchensink_food` when a base stage deploys: every prod migration run takes this path.
     */
    it('short-circuits the shared base database — no SELECT, no CREATE', async () => {
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
     * A per-PR database is created EMPTY from `template0` (curated catalog plan U7, KTD-5). The seed step that
     * follows the migration fills its catalog, so nothing is cloned from the base: the base holds no seed of its
     * own, and a clone is refused whenever any session holds it.
     *
     * ⚠️ This REPLACES the U38 clone assertion: the per-PR catalog no longer comes from the base.
     */
    it('creates the per-PR database from template0, owned by the owner (quoted identifiers), when absent', async () => {
        const { pool, query } = fakePool([{ rowCount: 0 }]);

        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_food_pr_7' }),
        ).resolves.toBe('created');
        expect(query).toHaveBeenLastCalledWith(
            'CREATE DATABASE "kitchensink_food_pr_7" TEMPLATE template0 OWNER "food_owner"',
        );
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

    it('FAILS LOUDLY when the role may not create the database (SQLSTATE 42501), naming what to grant', async () => {
        const cause = Object.assign(new Error('permission denied to create database'), { code: '42501' });
        const query = vi.fn().mockResolvedValueOnce({ rowCount: 0 }).mockRejectedValueOnce(cause);
        const pool = { query } as unknown as pg.Pool;

        const error = await ensureDatabaseExists({
            maintenancePool: pool,
            databaseName: 'kitchensink_food_pr_7',
        }).catch((caught: unknown) => caught);

        expect(isFoodDatabaseCreateError(error)).toBe(true);
        expect((error as FoodDatabaseCreateError).databaseName).toBe('kitchensink_food_pr_7');
        expect((error as FoodDatabaseCreateError).message).toMatch(/CREATEDB/u);
        // The deploy log keeps the SQLSTATE.
        expect((error as FoodDatabaseCreateError).cause).toBe(cause);
    });

    it('propagates any other CREATE failure untouched (no diagnosis it cannot support)', async () => {
        const cause = Object.assign(new Error('could not write to file: No space left on device'), { code: '53100' });
        const query = vi.fn().mockResolvedValueOnce({ rowCount: 0 }).mockRejectedValueOnce(cause);
        const pool = { query } as unknown as pg.Pool;

        const error = await ensureDatabaseExists({
            maintenancePool: pool,
            databaseName: 'kitchensink_food_pr_7',
        }).catch((caught: unknown) => caught);

        expect(error).toBe(cause);
        expect(isFoodDatabaseCreateError(error)).toBe(false);
    });
});

describe('handler — the event is a migrate and nothing else', () => {
    it('⛔ refuses a { action: "drop" } event instead of silently migrating (the drop door is gone)', async () => {
        // The per-PR reaper (ADR-0031) is the one drop authority; a stale caller still sending `drop` must
        // fail loudly, not have its payload's extra key ignored and a migration run in its place.
        await expect(handler({ action: 'drop', expectManifestSha: 'a'.repeat(64) })).rejects.toThrow(
            /malformed event/u,
        );
    });

    it('refuses a migrate with no manifest expectation (ADR-0035)', async () => {
        await expect(handler({})).rejects.toThrow(/expectManifestSha/u);
    });
});
