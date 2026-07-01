/**
 * `FetchRequestersDao` (T-109, MOD-003) — the distinct-requester demand set. The
 * `PK(food_id, sub)` structurally caps each `sub` to one row per food (`PRIORITY_CAP=1` per sub), so
 * `add` is idempotent and `request_count` (computed by {@link FetchQueueDao.enqueue}) is the UNCAPPED
 * distinct-`sub` count — never a raw `+1` (FR-044/DSN-3). Rows are pruned when the food leaves the
 * queue (DSN-10).
 *
 * @implements FR-043 FR-044
 */
import { eq, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { fetchRequesters } from '../../db/schema/index.js';

/** Input for {@link FetchRequestersDao.add}. */
export interface AddRequesterInput {
    /** Internal food id. */
    foodId: string;
    /** Authenticated Clerk `sub` or named service principal. */
    sub: string;
}

export class FetchRequestersDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Record a distinct requester for a food (idempotent via `PK(food_id, sub)`): a `sub`'s repeats
     * collapse to one row, so it cannot inflate priority (FR-044).
     *
     * @param input - The food id and requester sub.
     * @sideEffect Inserts into `fetch_requesters` (no-op on duplicate).
     */
    public async add(input: AddRequesterInput): Promise<void> {
        await this.db
            .insert(fetchRequesters)
            .values({ foodId: input.foodId, sub: input.sub })
            .onConflictDoNothing({ target: [fetchRequesters.foodId, fetchRequesters.sub] });
    }

    /**
     * Count the distinct requesters for a food (the demand weight).
     *
     * @param foodId - Internal food id.
     * @returns The distinct-`sub` count.
     * @sideEffect Reads `fetch_requesters`.
     */
    public async countForFood(foodId: string): Promise<number> {
        const result = await this.db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM fetch_requesters WHERE food_id = ${foodId}`,
        );

        return result.rows[0]?.n ?? 0;
    }

    /**
     * Prune all requester rows for a food (called when it leaves the queue, DSN-10).
     *
     * @param foodId - Internal food id.
     * @returns The number of pruned rows.
     * @sideEffect Deletes from `fetch_requesters`.
     */
    public async deleteForFood(foodId: string): Promise<number> {
        const result = await this.db.delete(fetchRequesters).where(eq(fetchRequesters.foodId, foodId));

        return result.rowCount ?? 0;
    }

    /**
     * Erase every requester row recorded for a `sub` across all foods (user-erasure, T-056/FR-043/
     * FR-044). `fetch_requesters` is the ONLY per-user data this service stores (there are deliberately
     * no `user_fetch_quota`/`global_fetch_quota` tables), so deleting a deleted user's rows here fully
     * removes their footprint; foods stay shared reference data and the surviving requesters keep their
     * demand weight. Idempotent (a re-run deletes nothing).
     *
     * @param sub - The deleted user's Clerk `sub`.
     * @returns The number of erased rows.
     * @sideEffect Deletes from `fetch_requesters`.
     */
    public async deleteForSub(sub: string): Promise<number> {
        const result = await this.db.delete(fetchRequesters).where(eq(fetchRequesters.sub, sub));

        return result.rowCount ?? 0;
    }
}
