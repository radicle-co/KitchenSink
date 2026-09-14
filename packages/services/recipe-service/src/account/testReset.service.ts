/**
 * ADR-0040 — the test principal's SELF-PURGE, for `POST /api/v1/account/test-reset` and its status query.
 *
 * @pattern Command — the request durably records a `test_reset_jobs` row and hands the purge to the account-erasure
 *   worker module (the one module permitted to hard-delete recipes); the status query reads the command's state.
 *
 * ## ⛔ The authorization is "claim AND registry", and the refusal is a 404
 *
 * Containment keys on the signed claim alone because that direction is fail-closed. This Command DESTROYS data with
 * no public carve-out, so it requires the verified token to say `testPrincipal` AND the service's own
 * `test_principals` registry to hold the principal (owner ruling 2026-09-13).
 *
 * ⛔ That is ONE witness checked twice, not two: `AuthMiddleware` writes the registry FROM the claim, so the registry
 * catches a process that never registered the principal, never a Clerk user an operator mis-marked — whose session
 * holder could then purge that user's own data. ADR-0040 makes a genuinely independent witness (a verified email
 * claim matching a per-stage anchored pattern) a precondition of any production tenant. Anything else answers
 * `404 NOT_FOUND` —
 * the code a path this service does not route answers — so the door is indistinguishable from absent to every real
 * user, and a job id is parsed only AFTER the gate so a `400` cannot reveal it either.
 *
 * A principal purges only ITSELF: nothing here accepts a target — the job, the message and the status query are all
 * keyed on the verified `userId`.
 *
 * ## Repeatable, unlike erasure
 *
 * An in-flight job is returned instead of a second one (the partial unique index arbitrates); a completed one blocks
 * nothing. There is no `410`: a pool slot is reset before and after every run, forever.
 *
 * ## Row first, message second, and a failed send is not a failed request
 *
 * `ErasureService`'s inversion, for its reason: the row is the source of truth and the erasure sweeper re-drains a
 * `queued` reset, so rolling the row back or failing the request on an SQS outage would trade a durable record for
 * nothing. While the job is active, `ErasureLockGuard` answers the principal's mutations with `423`.
 */
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { TestPrincipalResetMessage } from '@kitchensink/recipe-core';
import { z } from 'zod';

import { TestPrincipalsDal } from '../auth/dal/testPrincipals.dal.js';
import type { ActingPrincipal } from '../auth/principal.js';
import { apiError } from '../common/apiError.js';
import { TestResetJobsDal } from './dal/testResetJobs.dal.js';
import { ERASURE_QUEUE, type ErasureQueuePort } from './erasure.queue.js';
import type { TestResetAcceptedResponse, TestResetJobResponse } from './testReset.schema.js';

/** How many times one request re-evaluates the idempotent insert before giving up — `ErasureService`'s bound. */
const MAX_TEST_RESET_REQUEST_ATTEMPTS = 3;

/** A job id is a UUID; parsed with zod rather than a hand-rolled pattern. */
const jobIdSchema = z.uuid();

@Injectable()
export class TestResetService {
    private readonly logger = new Logger(TestResetService.name);

    public constructor(
        private readonly jobs: TestResetJobsDal,
        private readonly registry: TestPrincipalsDal,
        @Inject(ERASURE_QUEUE) private readonly queue: ErasureQueuePort,
    ) {}

    /**
     * Request a purge of everything the calling test principal owns.
     *
     * @param principal - The verified acting principal. Only its own data is ever targeted.
     * @returns The `202` payload: the queued job, or the one already in flight.
     * @throws {HttpException} `404 NOT_FOUND` unless the claim AND the registry both say test principal.
     * @throws {ServiceUnavailableException} (→ 503) when the idempotent insert never settles within the bound.
     * @sideEffect Reads `test_principals`; inserts a `test_reset_jobs` row; sends an SQS message.
     */
    public async requestReset(principal: ActingPrincipal): Promise<TestResetAcceptedResponse> {
        await this.assertSelfPurgeAllowed(principal);

        const userId = principal.userId;

        for (let attempt = 1; attempt <= MAX_TEST_RESET_REQUEST_ATTEMPTS; attempt += 1) {
            const jobId = await this.jobs.insertQueuedJob(userId);

            if (jobId !== undefined) {
                await this.enqueue(userId, jobId);

                return { jobId, status: 'queued' };
            }

            const active = await this.jobs.findActiveJob(userId);

            if (active !== undefined) {
                return { jobId: active.id, status: active.status };
            }

            // The job we collided with finished in between: the right answer changed underneath us — look again.
            this.logger.debug(`test reset for ${userId} raced a terminating job; retrying (attempt ${attempt})`);
        }

        throw new ServiceUnavailableException('Could not settle the test reset request; please retry.');
    }

    /**
     * Read where one of the calling test principal's own reset jobs stands.
     *
     * @param principal - The verified acting principal.
     * @param jobId - The job id from the path. Parsed AFTER the authorization gate.
     * @returns The job's status body.
     * @throws {HttpException} `404 NOT_FOUND` for anyone the gate refuses, a malformed id, or another principal's job.
     * @sideEffect Reads `test_principals` and `test_reset_jobs`.
     */
    public async getReset(principal: ActingPrincipal, jobId: string): Promise<TestResetJobResponse> {
        await this.assertSelfPurgeAllowed(principal);

        if (!jobIdSchema.safeParse(jobId).success) {
            throw notFound();
        }

        const job = await this.jobs.findOwnJob(principal.userId, jobId);

        if (job === undefined) {
            throw notFound();
        }

        return {
            jobId: job.id,
            status: job.status,
            createdAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
        };
    }

    /**
     * The claim-and-registry gate: the signed claim first (no I/O for a real principal), then the registry. Not two
     * independent witnesses — see the module docstring.
     *
     * @param principal - The verified acting principal.
     * @throws {HttpException} `404 NOT_FOUND` unless the claim and the registry both say test principal.
     * @sideEffect Reads `test_principals` for a claimed test principal.
     */
    private async assertSelfPurgeAllowed(principal: ActingPrincipal): Promise<void> {
        if (principal.principalKind !== 'test') {
            throw notFound();
        }

        if (!(await this.registry.isRegistered(principal.userId))) {
            throw notFound();
        }
    }

    /**
     * Send the reset message, swallowing failure by design — see the module docstring.
     *
     * @sideEffect Sends an SQS message; logs on failure.
     */
    private async enqueue(userId: string, jobId: string): Promise<void> {
        const message: TestPrincipalResetMessage = {
            kind: 'testPrincipalReset',
            ownerId: userId,
            requestedAt: new Date().toISOString(),
        };

        try {
            await this.queue.enqueue(message);
        } catch (error) {
            this.logger.error(
                `failed to enqueue test reset job ${jobId} for ${userId}; the row is durable and the sweeper will re-drain it`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

/**
 * The refusal every non-qualifying caller gets — the code a path this service does not route answers.
 *
 * @returns The `404` to throw. Pure.
 */
function notFound(): ReturnType<typeof apiError> {
    return apiError('NOT_FOUND', 'Not found.');
}
