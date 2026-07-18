/**
 * T134-test — unit tests for {@link ErasureService} over a mocked {@link ErasureJobsDal} and a mocked
 * {@link ErasureQueuePort}. No database, no SQS.
 *
 * Requirement → test map:
 *
 *   - **C-007 / T134 (enqueue)** — "queues job": a first request inserts a `queued` row and sends exactly
 *     one `{ ownerId, requestedAt }` message → `202 { jobId, status: 'queued' }`.
 *     → `describe('a first erasure request')`
 *   - **C-007 (idempotency, `queued`)** — a duplicate while a job is `queued` returns `202` with the
 *     **existing** job id and does NOT enqueue a second message.
 *     → `describe('a duplicate request while a job is in flight')`
 *   - **C-007 (idempotency, `running`)** — same, with `status: 'running'` surfaced.
 *     → `describe('a duplicate request while a job is in flight')`
 *   - **C-007 (already erased)** — after a `completed` job the endpoint is `410 ALREADY_ERASED`, and the
 *     check happens BEFORE any insert/enqueue.
 *     → `describe('a request after a completed job')`
 *   - **C-007 (retry after failure)** — after a `failed` job a fresh `queued` job is enqueued → `202`.
 *     → `describe('a request after a failed job')`
 *   - **C-007 (TOCTOU race)** — the partial unique index `idx_erasure_jobs_active_owner` is the
 *     enforcement point: a lost insert race is the idempotent path (`202` with the winner's id), never a
 *     `500`; and a job that terminates between the conflict and the re-read re-evaluates from the top.
 *     → `describe('the insert race on idx_erasure_jobs_active_owner')`
 *   - **FR-038 (owner scoping)** — every DAL/queue call is keyed on the caller's own `ownerId`.
 *     → asserted throughout
 *   - **T134 / U7 (confirmation phrase)** — REQUIRED: an absent, empty, or wrong phrase rejects with 400
 *     BEFORE any row is written or message sent.
 *     → `describe('the required confirmation phrase (U7)')`
 *   - **D7 / T136b (durability)** — the ROW is the durable record and the message is derived, so a failed
 *     enqueue must not fail the request nor roll the row back (the cron sweeper re-drains it).
 *     → `describe('a failed enqueue')`
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, GoneException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ACCOUNT_ALREADY_ERASED_CODE } from '@kitchensink/recipe-core';

import type { ErasureJobsDal } from '../dal/erasure-jobs.dal.js';
import type { ErasureQueuePort } from '../erasure.queue.js';
import { ErasureService, MAX_ERASURE_REQUEST_ATTEMPTS } from '../erasure.service.js';
import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE, type ErasureRequestDto } from '../dto/erasure.dto.js';
import { makeActiveErasureJob } from '../__fixtures__/erasure.fixtures.js';

type DalMock = { [K in keyof ErasureJobsDal]: ReturnType<typeof vi.fn> };
type QueueMock = { [K in keyof ErasureQueuePort]: ReturnType<typeof vi.fn> };

const OWNER = 'owner-1';
// The confirmation phrase is REQUIRED (U7). Every happy-path request must carry the exact phrase; tests
// that specifically exercise a missing/wrong phrase pass their own body.
const CONFIRMED = { confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE };
const NOW = '2026-07-16T12:00:00.000Z';
const NEW_JOB_ID = '00000000-0000-4000-8000-00000000new1';
const EXISTING_JOB_ID = '00000000-0000-4000-8000-000000000ex1';

/** A DAL mock defaulting to the happy path: nothing erased, insert wins, no in-flight job. */
function makeDal(): DalMock {
    return {
        hasCompletedJob: vi.fn().mockResolvedValue(false),
        insertQueuedJob: vi.fn().mockResolvedValue(NEW_JOB_ID),
        findActiveJob: vi.fn().mockResolvedValue(undefined),
    };
}

