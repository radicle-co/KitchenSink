/**
 * Unit tests for the identity {@link HealthController} (ARCH-PS-3). Proves liveness stays static and
 * readiness reflects the DB: `200` when `SELECT 1` resolves, `503` when it rejects or times out.
 *
 * NOTE: identity's vitest config only discovers the tests directory, so this unit test lives here
 * (rather than co-located under src) so it actually runs.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthController } from '../src/health/health.controller.js';
import type { ReadinessExecutor } from '../src/health/readiness.js';

function makeController(execute: ReturnType<typeof vi.fn>): HealthController {
    return new HealthController({ execute } as unknown as ReadinessExecutor);
}

describe('HealthController (identity)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('liveness returns a static ok payload without touching the DB', () => {
        const execute = vi.fn();
        const controller = makeController(execute);

        expect(controller.getHealth()).toEqual({ status: 'ok', service: 'identity' });
        expect(execute).not.toHaveBeenCalled();
    });

    it('readiness returns 200 ok when the SELECT 1 probe resolves', async () => {
        const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
        const controller = makeController(execute);

        await expect(controller.getReadiness()).resolves.toEqual({ status: 'ok', service: 'identity' });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('readiness throws 503 (ServiceUnavailable) when the probe rejects', async () => {
        const execute = vi.fn().mockRejectedValue(new Error('connection terminated: 10.0.3.14 password=secret'));
        const controller = makeController(execute);

        await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('readiness throws 503 when the probe hangs past the timeout budget', async () => {
        vi.useFakeTimers();
        const execute = vi.fn().mockReturnValue(new Promise(() => {})); // never settles
        const controller = makeController(execute);

        const pending = controller.getReadiness();
        const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);

        await vi.advanceTimersByTimeAsync(2000);
        await assertion;
    });

    it('readiness never leaks the underlying DB failure detail', async () => {
        const execute = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.3.14:5432 password=hunter2'));
        const controller = makeController(execute);

        const error = await controller.getReadiness().catch((e: unknown) => e);
        const body = (error as ServiceUnavailableException).getResponse();

        expect(JSON.stringify(body)).not.toContain('hunter2');
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    });
});
