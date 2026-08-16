/**
 * `AdminMetricsService` (T-184) — composes the operational signals the admin dashboard reads (FR-039 /
 * US-10): `fetch_queue` depths, the food lifecycle backlog (UNRESOLVED / NOT_FOUND / FAILED), and each
 * wired source's trailing-60-min rolling-window utilization. Read-only; it never mutates state and never
 * calls a source.
 *
 * @implements FR-039
 */
import { Injectable } from '@nestjs/common';

import { RollingWindowLimiter } from '../../sources/RollingWindowLimiter.js';
import { AdminMetricsDao } from './adminMetrics.dao.js';
// AUTHORED wire contract (CODING_STANDARDS §15.2), published via `@kitchensink/schema-food`. Re-exported so
// this module's historical import sites keep working, but no longer DEFINED here.
export type { OperationalMetrics, SourceWindowMetrics } from './adminMetrics.schema.js';
import type { OperationalMetrics, QueueDepthMetrics, SourceWindowMetrics } from './adminMetrics.schema.js';
import { IllegalStatusTransitionError, isIllegalStatusTransitionError } from '../dao/dao.errors.js';
import { FoodDao } from '../dao/food.dao.js';
import { FetchQueueDao } from '../dao/fetchQueue.dao.js';
import { FoodNotFoundError } from '../foods.errors.js';

/** The acknowledgement returned by an operator requeue (U9). */
export interface RequeueResponse {
    /** The requeued food id. */
    readonly id: string;
    /** Its lifecycle status after the requeue — always `PENDING`. */
    readonly status: 'PENDING';
}

@Injectable()
export class AdminMetricsService {
    public constructor(
        private readonly dao: AdminMetricsDao,
        private readonly limiter: RollingWindowLimiter,
        private readonly foodDao: FoodDao,
        private readonly queue: FetchQueueDao,
    ) {}

    /**
     * Collect the full operational-metrics payload (FR-039/US-10).
     *
     * @returns Queue depths, lifecycle backlog, and per-source window utilization.
     * @sideEffect Reads `fetch_queue`, `food`, and `source_call_log` (via the limiter).
     */
    public async collect(): Promise<OperationalMetrics> {
        const [queue, backlog, sources] = await Promise.all([
            this.dao.queueDepths(),
            this.dao.backlog(),
            this.sourceWindows(),
        ]);

        return { queue, backlog, sources };
    }

    /**
     * The `fetch_queue` depth signals on their own (the focused `/admin/queue` endpoint).
     *
     * @returns The pending / in-flight / tombstone depths.
     * @sideEffect Reads `fetch_queue`.
     */
    public async queueDepths(): Promise<QueueDepthMetrics> {
        return this.dao.queueDepths();
    }

    /** Per-source trailing-60-min window utilization for every wired source. */
    private async sourceWindows(): Promise<SourceWindowMetrics[]> {
        return Promise.all(
            this.limiter.knownSources().map(async (source) => {
                const [windowCount, paused] = await Promise.all([
                    this.limiter.count(source),
                    this.limiter.isPaused(source),
                ]);
                const caps = this.limiter.capsFor(source);
                const utilization = caps.hardCap > 0 ? Math.min(windowCount / caps.hardCap, 1) : 0;

                return {
                    source,
                    windowCount,
                    hardCap: caps.hardCap,
                    pauseThreshold: caps.pauseThreshold,
                    utilization,
                    paused,
                };
            }),
        );
    }

    /**
     * Requeue a blackholed food (U9) — clear the attempt count and the terminal mark so the normal drain
     * picks it up again.
     *
     * ⛔ **Both halves, or neither works.** Clearing `fetch_queue.attempts` without resetting the food's
     * terminal `FAILED` status leaves the food unreadable while the queue happily re-fetches it; resetting
     * the status without clearing the count means the very next failure re-exhausts an already-spent budget
     * and it tombstones again immediately. `reactivate` already does the queue half — this adds the
     * lifecycle half and orders them so a failure between the two leaves the food retryable rather than
     * stuck.
     *
     * ⚠️ **Idempotent, because an operator will run it twice.** `PENDING → PENDING` is not a legal
     * transition (FR-028a), so the bare `setStatus` rejected a food that was ALREADY pending — a second
     * invocation, or one that raced the worker's own recovery, answered `500` on a route whose contract
     * says `202`. Nothing distinguishes that from "the requeue failed", which is the worst answer to give
     * someone mid-incident. An already-pending food needs no mark cleared, so it is a success, not a fault.
     *
     * The rejection is CLASSIFIED after the fact rather than pre-checked with a read: the conditional
     * UPDATE stays the single authority on what is legal, and a concurrent writer that moved the food to
     * `PENDING` first is then indistinguishable from having done it here — which is the correct outcome.
     *
     * @param foodId - The food to requeue.
     * @returns The requeued food's id and its new status.
     * @throws {FoodNotFoundError} (→ 404) when no such food exists — previously an opaque `500`.
     * @sideEffect Resets `food.status` to `PENDING` and clears `fetch_queue.attempts`.
     */
    public async requeueFood(foodId: string): Promise<RequeueResponse> {
        // Lifecycle FIRST: `PENDING` is a legal target from both terminal states and from `AWAITING_RETRY`,
        // so this is the step that can legitimately reject. If the queue reset ran first and this failed,
        // the food would be re-fetchable while still reading `FAILED` to every caller.
        try {
            await this.foodDao.setStatus({ id: foodId, status: 'PENDING' });
        } catch (error) {
            if (!isIllegalStatusTransitionError(error)) {
                throw error;
            }

            await this.assertRequeueable(foodId);
        }

        await this.queue.reactivate(foodId);

        return { id: foodId, status: 'PENDING' };
    }

    /**
     * Decide whether a rejected `→ PENDING` transition was benign, and re-raise it as something a caller
     * can act on when it was not.
     *
     * @param foodId - The food whose transition was rejected.
     * @throws {FoodNotFoundError} when no row exists at all.
     * @throws {IllegalStatusTransitionError} when the food is in a state a requeue cannot clear (a
     *   `RESOLVED`/`UNRESOLVED` food is not blackholed — `POST /:id/refetch` is the route for those).
     * @sideEffect Reads `food`.
     */
    private async assertRequeueable(foodId: string): Promise<void> {
        const food = await this.foodDao.getById(foodId);

        if (!food) {
            throw new FoodNotFoundError(foodId);
        }

        if (food.status !== 'PENDING') {
            throw new IllegalStatusTransitionError(foodId, 'PENDING');
        }
    }
}
