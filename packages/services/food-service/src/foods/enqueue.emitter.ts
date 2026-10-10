/**
 * `EnqueueEmitter` (ARCH-002, MOD-002, T-141) — the in-process Postgres-as-queue enqueue. This is NOT
 * EventBridge: `publishFoodRequested` / `publishFoodBatchRequested` perform a direct
 * `INSERT … ON CONFLICT` into `fetch_queue` paired with `pg_notify('fetch_queued', food_id)` in one
 * transaction, recording the distinct requester in `fetch_requesters` (ON CONFLICT DO NOTHING) so
 * `request_count` counts distinct requesters (FR-044) — never a raw `+1`. The Fargate consumer wakes on
 * `LISTEN fetch_queued`.
 *
 * The food `id` is the dedup target (created up front by the create API). `requestedBy` is the requester
 * key (CR-002/U1: an app-user ULID for a user, or an allowlisted `svc_*` for a service) — NEVER the raw
 * Clerk `sub`, and NEVER an unauthenticated `'system'` shortcut (FR-048). A
 * per-`id` advisory lock serializes concurrent enqueues for the same food so the distinct-requester
 * recompute cannot race. `reactivate` revives a tombstoned queue row (DSN-1): the guarded normal upsert
 * is a no-op on a non-`pending` row, so a terminal-state reactivation must reset it explicitly.
 *
 * @implements FR-011 FR-013 FR-014 FR-017 FR-044 FR-048
 */
import { Inject, Injectable } from '@nestjs/common';

import { PgPoolProvider } from '../database/database.module.js';
import type pg from 'pg';
import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import { SeedOwnedFoodNotQueueableError } from './enqueue.errors.js';

/** `LISTEN/NOTIFY` channel the Fargate consumer worker subscribes to. */
const NOTIFY_CHANNEL = 'fetch_queued';

/** Input for a single-food enqueue (`FoodRequested`). */
export interface FoodRequestedInput {
    /** Internal food id (the dedup target, created up front). */
    id: string;
    /** The requester key — an app-user ULID or an allowlisted `svc_*` (CR-002/U1, FR-048). */
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
    /** The requester key — an app-user ULID or an allowlisted `svc_*` (CR-002/U1). */
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
            await this.refuseSeedOwned(client, [input.id]);
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
            await this.refuseSeedOwned(
                client,
                input.foods.map((food) => food.id),
            );

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
     * Refuse the whole publish when any id names a food the seed owns (KTD-12): the seed is that food's one writer,
     * so a queued fetch could never land. Every route refuses such a food first; this is the writer's own check, so a
     * caller that forgot cannot queue one. `seed_owned` is immutable after insert, so no later write can falsify it.
     *
     * @param client - The transaction-scoped pg client.
     * @param ids - Every food id the publish names.
     * @throws {SeedOwnedFoodNotQueueableError} for the first seed-owned id; the caller's transaction rolls back.
     * @sideEffect Reads `food` and `food_item`.
     */
    private async refuseSeedOwned(client: pg.PoolClient, ids: readonly string[]): Promise<void> {
        const seeded = await client.query<{ id: string }>(
            `SELECT f.id FROM food f JOIN food_item i ON i.id = f.item_id
              WHERE f.id = ANY($1::text[]) AND i.seed_owned
              LIMIT 1`,
            [ids],
        );
        const [first] = seeded.rows;

        if (first !== undefined) {
            throw new SeedOwnedFoodNotQueueableError(first.id);
        }
    }

    /**
     * Record the distinct requester and upsert (or reactivate) the queue row for one id, within a
     * transaction. `request_count` is recomputed as the live distinct-requester count — never a raw `+1`.
     *
     * @param client - The transaction-scoped pg client.
     * @param id - Internal food id.
     * @param requestedBy - The requester key (app-user ULID or `svc_*`).
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
        await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [ADVISORY_LOCK_CLASSES.foodEnqueue, id]);

        await client.query(
            `INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, $2)
             ON CONFLICT (food_id, requester_id) DO NOTHING`,
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
