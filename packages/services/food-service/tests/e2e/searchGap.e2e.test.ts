/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): the search-gap record on a real Postgres (migration 0022, ADR-0055
 * point 4), the guarantees only a real database can show:
 *
 * - the migration built the table the store writes, with its key and its checks, and no column for a user;
 * - concurrent searches of one gap, from two pools standing in for two tasks, each count exactly once;
 * - a repeat updates the holder and the name as last seen, and keeps when it was first seen;
 * - the prune deletes what was not seen within the retention period, and nothing newer, and the change-refresh run
 *   runs it beside the call ledger's prune;
 * - a root's delete takes its gaps with it.
 *
 * Every store connection is `food_app`, the role a deployed task holds.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema/index.js';
import { CandidateStore } from '../../src/foods/dao/foodCandidates.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { SEARCH_GAP_RETENTION_DAYS, SearchGapDao } from '../../src/foods/dao/searchGap.dao.js';
import type { SearchGap } from '../../src/foods/domain/remoteHitTriage.js';
import { EnqueueEmitter } from '../../src/foods/enqueue.emitter.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { ChangeRefreshConsumer } from '../../src/worker/change-refresh/changeRefresh.consumer.js';
import { SilentWorkerLogger } from '../../src/worker/SilentWorkerLogger.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { foodDb } from '../support/roleDb.js';

/** One task's connection: its own pool and its own store over it. */
interface Task {
    readonly pool: pg.Pool;
    readonly gaps: SearchGapDao;
}

/**
 * Open one task's pool as `food_app`.
 *
 * @returns The task.
 * @sideEffect Opens a pool.
 */
function openTask(): Task {
    const pool = new pg.Pool({ connectionString: foodDb().appUrl, max: 4 });

    return { pool, gaps: new SearchGapDao(drizzle(pool, { schema })) };
}

/**
 * A gap held by `foodId`.
 *
 * @param foodId - The holding root.
 * @param overrides - What a case changes.
 * @returns The gap.
 */
function gapOf(foodId: string, overrides: Partial<SearchGap> = {}): SearchGap {
    return {
        query: 'kale',
        source: 'usda',
        externalKey: '2346405',
        foodId,
        foodVariantId: null,
        remoteName: 'Kale, raw',
        ...overrides,
    };
}

/**
 * Every row, as the owner reads it.
 *
 * @returns The rows, ordered by key.
 * @sideEffect Reads `search_gap`.
 */
async function rows(): Promise<
    { query: string; external_key: string; food_id: string; remote_name: string; occurrences: number }[]
> {
    return foodDb().asOwner(async (client) => {
        const read = await client.query<{
            query: string;
            external_key: string;
            food_id: string;
            remote_name: string;
            occurrences: number;
        }>(
            'SELECT query, external_key, food_id, remote_name, occurrences FROM search_gap ORDER BY query, external_key',
        );

        return read.rows;
    });
}

