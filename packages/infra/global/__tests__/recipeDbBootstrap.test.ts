/**
 * Unit coverage for the master-connected recipe_app bootstrap SQL (feature 001, ADR-0006): the role +
 * rds_iam grant are always applied, CREATEDB is non-prod-only (per-PR databases never exist on prod), and
 * the base database creation is idempotent. Mirrors the food-db-bootstrap coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';

import { bootstrap } from '../src/recipe-db-bootstrap/handler.js';

/** Fake maintenance pool: records every SQL string; pg_database probe returns `dbExists`. */
function fakePool(dbExists = false): { pool: pg.Pool; sqls: string[] } {
    const sqls: string[] = [];
    const query = vi.fn((text: string) => {
        sqls.push(text);
        const rowCount = text.includes('pg_database') && dbExists ? 1 : 0;

        return Promise.resolve({ rowCount, rows: rowCount > 0 ? [{}] : [] });
    });

    return { pool: { query } as unknown as pg.Pool, sqls };
}

describe('recipe-db-bootstrap bootstrap()', () => {
    it('non-prod: creates the role, grants rds_iam + CREATEDB, creates the base database', async () => {
        const { pool, sqls } = fakePool();

        await bootstrap(pool, 'kitchensink_recipes', false);
        const joined = sqls.join('\n');

        expect(joined).toMatch(/CREATE ROLE recipe_app LOGIN/);
        expect(joined).toMatch(/GRANT rds_iam TO recipe_app/);
        expect(joined).toMatch(/ALTER ROLE recipe_app CREATEDB/);
        expect(joined).toMatch(/CREATE DATABASE "kitchensink_recipes" OWNER recipe_app/);
        expect(joined).toMatch(/GRANT ALL PRIVILEGES ON DATABASE "kitchensink_recipes"/);
    });

    it('prod: grants rds_iam but NEVER CREATEDB (no per-PR databases on prod)', async () => {
        const { pool, sqls } = fakePool();

        await bootstrap(pool, 'kitchensink_recipes', true);
        const joined = sqls.join('\n');

        expect(joined).toMatch(/GRANT rds_iam TO recipe_app/);
        expect(joined).not.toMatch(/CREATEDB/);
    });

    it('idempotent: skips CREATE DATABASE when the base database already exists', async () => {
        const { pool, sqls } = fakePool(true);

        await bootstrap(pool, 'kitchensink_recipes', false);

        expect(sqls.join('\n')).not.toMatch(/CREATE DATABASE/);
    });
});
