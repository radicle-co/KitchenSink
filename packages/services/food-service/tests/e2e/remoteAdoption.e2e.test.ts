/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): the adoption write on a real Postgres (ADR-0055 point 10, review
 * ruling 9). Adopting a remote item makes one live root that owns the item, under a transaction lock per item, with
 * the crosswalk claimed `ON CONFLICT` on `food_sources_source_key_unique`:
 *
 * - concurrent adopts of one item, from two pools standing in for two tasks, make one root and one crosswalk row;
 * - an item another writer crosswalked first (the worker's add-by-name, which takes no adoption lock) makes no root;
 * - a name a live catalog root already carries makes no second root (the catalog's name is unique among live roots);
 * - the root the write makes is resolved, carries the adopted name, and its golden record cites the item.
 *
 * The store connects as `food_app`, the role a deployed task holds.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema/index.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import { isLeaseLostError, leaseFenceFrom } from '../../src/foods/dao/leaseFence.js';
import { RemoteAdoptionDao, type AdoptionWriteInput } from '../../src/foods/dao/remoteAdoption.dao.js';
import { normalizeName } from '../../src/foods/foodName.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { makeMergeCandidate } from '../../src/foods/merge/__fixtures__/merge.fixtures.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { makeCatalogFood, makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { makeQueueRow } from '../__fixtures__/queueRow.js';
import { StubSourceAdapter } from '../support/StubSourceAdapter.js';
import { foodDb } from '../support/roleDb.js';

/** One task's connection: its own pool and its own store over it. */
interface Task {
    readonly pool: pg.Pool;
    readonly adoption: RemoteAdoptionDao;
}

/**
 * Open one task's pool as `food_app`.
 *
 * @returns The task.
 * @sideEffect Opens a pool.
 */
function openTask(): Task {
    const pool = new pg.Pool({ connectionString: foodDb().appUrl, max: 4 });

    return { pool, adoption: new RemoteAdoptionDao(drizzle(pool, { schema })) };
}

/** The merge engine the API composes, over a registry holding a USDA adapter. */
const ENGINE = (() => {
    const registry = new SourceAdapterRegistry();

    registry.register(new StubSourceAdapter());

    return new GoldenRecordMergeEngine(registry);
})();

/**
 * The input that adopts USDA item `externalKey` under `name`, persisting the item as the merge writer does.
 *
 * @param externalKey - The item.
 * @param name - The root's name.
 * @returns The input.
 */
function adoptionOf(
    externalKey: string,
    name = 'Kale chips, baked',
    lease: AdoptionWriteInput['lease'] = undefined,
): AdoptionWriteInput {
    const candidate = makeMergeCandidate('usda', { externalKey, name });

    return {
        source: 'usda',
        externalKey,
        name,
        normalizedName: normalizeName(name),
        lease,
        persistRoot: async (writer, foodId) => {
            await new MergeAndPersistService(writer, ENGINE).resolveFromPicks({ foodId, picks: [candidate] });
        },
    };
}

/**
 * How many of this role's backends wait on a lock.
 *
 * @param pool - A pool connected as the role.
 * @returns The count.
 * @sideEffect Reads `pg_stat_activity`.
 */
async function waitingOnLocks(pool: pg.Pool): Promise<number> {
    const waiting = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND usename = current_user",
    );

    return waiting.rows[0]?.n ?? 0;
}

/**
 * The live roots and the crosswalk rows for one item.
 *
 * @param externalKey - The item.
 * @returns The roots that own it, and the count of its crosswalk rows.
 * @sideEffect Reads `food` and `food_sources`.
 */
async function ownersOf(
    externalKey: string,
): Promise<{ roots: { id: string; name: string; status: string }[]; rows: number }> {
    return foodDb().asOwner(async (client) => {
        const roots = await client.query<{ id: string; name: string; status: string }>(
            `SELECT f.id, f.name, f.status::text AS status FROM food f
               JOIN food_sources fs ON fs.item_id = f.item_id
              WHERE fs.source = 'usda' AND fs.external_key = $1`,
            [externalKey],
        );
        const rows = await client.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM food_sources WHERE source = 'usda' AND external_key = $1",
            [externalKey],
        );

        return { roots: roots.rows, rows: rows.rows[0]?.n ?? 0 };
    });
}

describe('RemoteAdoptionDao', () => {
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

    it('makes one resolved root that owns the item, under the adopted name, its golden record citing the item', async () => {
        const write = await first.adoption.adopt(adoptionOf('900001'));

        expect(write.kind).toBe('created');

        const owners = await ownersOf('900001');

        expect(owners).toStrictEqual({
            roots: [{ id: write.kind === 'created' ? write.id : '', name: 'Kale chips, baked', status: 'RESOLVED' }],
            rows: 1,
        });

        const cited = await foodDb().asOwner((client) =>
            client.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM food_nutrition_citation c
                   JOIN food_nutrition h ON h.id = c.nutrition_id
                  WHERE h.food_id = $1 AND c.external_key = '900001'`,
                [write.kind === 'created' ? write.id : ''],
            ),
        );

        expect(cited.rows[0]?.n).toBe(1);
    });

    it('⛔ makes one root for concurrent adopts of one item from two tasks, and answers the others as crosswalked', async () => {
        const writes = await Promise.all(
            Array.from({ length: 8 }, async (_, index) =>
                (index % 2 === 0 ? first : second).adoption.adopt(adoptionOf('900002')),
            ),
        );

        expect(writes.filter((write) => write.kind === 'created')).toHaveLength(1);
        expect(writes.filter((write) => write.kind === 'crosswalked')).toHaveLength(7);

        const owners = await ownersOf('900002');

        expect(owners.roots).toHaveLength(1);
        expect(owners.rows).toBe(1);
    });

    it('makes no root for an item another writer crosswalked first, and leaves that writer’s row alone', async () => {
        const worker = await makeCatalogFood(first.pool, { name: 'kale chips' });

        await first.pool.query(
            `INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('fs-worker', $1, 'usda', '900003')`,
            [worker.itemId],
        );

        await expect(first.adoption.adopt(adoptionOf('900003', 'Kale chips, oven'))).resolves.toStrictEqual({
            kind: 'crosswalked',
        });
        expect((await ownersOf('900003')).roots.map((root) => root.id)).toStrictEqual([worker.id]);
    });

    it('⛔ makes no root, and leaves none behind, when a writer outside the lock claims the item mid-adopt', async () => {
        const worker = await makeCatalogFood(first.pool, { name: 'kale chips' });
        const competitor = await first.pool.connect();

        try {
            // The worker's crosswalk, written and not yet committed: the adopt's read under its lock cannot see it,
            // so its claim waits on the row and then conflicts.
            await competitor.query('BEGIN');
            await competitor.query(
                `INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('fs-race', $1, 'usda', '900006')`,
                [worker.itemId],
            );

            const adopting = second.adoption.adopt(adoptionOf('900006'));

            await expect
                .poll(async () => {
                    const waiting = await first.pool.query<{ n: number }>(
                        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'",
                    );

                    return waiting.rows[0]?.n ?? 0;
                })
                .toBeGreaterThan(0);
            await competitor.query('COMMIT');

            await expect(adopting).resolves.toStrictEqual({ kind: 'crosswalked' });
        } finally {
            competitor.release();
        }

        expect((await ownersOf('900006')).roots.map((root) => root.id)).toStrictEqual([worker.id]);
        await expect(first.adoption.liveCatalogRootNamed('kale chips, baked')).resolves.toBeUndefined();
    });

    it('makes no second root for a name a live catalog root carries, and answers that root', async () => {
        const named = await makeCatalogFood(first.pool, { name: 'Kale chips, baked' });

        await expect(first.adoption.adopt(adoptionOf('900004'))).resolves.toStrictEqual({
            kind: 'named',
            id: named.id,
        });
        expect(await ownersOf('900004')).toStrictEqual({ roots: [], rows: 0 });
    });

    it('reads the live catalog root carrying a name, and nothing for a retired or authored one', async () => {
        const live = await makeCatalogFood(first.pool, { name: 'kale chips' });

        await makeCatalogFood(first.pool, { name: 'kale crisps', userId: '01JAUTHOR00000000000000000' });

        // The status comes back with the id, because only a root holding a record answers a pick by name.
        await expect(first.adoption.liveCatalogRootNamed('kale chips')).resolves.toStrictEqual({
            id: live.id,
            status: 'RESOLVED',
        });
        await expect(first.adoption.liveCatalogRootNamed('kale crisps')).resolves.toBeUndefined();
        await expect(first.adoption.liveCatalogRootNamed('kale')).resolves.toBeUndefined();
    });

    it('leaves nothing behind when the record cannot be written', async () => {
        const failing: AdoptionWriteInput = {
            ...adoptionOf('900005'),
            persistRoot: async () => {
                throw new Error('merge failed');
            },
        };

        await expect(first.adoption.adopt(failing)).rejects.toThrow('merge failed');
        expect(await ownersOf('900005')).toStrictEqual({ roots: [], rows: 0 });
        await expect(first.adoption.liveCatalogRootNamed('kale chips, baked')).resolves.toBeUndefined();
    });
});

/**
 * A placeholder catalog root carrying the picked name, as add-by-name leaves one: no record, a queue row and a
 * requester (ADR-0055 point 10, the lead's ruling on S7.6). The pick completes it rather than answering it.
 */
describe('RemoteAdoptionDao — a placeholder root that carries the name', () => {
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
     * A queue over this task's connection.
     *
     * @returns The queue.
     */
    function queue(): FetchQueueDao {
        return new FetchQueueDao(drizzle(task.pool, { schema }));
    }

    /**
     * A catalog root in `status` carrying the picked name, with a requester, and a queue row unless told otherwise.
     *
     * @param status - The root's status.
     * @param queueStatus - The queue row's status, or `none` for no row.
     * @returns The root's ids.
     */
    async function placeholder(
        status: string,
        queueStatus: 'pending' | 'tombstone' | 'none' = 'pending',
    ): Promise<{ readonly id: string; readonly itemId: string }> {
        const root = await makeCatalogFood(task.pool, { name: 'Kale chips, baked', status });

        await task.pool.query('INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, $2)', [
            root.id,
            '01JCOOK0000000000000000000',
        ]);

        if (queueStatus !== 'none') {
            await makeQueueRow(drizzle(task.pool, { schema }), root.id);
            await task.pool.query('UPDATE fetch_queue SET status = $2 WHERE food_id = $1', [root.id, queueStatus]);
        }

        return root;
    }

    /**
     * The root's status, its source rows, its queue row, its requesters and its candidates.
     *
     * @param id - The root.
     * @returns What remains.
     */
    async function left(id: string): Promise<{
        status: string;
        sources: string[];
        queued: number;
        requesters: number;
        candidates: number;
    }> {
        return foodDb().asOwner(async (client) => {
            const read = await client.query<{
                status: string;
                sources: string[];
                queued: number;
                requesters: number;
                candidates: number;
            }>(
                `SELECT f.status::text AS status,
                        coalesce((SELECT array_agg(fs.external_key ORDER BY fs.external_key) FROM food_sources fs
                                   WHERE fs.item_id = f.item_id), '{}') AS sources,
                        (SELECT count(*)::int FROM fetch_queue WHERE food_id = f.id) AS queued,
                        (SELECT count(*)::int FROM fetch_requesters WHERE food_id = f.id) AS requesters,
                        (SELECT count(*)::int FROM food_candidates WHERE food_id = f.id) AS candidates
                   FROM food f WHERE f.id = $1`,
                [id],
            );
            const row = read.rows[0];

            if (row === undefined) {
                throw new Error(`no root ${id}`);
            }

            return row;
        });
    }

    it('leases a queued root’s row for the pick, so a drain then claims nothing', async () => {
        const root = await placeholder('PENDING');

        const lease = await queue().leaseFood(root.id);

        expect(lease.kind).toBe('leased');
        expect((await queue().getByFoodId(root.id))?.status).toBe('in_flight');
        await expect(queue().leaseNext()).resolves.toBeUndefined();
    });

    it('leases a row its retry back-off holds off the drain, because a cook is waiting', async () => {
        const root = await placeholder('AWAITING_RETRY');

        await task.pool.query(
            "UPDATE fetch_queue SET last_requested = now() + interval '10 minutes' WHERE food_id = $1",
            [root.id],
        );

        await expect(queue().leaseFood(root.id)).resolves.toMatchObject({ kind: 'leased' });
    });

    it('answers a row a drain holds as draining, and leaves the drain’s claim alone', async () => {
        const root = await placeholder('PENDING');
        const drain = await queue().leaseNext();

        await expect(queue().leaseFood(root.id)).resolves.toStrictEqual({ kind: 'draining' });
        expect((await queue().getByFoodId(root.id))?.leasedAt?.getTime()).toBe(drain?.leasedAt?.getTime());
    });

    it('takes over a drain’s claim whose lease lapsed, as the reaper would', async () => {
        const root = await placeholder('PENDING');

        await queue().leaseNext();
        await task.pool.query("UPDATE fetch_queue SET leased_at = now() - interval '1 day' WHERE food_id = $1", [
            root.id,
        ]);

        await expect(queue().leaseFood(root.id)).resolves.toMatchObject({ kind: 'leased' });
    });

    it.each<['tombstone' | 'none', string]>([
        ['tombstone', 'a tombstoned row, which no drain takes'],
        ['none', 'no row at all'],
    ])('answers %s (%s) as idle', async (queueStatus) => {
        const root = await placeholder('NOT_FOUND', queueStatus);

        await expect(queue().leaseFood(root.id)).resolves.toStrictEqual({ kind: 'idle' });
    });

    it('⛔ completes a pending root with the picked item: one source, resolved, its queue and requester rows settled', async () => {
        const root = await placeholder('PENDING');
        const lease = await queue().leaseFood(root.id);

        if (lease.kind !== 'leased') {
            throw new Error('expected a lease');
        }

        await expect(
            task.adoption.adopt(adoptionOf('900010', 'Kale chips, baked', { rootId: root.id, fence: lease.fence })),
        ).resolves.toStrictEqual({ kind: 'completed', id: root.id });
        expect(await left(root.id)).toStrictEqual({
            status: 'RESOLVED',
            sources: ['900010'],
            queued: 0,
            requesters: 0,
            candidates: 0,
        });
    });

    it.each(['NOT_FOUND', 'FAILED'])(
        'reactivates a %s root and completes it, its tombstoned row settled',
        async (status) => {
            const root = await placeholder(status, 'tombstone');

            await expect(task.adoption.adopt(adoptionOf('900011'))).resolves.toStrictEqual({
                kind: 'completed',
                id: root.id,
            });
            expect(await left(root.id)).toMatchObject({
                status: 'RESOLVED',
                sources: ['900011'],
                queued: 0,
                requesters: 0,
            });
        },
    );

    it('completes a root awaiting disambiguation, clearing its candidates', async () => {
        const root = await placeholder('UNRESOLVED', 'none');

        await task.pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name) VALUES ('c-1', $1, 'usda', '1', 'Kale')`,
            [root.id],
        );

        await expect(task.adoption.adopt(adoptionOf('900012'))).resolves.toStrictEqual({
            kind: 'completed',
            id: root.id,
        });
        expect(await left(root.id)).toMatchObject({ status: 'RESOLVED', sources: ['900012'], candidates: 0 });
    });

    it('⛔ writes nothing for a placeholder a drain is fetching for, when the pick holds no lease on it', async () => {
        const root = await placeholder('PENDING');

        await queue().leaseNext();

        await expect(task.adoption.adopt(adoptionOf('900013'))).resolves.toStrictEqual({ kind: 'draining' });
        expect(await left(root.id)).toMatchObject({ status: 'PENDING', sources: [], queued: 1 });
    });

    it('writes nothing when the pick’s lease was lost before it settled', async () => {
        const root = await placeholder('PENDING');
        const stale = { rootId: root.id, fence: leaseFenceFrom('2000-01-01 00:00:00+00') };

        await queue().leaseFood(root.id);

        await expect(task.adoption.adopt(adoptionOf('900014', 'Kale chips, baked', stale))).rejects.toSatisfy(
            isLeaseLostError,
        );
        expect(await left(root.id)).toMatchObject({ status: 'PENDING', sources: [] });
    });

    it('⛔ answers a placeholder another writer resolved while the pick waited on it, and writes nothing', async () => {
        // A cook's PATCH resolve takes no name lock: the pick must read the root's status under the root's row lock.
        const root = await placeholder('UNRESOLVED', 'none');
        const resolver = await task.pool.connect();

        try {
            await resolver.query('BEGIN');
            await resolver.query("UPDATE food SET status = 'RESOLVED' WHERE id = $1", [root.id]);

            const write = task.adoption.adopt(adoptionOf('900016'));

            await expect.poll(async () => (await waitingOnLocks(task.pool)) > 0).toBe(true);
            await resolver.query('COMMIT');

            await expect(write).resolves.toStrictEqual({ kind: 'named', id: root.id });
        } finally {
            resolver.release();
        }

        expect(await left(root.id)).toMatchObject({ status: 'RESOLVED', sources: [] });
    });

    it('never matches a retired root, whose name is free: the pick makes a new root', async () => {
        // A seed root may retire with no forward; a live one may not (0018's `food_retire_forwarded`).
        const retired = await makeSeededRoot(foodDb(), { name: 'Kale chips, baked', retired: true });

        const write = await task.adoption.adopt(adoptionOf('900015'));

        expect(write.kind).toBe('created');
        expect(write.kind === 'created' && write.id).not.toBe(retired.id);
    });
});
