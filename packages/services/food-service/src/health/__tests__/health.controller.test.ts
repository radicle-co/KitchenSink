/**
 * Unit tests for the food {@link HealthController} (ARCH-PS-3). Proves liveness stays static and
 * readiness reflects the DB pool: `200` when `SELECT 1` resolves, `503` when it rejects or times out.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthController } from '../health.controller.js';

function makeController(query: ReturnType<typeof vi.fn>): HealthController {
    return new HealthController({ query } as unknown as Pool);
}

describe('HealthController (food)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('liveness returns a static ok payload without touching the pool', () => {
        const query = vi.fn();
        const controller = makeController(query);

        expect(controller.getHealth()).toEqual({ status: 'ok', service: 'food' });
        expect(query).not.toHaveBeenCalled();
    });

    it('readiness returns 200 ok when the SELECT 1 probe resolves', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
        const controller = makeController(query);

        await expect(controller.getReadiness()).resolves.toEqual({ status: 'ok', service: 'food' });
        expect(query).toHaveBeenCalledWith('SELECT 1');
    });

    it('readiness throws 503 (ServiceUnavailable) when the probe rejects', async () => {
        const query = vi.fn().mockRejectedValue(new Error('connection terminated: 10.0.3.14 password=secret'));
        const controller = makeController(query);

        await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('readiness throws 503 when the probe hangs past the timeout budget', async () => {
        vi.useFakeTimers();
        const query = vi.fn().mockReturnValue(new Promise(() => {})); // never settles
        const controller = makeController(query);

        const pending = controller.getReadiness();
        // Attach a rejection handler synchronously so the timeout rejection is never "unhandled".
        const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);

        await vi.advanceTimersByTimeAsync(2000);
        await assertion;
    });

    it('readiness never leaks the underlying DB failure detail', async () => {
        const query = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.3.14:5432 password=hunter2'));
        const controller = makeController(query);

        const error = await controller.getReadiness().catch((e: unknown) => e);
        const body = (error as ServiceUnavailableException).getResponse();

        expect(JSON.stringify(body)).not.toContain('hunter2');
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    });
});
