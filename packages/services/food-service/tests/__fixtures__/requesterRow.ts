/**
 * Record that a requester asked for a food, for a suite that arranges the queue itself, and count a food's requesters.
 *
 * ⛔ A TEST ARRANGEMENT, NOT A WRITER. Production records a requester through `EnqueueEmitter` alone, in the
 * transaction that queues the food; `tests/e2e/enqueueEmitter.e2e.test.ts` pins its rules. The insert is plain, so a
 * suite that records one pair twice fails on the primary key instead of leaning on a conflict clause.
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../src/database/database.module.js';
import { fetchRequesters } from '../../src/db/schema/index.js';

/** One `fetch_requesters` row. */
export interface RequesterRow {
    /** The food asked for. */
    readonly foodId: string;
    /** Who asked: an app-user ULID or an allowlisted `svc_*` id. */
    readonly requesterId: string;
}

/**
 * Insert one requester row.
 *
 * @param db - The food-schema Drizzle client the suite holds.
 * @param row - The food and the requester.
 * @sideEffect Inserts into `fetch_requesters`.
 */
export async function makeRequesterRow(db: FoodDrizzle, row: RequesterRow): Promise<void> {
    await db.insert(fetchRequesters).values({ foodId: row.foodId, requesterId: row.requesterId });
}

/**
 * Count a food's requester rows.
 *
 * @param db - The food-schema Drizzle client the suite holds.
 * @param foodId - The food.
 * @returns How many requesters the food has.
 * @sideEffect Reads `fetch_requesters`.
 */
export async function countRequesterRows(db: FoodDrizzle, foodId: string): Promise<number> {
    const result = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM fetch_requesters WHERE food_id = ${foodId}`,
    );

    return result.rows[0]?.n ?? 0;
}
