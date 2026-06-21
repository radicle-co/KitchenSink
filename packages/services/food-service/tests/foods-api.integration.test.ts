/**
 * Integration tests for the `/v1/foods/*` read path against a REAL Postgres (`DATABASE_URL`).
 *
 * Mirrors the Phase-1 real-Postgres pattern: apply the Drizzle migration, bootstrap `pg_trgm`
 * and a `search_vector` trigger, seed `foods` rows, and drive the booted Foods layer
 * ({@link FoodsService} + {@link FetchQueueService}) against the live DB.
 *
 * Requirement → test mapping:
 * - FR-001/FR-002 (cache hit)        → "fetched row returns 200 food payload, no enqueue"
 * - FR-005/FR-025 (tombstone in TTL) → "not_found within TTL throws FoodNotFoundError (404), no queue row"
 * - FR-003/FR-014 (miss → enqueue)   → "miss enqueues one fetch_queue + fetch_requesters row, throws pending"
 * - FR-014 (dedup)                   → "concurrent enqueues for one id produce exactly one queue row"
 * - FR-031 (stale-while-revalidate)  → "stale row returns 200 + stale:true AND enqueues a re-fetch"
 * - FR-008/FR-010 (FTS)              → "search returns ranked exact matches"
 * - FR-008 (trigram fuzzy)           → "misspelled query returns the fuzzy match"
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema/index.js';
import { FetchQueueService } from '../src/foods/fetch-queue.service.js';
import { isFoodNotFoundError, isFoodPendingError } from '../src/foods/foods.errors.js';
import { FoodsRepository } from '../src/foods/foods.repository.js';
import { FoodsService } from '../src/foods/foods.service.js';

const { Pool } = pg;

const DATABASE_URL = process.env['DATABASE_URL'];
const DAY_MS = 86_400_000;

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../src/db/migrations');

/** Apply the Phase-1 ordered migration(s) + search bootstrap on a clean schema, before each test. */
async function resetSchema(pool: pg.Pool): Promise<void> {
    // Reset to a clean schema, then apply the hand-authored ordered migration(s) — the source of
    // truth the in-VPC runner applies (mirrors tests/schema.integration.test.ts; bare CREATE TABLE,
    // so it must run on an empty schema). pg_trgm is created by the migration itself.
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();
    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }

    // search_vector is maintained by the Phase-3 search indexer in prod; for tests, populate it via a
    // trigger so FTS has data (Phase 2 reads the column; Phase 3 owns the indexer).
    await pool.query(`
        CREATE OR REPLACE FUNCTION foods_search_vector_update() RETURNS trigger AS $$
        BEGIN
            NEW.search_vector := to_tsvector('english', coalesce(NEW.description, ''));
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `);
    await pool.query(`
        DROP TRIGGER IF EXISTS foods_search_vector_trigger ON foods;
        CREATE TRIGGER foods_search_vector_trigger
            BEFORE INSERT OR UPDATE ON foods
            FOR EACH ROW EXECUTE FUNCTION foods_search_vector_update();
    `);
}

