/**
 * Unit tests for {@link FoodRecoveryService} (U9) — the operator's way back from a blackholed food, over a
 * `FoodDao` double that enforces the REAL FR-028a `→ PENDING` transition rule.
 *
 * Requirement → test mapping:
 * - U9 / R2.4 → the requeue writes BOTH halves in the documented order, is idempotent for a food that is
 *   already pending, reports an unknown id as `FoodNotFoundError` (→ 404), and reports a food that is not
 *   blackholed at all as `NOT_REQUEUEABLE` (→ 409) naming the refetch route.
 *
 * These cases were `adminMetrics.service.test.ts`'s `requeueFood` describe until the operation moved off the
 * read-only metrics service; they moved with it and gained the 409 cases.
 *
 * The rejection is asserted by STATUS + published `code`, never by which `HttpException` subclass was
 * constructed — the status comes from the one `FOOD_ERROR_STATUS` table (`common/apiError.ts`).
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ApiErrorBody } from '../../../common/apiError.schema.js';
import { FoodRecoveryService } from '../foodRecovery.service.js';
import type { FoodRequestedInput } from '../../enqueue.emitter.js';
import { SVC_ADMIN_REQUEUE } from '../../../worker/change-refresh/changeRefresh.consumer.js';
import { SilentWorkerLogger } from '../../../worker/SilentWorkerLogger.js';
import type { LogContext, WorkerLogger } from '../../../worker/workerLogger.js';
import { IllegalStatusTransitionError } from '../../dao/dao.errors.js';
import { isFoodNotFoundError } from '../../foods.errors.js';

/**
 * A `FoodDao` double that enforces the real FR-028a rule for `→ PENDING`: legal only from `FAILED`,
 * `NOT_FOUND` and `AWAITING_RETRY`. Stating the rule (rather than a canned resolve/reject) is what lets these
 * tests distinguish "handled the rejection" from "never provoked one".
 */
function fakeFoodDao(status: string | undefined, trace: string[] = []): never {
    const legalPriors = new Set(['FAILED', 'NOT_FOUND', 'AWAITING_RETRY']);

    return {
        setStatus: async ({ id }: { id: string }) => {
            trace.push('setStatus');

            if (status === undefined || !legalPriors.has(status)) {
                throw new IllegalStatusTransitionError(id, 'PENDING');
            }

            return { id, status: 'PENDING' };
        },
        getById: async (id: string) => {
            trace.push('getById');

            return status === undefined ? undefined : { id, status };
        },
    } as never;
}

/**
 * An `EnqueueEmitter` double recording that (and when) the queue half ran, AND the enqueue it was asked
 * to publish. The RECORDED REQUESTER is the whole of U9's recovery fix, so a double that merely counted
 * calls would prove nothing: `tombstone` prunes `fetch_requesters` (DSN-10), so unless the requeue
 * records a principal of its own the revived row names none and the drain re-tombstones the food as
 * `unauthenticated_producer` — leaving it PENDING forever.
 */
function fakeEnqueue(trace: string[] = [], published: FoodRequestedInput[] = []): never {
    return {
        publishFoodRequested: async (input: FoodRequestedInput) => {
            trace.push('enqueue');
            published.push(input);
        },
    } as never;
}

/** A `WorkerLogger` double capturing the structured records the service emitted. */
function capturingLogger(): { logger: WorkerLogger; records: { message: string; context?: LogContext }[] } {
    const records: { message: string; context?: LogContext }[] = [];

    const record = (message: string, context?: LogContext): void => {
        records.push({ message, context });
    };

    return { logger: { info: record, warn: record, error: record }, records };
}

/** The authenticated operator id every case requeues as (the Clerk `sub` — the audit identity). */
const OPERATOR = 'admin_2xyz';

/**
 * Run a requeue that must fail, and return the thrown value.
 *
 * @param service - The service under test.
 * @param foodId - The id to requeue.
 * @returns Whatever `requeueFood` threw.
 */
async function requeueRejection(service: FoodRecoveryService, foodId: string): Promise<unknown> {
    try {
        await service.requeueFood(foodId, OPERATOR);
    } catch (error) {
        return error;
    }

    return expect.unreachable('the requeue resolved where it had to fail');
}

