/**
 * `FetchRequestersDao` (T-109, MOD-003) — the distinct-requester demand set. The
 * `PK(food_id, requester_id)` structurally caps each requester to one row per food (`PRIORITY_CAP=1`),
 * so `add` is idempotent and `request_count` (computed by `FetchQueueDao.enqueue`) is the UNCAPPED
 * distinct-requester count — never a raw `+1` (FR-044/DSN-3). Rows are pruned when the food leaves the
 * queue (DSN-10).
 *
 * **CR-002/U1 (R5).** `requester_id` is the app-user ULID (user) or an allowlisted `svc_*` (service),
 * NOT the Clerk `sub`. Opaque, no FK.
 *
 * @implements FR-043 FR-044 R5
 */
import { eq, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { fetchRequesters } from '../../db/schema/index.js';

/** Input for {@link FetchRequestersDao.add}. */
export interface AddRequesterInput {
    /** Internal food id. */
    foodId: string;
    /** The requester key — an app-user ULID (user) or an allowlisted `svc_*` id (service). */
    requesterId: string;
}

export class FetchRequestersDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Record a distinct requester for a food (idempotent via `PK(food_id, requester_id)`): a
     * requester's repeats collapse to one row, so it cannot inflate priority (FR-044).
     *
     * @param input - The food id and requester id.
     * @sideEffect Inserts into `fetch_requesters` (no-op on duplicate).
     */
    public async add(input: AddRequesterInput): Promise<void> {
        await this.db
            .insert(fetchRequesters)
            .values({ foodId: input.foodId, requesterId: input.requesterId })
            .onConflictDoNothing({ target: [fetchRequesters.foodId, fetchRequesters.requesterId] });
    }

    /**
     * Count the distinct requesters for a food (the demand weight).
     *
     * @param foodId - Internal food id.
     * @returns The distinct-requester count.
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
     * Erase every requester row recorded for a requester across all foods (user-erasure, T-056/FR-043/
     * FR-044). `fetch_requesters` is the ONLY per-user data this service stores (there are deliberately
     * no `user_fetch_quota`/`global_fetch_quota` tables), so deleting a deleted user's rows here fully
     * removes their footprint; foods stay shared reference data and the surviving requesters keep their
     * demand weight. Idempotent (a re-run deletes nothing).
     *
     * @param requesterId - The requester key to erase (CR-002/U1: the app-user ULID, not the Clerk `sub`).
     * @returns The number of erased rows.
     * @sideEffect Deletes from `fetch_requesters`.
     */
    public async deleteForRequester(requesterId: string): Promise<number> {
        const result = await this.db.delete(fetchRequesters).where(eq(fetchRequesters.requesterId, requesterId));

        return result.rowCount ?? 0;
    }
}