async function seedFood(pool: pg.Pool, values: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(values);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

    await pool.query(
        `INSERT INTO foods (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
        Object.values(values),
    );
}

describe.skipIf(!DATABASE_URL)('foods read API (real Postgres)', () => {
    let pool: pg.Pool;
    let service: FoodsService;
    let fetchQueue: FetchQueueService;

    beforeAll(() => {
        // Wire the booted Foods layer over a live Drizzle client + pg pool (same construction the
        // NestJS DatabaseModule performs, without pulling @nestjs/testing as a new dependency).
        pool = new Pool({ connectionString: DATABASE_URL });
        const db = drizzle(pool, { schema });
        const repository = new FoodsRepository(db);

        fetchQueue = new FetchQueueService(pool);
        service = new FoodsService(repository, fetchQueue);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    it('returns the food on a cache hit without enqueuing (FR-001/FR-002)', async () => {
        await seedFood(pool, {
            fdc_id: 171688,
            description: 'Apple, raw, granny smith',
            data_type: 'Foundation',
            fetch_status: 'fetched',
            calories: '58',
            protein_g: '0.3',
            fetched_at: new Date(),
        });

        const food = await service.getFood(171688, 'user_1');

        expect(food.fdcId).toBe(171688);
        expect(food.fetchStatus).toBe('fetched');
        expect(food.nutrients.calories).toBe(58);

        const queue = await pool.query('SELECT * FROM fetch_queue');
        expect(queue.rowCount).toBe(0);
    });

    it('throws FoodNotFoundError (404) for a tombstone within TTL, no queue row (FR-005/FR-025)', async () => {
        await seedFood(pool, {
            fdc_id: 999999,
            fetch_status: 'not_found',
            updated_at: new Date(),
        });

        await expect(service.getFood(999999, 'user_1')).rejects.toSatisfy(isFoodNotFoundError);

        const queue = await pool.query('SELECT * FROM fetch_queue');
        expect(queue.rowCount).toBe(0);
    });

    it('enqueues one fetch_queue + fetch_requesters row on a miss and throws pending (FR-003/FR-014)', async () => {
        await expect(service.getFood(424242, 'user_1')).rejects.toSatisfy(isFoodPendingError);

        const queue = await pool.query('SELECT * FROM fetch_queue WHERE fdc_id = $1', ['424242']);
        expect(queue.rowCount).toBe(1);
        expect(queue.rows[0].status).toBe('pending');

        const requesters = await pool.query('SELECT * FROM fetch_requesters WHERE fdc_id = $1', ['424242']);
        expect(requesters.rowCount).toBe(1);
        expect(requesters.rows[0].sub).toBe('user_1');
    });

    it('dedupes concurrent enqueues for one id to exactly one queue row (FR-014)', async () => {
        await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                fetchQueue.publishFoodRequested({
                    fdcId: 555000,
                    requestedAt: new Date().toISOString(),
                    requestedBy: `user_${i}`,
                }),
            ),
        );

        const queue = await pool.query('SELECT * FROM fetch_queue WHERE fdc_id = $1', ['555000']);
        expect(queue.rowCount).toBe(1);

        // request_count reflects distinct requesters (FR-044): 8 distinct subs.
        const requesters = await pool.query('SELECT count(*)::int AS c FROM fetch_requesters WHERE fdc_id = $1', [
            '555000',
        ]);
        expect(requesters.rows[0].c).toBe(8);
        expect(queue.rows[0].request_count).toBe(8);
    });

    it('serves stale data as 200 + stale:true and enqueues a background re-fetch (FR-031)', async () => {
        await seedFood(pool, {
            fdc_id: 171688,
            description: 'Apple, raw, granny smith',
            fetch_status: 'fetched',
            calories: '58',
            fetched_at: new Date(Date.now() - 40 * DAY_MS),
        });

        const food = await service.getFood(171688, 'user_1');

        expect(food.fetchStatus).toBe('stale');
        expect(food.stale).toBe(true);

        const queue = await pool.query('SELECT * FROM fetch_queue WHERE fdc_id = $1', ['171688']);
        expect(queue.rowCount).toBe(1);
    });

    it('returns ranked FTS results and never touches USDA (FR-008/FR-009/FR-010)', async () => {
        await seedFood(pool, { fdc_id: 1, description: 'Chicken breast, raw', fetch_status: 'fetched' });
        await seedFood(pool, { fdc_id: 2, description: 'Chicken thigh, raw', fetch_status: 'fetched' });
        await seedFood(pool, { fdc_id: 3, description: 'Beef steak', fetch_status: 'fetched' });

        const result = await service.search('chicken breast');

        expect(result.foods.length).toBeGreaterThanOrEqual(1);
        expect(result.foods.map((f) => f.description)).toContain('Chicken breast, raw');
        expect(result.foods.map((f) => f.description)).not.toContain('Beef steak');
    });

    it('finds an avocado for the misspelled query "avacado" via trigram fuzzy fallback (FR-008)', async () => {
        await seedFood(pool, { fdc_id: 10, description: 'Avocado, raw', fetch_status: 'fetched' });
        await seedFood(pool, { fdc_id: 11, description: 'Banana, raw', fetch_status: 'fetched' });

        const result = await service.search('avacado');

        expect(result.foods.map((f) => f.description)).toContain('Avocado, raw');
    });

    it('returns an empty result set for a no-match query without calling USDA (FR-009)', async () => {
        await seedFood(pool, { fdc_id: 20, description: 'Apple, raw', fetch_status: 'fetched' });

        const result = await service.search('zzzznonexistentfood');

        expect(result.foods).toEqual([]);
    });
});
