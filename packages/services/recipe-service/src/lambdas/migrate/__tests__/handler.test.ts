/**
 * Unit coverage for the recipe migrate runner's pure/guarded logic (feature 001) — the parts that run
 * without a database: the logical-DB-name guard, ordered `.sql` discovery, and the idempotent, injection-
 * safe create/drop of a per-PR database (base name is never created or dropped). The DB-hitting
 * `runMigrations` path is exercised end-to-end by the deploy's migrate invocation (9 migrations / 10
 * tables) and can gain an `.integration.spec.ts` later.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { discoverMigrations, dropDatabase, ensureDatabaseExists, isValidRecipeDatabaseName } from '../handler.js';

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
        const dir = mkdtempSync(join(tmpdir(), 'recipe-mig-'));
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

describe('dropDatabase', () => {
    it('never drops the base database', async () => {
        const { pool, sqls } = fakePool(true);
        await expect(dropDatabase({ maintenancePool: pool, databaseName: 'kitchensink_recipes' })).resolves.toBe(
            'skipped-base',
        );
        expect(sqls.join('\n')).not.toMatch(/DROP DATABASE/);
    });

    it('drops an existing per-PR database with FORCE', async () => {
        const { pool, sqls } = fakePool(true);
        await expect(dropDatabase({ maintenancePool: pool, databaseName: 'kitchensink_recipes_pr_73' })).resolves.toBe(
            'dropped',
        );
        expect(sqls.join('\n')).toMatch(/DROP DATABASE IF EXISTS "kitchensink_recipes_pr_73" WITH \(FORCE\)/);
    });

    it('is a no-op when the per-PR database is absent', async () => {
        const { pool } = fakePool(false);
        await expect(dropDatabase({ maintenancePool: pool, databaseName: 'kitchensink_recipes_pr_73' })).resolves.toBe(
            'absent',
        );
    });
});
