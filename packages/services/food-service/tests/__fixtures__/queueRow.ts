/**
 * Queue a food for a drain suite: a `pending` `fetch_queue` row whose `request_count` is the food's live
 * distinct-requester count, inserted or (while still `pending`) refreshed, with no requester recorded.
 *
 * ⛔ A TEST ARRANGEMENT, NOT A WRITER. Production queues through `EnqueueEmitter` alone, which records the requester
 * and refuses a seed-owned food in the same transaction (`tests/e2e/enqueueEmitter.e2e.test.ts` pins its rules).
 * The suites that call this are about what the DRAIN does with a row — lease order, demotion, reaping, settling — and
 * arrange their requesters themselves, so a fixture that recorded one would move every count they assert.
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../src/database/database.module.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import type { FetchQueueRow } from '../../src/db/schema/index.js';

/**
 * Insert or refresh the queue row for one food.
 *
 * @param db - The food-schema Drizzle client the suite holds.
 * @param foodId - The food to queue.
 * @returns The queue row as it now stands.
 * @throws {Error} when no row exists afterwards.
 * @sideEffect Inserts or updates `fetch_queue`.
 */
export async function makeQueueRow(db: FoodDrizzle, foodId: string): Promise<FetchQueueRow> {
    await db.execute(sql`
        INSERT INTO fetch_queue (food_id, request_count, first_requested, last_requested, status)
        VALUES (
            ${foodId},
            (SELECT count(*) FROM fetch_requesters WHERE food_id = ${foodId}),
            now(), now(), 'pending'
        )
        ON CONFLICT (food_id) DO UPDATE SET
            request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id = ${foodId}),
            last_requested = now()
        WHERE fetch_queue.status = 'pending'
    `);

    const row = await new FetchQueueDao(db).getByFoodId(foodId);

    if (!row) {
        throw new Error(`makeQueueRow left no queue row for ${foodId}`);
    }

    return row;
}
