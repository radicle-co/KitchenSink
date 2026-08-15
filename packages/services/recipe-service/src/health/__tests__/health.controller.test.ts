/**
 * ARCH-PS-3-test — unit tests for {@link HealthController}.
 *
 * Pins the liveness/readiness split: liveness is a static `ok` that never touches the DB; readiness
 * runs a `SELECT 1` and returns `200` on success, `503` on a failed query, and `503` on a query that
 * exceeds the probe timeout.
 *
 * The `503` body is the standard error envelope (`code: NOT_READY`). It used to be a bespoke
 * `{ status: 'unavailable', service: 'recipe' }` — a FIFTH error shape on this service's wire — which the
 * error-envelope convergence retired along with the filter's passthrough branch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type pg from 'pg';

import { CONTRACT_HASH } from '../../contract/contractHash.js';
import { HealthController, READINESS_QUERY_TIMEOUT_MS } from '../health.controller.js';

/**
 * Assert a rejection is the readiness failure: a `503` carrying the `NOT_READY` envelope.
 *
 * ⚠️ ASSERTED ON `getStatus()` AND THE BODY, NOT ON THE EXCEPTION SUBCLASS — this used to be
 * `toBeInstanceOf(ServiceUnavailableException)`. The controller now raises `apiError('NOT_READY', …)`, which
 * returns a BARE `HttpException` on purpose: choosing `ServiceUnavailableException` would be choosing the status
 * a second time, from a second place, when the code→status table already assigns it (see `common/apiError.ts`).
 * So the subclass is not part of the contract and asserting it would pin an implementation detail; the status and
 * the body ARE the contract.
 *
 * @param thrown - The rejection value.
 * @sideEffect None.
 */
function expectNotReady(thrown: unknown): void {
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((thrown as HttpException).getResponse()).toStrictEqual({
        code: 'NOT_READY',
        message: 'Database not reachable',
    });
}

/** A pool exposing only the `query` method the controller uses. */
function makePool(query: ReturnType<typeof vi.fn>): pg.Pool {
    return { query } as unknown as pg.Pool;
}

describe('HealthController', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('liveness (GET /health)', () => {
        it('returns a static ok payload without touching the database', () => {
            const query = vi.fn();
            const controller = new HealthController(makePool(query));

            expect(controller.getHealth()).toEqual({ status: 'ok', service: 'recipe', contractHash: CONTRACT_HASH });
            expect(query).not.toHaveBeenCalled();
        });
    });

    describe('readiness (GET /health/ready)', () => {
        it('returns 200 ok when the SELECT 1 probe resolves', async () => {
            const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
            const controller = new HealthController(makePool(query));

            await expect(controller.getReadiness()).resolves.toEqual({
                status: 'ok',
                service: 'recipe',
                contractHash: CONTRACT_HASH,
            });
            expect(query).toHaveBeenCalledWith('SELECT 1');
        });

        it('throws the NOT_READY 503 when the probe query rejects', async () => {
            const query = vi.fn().mockRejectedValue(new Error('pool exhausted'));
            const controller = new HealthController(makePool(query));

            await expect(controller.getReadiness()).rejects.toSatisfy((thrown: unknown) => {
                expectNotReady(thrown);

                return true;
            });
        });

        // The probe is UNAUTHENTICATED, so the body must not name the dependency or echo the underlying failure.
        // `pool exhausted` is exactly the kind of operational detail that must stay in the log line.
        it('never leaks the underlying failure to an unauthenticated caller', async () => {
            const query = vi.fn().mockRejectedValue(new Error('pool exhausted: postgres://u:p@host/db'));
            const controller = new HealthController(makePool(query));

            const thrown = await controller.getReadiness().catch((error: unknown) => error);

            expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain('postgres://');
            expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain('pool exhausted');
        });

        it('throws 503 when the probe query exceeds the timeout', async () => {
            vi.useFakeTimers();
            // A query that never settles must not hang the probe — the timeout fires and yields 503.
            const query = vi.fn().mockReturnValue(new Promise<never>(() => {}));
            const controller = new HealthController(makePool(query));

            const pending = controller.getReadiness().catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(READINESS_QUERY_TIMEOUT_MS);
            expectNotReady(await pending);
        });
    });
});
