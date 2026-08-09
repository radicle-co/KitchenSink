/**
 * `FetchQueueDao` (T-109, MOD-003) — the demand-weighted Postgres-as-queue, one row per food `id`.
 * `enqueue` is idempotent (`INSERT … ON CONFLICT (food_id)`) and sets `request_count` to the live
 * distinct-requester count from `fetch_requesters` (never a raw `+1`, FR-044/DSN-3). `leaseNext` claims
 * the highest-demand eligible row under a `leased_at` lease (`FOR UPDATE SKIP LOCKED`, with live
 * drain-time demotion), reclaiming a stale `in_flight` row WITHOUT touching `attempts` (DSN-5);
 * `reapExpiredLeases` reverts orphaned leases (FR-018). `resolve`/`tombstone` remove the row from the
 * pending set and prune its requester rows (DSN-10); `reactivate` revives a tombstone to `pending`.
 *
 * The demotion threshold comes from `FOOD_DEMOTE_THRESHOLD` (see {@link FetchQueueDaoOptions}) — the SAME
 * knob the API's near-ceiling flood-shed reads, because the two halves of FR-043 must not disagree.
 *
 * @implements FR-014 FR-015 FR-018 FR-043 FR-044
 */
import { eq, sql } from 'drizzle-orm';

import { settingFromEnv } from '../../config/env.schema.js';
import type { FoodDrizzle } from '../../database/database.module.js';
import { fetchQueue, type FetchQueueRow } from '../../db/schema/index.js';

/** Default worker lease window in seconds (REQ-017). */
const DEFAULT_LEASE_SECONDS = 30;

/** Options for {@link FetchQueueDao}. */
export interface FetchQueueDaoOptions {
    /**
     * Per-requester pending-threshold above which a requester is over-demand (REQ-043, drain-time
     * demotion). Defaults to the configured `FOOD_DEMOTE_THRESHOLD` (50 when unset).
     *
     * The default is resolved HERE rather than left to each composition root on purpose: a caller that
     * forgets to pass the configured value silently falls back to the built-in one, which is exactly how
     * the worker spent a slice of its life ignoring `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` (see the note at
     * `src/worker/main.ts`). The override exists for tests and for any future caller that already holds a
     * validated `Environment`.
     */
    readonly demoteThreshold?: number;
}

export class FetchQueueDao {
    /** The resolved per-requester pending threshold used by {@link leaseNext}'s demotion ranking. */
    private readonly demoteThreshold: number;