describe('FoodRecoveryService.requeueFood (U9 — the way back from a blackholed food)', () => {
    it('clears the lifecycle mark BEFORE the queue half, so a mid-failure leaves the food retryable', async () => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(
            fakeFoodDao('FAILED', trace),
            fakeEnqueue(trace),
            new SilentWorkerLogger(),
        );

        await expect(service.requeueFood('food-1', OPERATOR)).resolves.toStrictEqual({
            id: 'food-1',
            status: 'PENDING',
        });

        expect(trace).toStrictEqual(['setStatus', 'enqueue']);
    });

    it.each(['NOT_FOUND', 'AWAITING_RETRY'])('recovers a food resting in %s', async (status) => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(
            fakeFoodDao(status, trace),
            fakeEnqueue(trace),
            new SilentWorkerLogger(),
        );

        await expect(service.requeueFood('food-1', OPERATOR)).resolves.toMatchObject({ status: 'PENDING' });
        expect(trace).toStrictEqual(['setStatus', 'enqueue']);
    });

    it('is idempotent for an already-PENDING food — and STILL runs the queue half', async () => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(
            fakeFoodDao('PENDING', trace),
            fakeEnqueue(trace),
            new SilentWorkerLogger(),
        );

        await expect(service.requeueFood('food-1', OPERATOR)).resolves.toStrictEqual({
            id: 'food-1',
            status: 'PENDING',
        });

        // The rejected write is classified by a read, then the queue half runs anyway: an operator whose
        // first call already reset the lifecycle must still get the attempt count cleared.
        expect(trace).toStrictEqual(['setStatus', 'getById', 'enqueue']);
    });

    it('reports an unknown id as FoodNotFoundError (404) and never touches the queue for a food that is absent', async () => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(
            fakeFoodDao(undefined, trace),
            fakeEnqueue(trace),
            new SilentWorkerLogger(),
        );

        await expect(service.requeueFood('missing', OPERATOR)).rejects.toSatisfy(isFoodNotFoundError);
        expect(trace).not.toContain('enqueue');
    });

    /**
     * THE 409 CASES. A `RESOLVED`/`UNRESOLVED` food is not blackholed, so a requeue is the wrong operation on
     * it — but it is the OPERATOR who is wrong, not the service, and this used to answer `500`. Mid-incident
     * that reads as "the requeue failed", which is the worst answer available: it invites a retry loop against
     * a food that was never stuck.
     */
    describe('a food that is not blackholed is a 409, not a 500 and not a silent success', () => {
        it.each(['RESOLVED', 'UNRESOLVED'])('rejects a %s food with 409 NOT_REQUEUEABLE', async (status) => {
            const trace: string[] = [];
            const service = new FoodRecoveryService(
                fakeFoodDao(status, trace),
                fakeEnqueue(trace),
                new SilentWorkerLogger(),
            );

            const thrown = await requeueRejection(service, 'food-1');

            expect(thrown).toBeInstanceOf(HttpException);
            expect((thrown as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);

            const body = (thrown as HttpException).getResponse() as ApiErrorBody;
            expect(body.code).toBe('NOT_REQUEUEABLE');
            expect(body.details).toStrictEqual({ id: 'food-1', status });
        });

        // The whole point of choosing `409` over `500`: the answer has to tell the operator what to do
        // instead. A body that merely says "conflict" leaves them exactly as stuck as the 500 did.
        it('names the refetch route in the message, so the operator is not left guessing', async () => {
            const service = new FoodRecoveryService(fakeFoodDao('RESOLVED'), fakeEnqueue(), new SilentWorkerLogger());

            const thrown = await requeueRejection(service, 'food-1');

            expect(((thrown as HttpException).getResponse() as ApiErrorBody).message).toContain(
                '/api/v1/foods/food-1/refetch',
            );
        });

        it('leaves the queue untouched — a healthy food is never requeued into the drain', async () => {
            const trace: string[] = [];
            const service = new FoodRecoveryService(
                fakeFoodDao('RESOLVED', trace),
                fakeEnqueue(trace),
                new SilentWorkerLogger(),
            );

            await requeueRejection(service, 'food-1');

            expect(trace).toStrictEqual(['setStatus', 'getById']);
        });

        // The DAO error's own contract says it is INTERNAL: its message names the rejected transition and is
        // not something a caller should ever read. Leaking it would also re-raise it as a 500, since the
        // filter has no arm for a DAO type.
        it('does not leak the DAO error out of the service boundary', async () => {
            const service = new FoodRecoveryService(fakeFoodDao('RESOLVED'), fakeEnqueue(), new SilentWorkerLogger());

            const thrown = await requeueRejection(service, 'food-1');

            expect(thrown).not.toBeInstanceOf(IllegalStatusTransitionError);
            expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain('Illegal status');
        });
    });

    it('does not swallow a non-transition failure from the lifecycle write', async () => {
        const boom = new Error('connection terminated');
        const foodDao = { setStatus: vi.fn().mockRejectedValue(boom), getById: vi.fn() } as never;
        const service = new FoodRecoveryService(foodDao, fakeEnqueue(), new SilentWorkerLogger());

        await expect(service.requeueFood('food-1', OPERATOR)).rejects.toBe(boom);
    });
});

