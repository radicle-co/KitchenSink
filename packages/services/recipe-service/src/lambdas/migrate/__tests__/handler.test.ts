/**
 * Unit coverage for the recipe migrate runner's pure/guarded logic (feature 001) — the parts that run
 * without a database: the logical-DB-name guard, ordered `.sql` discovery, and the idempotent, injection-
 * safe create/drop of a per-PR database (base name is never created or dropped). The DB-hitting
 * `runMigrations` path is exercised end-to-end by the deploy's migrate invocation (the ordered
 * `0001..NNNN_*.sql` set) and can gain an `.integration.test.ts` later.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { discoverMigrations, ensureDatabaseExists, handler, isValidRecipeDatabaseName } from '../handler.js';

/** Fake pool: records SQL, and a `pg_database` probe returns `dbExists`. */
function fakePool(dbExists = false): { pool: pg.Pool; sqls: string[] } {
    const sqls: string[] = [];
    const query = vi.fn((text: string) => {
        sqls.push(text);
        const rowCount = text.includes('pg_database') && dbExists ? 1 : 0;

        return Promise.resolve({ rowCount, rows: rowCount > 0 ? [{}] : [] });
    });

    return { pool: { query } as unknown as pg.Pool, sqls };
}

/** Scratch directories this file created, removed in `afterAll` so a FAILING test still cleans up. */
const scratchDirectories: string[] = [];

afterAll(() => {
    for (const directory of scratchDirectories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * A throwaway directory, registered for removal when this file's suites finish.
 *
 * @param prefix - The `mkdtemp` prefix, so a directory that does outlive a run names the suite that made it.
 * @returns The absolute path to the new directory.
 * @sideEffect Creates a directory under the OS temp directory.
 */
function scratchDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));

    scratchDirectories.push(directory);

    return directory;
}

describe('isValidRecipeDatabaseName', () => {
    it('accepts the base name and per-PR suffixed names', () => {
        expect(isValidRecipeDatabaseName('kitchensink_recipes')).toBe(true);
        expect(isValidRecipeDatabaseName('kitchensink_recipes_pr_73')).toBe(true);
    });

    it('rejects anything outside the contract (wrong prefix, uppercase, spaces, injection)', () => {
        for (const bad of [
            'kitchensink_food',
            'Kitchensink_recipes',
            'kitchensink_recipes;',
            'recipes',
            'kitchensink_recipes-1',
        ]) {
            expect(isValidRecipeDatabaseName(bad)).toBe(false);
        }
    });
});

describe('discoverMigrations', () => {
    it('discovers ordered .sql files by filename, ignoring non-sql', () => {
        const dir = scratchDirectory('recipe-mig-');
        writeFileSync(join(dir, '0002_second.sql'), 'SELECT 1;');
        writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;');
        writeFileSync(join(dir, 'notes.txt'), 'ignore me');

        expect(discoverMigrations(dir).map((m) => m.name)).toEqual(['0001_first', '0002_second']);
    });
});

describe('ensureDatabaseExists', () => {
    afterEach(() => vi.restoreAllMocks());

    it('never creates the base database', async () => {
        const { pool, sqls } = fakePool();
        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_recipes' }),
        ).resolves.toBe('skipped-base');
        expect(sqls.join('\n')).not.toMatch(/CREATE DATABASE/);
    });

    it('creates an absent per-PR database', async () => {
        const { pool, sqls } = fakePool(false);
        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_recipes_pr_73' }),
        ).resolves.toBe('created');
        expect(sqls.join('\n')).toMatch(/CREATE DATABASE "kitchensink_recipes_pr_73"/);
    });

    it('is a no-op when the per-PR database already exists', async () => {
        const { pool, sqls } = fakePool(true);
        await expect(
            ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_recipes_pr_73' }),
        ).resolves.toBe('exists');
        expect(sqls.join('\n')).not.toMatch(/CREATE DATABASE/);
    });

    it('refuses an invalid database name', async () => {
        const { pool } = fakePool();
        await expect(ensureDatabaseExists({ maintenancePool: pool, databaseName: 'evil; DROP' })).rejects.toThrow(
            /invalid name/,
        );
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

describe('ensureDatabaseExists — the per-PR database belongs to the OWNER', () => {
    it('creates it OWNER recipe_owner, never owned by the migrator that runs the CREATE', async () => {
        const { pool, sqls } = fakePool(false);

        await ensureDatabaseExists({ maintenancePool: pool, databaseName: 'kitchensink_recipes_pr_73' });

        expect(sqls).toContain('CREATE DATABASE "kitchensink_recipes_pr_73" OWNER "recipe_owner"');
    });
});
