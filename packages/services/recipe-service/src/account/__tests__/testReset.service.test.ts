/**
 * ADR-0040 — unit tests for {@link TestResetService}, the test principal's self-purge Command, over mocked DALs and
 * queue.
 *
 * The rules this pins, and the mutants each would let through:
 *
 *  1. **Only a signed test principal the registry ALSO knows may purge**, and anything else answers the same
 *     `404 NOT_FOUND` a path this service does not route answers — so the door is invisible to real users and a
 *     mis-marked principal the registry never saw cannot destroy data. Dropping either half of the AND fails here.
 *  2. **A principal purges only ITSELF** — the job and the message carry the verified `userId`, and the status query
 *     is scoped by it, so another principal's job id is a `404`.
 *  3. **Repeatable, not one-shot** — an in-flight job is returned rather than duplicated; there is no `410`.
 *  4. **The row is written before the message, and a failed send is not a failed request** — the erasure
 *     service's inversion, for the erasure service's reason: the sweeper re-drains a `queued` row.
 */
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TestPrincipalsDal } from '../../auth/dal/testPrincipals.dal.js';
import { makeActingPrincipal } from '../../auth/__fixtures__/actingPrincipal.fixtures.js';
import type { TestResetJobsDal } from '../dal/testResetJobs.dal.js';
import type { ErasureQueuePort } from '../erasure.queue.js';
import { TestResetService } from '../testReset.service.js';

const USER = '01JZRESETTESTPRINCIPAL0001';
const JOB_ID = '00000000-0000-4000-8000-0000000000f1';
const NOW = '2026-09-13T12:00:00.000Z';
const TEST = makeActingPrincipal(USER, { principalKind: 'test' });
const TEST_ON_OFF_STAGE = makeActingPrincipal(USER, { principalKind: 'test', containment: 'off' });
const REAL = makeActingPrincipal(USER);

