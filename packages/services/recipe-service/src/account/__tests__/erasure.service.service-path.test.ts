/**
 * Unit tests for {@link ErasureService.requestServiceErasure} — the SERVICE-principal erasure path
 * (CR-002 / U4a), over a mocked DAL, queue, and metrics emitter.
 *
 * Requirement → test map:
 *
 *   - **U4a (phrase skip)** — the service path takes NO confirmation phrase; the verified single-target
 *     token is the authorization. The target owner + actor come from the principal, never a body.
 *     → `describe('a service-principal erasure')`
 *   - **R8 (audit)** — every service job is inserted with `trigger_source='service'` + the token's actor.
 *     → `describe('a service-principal erasure')`
 *   - **U4a (detection)** — a newly-created service erasure emits exactly one volume metric; an idempotent
 *     return or an already-erased no-op does NOT (only genuine new targets count toward the alarm).
 *     → `describe('the volume metric')`
 *   - **R9 (idempotency)** — a job already in flight is returned, not duplicated; an already-erased account
 *     is an idempotent no-op success (NOT a 410, unlike the user path).
 *     → `describe('idempotency (R9)')`
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, ServiceUnavailableException } from '@nestjs/common';

import type { ErasureJobsDal } from '../dal/erasure-jobs.dal.js';
import type { ErasureQueuePort } from '../erasure.queue.js';
import type { ServicePrincipalErasureMetrics } from '../erasure-metrics.js';
import { ErasureService, MAX_ERASURE_REQUEST_ATTEMPTS } from '../erasure.service.js';
import { makeActiveErasureJob } from '../__fixtures__/erasure.fixtures.js';
import type { ServicePrincipal } from '../../auth/service-principal.js';

type DalMock = { [K in keyof ErasureJobsDal]: ReturnType<typeof vi.fn> };
type QueueMock = { [K in keyof ErasureQueuePort]: ReturnType<typeof vi.fn> };
type MetricsMock = { [K in keyof ServicePrincipalErasureMetrics]: ReturnType<typeof vi.fn> };

const OWNER = '01JTARGETOWNER0000000000AA';
const NEW_JOB_ID = '00000000-0000-4000-8000-00000000new1';
const EXISTING_JOB_ID = '00000000-0000-4000-8000-000000000ex1';
const NOW = '2026-07-16T12:00:00.000Z';

const PRINCIPAL: ServicePrincipal = { ownerId: OWNER, eventId: 'evt_del_7', actor: 'identity-deletion-worker' };

function makeDal(): DalMock {
    return {
        hasCompletedJob: vi.fn().mockResolvedValue(false),
        insertQueuedJob: vi.fn().mockResolvedValue(NEW_JOB_ID),
        findActiveJob: vi.fn().mockResolvedValue(undefined),
    };
}

let dal: DalMock;
let queue: QueueMock;
let metrics: MetricsMock;
let service: ErasureService;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    // The service path logs an audit line at `log` level on every accepted/idempotent job; keep it out of
    // the suite output (the log content is not the subject of these tests).
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    dal = makeDal();
    queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    metrics = { recordServicePrincipalErasure: vi.fn() };
    service = new ErasureService(
        dal as unknown as ErasureJobsDal,
        queue as unknown as ErasureQueuePort,
        metrics as unknown as ServicePrincipalErasureMetrics,
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('a service-principal erasure', () => {
    it('inserts a job WITHOUT a confirmation phrase, scoped to the token-bound owner', async () => {
        const result = await service.requestServiceErasure(PRINCIPAL);

        expect(result).toEqual({ jobId: NEW_JOB_ID, status: 'queued', triggerSource: 'service' });
        expect(dal.insertQueuedJob).toHaveBeenCalledOnce();
    });

    it('records trigger_source=service and the token actor (R8), with NO donate election (KTD-2 default delete)', async () => {
        await service.requestServiceErasure(PRINCIPAL);

        expect(dal.insertQueuedJob).toHaveBeenCalledExactlyOnceWith({
            ownerId: OWNER,
            publishRecipeIds: [],
            triggerSource: 'service',
            actor: 'identity-deletion-worker',
        });
    });

    it('enqueues one message for the bound owner (delete-everything: empty election)', async () => {
        await service.requestServiceErasure(PRINCIPAL);

        expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
            ownerId: OWNER,
            requestedAt: NOW,
            publishRecipeIds: [],
        });
    });

    it('erases ONLY the bound owner — a different principal owner never leaks in', async () => {
        await service.requestServiceErasure({ ...PRINCIPAL, ownerId: '01JOTHER0000000000000000BB' });

        const [insertArg] = dal.insertQueuedJob.mock.calls[0] ?? [];
        expect((insertArg as { ownerId: string }).ownerId).toBe('01JOTHER0000000000000000BB');
    });
});

describe('the volume metric', () => {
    it('emits exactly one metric for a NEWLY-created service erasure', async () => {
        await service.requestServiceErasure(PRINCIPAL);

        expect(metrics.recordServicePrincipalErasure).toHaveBeenCalledExactlyOnceWith({ ownerId: OWNER });
    });

    it('does NOT emit for an idempotent return of an already-in-flight job', async () => {
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob({ id: EXISTING_JOB_ID, status: 'running' }));

        await service.requestServiceErasure(PRINCIPAL);

        expect(metrics.recordServicePrincipalErasure).not.toHaveBeenCalled();
    });

    it('does NOT emit for an already-erased no-op', async () => {
        vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        dal.hasCompletedJob.mockResolvedValue(true);

        await service.requestServiceErasure(PRINCIPAL);

        expect(metrics.recordServicePrincipalErasure).not.toHaveBeenCalled();
    });
});

describe('idempotency (R9)', () => {
    it('returns the EXISTING in-flight job rather than enqueuing a second (echo/collision no-op)', async () => {
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob({ id: EXISTING_JOB_ID, status: 'running' }));

        const result = await service.requestServiceErasure(PRINCIPAL);

        expect(result).toEqual({ jobId: EXISTING_JOB_ID, status: 'running', triggerSource: 'service' });
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('treats an already-erased account as an idempotent no-op success — NOT a 410', async () => {
        vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        dal.hasCompletedJob.mockResolvedValue(true);

        const result = await service.requestServiceErasure(PRINCIPAL);

        expect(result).toEqual({ status: 'completed', triggerSource: 'service' });
        expect(dal.insertQueuedJob).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('gives up with a retryable 503 when the race never settles (shared bound with the user path)', async () => {
        vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(undefined);

        await expect(service.requestServiceErasure(PRINCIPAL)).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(dal.insertQueuedJob).toHaveBeenCalledTimes(MAX_ERASURE_REQUEST_ATTEMPTS);
    });
});
