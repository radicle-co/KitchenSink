/**
 * The WRITE side of the admin surface (U9): the operator's way back from a blackholed food. Split from
 * `AdminMetricsService`, which is the read model and had grown an operation that mutates two tables.
 *
 * @implements FR-028a
 */
import { Injectable } from '@nestjs/common';

import { apiError } from '../../common/apiError.js';
// AUTHORED wire contract (CODING_STANDARDS §15.2), published via `@kitchensink/schema-food`.
export type { RequeueResponse } from './foodRecovery.schema.js';
import type { RequeueResponse } from './foodRecovery.schema.js';
import { isIllegalStatusTransitionError } from '../dao/dao.errors.js';
import { FoodDao } from '../dao/food.dao.js';
import { EnqueueEmitter } from '../enqueue.emitter.js';
import { FoodNotFoundError } from '../foods.errors.js';
import { SVC_ADMIN_REQUEUE } from '../../worker/change-refresh/changeRefresh.consumer.js';
import { ConsoleWorkerLogger } from '../../worker/ConsoleWorkerLogger.js';
import type { WorkerLogger } from '../../worker/workerLogger.js';

/**
 * Recovery commands an operator issues against a single food.
 *
 * DESIGN PATTERN: **Command**, and the write half of the CQRS split with `AdminMetricsService` — one operator
 * intent per method, each owning what its own failures MEAN on its own route. That ownership is the reason
 * this is a service and not a filter arm: `IllegalStatusTransitionError` is a DAO invariant raised from six
 * call sites whose HTTP meanings differ, so it can only be translated where the caller's intent is known.
 */
@Injectable()
export class FoodRecoveryService {
    /**
     * @param foodDao - Lifecycle DAO (the `→ PENDING` transition half).
     * @param enqueue - The ordinary enqueue path (the queue half): records the requester, revives the
     *   row and wakes the worker in one transaction.
     * @param logger - Structured sink for the operator audit line. Wired by `FoodsModule`'s factory
     *   provider; defaults to the production JSON console sink for direct construction.
     */
    public constructor(
        private readonly foodDao: FoodDao,
        private readonly enqueue: EnqueueEmitter,
        private readonly logger: WorkerLogger = new ConsoleWorkerLogger('food-admin'),
    ) {}

    /**
     * Requeue a blackholed food (U9) — clear the attempt count and the terminal mark so the normal drain
     * picks it up again.
     *
     * ⛔ **Both halves, or neither works.** Clearing `fetch_queue.attempts` without resetting the food's
     * terminal `FAILED` status leaves the food unreadable while the queue happily re-fetches it; resetting
     * the status without clearing the count means the very next failure re-exhausts an already-spent budget
     * and it tombstones again immediately. The enqueue's reactivation does the queue half — this adds the
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
     * ⛔ **The queue half is an ENQUEUE, not a bare queue-row revival — and that distinction is the whole
     * fix.** Clearing the attempt count and the terminal mark produced a CLAIMABLE row that the drain then
     * REFUSED: `tombstone` prunes `fetch_requesters` (DSN-10), so a blackholed food names no principal and
     * `processRow`'s FR-048 gate re-tombstoned it as `unauthenticated_producer` — parking the food at
     * `PENDING` forever, a permanent `202` to readers and strictly worse than the `404` it had.
     *
     * Going through `EnqueueEmitter.publishFoodRequested` instead of `FetchQueueDao.reactivate` fixes that
     * by RECORDING A PRINCIPAL, which is what FR-048 actually asks for — no authorization rule is relaxed.
     * It also, in the same transaction, gives the recovered row real demand (so `leaseNext` claims it in
     * the promoted tier rather than behind every pending row) and a `pg_notify` that wakes the drainer at
     * once instead of on its next 60s reap tick.
     *
     * The recorded principal is the CONSTANT `svc_admin_requeue`, never the operator: `fetch_requesters`
     * is documented (`foods/userErasure.service.ts`) as the only place this service stores user identity —
     * the right-to-erasure surface — and an admin's own ULID there would both widen that surface and make
     * the food silently re-break if that admin ever erased their account. WHO acted goes in the audit line
     * below, which is the only place that identity lives.
     *
     * ⚠️ `reactivate: true` is load-bearing: the ordinary upsert is guarded `WHERE status = 'pending'`, so
     * on a tombstoned row — which is every blackholed food — it would be a silent no-op.
     *
     * @param foodId - The food to requeue.
     * @param operator - The authenticated operator's id (the verified Clerk `sub`), recorded in the audit
     *   line. Required, so a requeue cannot happen without naming who is accountable for it.
     * @returns The requeued food's id and its new status.
     * @throws {FoodNotFoundError} (→ 404) when no such food exists.
     * @throws {HttpException} `NOT_REQUEUEABLE` (→ 409) when the food is not blackholed at all.
     * @sideEffect Resets `food.status` to `PENDING`, records the `svc_admin_requeue` requester, revives
     *   the queue row, emits `pg_notify('fetch_queued')`, and writes an `operator-requeue` audit record.
     */
    public async requeueFood(foodId: string, operator: string): Promise<RequeueResponse> {
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

        await this.enqueue.publishFoodRequested({ id: foodId, requestedBy: SVC_ADMIN_REQUEUE, reactivate: true });

        // Emitted only after BOTH writes land, so an audit line always means the food was really requeued —
        // and it is the ONLY record of who did it, by design.
        this.logger.info('operator-requeue', { foodId, operator, requestedBy: SVC_ADMIN_REQUEUE });

        return { id: foodId, status: 'PENDING' };
    }

    /**
     * Decide whether a rejected `→ PENDING` transition was benign, and re-raise it as something a caller
     * can act on when it was not.
     *
     * The DAO error is NOT re-thrown: it is internal (its message names the rejected transition), nothing
     * classifies it as anything but a `500`, and a `500` here tells an operator mid-incident "the requeue
     * failed" when the truth is "this food was never stuck". The `409` says which, and the message says
     * what to run instead.
     *
     * @param foodId - The food whose transition was rejected.
     * @throws {FoodNotFoundError} when no row exists at all.
     * @throws {HttpException} `NOT_REQUEUEABLE` when the food is in a state a requeue cannot clear (a
     *   `RESOLVED`/`UNRESOLVED` food is not blackholed — `POST /{id}/refetch` is the route for those).
     * @sideEffect Reads `food`.
     */
    private async assertRequeueable(foodId: string): Promise<void> {
        const food = await this.foodDao.getById(foodId);

        if (!food) {
            throw new FoodNotFoundError(foodId);
        }

        if (food.status !== 'PENDING') {
            throw apiError(
                'NOT_REQUEUEABLE',
                `Food '${foodId}' is ${food.status}, not blackholed — re-fetch it with ` +
                    `POST /api/v1/foods/${foodId}/refetch`,
                { id: foodId, status: food.status },
            );
        }
    }
}
