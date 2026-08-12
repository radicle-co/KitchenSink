/**
 * Unit tests for the identity {@link HealthController} (ARCH-PS-3). Proves liveness stays static and
 * readiness reflects the DB: `200` when `SELECT 1` resolves, `503` when it rejects or times out.
 *
 * Also pins the drift-layer-3 SKEW SIGNAL (`docs/CODING_STANDARDS.md` §15.2.5): both `200` payloads must
 * carry `contractHash`, because a consumer cannot detect "this service is serving a contract my pinned
 * schema does not describe" unless the service says which contract it is serving.
 *
 * NOTE: identity's vitest config only discovers the tests directory, so this unit test lives here
 * (rather than co-located under src) so it actually runs.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONTRACT_HASH } from '../src/contract/contract-hash.js';
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

        expect(controller.getHealth()).toEqual({ status: 'ok', service: 'identity', contractHash: CONTRACT_HASH });
        expect(execute).not.toHaveBeenCalled();
    });

    it('readiness returns 200 ok when the SELECT 1 probe resolves', async () => {
        const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
        const controller = makeController(execute);

        await expect(controller.getReadiness()).resolves.toEqual({
            status: 'ok',
            service: 'identity',
            contractHash: CONTRACT_HASH,
        });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    // The skew signal is only useful if it is the REAL fingerprint. A hard-coded or truncated stamp would
    // satisfy `toEqual(CONTRACT_HASH)` above while telling every consumer nothing, so assert the SHAPE the
    // generator emits independently of the constant.
    it('publishes the contract fingerprint as a full lower-case hex SHA-256 on both probes', async () => {
        const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
        const controller = makeController(execute);

        expect(controller.getHealth().contractHash).toMatch(/^[0-9a-f]{64}$/u);
        expect((await controller.getReadiness()).contractHash).toMatch(/^[0-9a-f]{64}$/u);
    });

    // Two routes, ONE payload. If liveness and readiness ever answered with different fingerprints, a
    // consumer probing one of them would draw a conclusion that does not hold for the other.
    it('answers both probes with the identical payload, so the two cannot disagree', async () => {
        const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
        const controller = makeController(execute);

        expect(controller.getHealth()).toEqual(await controller.getReadiness());
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
