/**
 * `FetchQueueDao` (T-109, MOD-003) — the demand-weighted Postgres-as-queue, one row per food `id`.
 * `enqueue` is idempotent (`INSERT … ON CONFLICT (food_id)`) and sets `request_count` to the live
 * distinct-`sub` count from `fetch_requesters` (never a raw `+1`, FR-044/DSN-3). `leaseNext` claims
 * the highest-demand eligible row under a `leased_at` lease (`FOR UPDATE SKIP LOCKED`, with live
 * drain-time demotion), reclaiming a stale `in_flight` row WITHOUT touching `attempts` (DSN-5);
 * `reapExpiredLeases` reverts orphaned leases (FR-018). `resolve`/`tombstone` remove the row from the
 * pending set and prune its requester rows (DSN-10); `reactivate` revives a tombstone to `pending`.
 *
 * @implements FR-014 FR-015 FR-018 FR-043 FR-044
 */
import { eq, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { fetchQueue, type FetchQueueRow } from '../../db/schema/index.js';

/** Default worker lease window in seconds (REQ-017). */
const DEFAULT_LEASE_SECONDS = 30;

/** Per-`sub` pending-threshold above which a requester is over-demand (REQ-043, drain-time demotion). */
const DEMOTION_PENDING_THRESHOLD = 50;

export class FetchQueueDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Read the queue row for a food.
     *
     * @param foodId - Internal food id.
     * @returns The queue row, or `undefined` when the food is not queued.
     * @sideEffect Reads `fetch_queue`.
     */
    public async getByFoodId(foodId: string): Promise<FetchQueueRow | undefined> {
        const rows = await this.db.select().from(fetchQueue).where(eq(fetchQueue.foodId, foodId)).limit(1);

        return rows[0];
    }

    /**
     * Idempotently enqueue a food (`INSERT … ON CONFLICT (food_id)`), setting `request_count` to the
     * live distinct-requester count from `fetch_requesters` on BOTH the insert and the (still-`pending`)
     * conflict path — never a raw `+1` (FR-014/FR-044/DSN-3). A non-`pending` (in_flight/tombstone)
     * row is left untouched; use {@link reactivate} to revive a tombstone.
     *
     * @param foodId - Internal food id (the dedup target).
     * @returns The current queue row.
     * @sideEffect Inserts or updates `fetch_queue`.
     */
    public async enqueue(foodId: string): Promise<FetchQueueRow> {
        await this.db.execute(sql`
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

        const row = await this.getByFoodId(foodId);

        if (!row) {
            throw new Error('enqueue produced no row');
        }

        return row;
    }

    /**
     * Revive a tombstoned (or otherwise non-`pending`) queue row to `pending`, clearing the
     * failure/lease bookkeeping and refreshing `request_count` (DSN-1/FR-028a). Inserts a fresh row
     * only if none exists.
     *
     * @param foodId - Internal food id.
     * @returns The revived queue row.
     * @sideEffect Updates or inserts `fetch_queue`.
     */
    public async reactivate(foodId: string): Promise<FetchQueueRow> {
        const updated = await this.db.execute(sql`
            UPDATE fetch_queue SET
                status = 'pending', attempts = 0, leased_at = NULL, last_error = NULL, last_requested = now(),
                request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id = ${foodId})
            WHERE food_id = ${foodId}
        `);

        if ((updated.rowCount ?? 0) === 0) {
            await this.db.execute(sql`
                INSERT INTO fetch_queue (food_id, request_count, first_requested, last_requested, status)
                VALUES (
                    ${foodId},
                    (SELECT count(*) FROM fetch_requesters WHERE food_id = ${foodId}),
                    now(), now(), 'pending'
                )
            `);
        }

        const row = await this.getByFoodId(foodId);

        if (!row) {
            throw new Error('reactivate produced no row');
        }

        return row;
    }

    /**
     * Claim the next eligible row, highest-demand first, under a lease stamped on `leased_at`
     * (`status='in_flight'`, FR-015/FR-017). Eligible = a `pending` row whose `last_requested <= now()`
     * OR an `in_flight` row whose lease lapsed (reaper-on-claim, FR-018). Ordering is the live
     * drain-time demotion (a food sorts back only when ALL its requesters exceed the pending threshold,
     * REQ-043) then `request_count DESC, first_requested ASC`. `FOR UPDATE SKIP LOCKED` keeps concurrent
     * drains off the same row; a reclaim does NOT consume the failure budget (`attempts` untouched, DSN-5).
     *
     * @param leaseSeconds - Lease window in seconds (default 30).
     * @returns The leased row, or `undefined` when nothing is eligible.
     * @sideEffect Updates `fetch_queue` (status/leased_at).
     */
    public async leaseNext(leaseSeconds: number = DEFAULT_LEASE_SECONDS): Promise<FetchQueueRow | undefined> {
        const result = await this.db.execute<{ food_id: string }>(sql`
            UPDATE fetch_queue
            SET status = 'in_flight', leased_at = now()
            WHERE food_id = (
                SELECT q.food_id FROM fetch_queue q
                WHERE (q.status = 'pending' AND q.last_requested <= now())
                   OR (q.status = 'in_flight' AND q.leased_at < now() - make_interval(secs => ${leaseSeconds}))
                ORDER BY
                    (CASE WHEN NOT EXISTS (
                        SELECT 1 FROM fetch_requesters r
                        WHERE r.food_id = q.food_id
                          AND (
                              SELECT count(*) FROM fetch_queue fq JOIN fetch_requesters fr USING (food_id)
                              WHERE fr.sub = r.sub AND fq.status IN ('pending', 'in_flight')
                          ) <= ${DEMOTION_PENDING_THRESHOLD}
                    ) THEN 1 ELSE 0 END) ASC,
                    q.request_count DESC, q.first_requested ASC
                LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            RETURNING food_id
        `);

        const leasedId = result.rows[0]?.food_id;

        if (!leasedId) {
            return undefined;
        }

        return this.getByFoodId(leasedId);
    }

    /**
     * Revert orphaned `in_flight` rows whose lease has lapsed back to `pending` (the reaper, FR-018).
     * Does NOT touch `attempts` — a reclaim is not a failure (DSN-5).
     *
     * @param leaseSeconds - Lease window in seconds (default 30).
     * @returns The number of reclaimed rows.
     * @sideEffect Updates `fetch_queue`.
     */
    public async reapExpiredLeases(leaseSeconds: number = DEFAULT_LEASE_SECONDS): Promise<number> {
        const result = await this.db.execute(sql`
            UPDATE fetch_queue SET status = 'pending'
            WHERE status = 'in_flight' AND leased_at < now() - make_interval(secs => ${leaseSeconds})
        `);

        return result.rowCount ?? 0;
    }

    /**
     * Count a requester's live pending demand: the `pending` queue rows the `sub` is attached to
     * (FR-043, fairness-by-demotion input).
     *
     * @param sub - The requester sub.
     * @returns The count of `pending` queue rows requested by that sub.
     * @sideEffect Reads `fetch_queue` joined to `fetch_requesters`.
     */
    public async pendingCountForSub(sub: string): Promise<number> {
        const result = await this.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n
              FROM fetch_queue q
              JOIN fetch_requesters r USING (food_id)
             WHERE r.sub = ${sub} AND q.status = 'pending'
        `);

        return result.rows[0]?.n ?? 0;
    }

    /**
     * Acknowledge a `RESOLVED`/`UNRESOLVED` food: remove its queue row AND prune its requester rows
     * so `fetch_requesters` does not grow unbounded after the food leaves the queue (DSN-10).
     *
     * @param foodId - Internal food id.
     * @sideEffect Deletes from `fetch_requesters` and `fetch_queue` (one transaction).
     */
    public async resolve(foodId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            await tx.execute(sql`DELETE FROM fetch_requesters WHERE food_id = ${foodId}`);
            await tx.execute(sql`DELETE FROM fetch_queue WHERE food_id = ${foodId}`);
        });
    }

    /**
     * Tombstone an exhausted/`NOT_FOUND` food (`status='tombstone'`, the DLQ analog + audit trail,
     * FR-016/FR-025) and prune its requester rows (DSN-10).
     *
     * @param foodId - Internal food id.
     * @param lastError - Optional terminal error detail recorded on the row.
     * @sideEffect Deletes from `fetch_requesters`; updates `fetch_queue` (one transaction).
     */
    public async tombstone(foodId: string, lastError?: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            await tx.execute(sql`DELETE FROM fetch_requesters WHERE food_id = ${foodId}`);
            await tx.execute(sql`
                UPDATE fetch_queue SET status = 'tombstone', last_error = ${lastError ?? null}
                WHERE food_id = ${foodId}
            `);
        });
    }
}
