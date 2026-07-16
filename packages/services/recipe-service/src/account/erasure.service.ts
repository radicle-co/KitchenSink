/**
 * T134 — GDPR account-erasure orchestration for `POST /v1/account/erasure` (C-007 / D7).
 *
 * Sits between the controller (which supplies the verified owner key) and the {@link ErasureJobsDal} +
 * an injected {@link ErasureQueuePort}. It owns the rules neither of them does:
 *
 *  - **the C-007 outcome map** — in-flight job → `202` with the EXISTING job id (no second enqueue);
 *    prior `completed` job → `410 ALREADY_ERASED`; prior `failed` job → a fresh `202`. Note what is
 *    absent: there is no `409`. A duplicate erasure request is not a conflict to report, it is the same
 *    request again, and the honest answer is the job that is already doing the work.
 *  - **the confirmation phrase** — validated only when the client sends one, and before anything is
 *    written.
 *
 * **Why the row is written BEFORE the message is sent, and why a failed send is not a failed request.**
 * The sibling version-archive path deliberately does not enqueue at all (`archive-sweeper.ts`): its row
 * is the source of truth and the message is a derived artifact, because a save that enqueues is a save
 * that fails when SQS is down. Erasure keeps that inversion — the `account_erasure_jobs` row is the
 * durable record and the cron sweeper (T136b) re-drains anything left `queued`/`running` — and merely
 * adds an eager send on top as a LATENCY optimization, so a user who asks to be forgotten is not waiting
 * on a cron tick. That makes the ordering forced: row first, message second, and an SQS failure logged
 * rather than surfaced. Rolling the row back on a send failure, or 500-ing the request, would convert a
 * transient queue outage into a dropped right-to-erasure request — trading a durable record for nothing.
 * The cost of the trade is at-least-once delivery (the sweeper may re-send a message the service already
 * sent); the worker is idempotent by design, so a duplicate is a no-op.
 */
import {
    BadRequestException,
    GoneException,
    Inject,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ACCOUNT_ALREADY_ERASED_CODE, type AccountErasureMessage } from '@kitchensink/recipe-core';

import { ErasureJobsDal } from './dal/erasure-jobs.dal.js';
import { ERASURE_QUEUE, type ErasureQueuePort } from './erasure.queue.js';
import {
    ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
    type ErasureRequestDto,
    type ErasureRequestAcceptedResponse,
} from './dto/erasure.dto.js';

/**
 * How many times a single request re-evaluates the C-007 outcome before giving up.
 *
 * One pass suffices unless the owner's in-flight job TERMINATES between our insert losing the conflict
 * and our re-read of it — a window measured in microseconds, after which the correct answer has changed
 * (`completed` → `410`, `failed` → a fresh job) and the only sound move is to look again. A second pass
 * settles that; the third is slack for an adversarially-timed third request. The bound exists so the
 * loop cannot spin forever against a pathological workload: a caller gets an honest, retryable `503`
 * instead of a hung request.
 */
export const MAX_ERASURE_REQUEST_ATTEMPTS = 3;

@Injectable()
export class ErasureService {
    private readonly logger = new Logger(ErasureService.name);

    public constructor(
        private readonly jobs: ErasureJobsDal,
        @Inject(ERASURE_QUEUE) private readonly queue: ErasureQueuePort,
    ) {}

    /**
     * Request erasure of the caller's own account data.
     *
     * @param ownerId - The VERIFIED app-user ULID from the session token. Never client-supplied: this is
     *   the only thing scoping the erasure, so accepting it from a request body would let any caller
     *   erase any account.
     * @param request - The optional request body.
     * @returns `202` payload: the id + status of the job now in flight (possibly a pre-existing one).
     * @throws {BadRequestException} (→ 400) when a supplied confirmation phrase does not match.
     * @throws {GoneException} (→ 410) when a prior erasure job already completed.
     * @throws {ServiceUnavailableException} (→ 503) when the outcome never settles within the attempt bound.
     * @sideEffect Inserts an `account_erasure_jobs` row and sends an SQS message.
     */
    public async requestErasure(ownerId: string, request?: ErasureRequestDto): Promise<ErasureRequestAcceptedResponse> {
        assertConfirmationPhrase(request?.confirmationPhrase);

        for (let attempt = 1; attempt <= MAX_ERASURE_REQUEST_ATTEMPTS; attempt += 1) {
            // Terminal state first: an account whose erasure already completed has nothing left to erase,
            // and the index would happily accept a new row for it (a `completed` row is outside the
            // partial index's predicate).
            if (await this.jobs.hasCompletedJob(ownerId)) {
                throw new GoneException({
                    code: ACCOUNT_ALREADY_ERASED_CODE,
                    message: 'Account has already been erased',
                });
            }

            const jobId = await this.jobs.insertQueuedJob(ownerId);

            if (jobId !== undefined) {
                await this.enqueue(ownerId, jobId);

                return { jobId, status: 'queued' };
            }

            // The insert lost the race on `idx_erasure_jobs_active_owner` → someone else's job is in
            // flight. That IS the idempotent answer: hand back their job, and do not enqueue again.
            const active = await this.jobs.findActiveJob(ownerId);

            if (active !== undefined) {
                return { jobId: active.id, status: active.status };
            }

            // Neither a completed job, nor an insert, nor an in-flight job: the job we collided with
            // reached a terminal state in between. The right answer changed underneath us — re-evaluate.
            this.logger.debug(`erasure request for ${ownerId} raced a terminating job; retrying (attempt ${attempt})`);
        }

        throw new ServiceUnavailableException('Could not settle the erasure request; please retry.');
    }

    /**
     * Send the erasure message, swallowing failure by design.
     *
     * The queued row is already durable at this point and the sweeper (T136b) re-drains it, so a send
     * failure costs latency, not the request. It is logged at `error` because a queue that is down is a
     * real operational signal even though it is not a client-visible one.
     *
     * @sideEffect Sends an SQS message; logs on failure.
     */
    private async enqueue(ownerId: string, jobId: string): Promise<void> {
        const message: AccountErasureMessage = { ownerId, requestedAt: new Date().toISOString() };

        try {
            await this.queue.enqueue(message);
        } catch (error) {
            this.logger.error(
                `failed to enqueue erasure job ${jobId} for ${ownerId}; the row is durable and the sweeper will re-drain it`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

/**
 * Reject a supplied confirmation phrase that does not match {@link ACCOUNT_ERASURE_CONFIRMATION_PHRASE}.
 *
 * Per the contract the phrase is optional — "when provided the server validates it" — so an absent field
 * is not an error. An EMPTY string is: a client that sent the key meant to confirm and got it wrong,
 * and silently erasing an account on a blank confirmation is the opposite of what the field is for.
 *
 * Surrounding whitespace is tolerated (a paste artefact, not a different intent) but case is not: the
 * phrase gates an irreversible, unrecoverable action, and the value of a confirmation ritual is that it
 * is deliberate. The rejection deliberately does NOT echo the expected phrase — a confirmation a client
 * can learn by guessing once is not a confirmation.
 *
 * @param phrase - The client-supplied phrase, if any.
 * @throws {BadRequestException} (→ 400) when a phrase is present and does not match. Pure otherwise.
 */
function assertConfirmationPhrase(phrase: string | undefined): void {
    if (phrase === undefined) {
        return;
    }

    if (phrase.trim() !== ACCOUNT_ERASURE_CONFIRMATION_PHRASE) {
        throw new BadRequestException('The confirmation phrase does not match.');
    }
}
