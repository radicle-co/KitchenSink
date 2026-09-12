/**
 * LOCAL e2e — {@link EnqueueEmitter}, the ONE writer of `fetch_queue`, against a REAL PostgreSQL as `food_app`
 * (ADR-0039). Target: LOCAL (§7.1a).
 *
 * The queue rules it holds: `request_count` is the live DISTINCT-requester count, never a raw `+1` (FR-044/DSN-3);
 * the publish is idempotent on `food_id`; a normal publish leaves a non-`pending` row alone (FR-014); and a
 * reactivating publish revives a tombstone to `pending` with its failure and lease bookkeeping cleared (DSN-1,
 * FR-028a). Its seed-owned refusal is `src/foods/__tests__/enqueue.emitter.test.ts`'s.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EnqueueEmitter } from '../../src/foods/enqueue.emitter.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { foodDb } from '../support/roleDb.js';

/** The queue columns these rules are about. */
interface QueueRow {
    readonly status: string;
    readonly request_count: number;
    readonly attempts: number;
    readonly last_error: string | null;
    readonly leased_at: Date | null;
}

describe('EnqueueEmitter — the fetch_queue writer, LOCAL e2e', () => {
    let pool: pg.Pool;
    let emitter: EnqueueEmitter;

    /** Every queue row for a food (the idempotency rules count them). */
    async function queueRows(foodId: string): Promise<QueueRow[]> {
        const { rows } = await pool.query<QueueRow>(
            'SELECT status, request_count, attempts, last_error, leased_at FROM fetch_queue WHERE food_id = $1',
            [foodId],
        );

        return rows;
    }

    /** A queueable (not seed-owned) food. */
    async function food(): Promise<string> {
        const { id } = await makeCatalogFood(pool, { id: `food-${randomUUID()}`, status: 'PENDING' });

        return id;
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl, max: 2 });
        emitter = new EnqueueEmitter(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('counts ONE requester once however often it asks, in one queue row (FR-044)', async () => {
        const id = await food();

        for (let i = 0; i < 5; i += 1) {
            await emitter.publishFoodRequested({ id, requestedBy: 'user_solo' });
        }

        expect(await queueRows(id)).toMatchObject([{ status: 'pending', request_count: 1 }]);
    });

    it('counts N distinct requesters as N, still in one queue row', async () => {
        const id = await food();

        for (let i = 0; i < 4; i += 1) {
            await emitter.publishFoodRequested({ id, requestedBy: `user_${i}` });
        }

        expect(await queueRows(id)).toMatchObject([{ status: 'pending', request_count: 4 }]);
    });

    it('leaves a tombstoned row alone on a normal publish, so a dead food is not silently revived', async () => {
        const id = await food();
        await emitter.publishFoodRequested({ id, requestedBy: 'user_a' });
        await pool.query(
            `UPDATE fetch_queue SET status = 'tombstone', attempts = 5, last_error = 'source down' WHERE food_id = $1`,
            [id],
        );

        await emitter.publishFoodRequested({ id, requestedBy: 'user_b' });

        expect(await queueRows(id)).toMatchObject([
            { status: 'tombstone', request_count: 1, attempts: 5, last_error: 'source down' },
        ]);
    });

    it('revives a tombstone on a reactivating publish, clearing failure and lease bookkeeping (DSN-1)', async () => {
        const id = await food();
        await emitter.publishFoodRequested({ id, requestedBy: 'user_a' });
        await pool.query(
            `UPDATE fetch_queue SET status = 'tombstone', attempts = 5, last_error = 'source down', leased_at = now()
              WHERE food_id = $1`,
            [id],
        );

        await emitter.publishFoodRequested({ id, requestedBy: 'svc_admin_requeue', reactivate: true });

        expect(await queueRows(id)).toStrictEqual([
            { status: 'pending', request_count: 2, attempts: 0, last_error: null, leased_at: null },
        ]);
    });

    it('inserts a fresh pending row on a reactivating publish when the food has none', async () => {
        const id = await food();

        await emitter.publishFoodRequested({ id, requestedBy: 'svc_admin_requeue', reactivate: true });

        expect(await queueRows(id)).toMatchObject([{ status: 'pending', request_count: 1, attempts: 0 }]);
    });
});
