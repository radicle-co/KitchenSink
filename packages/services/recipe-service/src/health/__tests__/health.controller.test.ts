/**
 * ARCH-PS-3-test — unit tests for {@link HealthController}.
 *
 * Pins the liveness/readiness split: liveness is a static `ok` that never touches the DB; readiness
 * runs a `SELECT 1` and returns `200` on success, `503` on a failed query, and `503` on a query that
 * exceeds the probe timeout.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';

import { CONTRACT_HASH } from '../../contract/contract-hash.js';
import { HealthController, READINESS_QUERY_TIMEOUT_MS } from '../health.controller.js';

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

        it('throws 503 when the probe query rejects', async () => {
            const query = vi.fn().mockRejectedValue(new Error('pool exhausted'));
            const controller = new HealthController(makePool(query));

            await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
        });

        it('throws 503 when the probe query exceeds the timeout', async () => {
            vi.useFakeTimers();
            // A query that never settles must not hang the probe — the timeout fires and yields 503.
            const query = vi.fn().mockReturnValue(new Promise<never>(() => {}));
            const controller = new HealthController(makePool(query));

            const pending = controller.getReadiness();
            const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
            await vi.advanceTimersByTimeAsync(READINESS_QUERY_TIMEOUT_MS);
            await assertion;
        });
    });
});
