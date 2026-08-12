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
     * The default is resolved HERE rather than left to each composition root on purpose: a caller that
     * forgets to pass the configured value silently falls back to the built-in one, which is exactly how
     * the worker spent a slice of its life ignoring `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` (see the note at
     * `src/worker/main.ts`). The override exists for tests and for any future caller that already holds a
     * validated `Environment`.
     */
    readonly demoteThreshold?: number;
    /**
     * Worker lease window in seconds (FR-018) — the age at which the reaper reverts an `in_flight` row.
     * Defaults to the configured `FOOD_LEASE_TIMEOUT_SECONDS` (30 when unset).
     *
     * Resolved HERE for the same reason as `demoteThreshold`: the variable is documented, boot-validated,
     * and used to have NO consumer at all — the reaper ran on a module literal, and `FoodConsumerService`
     * held a third copy of the same 30 that overrode this one on every real call. An operator raising the
     * window to stop the reaper stealing rows from a slow-but-live fan-out changed nothing, silently.
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
     * ## Why `promoted_ready` gates branch 1 (T-201/DSN-11 re-opened — this is the O(depth) fix)
     *
     * T-197 left ONE case linear in queue depth, and CI measured it breaching: when NOTHING is promoted,
     * branch 1's index-ordered scan has to examine EVERY eligible row before it can conclude the promoted
     * tier is empty and fall through. Early termination is worth nothing when there is nothing to
     * terminate on. The FR-046 ceiling probe measured **85.52ms p95 at depth 10,000 (`adversarial`) against
     * a 60ms budget** on CI, while `mixed` — where the very first row qualifies — passed everywhere. So the
     * cost was never the fairness computation; it was proving a NEGATIVE by enumeration.
     *
     * The fix determines that negative from the AGGREGATE instead of from the queue:
     *
     * 5. **`over_demand` is now DERIVED from a `demand` CTE** that keeps every requester with the boolean
     *    `count(*) > threshold` instead of filtering with `HAVING`. Same one aggregate over the same one
     *    scan, and the set `over_demand` yields is unchanged — but the tier boundary is now readable by a
     *    second consumer without restating it. That matters: the threshold comparison still appears EXACTLY
     *    ONCE in the statement, and `FOOD_DEMOTE_THRESHOLD` has already been through one split-brain
     *    (T-199a, `8f6e1e7f`, where the API's flood-shed and this DAO disagreed about the same number behind
     *    green tests). A `count(*) <= threshold` spelled out a second time for the probe below would be that
     *    defect re-introduced inside a single statement.
     * 6. **`promoted_ready` asks the question from the REQUESTER side, and stops at the first hit.** A
     *    promoted row exists iff some requester is under-threshold AND has at least one eligible pending
     *    row. `demand` is bounded by the count of DISTINCT requesters — not by depth — and is already
     *    materialized, so the probe walks it rather than the queue, and `LIMIT 1` ends it at the first
     *    requester with eligible work. In the adversarial shape `demand` holds no under-threshold requester
     *    at all, so the probe finishes without touching `fetch_queue` once.
     * 7. **`CASE WHEN EXISTS (promoted_ready)` gates branch 1**, which is what turns the probe into saved
     *    work: `CASE` does not evaluate a branch it does not need, so an empty promoted tier leaves branch
     *    1's SubPlan `never executed` — verified in `EXPLAIN ANALYZE`, and asserted from the real plan by
     *    `drain-claim-scaling.integration.test.ts`. Gating inside branch 1's own `WHERE` would NOT work: a
     *    qual is evaluated per row, so the index scan would still walk the queue to reject every one.
     *
     * **The ranking is UNCHANGED, and provably so rather than merely intended.** Branch 1 and branch 2 are
     * byte-identical to before — same eligibility predicate, same `NOT IN over_demand` fairness filter over
     * the same set, same `ORDER BY`, same `LIMIT 1 FOR UPDATE SKIP LOCKED`. The only new behaviour is that
     * branch 1 can be SKIPPED, and it can only be skipped when it would have returned nothing: if branch 1
     * would return row `q`, then `q` is an eligible pending row with some requester `r` not in
     * `over_demand`; `r` is attached to a `pending` row so `r` appears in `demand` with
     * `NOT over_threshold`; and `q` is itself an eligible pending row of `r` — so `promoted_ready` holds.
     * Contrapositive: gate false ⇒ branch 1 empty. Hence the claim is identical in every case, `SKIP LOCKED`
     * contention included (a promoted row another worker holds still falls through to the demoted branch,
     * exactly as before). `drain-claim-ranking-differential.integration.test.ts` re-proves the whole chain
     * against FR-043's spec-literal ranking over randomised queues, drain order for drain order.
     *
     * **Measured** (this workstation, the depth-10,000 fixture from `drain-demotion.perf.ts`, through the
     * real DAO, 30 samples, before → after): `adversarial` p95 **41.70ms → 7.20ms** at depth 10,000 (5.8×)
     * and 6.97ms → 4.03ms at 1,000, with `mixed` unchanged (8.86ms → 9.04ms at 10,000, inside run-to-run
     * spread). In-database timing without the client round trip isolates the statement itself: 33.21ms →
     * 3.56ms adversarial, and 40,457 → 1,439 shared buffer hits. (**Buffer figure corrected 2026-08-12: 328,
     * not 1,439**, for `adversarial` @10,000 re-measured on a FRESHLY SEEDED fixture — 311 of those 328 are the
     * `demand` aggregate's two sequential scans. The 1,439 was measured against a CI-style database the k6
     * steps had already churned, i.e. bloated tables carrying ~5× the pages for the same rows. Neither figure
     * is asserted anywhere: the scaling gate asserts index TUPLES, which bloat does not move.) An earlier
     * revision that also replaced
     * `NOT IN over_demand` with `IN under_demand` cost `mixed` ~30% (a 10,000-entry hashed SubPlan instead of
     * 50) for no semantic gain, which is why branch 1 keeps the small over-threshold set. CI hardware is ~3×
     * slower than this machine, so **the CI probe is the only arbiter of the absolute numbers**; what is
     * hardware-independent is the buffer count and the `never executed` branch, and both are asserted.
     *
     * **WHERE THE TIME ACTUALLY GOES** (`EXPLAIN (ANALYZE, BUFFERS)` of the statement the DAO sends, captured
     * from a Drizzle logger; freshly-seeded depth-10,000 fixture, this workstation, 2026-08-12). Recorded
     * because a `mixed` p95 regression invites exactly one wrong diagnosis — "it must be branch 1, the tier
     * `adversarial` never enters" — and the numbers say otherwise:
     *
     *   - `mixed`: **8.889ms** total, 755 buffers. The `demand` aggregate is **7.239ms of it (81%)**;
     *     `promoted_ready` adds 0.013ms and 6 buffers on top of it; **branch 1 is 1.547ms**, of which 1.521ms
     *     is building the 50-row hashed `over_demand` SubPlan and only 0.003ms is the index scan itself
     *     (`idx_fetch_queue_priority`, `rows=1 loops=1` — early termination working as designed).
     *   - `adversarial`: **5.356ms** total, 328 buffers. `demand` is 5.224ms (97%); branch 1 `never executed`;
     *     branch 2's index scan is 0.018ms.
     *
     * So the whole `mixed` − `adversarial` delta (3.5ms) is the aggregate reading 30,000 rather than 20,000
     * `fetch_requesters` rows (727 vs 311 buffers) plus branch 1's one-time hash. **Branch 1 is ~17% of the
     * statement, and the FR-043 aggregate is 81–97% of it.**
     *
     * **CONFIRMED ON CI** (run 31451860784, budget p95 <= 60ms, before -> after on the same runner class):
     * `adversarial` @10,000 **85.52ms -> 10.81ms** (7.9x, now 5.6x inside budget), @1,000 10.76ms -> 3.91ms,
     * @100 2.64ms -> 2.65ms; `mixed` @10,000 16.73ms -> 16.59ms, @1,000 3.98ms -> 5.46ms, @100 4.78ms ->
     * 4.87ms. Every series passes. Note the local prediction was 7.20ms and CI measured 10.81ms — the ~3x
     * hardware factor applies to the REMAINING aggregate too, which is why the probe stays the contract.
     *
     * **SUPERSEDED AS A p95 REFERENCE (2026-08-12) — the before/after above stands, but read the MEDIANS, not
     * the p95s.** The same probe later reported `mixed` @10,000 at **90.23ms p95** (run 31608073724) with this
     * statement, its plan, its `never executed` branch and its buffer counts ALL unchanged. Across five heavy
     * runs on one branch that series measured p50/p95 of 15.69/16.59, 15.14/15.41, 16.58/18.01, 11.84/12.36
     * and **12.23/90.23** — the "regressing" run had the second-FASTEST median ever recorded for it. Two
     * things combined: the probe sampled n=30, where its nearest-rank p95 IS the second-largest sample (and
     * p99 IS the maximum, which is why every table it ever printed had `p99 == max` in every row), and the
     * runner intermittently stalls for 30-170ms — visible in the same run as `adversarial` @1,000 at p50
     * 3.55ms with p95 29.37ms, and in run 31537195430 as `mixed` @100 at p50 2.31ms with p95 **56.51ms**, at a
     * depth where this statement does ~2ms of work. The probe now samples 300 per series, so p95 is the
     * 16th-largest observation; `FOOD_DRAIN_CLAIM_P95_MS`, the fixture and both plan gates are untouched. The
     * stall was reproduced locally (62.63ms and 73.78ms samples against 8-10ms medians) and its most plausible
     * innocent explanation was measured and REJECTED (300 samples either side of an explicit `VACUUM
     * (ANALYZE)` moved p50 by 0.2-0.4ms, and `autovacuum_count` never advanced). **What is NOT diagnosed, and
     * is not claimed to be: the source of those stalls on GitHub's runners — CPU steal versus IO contention.**
     * Full evidence in `tests/load/README.md` "Finding 2".
     *
     * **Residual, stated rather than hidden:** the claim is still linear in `fetch_requesters` ROWS, because
     * one aggregate must read them to know each requester's outstanding count. It is no longer linear in
     * QUEUE DEPTH, which is what FR-046 bounds and what DSN-11 escalated. Removing the remaining term needs
     * a maintained per-requester counter — a second representation of the same number, i.e. the T-199a
     * split-brain by construction — and it is not justified at the measured cost.
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