function makeQueue(): QueueMock {
    return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

function makeService(dal: DalMock, queue: QueueMock): ErasureService {
    return new ErasureService(dal as unknown as ErasureJobsDal, queue as unknown as ErasureQueuePort);
}

let dal: DalMock;
let queue: QueueMock;
let service: ErasureService;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    dal = makeDal();
    queue = makeQueue();
    service = makeService(dal, queue);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('a first erasure request', () => {
    it('inserts a queued job for the caller and returns 202 with the new job id', async () => {
        const result = await service.requestErasure(OWNER, CONFIRMED);

        expect(dal.insertQueuedJob).toHaveBeenCalledExactlyOnceWith(OWNER);
        expect(result).toEqual({ jobId: NEW_JOB_ID, status: 'queued' });
    });

    it('enqueues exactly one message carrying the owner and the request time', async () => {
        await service.requestErasure(OWNER, CONFIRMED);

        expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({ ownerId: OWNER, requestedAt: NOW });
    });

    it('writes the durable row BEFORE enqueuing, so a lost message is always recoverable by the sweeper', async () => {
        const order: string[] = [];
        dal.insertQueuedJob.mockImplementation(() => {
            order.push('insert');

            return Promise.resolve(NEW_JOB_ID);
        });
        queue.enqueue.mockImplementation(() => {
            order.push('enqueue');

            return Promise.resolve();
        });

        await service.requestErasure(OWNER, CONFIRMED);

        expect(order).toEqual(['insert', 'enqueue']);
    });
});

describe('a duplicate request while a job is in flight', () => {
    it('returns 202 with the EXISTING queued job id and does not enqueue a second message', async () => {
        // The partial unique index rejects the second insert; the DAL surfaces that as `undefined`.
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob({ id: EXISTING_JOB_ID, status: 'queued' }));

        const result = await service.requestErasure(OWNER, CONFIRMED);

        expect(result).toEqual({ jobId: EXISTING_JOB_ID, status: 'queued' });
        expect(result.jobId).not.toBe(NEW_JOB_ID);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('surfaces a running job as status "running" with its existing id', async () => {
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob({ id: EXISTING_JOB_ID, status: 'running' }));

        const result = await service.requestErasure(OWNER, CONFIRMED);

        expect(result).toEqual({ jobId: EXISTING_JOB_ID, status: 'running' });
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('looks the in-flight job up under the caller own owner id', async () => {
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob());

        await service.requestErasure(OWNER, CONFIRMED);

        expect(dal.findActiveJob).toHaveBeenCalledExactlyOnceWith(OWNER);
    });
});

describe('a request after a completed job', () => {
    it('rejects with 410 ALREADY_ERASED', async () => {
        dal.hasCompletedJob.mockResolvedValue(true);

        const error = await service.requestErasure(OWNER, CONFIRMED).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(GoneException);
        expect((error as GoneException).getStatus()).toBe(410);
        expect((error as GoneException).getResponse()).toEqual({
            code: ACCOUNT_ALREADY_ERASED_CODE,
            message: 'Account has already been erased',
        });
    });

    it('never writes a row or enqueues a message for an already-erased account', async () => {
        dal.hasCompletedJob.mockResolvedValue(true);

        await service.requestErasure(OWNER, CONFIRMED).catch(() => undefined);

        expect(dal.insertQueuedJob).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('checks the completed state for the caller own owner id', async () => {
        dal.hasCompletedJob.mockResolvedValue(true);

        await service.requestErasure(OWNER, CONFIRMED).catch(() => undefined);

        expect(dal.hasCompletedJob).toHaveBeenCalledExactlyOnceWith(OWNER);
    });
});

describe('a request after a failed job', () => {
    it('enqueues a FRESH queued job and returns 202 with the new id', async () => {
        // A `failed` row is outside the partial index's predicate, so the insert wins outright.
        dal.hasCompletedJob.mockResolvedValue(false);
        dal.insertQueuedJob.mockResolvedValue(NEW_JOB_ID);

        const result = await service.requestErasure(OWNER, CONFIRMED);

        expect(result).toEqual({ jobId: NEW_JOB_ID, status: 'queued' });
        expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({ ownerId: OWNER, requestedAt: NOW });
    });
});

describe('the insert race on idx_erasure_jobs_active_owner', () => {
    beforeEach(() => {
        // The retry path logs a debug line per re-evaluation; keep it out of the suite output.
        vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    });

    it('returns 202 with the winner job id rather than surfacing the unique violation as a 500', async () => {
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(makeActiveErasureJob({ id: EXISTING_JOB_ID, status: 'queued' }));

        await expect(service.requestErasure(OWNER, CONFIRMED)).resolves.toEqual({
            jobId: EXISTING_JOB_ID,
            status: 'queued',
        });
    });

    it('re-evaluates when the in-flight job COMPLETES between the conflict and the re-read (→ 410)', async () => {
        dal.hasCompletedJob.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        dal.insertQueuedJob.mockResolvedValueOnce(undefined);
        dal.findActiveJob.mockResolvedValueOnce(undefined);

        const error = await service.requestErasure(OWNER, CONFIRMED).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(GoneException);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('re-evaluates when the in-flight job FAILS between the conflict and the re-read (→ fresh 202)', async () => {
        dal.hasCompletedJob.mockResolvedValue(false);
        dal.insertQueuedJob.mockResolvedValueOnce(undefined).mockResolvedValueOnce(NEW_JOB_ID);
        dal.findActiveJob.mockResolvedValueOnce(undefined);

        const result = await service.requestErasure(OWNER, CONFIRMED);

        expect(result).toEqual({ jobId: NEW_JOB_ID, status: 'queued' });
        expect(dal.insertQueuedJob).toHaveBeenCalledTimes(2);
        expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({ ownerId: OWNER, requestedAt: NOW });
    });

    it('gives up with a retryable 503 rather than looping forever when the race never settles', async () => {
        dal.hasCompletedJob.mockResolvedValue(false);
        dal.insertQueuedJob.mockResolvedValue(undefined);
        dal.findActiveJob.mockResolvedValue(undefined);

        const error = await service.requestErasure(OWNER, CONFIRMED).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(dal.insertQueuedJob).toHaveBeenCalledTimes(MAX_ERASURE_REQUEST_ATTEMPTS);
        expect(queue.enqueue).not.toHaveBeenCalled();
    });
});

describe('the required confirmation phrase (U7)', () => {
    it('REJECTS with 400 when the body is absent entirely — the phrase is required, no intent gate is fatal', async () => {
        // The most dangerous no-op: a request with no body at all cannot slip past the intent gate and
        // trigger irreversible erasure. The service enforces it directly (a request with no body bypasses
        // the DTO pipe), so nothing is written or enqueued.
        const error = await service.requestErasure(OWNER).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(dal.insertQueuedJob).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('REJECTS with 400 when the body carries no phrase', async () => {
        await expect(service.requestErasure(OWNER, {} as ErasureRequestDto)).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(dal.insertQueuedJob).not.toHaveBeenCalled();
    });

    it('proceeds when the provided phrase matches', async () => {
        await expect(
            service.requestErasure(OWNER, { confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE }),
        ).resolves.toMatchObject({ status: 'queued' });
    });

    it('tolerates surrounding whitespace on an otherwise exact phrase', async () => {
        await expect(
            service.requestErasure(OWNER, { confirmationPhrase: `  ${ACCOUNT_ERASURE_CONFIRMATION_PHRASE}\n` }),
        ).resolves.toMatchObject({ status: 'queued' });
    });

    it('rejects a wrong phrase with 400 BEFORE writing a row or enqueuing', async () => {
        const error = await service
            .requestErasure(OWNER, { confirmationPhrase: 'delete everything' })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(dal.hasCompletedJob).not.toHaveBeenCalled();
        expect(dal.insertQueuedJob).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a case-mismatched phrase — confirmation of an irreversible action is exact', async () => {
        await expect(service.requestErasure(OWNER, { confirmationPhrase: 'erase my data' })).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(dal.insertQueuedJob).not.toHaveBeenCalled();
    });

    it('rejects an empty-string phrase rather than treating it as "not provided"', async () => {
        await expect(service.requestErasure(OWNER, { confirmationPhrase: '' })).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(dal.insertQueuedJob).not.toHaveBeenCalled();
    });

    it('does not leak the expected phrase in the rejection message', async () => {
        const error = await service
            .requestErasure(OWNER, { confirmationPhrase: 'nope' })
            .catch((caught: unknown) => caught);

        expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain(
            ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
        );
    });
});

describe('a failed enqueue', () => {
    let logged: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // Silences Nest's logger in the suite output AND pins the operational signal: swallowing the
        // failure is only defensible because it is still reported somewhere an operator can see it.
        logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        queue.enqueue.mockRejectedValue(new Error('SQS unavailable'));
    });

    it('still returns 202 — the row is the durable record and the sweeper re-drains it', async () => {
        await expect(service.requestErasure(OWNER, CONFIRMED)).resolves.toEqual({
            jobId: NEW_JOB_ID,
            status: 'queued',
        });
    });

    it('keeps the queued row written (it is never rolled back on an enqueue failure)', async () => {
        await service.requestErasure(OWNER, CONFIRMED);

        expect(dal.insertQueuedJob).toHaveBeenCalledExactlyOnceWith(OWNER);
    });

    it('reports the failure to the operator, naming the job left for the sweeper', async () => {
        await service.requestErasure(OWNER, CONFIRMED);

        expect(logged).toHaveBeenCalledOnce();
        expect(String(logged.mock.calls[0]?.[0])).toContain(NEW_JOB_ID);
    });

    it('does not leak the SQS failure detail to the caller', async () => {
        queue.enqueue.mockRejectedValue(new Error('SQS unavailable: secret-queue-arn'));

        const result = await service.requestErasure(OWNER, CONFIRMED);

        expect(JSON.stringify(result)).not.toContain('secret-queue-arn');
    });
});
