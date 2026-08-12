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

/** Options for {@link FetchQueueDao}. */
export interface FetchQueueDaoOptions {
    /**
     * Per-requester pending-threshold above which a requester is over-demand (REQ-043, drain-time
     * demotion). Defaults to the configured `FOOD_DEMOTE_THRESHOLD` (50 when unset).
     *
     * ⚠️ The default is resolved HERE rather than left to each composition root: a caller that forgets to
     * pass the configured value would silently fall back to the built-in one, which is how the worker
     * spent a period ignoring `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` (see `src/worker/main.ts`). The override
     * exists for tests and for a caller that already holds a validated `Environment`.
     */
    readonly demoteThreshold?: number;
    /**
     * Worker lease window in seconds (FR-018) — the age at which the reaper reverts an `in_flight` row.
     * Defaults to the configured `FOOD_LEASE_TIMEOUT_SECONDS` (30 when unset).
     *
     * ⚠️ Resolved HERE for the same reason: this boot-validated variable once had NO consumer at all, the
     * reaper running on a module literal while `FoodConsumerService` held a third copy of the same 30 that
     * overrode it on every real call — so an operator raising the window changed nothing, silently.
     */
    readonly leaseSeconds?: number;
}

export class FetchQueueDao {
    /** The resolved per-requester pending threshold used by {@link leaseNext}'s demotion ranking. */
    private readonly demoteThreshold: number;

    /** The resolved lease window (seconds) the reaper and the reaper-on-claim default to (FR-018). */
    private readonly leaseSeconds: number;

