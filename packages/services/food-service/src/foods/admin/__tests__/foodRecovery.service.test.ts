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

/** A `FetchQueueDao` double recording that (and when) the queue half ran. */
function fakeQueue(trace: string[] = []): never {
    return {
        reactivate: async () => {
            trace.push('reactivate');
        },
    } as never;
}

/**
 * Run a requeue that must fail, and return the thrown value.
 *
 * @param service - The service under test.
 * @param foodId - The id to requeue.
 * @returns Whatever `requeueFood` threw.
 */
async function requeueRejection(service: FoodRecoveryService, foodId: string): Promise<unknown> {
    try {
        await service.requeueFood(foodId);
    } catch (error) {
        return error;
    }

    return expect.unreachable('the requeue resolved where it had to fail');
}

describe('FoodRecoveryService.requeueFood (U9 — the way back from a blackholed food)', () => {
    it('clears the lifecycle mark BEFORE the queue half, so a mid-failure leaves the food retryable', async () => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(fakeFoodDao('FAILED', trace), fakeQueue(trace));

        await expect(service.requeueFood('food-1')).resolves.toStrictEqual({ id: 'food-1', status: 'PENDING' });

        expect(trace).toStrictEqual(['setStatus', 'reactivate']);
    });

    it.each(['NOT_FOUND', 'AWAITING_RETRY'])('recovers a food resting in %s', async (status) => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(fakeFoodDao(status, trace), fakeQueue(trace));

        await expect(service.requeueFood('food-1')).resolves.toMatchObject({ status: 'PENDING' });
        expect(trace).toStrictEqual(['setStatus', 'reactivate']);
    });

    it('is idempotent for an already-PENDING food — and STILL runs the queue half', async () => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(fakeFoodDao('PENDING', trace), fakeQueue(trace));

        await expect(service.requeueFood('food-1')).resolves.toStrictEqual({ id: 'food-1', status: 'PENDING' });

        // The rejected write is classified by a read, then the queue half runs anyway: an operator whose
        // first call already reset the lifecycle must still get the attempt count cleared.
        expect(trace).toStrictEqual(['setStatus', 'getById', 'reactivate']);
    });

    it('reports an unknown id as FoodNotFoundError (404) and never touches the queue for a food that is absent', async () => {
        const trace: string[] = [];
        const service = new FoodRecoveryService(fakeFoodDao(undefined, trace), fakeQueue(trace));

        await expect(service.requeueFood('missing')).rejects.toSatisfy(isFoodNotFoundError);
        expect(trace).not.toContain('reactivate');
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
            const service = new FoodRecoveryService(fakeFoodDao(status, trace), fakeQueue(trace));

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
            const service = new FoodRecoveryService(fakeFoodDao('RESOLVED'), fakeQueue());

            const thrown = await requeueRejection(service, 'food-1');

            expect(((thrown as HttpException).getResponse() as ApiErrorBody).message).toContain(
                '/api/v1/foods/food-1/refetch',
            );
        });

        it('leaves the queue untouched — a healthy food is never requeued into the drain', async () => {
            const trace: string[] = [];
            const service = new FoodRecoveryService(fakeFoodDao('RESOLVED', trace), fakeQueue(trace));

            await requeueRejection(service, 'food-1');

            expect(trace).toStrictEqual(['setStatus', 'getById']);
        });

        // The DAO error's own contract says it is INTERNAL: its message names the rejected transition and is
        // not something a caller should ever read. Leaking it would also re-raise it as a 500, since the
        // filter has no arm for a DAO type.
        it('does not leak the DAO error out of the service boundary', async () => {
            const service = new FoodRecoveryService(fakeFoodDao('RESOLVED'), fakeQueue());

            const thrown = await requeueRejection(service, 'food-1');

            expect(thrown).not.toBeInstanceOf(IllegalStatusTransitionError);
            expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain('Illegal status');
        });
    });

    it('does not swallow a non-transition failure from the lifecycle write', async () => {
        const boom = new Error('connection terminated');
        const foodDao = { setStatus: vi.fn().mockRejectedValue(boom), getById: vi.fn() } as never;
        const service = new FoodRecoveryService(foodDao, fakeQueue());

        await expect(service.requeueFood('food-1')).rejects.toBe(boom);
    });
});
