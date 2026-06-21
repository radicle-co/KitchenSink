import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

/**
 * Validates the kitchensink_food schema (T-005–T-008) against a REAL Postgres. Applies the
 * hand-authored ordered migration SQL — the source of truth the in-VPC runner applies (FU-MIGRATE)
 * — to a clean DB and asserts the FR-028 CHECK constraint, the fetch_queue ON CONFLICT dedup, the
 * usda_sync_metadata singleton seed, the empty usda_call_log window, the expected indexes, and the
 * pg_trgm extension. Runs against CI's Postgres service (or a local DATABASE_URL); skips cleanly
 * when none is configured.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

async function runMigrations(pool: pg.Pool): Promise<void> {
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    // The integration suite shares one database; reset to a blank schema before applying the
    // ordered migrations. The SQL is not idempotent (bare CREATE TABLE), so replaying it on an
    // already-migrated DB would otherwise fail with "relation already exists".
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }
}

describe.skipIf(!DATABASE_URL)('kitchensink_food schema (integration)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await runMigrations(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    it('applies the ordered migration SQL with no error', async () => {
        // beforeAll already ran the migration; a re-run on a clean schema must also succeed.
        await expect(runMigrations(pool)).resolves.toBeUndefined();
    });

    describe('foods.fetch_status CHECK (FR-028)', () => {
        it('rejects an invalid fetch_status', async () => {
            await expect(
                pool.query(`INSERT INTO foods (fdc_id, fetch_status) VALUES (100001, 'bogus')`),
            ).rejects.toThrow();
        });

        it('accepts a valid fetch_status', async () => {
            await expect(
                pool.query(`INSERT INTO foods (fdc_id, fetch_status) VALUES (100002, 'pending')`),
            ).resolves.toBeDefined();
            await pool.query(`DELETE FROM foods WHERE fdc_id = 100002`);
        });
    });

    describe('fetch_queue ON CONFLICT dedup (FR-014)', () => {
        it('increments request_count atomically on conflict', async () => {
            await pool.query(`DELETE FROM fetch_queue WHERE fdc_id = '200001'`);

            const enqueue = `INSERT INTO fetch_queue (fdc_id) VALUES ('200001')
                ON CONFLICT (fdc_id) DO UPDATE SET request_count = fetch_queue.request_count + 1`;
            await pool.query(enqueue);
            await pool.query(enqueue);

            const { rows } = await pool.query<{ request_count: number }>(
                `SELECT request_count FROM fetch_queue WHERE fdc_id = '200001'`,
            );
            expect(rows[0]?.request_count).toBe(2);

            await pool.query(`DELETE FROM fetch_queue WHERE fdc_id = '200001'`);
        });

        it('rejects an invalid status (FR-014/FR-015 CHECK)', async () => {
            await expect(
                pool.query(`INSERT INTO fetch_queue (fdc_id, status) VALUES ('200002', 'bogus')`),
            ).rejects.toThrow();
        });
    });

    describe('usda_sync_metadata singleton (FR-019)', () => {
        it('has exactly one row with id = 1', async () => {
            const { rows } = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM usda_sync_metadata`);
            expect(Number(rows[0]?.count)).toBe(1);

            const { rows: idRows } = await pool.query<{ id: number }>(`SELECT id FROM usda_sync_metadata`);
            expect(idRows[0]?.id).toBe(1);
        });
    });

    describe('usda_call_log rolling window (FR-019)', () => {
        it('starts empty over the trailing 60 minutes', async () => {
            const { rows } = await pool.query<{ count: string }>(
                `SELECT count(*) AS count FROM usda_call_log WHERE called_at > now() - interval '60 minutes'`,
            );
            expect(Number(rows[0]?.count)).toBe(0);
        });
    });

    describe('indexes (FR-029)', () => {
        it('creates the expected indexes', async () => {
            const { rows } = await pool.query<{ indexname: string }>(
                `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
            );
            const names = new Set(rows.map((row) => row.indexname));
            for (const expected of [
                'idx_fetch_queue_priority',
                'idx_foods_search',
                'idx_foods_fetch_status_fetched_at',
                'idx_usda_call_log_called_at',
            ]) {
                expect(names).toContain(expected);
            }
        });
    });

    describe('pg_trgm extension (FR-029)', () => {
        it('is installed', async () => {
            const { rows } = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
            expect(rows).toHaveLength(1);
        });
    });
});