    /**
     * @param db - The food-schema Drizzle client.
     * @param options - Optional demotion-threshold / lease-window overrides (defaulting to
     *   `FOOD_DEMOTE_THRESHOLD` and `FOOD_LEASE_TIMEOUT_SECONDS`).
     */
    public constructor(
        private readonly db: FoodDrizzle,
        options?: FetchQueueDaoOptions,
    ) {
        this.demoteThreshold = options?.demoteThreshold ?? settingFromEnv('FOOD_DEMOTE_THRESHOLD');
        this.leaseSeconds = options?.leaseSeconds ?? settingFromEnv('FOOD_LEASE_TIMEOUT_SECONDS');
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
     * ⛔ The statement's SHAPE is load-bearing (T-197/T-201, DSN-11) — do not "simplify" it back:
     *
     * 1. The fairness term is a FILTER, never a sort key. As the leading `ORDER BY` key it had to be
     *    computed for every eligible row before the first row was known, so `LIMIT 1` saved nothing and
     *    `idx_fetch_queue_priority` was unusable — a Seq Scan + Sort at depth 10,000.
     * 2. `MATERIALIZED` is load-bearing: inlined, the planner re-runs `over_demand` per candidate row.
     * 3. `NOT IN` over the CTE, not `NOT EXISTS` — an uncorrelated `NOT IN` builds ONE hashed SubPlan for
     *    the statement, where the `NOT EXISTS` form re-planned an anti-join per row (3× slower, identical
     *    results). Safe against `NOT IN`'s NULL trap only because `fetch_requesters.requester_id` is
     *    `NOT NULL`.
     * 4. `demand` carries `count(*) > threshold` as a BOOLEAN rather than filtering with `HAVING`, so the
     *    threshold comparison appears EXACTLY ONCE in the statement. `FOOD_DEMOTE_THRESHOLD` has already
     *    had one split-brain (T-199a); restating the comparison for the probe below would rebuild that
     *    defect inside a single statement.
     * 5. `promoted_ready` asks "is any promoted row ready?" from the REQUESTER side, so it is bounded by
     *    distinct requesters rather than by queue depth, and `LIMIT 1` stops it at the first hit.
     * 6. `CASE WHEN EXISTS (promoted_ready)` gates branch 1, which is what turns the probe into saved
     *    work — `CASE` leaves a branch it does not need `never executed`. ⛔ Gating inside branch 1's own
     *    `WHERE` would NOT work: a qual is evaluated per row, so the index scan would still walk the
     *    whole queue to reject every one. Proving that negative by enumeration was the O(depth) cost.
     * 7. Two branches, ONE statement: `COALESCE` evaluates the second only when the first yields nothing,
     *    both stay on one snapshot, and the claim stays atomic. The eligibility predicate and the
     *    ordering are spelled out twice on purpose — a shared CTE cannot carry `FOR UPDATE`.
     *
     * The RANKING is unchanged, and provably so rather than merely intended: branch 1 can only be skipped
     * when it would have returned nothing (if it would return `q`, then `q` has a requester not in
     * `over_demand`, which therefore appears in `demand` as under-threshold with eligible work, so
     * `promoted_ready` holds — contrapositive: gate false ⇒ branch 1 empty).
     * `drain-claim-ranking-differential.integration.test.ts` re-proves that against FR-043's spec-literal
     * ranking over randomised queues, drain order for drain order, and `drain-claim-scaling` asserts the
     * `never executed` branch and the index TUPLE counts from the real plan.
     *
     * ⚠️ Those gates assert PLAN SHAPE and tuple counts, never wall-clock, and deliberately so: table
     * bloat moves buffer counts ~5× for the same rows, and CI hardware is ~3× slower than a workstation,
     * so the CI probe is the only arbiter of absolute latency. Measurements, the p95 sampling correction
     * and the undiagnosed runner stalls are recorded in `tests/load/README.md` ("Finding 2").
     *
     * Residual, stated rather than hidden: the claim is still linear in `fetch_requesters` ROWS, because
     * one aggregate must read them to know each requester's outstanding count. It is no longer linear in
     * QUEUE DEPTH, which is what FR-046 bounds and DSN-11 escalated. Removing the remaining term needs a
     * maintained per-requester counter — the T-199a split-brain by construction — and is not justified at
     * the measured cost.
     *
     * @param leaseSeconds - Lease window in seconds (defaults to the configured `FOOD_LEASE_TIMEOUT_SECONDS`).
     * @returns The leased row, or `undefined` when nothing is eligible.
     * @sideEffect Updates `fetch_queue` (status/leased_at) — including reverting lapsed leases.
     */
    public async leaseNext(leaseSeconds: number = this.leaseSeconds): Promise<FetchQueueRow | undefined> {
        // Reaper-on-claim as its own statement (FR-018). A lapsed `in_flight` row always has
        // `last_requested <= now()` — nothing pushes that stamp forward without also setting
        // `status = 'pending'` — so reverting it here makes it eligible for THIS claim at exactly the
        // rank the old `OR (status = 'in_flight' AND …)` branch gave it, while leaving the claim itself a
        // single-status predicate. That is what the partial index needs: an OR across two statuses forces
        // a BitmapOr plus a full sort, which is the early termination the rewrite exists to restore.
        await this.reapExpiredLeases(leaseSeconds);

        const result = await this.db.execute<{ food_id: string }>(sql`
            WITH demand AS MATERIALIZED (
                SELECT fr.requester_id, count(*) > ${this.demoteThreshold} AS over_threshold
                  FROM fetch_requesters fr
                  JOIN fetch_queue fq USING (food_id)
                 WHERE fq.status IN ('pending', 'in_flight')
                 GROUP BY fr.requester_id
            ),
            over_demand AS MATERIALIZED (
                SELECT d.requester_id FROM demand d WHERE d.over_threshold
            ),
            promoted_ready AS MATERIALIZED (
                SELECT 1 AS present
                  FROM demand d
                 WHERE NOT d.over_threshold
                   AND EXISTS (
                       SELECT 1 FROM fetch_requesters r
                        JOIN fetch_queue q ON q.food_id = r.food_id
                        WHERE r.requester_id = d.requester_id
                          AND q.status = 'pending' AND q.last_requested <= now()
                   )
                 LIMIT 1
            )
            UPDATE fetch_queue
            SET status = 'in_flight', leased_at = now()
            WHERE food_id = COALESCE(
                CASE WHEN EXISTS (SELECT 1 FROM promoted_ready) THEN (
                    SELECT q.food_id FROM fetch_queue q
                     WHERE q.status = 'pending' AND q.last_requested <= now()
                       AND EXISTS (
                           SELECT 1 FROM fetch_requesters r
                            WHERE r.food_id = q.food_id
                              AND r.requester_id NOT IN (SELECT o.requester_id FROM over_demand o)
                       )
                     ORDER BY q.request_count DESC, q.first_requested ASC
                     LIMIT 1 FOR UPDATE SKIP LOCKED
                ) END,
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
     * @param leaseSeconds - Lease window in seconds (defaults to the configured `FOOD_LEASE_TIMEOUT_SECONDS`).
     * @returns The number of reclaimed rows.
     * @sideEffect Updates `fetch_queue`.
     */
    public async reapExpiredLeases(leaseSeconds: number = this.leaseSeconds): Promise<number> {
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