    /**
     * @param db - The food-schema Drizzle client.
     * @param options - Optional demotion-threshold override (defaults to `FOOD_DEMOTE_THRESHOLD`).
     */
    public constructor(
        private readonly db: FoodDrizzle,
        options?: FetchQueueDaoOptions,
    ) {
        this.demoteThreshold = options?.demoteThreshold ?? settingFromEnv('FOOD_DEMOTE_THRESHOLD');
    }

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
     * (`status='in_flight'`, FR-015/FR-017). Eligible = a `pending` row whose `last_requested <= now()`,
     * plus any `in_flight` row whose lease lapsed — folded back into the pending set first
     * (reaper-on-claim, FR-018) so it competes on demand like any other pending row, `attempts`
     * untouched (a reclaim is not a failure, DSN-5). Priority is FR-043's live drain-time demotion (a
     * food sorts back only when ALL its requesters exceed the CONFIGURED pending threshold
     * `FOOD_DEMOTE_THRESHOLD`) and then `request_count DESC, first_requested ASC`. The comparison is
     * `<= threshold`, so a requester holding EXACTLY the threshold is still under-demand.
     * `FOR UPDATE SKIP LOCKED` keeps concurrent drains off the same row.
     *
     * ## Why the query is shaped like this (T-197/DSN-11 — do not "simplify" it back)
     *
     * The demotion used to be the LEADING key of the `ORDER BY`, expressed as a correlated `COUNT(*)`
     * over a join. A computed leading sort key must be evaluated for EVERY eligible row before the first
     * row is known, so `LIMIT 1` could not avoid the work and `idx_fetch_queue_priority` — which already
     * indexes exactly `(request_count DESC, first_requested ASC) WHERE status = 'pending'` — was unusable.
     * T-195 measured the consequence at the FR-046 ceiling: a Seq Scan + Sort costing 20.2s and 27.8M
     * buffer hits per claim at depth 10,000 (541ms at 1,000), i.e. drain throughput collapsing exactly
     * when the queue is deepest. The rewrite keeps the SAME outcome and gets the index back:
     *
     * 1. **The fairness term became a FILTER, not a sort key**, so the `ORDER BY` matches the index and
     *    the scan stops at the first qualifying row (measured: 9.3ms at depth 10,000 with nothing
     *    demoted, `rows=1 loops=1` on the index scan; 35.6ms with EVERYTHING demoted, where the scan
     *    must legitimately examine every row before concluding the promoted tier is empty).
     * 2. **`over_demand` computes every requester's outstanding count ONCE per claim**, set-based
     *    (`MATERIALIZED` is load-bearing — inlined, the planner would re-run it per candidate row). It is
     *    inherently small: a requester in it holds more than `demoteThreshold` rows, so it cannot exceed
     *    `queue_depth / demoteThreshold` entries.
     * 3. **`NOT IN` over that CTE, not `NOT EXISTS`**, because an uncorrelated `NOT IN` becomes a hashed
     *    SubPlan built ONCE for the statement, leaving each examined row a couple of hash probes over its
     *    own requester rows; the `NOT EXISTS` form re-planned an anti-join per row and measured 108ms at
     *    the ceiling — 3x slower — for identical results. Safe against `NOT IN`'s NULL trap because
     *    `fetch_requesters.requester_id` is `NOT NULL`.
     * 4. **Two branches, one statement.** `COALESCE` evaluates the second `SELECT` only when the first
     *    yields nothing (verified: `never executed` in `EXPLAIN ANALYZE`), and when the first yields
     *    nothing EVERY eligible row is demoted — so the fallback needs no demotion predicate, and
     *    "highest-demand promoted row, else highest-demand demoted row" is exactly what the old
     *    `CASE … ASC, request_count DESC, first_requested ASC` computed. One statement keeps both
     *    branches on ONE snapshot and keeps the claim atomic; `SKIP LOCKED` still applies per branch, so
     *    a row another worker is claiming is skipped rather than double-claimed. (The eligibility
     *    predicate and the ordering are spelled out twice on purpose: a shared CTE cannot carry
     *    `FOR UPDATE`, and pushing either through one would cost the index-ordered access path.)
     *
     * @param leaseSeconds - Lease window in seconds (default 30).
     * @returns The leased row, or `undefined` when nothing is eligible.
     * @sideEffect Updates `fetch_queue` (status/leased_at) — including reverting lapsed leases.
     */
    public async leaseNext(leaseSeconds: number = DEFAULT_LEASE_SECONDS): Promise<FetchQueueRow | undefined> {
        // Reaper-on-claim as its own statement (FR-018). A lapsed `in_flight` row always has
        // `last_requested <= now()` — nothing pushes that stamp forward without also setting
        // `status = 'pending'` — so reverting it here makes it eligible for THIS claim at exactly the
        // rank the old `OR (status = 'in_flight' AND …)` branch gave it, while leaving the claim itself a
        // single-status predicate. That is what the partial index needs: an OR across two statuses forces
        // a BitmapOr plus a full sort, which is the early termination the rewrite exists to restore.
        await this.reapExpiredLeases(leaseSeconds);

        const result = await this.db.execute<{ food_id: string }>(sql`
            WITH over_demand AS MATERIALIZED (
                SELECT fr.requester_id
                  FROM fetch_requesters fr
                  JOIN fetch_queue fq USING (food_id)
                 WHERE fq.status IN ('pending', 'in_flight')
                 GROUP BY fr.requester_id
                HAVING count(*) > ${this.demoteThreshold}
            )
            UPDATE fetch_queue
            SET status = 'in_flight', leased_at = now()
            WHERE food_id = COALESCE(
                (
                    SELECT q.food_id FROM fetch_queue q
                     WHERE q.status = 'pending' AND q.last_requested <= now()
                       AND EXISTS (
                           SELECT 1 FROM fetch_requesters r
                            WHERE r.food_id = q.food_id
                              AND r.requester_id NOT IN (SELECT o.requester_id FROM over_demand o)
                       )
                     ORDER BY q.request_count DESC, q.first_requested ASC
                     LIMIT 1 FOR UPDATE SKIP LOCKED
                ),
                (
                    SELECT q.food_id FROM fetch_queue q
                     WHERE q.status = 'pending' AND q.last_requested <= now()
                     ORDER BY q.request_count DESC, q.first_requested ASC
                     LIMIT 1 FOR UPDATE SKIP LOCKED
                )
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
     * List the distinct requester ids recorded for a food (FR-048 producer-provenance input). The
     * consumer refuses to drain a row whose recorded requesters do not all name a real principal
     * (CR-002/U1: an app-user ULID or an allowlisted `svc_*`).
     *
     * @param foodId - Internal food id.
     * @returns The recorded requester ids (empty when none).
     * @sideEffect Reads `fetch_requesters`.
     */
    public async listRequesterIds(foodId: string): Promise<string[]> {
        const result = await this.db.execute<{ requester_id: string }>(
            sql`SELECT requester_id FROM fetch_requesters WHERE food_id = ${foodId}`,
        );

        return result.rows.map((row) => row.requester_id);
    }

    /**
     * Count a requester's live pending demand: the `pending` queue rows the requester is attached to
     * (FR-043, fairness-by-demotion input).
     *
     * @param requesterId - The requester key (app-user ULID or `svc_*`).
     * @returns The count of `pending` queue rows requested by that requester.
     * @sideEffect Reads `fetch_queue` joined to `fetch_requesters`.
     */
    public async pendingCountForRequester(requesterId: string): Promise<number> {
        const result = await this.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n
              FROM fetch_queue q
              JOIN fetch_requesters r USING (food_id)
             WHERE r.requester_id = ${requesterId} AND q.status = 'pending'
        `);

        return result.rows[0]?.n ?? 0;
    }

    /**
     * Age in seconds of the OLDEST pending row — `now() - min(first_requested)` over `status='pending'`
     * (T-183 freshness signal; the worker emits this as `food-fetch-pending-age-seconds` and the CDK
     * alarms when it exceeds 5 minutes, FR-046). Returns 0 when nothing is pending.
     *
     * @returns The oldest-pending age in whole seconds (0 when the pending set is empty).
     * @sideEffect Reads `fetch_queue`.
     */
    public async pendingAgeSeconds(): Promise<number> {
        const result = await this.db.execute<{ age: number | null }>(sql`
            SELECT EXTRACT(EPOCH FROM (now() - min(first_requested)))::int AS age
              FROM fetch_queue
             WHERE status = 'pending'
        `);

        return result.rows[0]?.age ?? 0;
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
     * Record a REAL source failure on a leased row (FR-016/FR-027, DSN-5): increment the failure
     * counter `attempts`, re-queue the row `pending` (clearing the lease), and gate the next claim
     * behind exponential backoff — `last_requested = now() + interval '2^attempts seconds'` using the
     * post-increment `attempts`. Called ONLY on a genuine source error (5xx/timeout or an exhausted
     * 429), NEVER on a lease/claim, a reaper reclaim, or a rate-limit/back-pressure deferral (use
     * {@link deferLease} for those). The caller tombstones the food `FAILED` once the returned
     * `attempts` reaches the retry budget.
     *
     * @param foodId - Internal food id.
     * @param lastError - A sanitized, source-agnostic failure detail recorded on the row.
     * @returns The re-queued row (its `attempts` is the value the caller checks against the budget).
     * @sideEffect Updates `fetch_queue` (attempts/status/leased_at/last_requested/last_error).
     */
    public async recordFailure(foodId: string, lastError?: string): Promise<FetchQueueRow> {
        await this.db.execute(sql`
            UPDATE fetch_queue SET
                attempts = attempts + 1,
                status = 'pending',
                leased_at = NULL,
                last_error = ${lastError ?? null},
                last_requested = now() + make_interval(secs => power(2, attempts + 1)::int)
            WHERE food_id = ${foodId}
        `);

        const row = await this.getByFoodId(foodId);

        if (!row) {
            throw new Error('recordFailure produced no row');
        }

        return row;
    }

    /**
     * Defer a leased row back to `pending` for `seconds` WITHOUT consuming the failure budget (DSN-5):
     * a rate-limit / window-full / 90%-pause deferral or a source 429 back-off is back-pressure, not a
     * failure, so `attempts` is left untouched. The row re-becomes eligible once `last_requested`
     * (now `now() + seconds`) elapses.
     *
     * @param foodId - Internal food id.
     * @param seconds - How long to hold the row off the eligible set.
     * @sideEffect Updates `fetch_queue` (status/leased_at/last_requested); `attempts` unchanged.
     */
    public async deferLease(foodId: string, seconds: number): Promise<void> {
        await this.db.execute(sql`
            UPDATE fetch_queue SET
                status = 'pending',
                leased_at = NULL,
                last_requested = now() + make_interval(secs => ${seconds})
            WHERE food_id = ${foodId}
        `);
    }

    /**
     * Release EVERY `in_flight` lease back to `pending` immediately (graceful shutdown, FR-017/FR-022):
     * on `SIGTERM` the single drainer reverts the rows it holds so a replacement instance can re-claim
     * them at once rather than waiting out the 30s reaper window. Does NOT touch `attempts` — a
     * shutdown is not a failure (DSN-5). Safe under the single-drainer invariant (the only `in_flight`
     * rows are this worker's).
     *
     * @returns The number of released rows.
     * @sideEffect Updates `fetch_queue` (status/leased_at).
     */
    public async releaseInFlight(): Promise<number> {
        const result = await this.db.execute(sql`
            UPDATE fetch_queue SET status = 'pending', leased_at = NULL WHERE status = 'in_flight'
        `);

        return result.rowCount ?? 0;
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
