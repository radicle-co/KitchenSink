/**
 * `EnqueueEmitter` (ARCH-002, MOD-002, T-141) — the in-process Postgres-as-queue enqueue. This is NOT
 * EventBridge: `publishFoodRequested` / `publishFoodBatchRequested` perform a direct
 * `INSERT … ON CONFLICT` into `fetch_queue` paired with `pg_notify('fetch_queued', food_id)` in one
 * transaction, recording the distinct requester in `fetch_requesters` (ON CONFLICT DO NOTHING) so
 * `request_count` counts distinct `sub`s (FR-044) — never a raw `+1`. The Fargate consumer wakes on
 * `LISTEN fetch_queued`.
 *
 * The food `id` is the dedup target (created up front by the create API). `requestedBy` is the verified
 * Clerk `sub` or a named service principal — NEVER an unauthenticated `'system'` shortcut (FR-048). A
 * per-`id` advisory lock serializes concurrent enqueues for the same food so the distinct-requester
 * recompute cannot race. `reactivate` revives a tombstoned queue row (DSN-1): the guarded normal upsert
 * is a no-op on a non-`pending` row, so a terminal-state reactivation must reset it explicitly.
 *
 * @implements FR-011 FR-013 FR-014 FR-017 FR-044 FR-048
 */
import { Inject, Injectable } from '@nestjs/common';

import { PgPoolProvider } from '../database/database.module.js';
import type pg from 'pg';

/** `LISTEN/NOTIFY` channel the Fargate consumer worker subscribes to. */
const NOTIFY_CHANNEL = 'fetch_queued';

/** Input for a single-food enqueue (`FoodRequested`). */
export interface FoodRequestedInput {
    /** Internal food id (the dedup target, created up front). */
    id: string;
    /** Verified Clerk `sub` or named service principal (FR-048). */
    requestedBy: string;
    /** When `true`, reset a tombstoned queue row to `pending` (terminal-state reactivation, DSN-1). */
    reactivate?: boolean;
}

/** A single food in a batch enqueue (`FoodBatchRequested`). */
export interface BatchFoodInput {
    /** Internal food id. */
    id: string;
    /** When `true`, reactivate a tombstoned queue row. */
    reactivate?: boolean;
}

/** Input for a multi-food enqueue (`FoodBatchRequested`). */
export interface FoodBatchRequestedInput {
    /** The foods to enqueue (≤100; FR-045). */
    foods: BatchFoodInput[];
    /** Verified Clerk `sub` or named service principal. */
    requestedBy: string;
}

@Injectable()
export class EnqueueEmitter {
    public constructor(@Inject(PgPoolProvider) private readonly pool: pg.Pool) {}

    /**
     * Enqueue a single food (idempotent / deduped) and wake the worker.
     *
     * @param input - The food id, requester, and reactivation flag.
     * @sideEffect Writes `fetch_requesters` + `fetch_queue`; emits `pg_notify('fetch_queued', id)`.
     */
    public async publishFoodRequested(input: FoodRequestedInput): Promise<void> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            await this.enqueueOne(client, input.id, input.requestedBy, input.reactivate ?? false);
            // pg_notify's channel cannot be a bound identifier, so the channel is a literal and the
            // food id is the bound payload (a string parameter — no SQL injection).
            await client.query(`SELECT pg_notify('${NOTIFY_CHANNEL}', $1)`, [input.id]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Enqueue a batch of foods (each deduped) and wake the worker once.
     *
     * @param input - The foods to enqueue + the requester.
     * @sideEffect Writes one `fetch_requesters` + `fetch_queue` row per id; emits one `pg_notify`.
     */
    public async publishFoodBatchRequested(input: FoodBatchRequestedInput): Promise<void> {
        if (input.foods.length === 0) {
            return;
        }

        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Acquire the per-id advisory locks in a consistent order so two overlapping batches can
            // never deadlock on opposite lock orderings.
            const ordered = [...input.foods].sort((left, right) => left.id.localeCompare(right.id));

            for (const food of ordered) {
                await this.enqueueOne(client, food.id, input.requestedBy, food.reactivate ?? false);
            }

            await client.query(`SELECT pg_notify('${NOTIFY_CHANNEL}', $1)`, [
                input.foods.map((food) => food.id).join(','),
            ]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Record the distinct requester and upsert (or reactivate) the queue row for one id, within a
     * transaction. `request_count` is recomputed as the live distinct-`sub` count — never a raw `+1`.
     *
     * @param client - The transaction-scoped pg client.
     * @param id - Internal food id.
     * @param requestedBy - The verified requester sub / service principal.
     * @param reactivate - When `true`, reset a tombstoned row to `pending` (the guarded upsert skips it).
     * @sideEffect Takes a transaction-scoped advisory lock; writes `fetch_requesters` + `fetch_queue`.
     */
    private async enqueueOne(
        client: pg.PoolClient,
        id: string,
        requestedBy: string,
        reactivate: boolean,
    ): Promise<void> {
        // Serialize concurrent enqueues for the SAME id so the distinct-requester recompute below cannot
        // race on the committed `fetch_requesters` snapshot (FR-044). Released on COMMIT/ROLLBACK.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [id]);

        await client.query(
            `INSERT INTO fetch_requesters (food_id, sub) VALUES ($1, $2)
             ON CONFLICT (food_id, sub) DO NOTHING`,
            [id, requestedBy],
        );

        if (reactivate) {
            // Terminal-state reactivation (DSN-1): reset the tombstoned row; insert a fresh one if absent.
            const updated = await client.query(
                `UPDATE fetch_queue SET
                     status = 'pending', attempts = 0, leased_at = NULL, last_error = NULL, last_requested = now(),
                     request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id = $1)
                 WHERE food_id = $1`,
                [id],
            );

            if ((updated.rowCount ?? 0) === 0) {
                await client.query(
                    `INSERT INTO fetch_queue (food_id, request_count, first_requested, last_requested, status)
                     VALUES ($1, (SELECT count(*) FROM fetch_requesters WHERE food_id = $1), now(), now(), 'pending')`,
                    [id],
                );
            }

            return;
        }

        // Normal enqueue: insert, or refresh demand on a still-`pending` row (a non-`pending` row is left
        // untouched — its re-attempt goes through the reactivation path above, FR-014/DSN-1).
        await client.query(
            `INSERT INTO fetch_queue (food_id, request_count, first_requested, last_requested, status)
             VALUES ($1, (SELECT count(*) FROM fetch_requesters WHERE food_id = $1), now(), now(), 'pending')
             ON CONFLICT (food_id) DO UPDATE
             SET request_count = (SELECT count(*) FROM fetch_requesters WHERE food_id = $1),
                 last_requested = now()
             WHERE fetch_queue.status = 'pending'`,
            [id],
        );
    }
}