let registry: { isRegistered: ReturnType<typeof vi.fn> };
let jobs: {
    insertQueuedJob: ReturnType<typeof vi.fn>;
    findActiveJob: ReturnType<typeof vi.fn>;
    findOwnJob: ReturnType<typeof vi.fn>;
};
let queue: { enqueue: ReturnType<typeof vi.fn> };
let service: TestResetService;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    registry = { isRegistered: vi.fn().mockResolvedValue(true) };
    jobs = {
        insertQueuedJob: vi.fn().mockResolvedValue(JOB_ID),
        findActiveJob: vi.fn().mockResolvedValue(undefined),
        findOwnJob: vi.fn().mockResolvedValue(undefined),
    };
    queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    service = new TestResetService(
        jobs as unknown as TestResetJobsDal,
        registry as unknown as TestPrincipalsDal,
        queue as unknown as ErasureQueuePort,
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** The status and code a rejected call answered with. */
async function outcomeOf(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
    const error = await promise.then(
        () => expect.unreachable('expected a refusal'),
        (thrown: unknown) => thrown,
    );

    if (!(error instanceof HttpException)) {
        throw error;
    }

    return { status: error.getStatus(), code: (error.getResponse() as { code: string }).code };
}

describe('who may purge (ADR-0040: claim AND registry)', () => {
    it('⛔ answers 404 NOT_FOUND to a REAL principal and touches nothing', async () => {
        expect(await outcomeOf(service.requestReset(REAL))).toEqual({ status: 404, code: 'NOT_FOUND' });
        expect(registry.isRegistered).not.toHaveBeenCalled();
        expect(jobs.insertQueuedJob).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('⛔ answers 404 to a signed test principal the REGISTRY does not know, and writes nothing', async () => {
        registry.isRegistered.mockResolvedValue(false);

        expect(await outcomeOf(service.requestReset(TEST))).toEqual({ status: 404, code: 'NOT_FOUND' });
        expect(registry.isRegistered).toHaveBeenCalledWith(USER);
        expect(jobs.insertQueuedJob).not.toHaveBeenCalled();
    });

    it('accepts a signed, registered test principal on an ENFORCING stage — containment does not close this door', async () => {
        expect(await service.requestReset(TEST)).toEqual({ jobId: JOB_ID, status: 'queued' });
    });

    it('accepts a signed, registered test principal where containment is off — the reset is the same Command on every stage', async () => {
        expect(await service.requestReset(TEST_ON_OFF_STAGE)).toEqual({ jobId: JOB_ID, status: 'queued' });
    });

    it('⛔ applies the SAME gate to the status query — a real principal cannot learn a job exists', async () => {
        expect(await outcomeOf(service.getReset(REAL, JOB_ID))).toEqual({ status: 404, code: 'NOT_FOUND' });
        expect(jobs.findOwnJob).not.toHaveBeenCalled();
    });
});

describe('requesting a reset', () => {
    it('writes the job for the VERIFIED principal, then enqueues a testPrincipalReset for that principal alone', async () => {
        await service.requestReset(TEST);

        expect(jobs.insertQueuedJob).toHaveBeenCalledExactlyOnceWith(USER);
        expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
            kind: 'testPrincipalReset',
            ownerId: USER,
            requestedAt: NOW,
        });
        expect(jobs.insertQueuedJob.mock.invocationCallOrder[0]).toBeLessThan(
            queue.enqueue.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
        );
    });

    it('returns the job ALREADY in flight rather than starting a second purge, and sends nothing', async () => {
        jobs.insertQueuedJob.mockResolvedValue(undefined);
        jobs.findActiveJob.mockResolvedValue({ id: JOB_ID, status: 'running' });

        expect(await service.requestReset(TEST)).toEqual({ jobId: JOB_ID, status: 'running' });
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('re-evaluates when the in-flight job completed between the lost insert and the re-read', async () => {
        jobs.insertQueuedJob.mockResolvedValueOnce(undefined).mockResolvedValueOnce(JOB_ID);
        jobs.findActiveJob.mockResolvedValueOnce(undefined);

        expect(await service.requestReset(TEST)).toEqual({ jobId: JOB_ID, status: 'queued' });
        expect(jobs.insertQueuedJob).toHaveBeenCalledTimes(2);
    });

    it('gives up with a retryable 503 rather than spinning when the race never settles', async () => {
        jobs.insertQueuedJob.mockResolvedValue(undefined);
        jobs.findActiveJob.mockResolvedValue(undefined);

        expect((await outcomeOf(service.requestReset(TEST))).status).toBe(503);
    });

    it('⛔ still answers 202 when the send FAILS — the queued row is durable and the sweeper re-drains it', async () => {
        vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        queue.enqueue.mockRejectedValue(new Error('SQS down'));

        expect(await service.requestReset(TEST)).toEqual({ jobId: JOB_ID, status: 'queued' });
    });
});

describe('reading a reset', () => {
    it('answers the principal’s own job, scoped by its verified id', async () => {
        const created = new Date('2026-09-13T11:59:00.000Z');
        const updated = new Date('2026-09-13T11:59:30.000Z');
        jobs.findOwnJob.mockResolvedValue({ id: JOB_ID, status: 'completed', createdAt: created, updatedAt: updated });

        expect(await service.getReset(TEST, JOB_ID)).toEqual({
            jobId: JOB_ID,
            status: 'completed',
            createdAt: created.toISOString(),
            updatedAt: updated.toISOString(),
        });
        expect(jobs.findOwnJob).toHaveBeenCalledExactlyOnceWith(USER, JOB_ID);
    });

    it('⛔ answers 404 for a job id that is not the principal’s own', async () => {
        expect(await outcomeOf(service.getReset(TEST, JOB_ID))).toEqual({ status: 404, code: 'NOT_FOUND' });
    });

    it('⛔ answers 404 — never a 400 — for a job id that is not a UUID, so validation cannot reveal the route', async () => {
        expect(await outcomeOf(service.getReset(TEST, 'not-a-uuid'))).toEqual({ status: 404, code: 'NOT_FOUND' });
        expect(jobs.findOwnJob).not.toHaveBeenCalled();
    });
});