describe('search_gap — the table migration 0022 built', () => {
    let task: Task;

    beforeAll(() => {
        task = openTask();
    });

    afterAll(async () => {
        await task.pool.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('has exactly the columns of a gap, and none that could hold a user', async () => {
        const columns = await task.pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'search_gap' ORDER BY ordinal_position`,
        );

        expect(columns.rows.map((row) => row.column_name)).toStrictEqual([
            'query',
            'source',
            'external_key',
            'food_id',
            'food_variant_id',
            'remote_name',
            'occurrences',
            'first_seen_at',
            'last_seen_at',
        ]);
    });

    it('keys a gap on its query, source and item', async () => {
        const food = await makeCatalogFood(task.pool);

        await task.pool.query(
            `INSERT INTO search_gap (query, source, external_key, food_id, remote_name)
             VALUES ('kale', 'usda', '1', $1, 'Kale')`,
            [food.id],
        );

        await expect(
            task.pool.query(
                `INSERT INTO search_gap (query, source, external_key, food_id, remote_name)
                 VALUES ('kale', 'usda', '1', $1, 'Kale')`,
                [food.id],
            ),
        ).rejects.toMatchObject({ code: '23505', constraint: 'search_gap_pkey' });
    });

    it.each<[string, string, number]>([
        ['a count below one', 'kale', 0],
        ['an empty query', '', 1],
        ['a query over 200 characters', 'a'.repeat(201), 1],
    ])('refuses %s', async (_label, query, occurrences) => {
        const food = await makeCatalogFood(task.pool);

        await expect(
            task.pool.query(
                `INSERT INTO search_gap (query, source, external_key, food_id, remote_name, occurrences)
                 VALUES ($2, 'usda', '1', $1, 'Kale', $3)`,
                [food.id, query, occurrences],
            ),
        ).rejects.toMatchObject({ code: '23514' });
    });
});

describe('SearchGapDao — counting', () => {
    let first: Task;
    let second: Task;

    beforeAll(() => {
        first = openTask();
        second = openTask();
    });

    afterAll(async () => {
        await Promise.all([first.pool.end(), second.pool.end()]);
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('records a new gap once, then counts each repeat and keeps the holder and the name as last seen', async () => {
        const kale = await makeCatalogFood(first.pool, { name: 'kale' });
        const curly = await makeCatalogFood(first.pool, { name: 'curly kale' });

        await first.gaps.record([gapOf(kale.id)]);
        await first.gaps.record([gapOf(curly.id, { remoteName: 'Kale, curly, raw' })]);

        expect(await rows()).toStrictEqual([
            {
                query: 'kale',
                external_key: '2346405',
                food_id: curly.id,
                remote_name: 'Kale, curly, raw',
                occurrences: 2,
            },
        ]);
    });

    it('keeps when a gap was first seen, and moves when it was last seen', async () => {
        const kale = await makeCatalogFood(first.pool, { name: 'kale' });

        await first.gaps.record([gapOf(kale.id)]);
        await foodDb().asOwner((client) =>
            client.query(
                "UPDATE search_gap SET first_seen_at = now() - interval '2 days', last_seen_at = now() - interval '1 day'",
            ),
        );
        await first.gaps.record([gapOf(kale.id)]);

        const seen = await foodDb().asOwner((client) =>
            client.query<{ first_days: number; last_seconds: number }>(
                `SELECT extract(epoch FROM now() - first_seen_at)::float8 / 86400 AS first_days,
                        extract(epoch FROM now() - last_seen_at)::float8 AS last_seconds
                   FROM search_gap`,
            ),
        );

        expect(seen.rows[0]?.first_days).toBeGreaterThan(1.9);
        expect(seen.rows[0]?.last_seconds).toBeLessThan(60);
    });

    it('⛔ counts every one of concurrent searches of one gap from two tasks, exactly', async () => {
        const kale = await makeCatalogFood(first.pool, { name: 'kale' });
        const searches = 24;

        await Promise.all(
            Array.from({ length: searches }, async (_, index) =>
                (index % 2 === 0 ? first : second).gaps.record([gapOf(kale.id)]),
            ),
        );

        expect((await rows()).map((row) => row.occurrences)).toStrictEqual([searches]);
    });

    it('records a batch of gaps for one answer in one go, one row each', async () => {
        const kale = await makeCatalogFood(first.pool, { name: 'kale' });

        await first.gaps.record([
            gapOf(kale.id),
            gapOf(kale.id, { externalKey: '168421', remoteName: 'Kale, cooked' }),
        ]);

        expect((await rows()).map((row) => [row.external_key, row.occurrences])).toStrictEqual([
            ['168421', 1],
            ['2346405', 1],
        ]);
    });

    it('takes a root’s gaps with it when the root is deleted', async () => {
        const kale = await makeCatalogFood(first.pool, { name: 'kale' });
        const chard = await makeCatalogFood(first.pool, { name: 'chard' });

        await first.gaps.record([gapOf(kale.id), gapOf(chard.id, { query: 'swiss chard' })]);
        await foodDb().asOwner((client) => client.query('DELETE FROM food WHERE id = $1', [kale.id]));

        expect((await rows()).map((row) => row.food_id)).toStrictEqual([chard.id]);
    });
});

describe('SearchGapDao — the prune', () => {
    let task: Task;

    beforeAll(() => {
        task = openTask();
    });

    afterAll(async () => {
        await task.pool.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    /**
     * Two gaps: one last seen just inside the retention period, one just outside it.
     *
     * @returns The holding root's id.
     */
    async function agedAndFresh(): Promise<string> {
        const kale = await makeCatalogFood(task.pool, { name: 'kale' });

        await task.gaps.record([gapOf(kale.id), gapOf(kale.id, { query: 'curly kale' })]);
        await foodDb().asOwner(async (client) => {
            await client.query(
                `UPDATE search_gap SET first_seen_at = now() - make_interval(days => $1::int + 1),
                                       last_seen_at = now() - make_interval(days => $1::int + 1)
                  WHERE query = 'kale'`,
                [SEARCH_GAP_RETENTION_DAYS],
            );
            await client.query(
                `UPDATE search_gap SET first_seen_at = now() - make_interval(days => $1::int - 1),
                                       last_seen_at = now() - make_interval(days => $1::int - 1)
                  WHERE query = 'curly kale'`,
                [SEARCH_GAP_RETENTION_DAYS],
            );
        });

        return kale.id;
    }

    it('deletes what was not seen within the retention period, and nothing seen since', async () => {
        await agedAndFresh();

        await expect(task.gaps.pruneAged()).resolves.toBe(1);
        expect((await rows()).map((row) => row.query)).toStrictEqual(['curly kale']);
    });

    it('runs in every change-refresh pass, beside the call ledger’s prune', async () => {
        await agedAndFresh();

        const db = drizzle(task.pool, { schema });
        const consumer = new ChangeRefreshConsumer({
            sources: new FoodSourcesDao(db),
            candidates: new CandidateStore(db),
            registry: new SourceAdapterRegistry(),
            limiter: { pruneAged: async () => 0 },
            searchGaps: task.gaps,
            enqueue: new EnqueueEmitter(task.pool),
            logger: new SilentWorkerLogger(),
            unresolvedTtlDays: 30,
        });

        await consumer.runOnce();

        expect((await rows()).map((row) => row.query)).toStrictEqual(['curly kale']);
    });
});
