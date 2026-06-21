/**
 * `FetchQueueService` / EnqueueEmitter (ARCH-002, MOD-002, T-016) — the in-process
 * Postgres-as-queue enqueue. This is NOT EventBridge: `publishFoodRequested` /
 * `publishFoodBatchRequested` perform a direct `INSERT … ON CONFLICT` into `fetch_queue`
 * paired with `pg_notify('fetch_queued', fdc_id)` in one transaction, and record the distinct
 * requester in `fetch_requesters` (ON CONFLICT DO NOTHING) so priority counts distinct `sub`s
 * (FR-044). The Fargate consumer worker wakes on `LISTEN fetch_queued`.
 *
 * Demand priority uses distinct-requester count (FR-044): `request_count` is recomputed as
 * `count(*)` over `fetch_requesters` for the id — a `sub` cannot inflate priority by repeating.
 *
 * @implements FR-011 FR-013 FR-014 FR-017 FR-044
 */
import { Inject, Injectable } from '@nestjs/common';

import { PgPoolProvider } from '../database/database.module.js';
import type pg from 'pg';

/** `LISTEN/NOTIFY` channel the Fargate consumer worker subscribes to. */
const NOTIFY_CHANNEL = 'fetch_queued';

/** Payload for a single-food enqueue (FoodRequested). */
export interface FoodRequestedPayload {
    /** USDA FoodData Central id. */
    fdcId: number;
    /** ISO 8601 timestamp of the request (NFR-010). */
    requestedAt: string;
    /** Authenticated Clerk `sub` or named service principal (FR-048). */
    requestedBy: string;
}

/** Payload for a multi-food enqueue (FoodBatchRequested). */
export interface FoodBatchRequestedPayload {
    /** USDA FoodData Central ids (≤100; FR-045). */
    fdcIds: number[];
    /** ISO 8601 timestamp of the request. */
    requestedAt: string;
    /** Authenticated Clerk `sub` or named service principal. */
    requestedBy: string;
}

@Injectable()
export class FetchQueueService {
    public constructor(@Inject(PgPoolProvider) private readonly pool: pg.Pool) {}

    /**
     * Enqueue a single food for async backfill (idempotent / deduped).
     *
     * Records the distinct requester, upserts the `fetch_queue` row recomputing `request_count`
     * from the distinct-requester count, and fires `pg_notify` — all in one transaction so a
     * concurrent duplicate request never produces a second queue row (FR-014).
     *
     * @sideEffect Writes `fetch_requesters` + `fetch_queue`; emits `pg_notify('fetch_queued')`.
     * @param payload - The enqueue request.
     */
    public async publishFoodRequested(payload: FoodRequestedPayload): Promise<void> {
        const fdcId = String(payload.fdcId);
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            await this.enqueueOne(client, fdcId, payload.requestedBy);

            // pg_notify cannot bind an identifier as the channel, so the channel is a literal and
            // the fdc_id is the bound payload (no SQL injection: it is a string parameter).
            await client.query(`SELECT pg_notify('${NOTIFY_CHANNEL}', $1)`, [fdcId]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Enqueue a batch of foods for async backfill (each deduped via ON CONFLICT).
     *
     * @sideEffect Writes one `fetch_requesters` + `fetch_queue` row per id; emits one `pg_notify`.
     * @param payload - The batch enqueue request.
     */
    public async publishFoodBatchRequested(payload: FoodBatchRequestedPayload): Promise<void> {
        if (payload.fdcIds.length === 0) {
            return;
        }

        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Acquire the per-id advisory locks (in enqueueOne) in a consistent ascending order so
            // two overlapping batches can never deadlock on opposite lock orderings.
            const orderedIds = [...payload.fdcIds].sort((a, b) => a - b);

            for (const id of orderedIds) {
                await this.enqueueOne(client, String(id), payload.requestedBy);
            }

            // One wake for the batch; the worker drains all pending rows once woken.
            await client.query(`SELECT pg_notify('${NOTIFY_CHANNEL}', $1)`, [payload.fdcIds.map(String).join(',')]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Record the distinct requester and upsert the queue row for one id (within a transaction).
     *
     * The `ON CONFLICT` only updates rows still `pending`/`in_flight` — a tombstoned row is left
     * alone (its re-attempt is gated by the tombstone TTL in the controller, FR-025).
     */
    private async enqueueOne(client: pg.PoolClient, fdcId: string, requestedBy: string): Promise<void> {
        // Serialize concurrent enqueues for the SAME fdcId (a popular food can be requested by many
        // subs at once). Without this, the `request_count` recompute below races on the snapshot of
        // committed `fetch_requesters` rows and the distinct-requester count (FR-044) is lost/undercounted
        // under concurrency. The xact lock is released automatically on COMMIT/ROLLBACK; distinct ids
        // hash to distinct locks so unrelated enqueues don't block each other.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [fdcId]);

        // Distinct-requester demand: each sub contributes at most one row (FR-044).
        await client.query(
            `INSERT INTO fetch_requesters (fdc_id, sub) VALUES ($1, $2)
             ON CONFLICT (fdc_id, sub) DO NOTHING`,
            [fdcId, requestedBy],
        );

        // Upsert the queue row; recompute request_count as the distinct-requester count.
        await client.query(
            `INSERT INTO fetch_queue (fdc_id) VALUES ($1)
             ON CONFLICT (fdc_id) DO UPDATE
             SET request_count = (SELECT count(*) FROM fetch_requesters WHERE fdc_id = $1),
                 last_requested = now()
             WHERE fetch_queue.status IN ('pending', 'in_flight')`,
            [fdcId],
        );
    }

    // TODO(Phase 7 — FR-043/FR-046, T-052/T-054): `admitEnqueue(req.user, fdcIds)` runs here
    // BEFORE enqueue to enforce queue-depth backpressure + circuit breaker (→ 503) and to enroll
    // the sub for fairness-by-demotion. Left as a seam; the core enqueue is intentionally open in
    // this phase (no auth guard yet — see FoodsController for the requestedBy seam).
}