/**
 * THE RECOVERY HALF (U9 × FR-048). Clearing the attempt count and the terminal mark is necessary but not
 * sufficient: `tombstone` prunes `fetch_requesters` (DSN-10), so a bare queue revival names NO principal
 * and the drain's producer-provenance gate re-tombstones the food as `unauthenticated_producer` — leaving
 * it at `PENDING` forever, which is a WORSE answer to a reader than the `404` it had.
 *
 * The requeue therefore goes through the ORDINARY enqueue path as the named service principal
 * `svc_admin_requeue`, exactly as change-refresh does with `svc_change_refresh`. The operator's own id
 * must NOT go into `fetch_requesters` (the user-erasure surface, `foods/userErasure.service.ts`); WHO
 * acted is recorded in a structured audit line instead.
 */
describe('FoodRecoveryService.requeueFood — producer provenance for the recovered row (U9 × FR-048)', () => {
    it('re-enqueues as SVC_ADMIN_REQUEUE with reactivate, so the next drain does not refuse it', async () => {
        const published: FoodRequestedInput[] = [];
        const service = new FoodRecoveryService(
            fakeFoodDao('FAILED'),
            fakeEnqueue([], published),
            new SilentWorkerLogger(),
        );

        await service.requeueFood('food-1', OPERATOR);

        // `reactivate: true` is not optional: the ordinary upsert is guarded `WHERE status = 'pending'`,
        // so on a TOMBSTONED row — which is every blackholed food — it would be a silent no-op.
        expect(published).toStrictEqual([{ id: 'food-1', requestedBy: SVC_ADMIN_REQUEUE, reactivate: true }]);
    });

    it('⛔ never records the OPERATOR as the requester — that id must not reach fetch_requesters', async () => {
        // The whole reason for a constant service principal: `fetch_requesters` is the user-erasure
        // surface, so an admin's own id there would widen it AND would re-break the food if that admin
        // ever erased their account. If this assertion fails, that coupling has been reintroduced.
        const published: FoodRequestedInput[] = [];
        const service = new FoodRecoveryService(
            fakeFoodDao('FAILED'),
            fakeEnqueue([], published),
            new SilentWorkerLogger(),
        );

        await service.requeueFood('food-1', OPERATOR);

        expect(published[0]?.requestedBy).not.toBe(OPERATOR);
        expect(published[0]?.requestedBy).toMatch(/^svc_/u);
    });

    it('re-enqueues on the IDEMPOTENT path too — a second requeue must not leave the row unattributed', async () => {
        // The already-`PENDING` food is the one an operator hits twice mid-incident. If only the first
        // call recorded a requester, the food a colleague "already requeued" would still be refused.
        const published: FoodRequestedInput[] = [];
        const service = new FoodRecoveryService(
            fakeFoodDao('PENDING'),
            fakeEnqueue([], published),
            new SilentWorkerLogger(),
        );

        await service.requeueFood('food-1', OPERATOR);

        expect(published).toStrictEqual([{ id: 'food-1', requestedBy: SVC_ADMIN_REQUEUE, reactivate: true }]);
    });

    it('logs the accountable operator — the WHO lives in the audit line, never in fetch_requesters', async () => {
        const { logger, records } = capturingLogger();
        const service = new FoodRecoveryService(fakeFoodDao('FAILED'), fakeEnqueue(), logger);

        await service.requeueFood('food-1', OPERATOR);

        const requeued = records.find((entry) => entry.message === 'operator-requeue');
        expect(requeued).toBeDefined();
        expect(requeued?.context).toMatchObject({ foodId: 'food-1', operator: OPERATOR });
    });

    it('does not log a requeue that was REFUSED — an audit line must mean the row was actually marked', async () => {
        const { logger, records } = capturingLogger();
        const service = new FoodRecoveryService(fakeFoodDao('RESOLVED'), fakeEnqueue(), logger);

        await requeueRejection(service, 'food-1');

        expect(records.filter((entry) => entry.message === 'operator-requeue')).toHaveLength(0);
    });
});
