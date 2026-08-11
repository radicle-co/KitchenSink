/**
 * T134 — GDPR account-erasure orchestration for `POST /api/v1/account/erasure` (C-007 / D7).
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
import {
    ACCOUNT_ALREADY_ERASED_CODE,
    type AccountErasureMessage,
    type ErasureTriggerSource,
} from '@kitchensink/recipe-core';

import { ErasureJobsDal } from './dal/erasure-jobs.dal.js';
import { ERASURE_QUEUE, type ErasureQueuePort } from './erasure.queue.js';
import { ServicePrincipalErasureMetrics } from './erasure-metrics.js';
import { matchesAccountErasureConfirmation, type ErasureRequest } from './account.schema.js';
import type { ActiveErasureJobStatus, ErasureRequestAcceptedResponse } from './account.schema.js';
import type { ServiceErasureAcceptedResponse } from './dto/service-erasure.dto.js';
import type { ServicePrincipal } from '../auth/service-principal.js';

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

/**
 * The outcome of the shared C-007 enqueue core, before each caller maps it to its own HTTP contract.
 *
 *  - `accepted` — a job is in flight for the owner. `created` distinguishes a job THIS request enqueued
 *    from a pre-existing in-flight one it returned idempotently (only a newly-created SERVICE job is
 *    metric-counted for the volume alarm).
 *  - `alreadyErased` — a prior erasure completed. The user path turns this into `410`; the service path
 *    treats it as an idempotent no-op success.
 */
type ErasureEnqueueOutcome =
    | {
          readonly kind: 'accepted';
          readonly jobId: string;
          readonly status: ActiveErasureJobStatus;
          readonly created: boolean;
      }
    | { readonly kind: 'alreadyErased' };

@Injectable()
export class ErasureService {
    private readonly logger = new Logger(ErasureService.name);

    public constructor(
        private readonly jobs: ErasureJobsDal,
        @Inject(ERASURE_QUEUE) private readonly queue: ErasureQueuePort,
        private readonly metrics: ServicePrincipalErasureMetrics,
    ) {}

    /**
     * Request erasure of the caller's own account data (the USER path — confirmation-gated).
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
    public async requestErasure(ownerId: string, request?: ErasureRequest): Promise<ErasureRequestAcceptedResponse> {
        // The confirmation phrase is the USER path's authorization gate — enforced BEFORE anything is
        // written, and NEVER skipped. The service path skips it because its signed single-target token IS
        // the authorization; a user token can never reach that branch (separate route + separate guard).
        assertConfirmationPhrase(request?.confirmationPhrase);

        // The per-recipe DONATE election (U3b). Defaulted to [] ("donate nothing") when absent, so the
        // durable row always records an explicit election rather than a NULL the worker has to interpret.
        const publishRecipeIds = request?.publishRecipeIds ?? [];

        // R8 audit: a user-initiated erasure's actor IS the owner (they authorized it via the phrase).
        const outcome = await this.enqueueErasure({
            ownerId,
            publishRecipeIds,
            triggerSource: 'user',
            actor: ownerId,
        });

        if (outcome.kind === 'alreadyErased') {
            throw new GoneException({
                code: ACCOUNT_ALREADY_ERASED_CODE,
                message: 'Account has already been erased',
            });
        }

        return { jobId: outcome.jobId, status: outcome.status };
    }

    /**
     * Trigger erasure of a target account on behalf of a VERIFIED service principal (CR-002 / U4a — the
     * `user.deleted`/close event path). NO confirmation phrase: the signed, single-target token verified by
     * {@link import('../auth/service-erasure.guard.js').ServiceErasureGuard} IS the authorization, and the
     * target owner comes from the token's bound claim — never a request body/query.
     *
     * There is NO donate election on this path (KTD-2): a webhook/admin erasure defaults to removing every
     * owner-only recipe. Every job records `trigger_source='service'` + the token's `actor` (R8), and a
     * newly-created job emits the volume metric (a burst of distinct owners is the incident signal).
     *
     * Idempotent by the same C-007 machinery as the user path (R9): a job already in flight for the owner
     * is returned rather than duplicated, and an already-erased account is a no-op success (not a `410`) —
     * the worker only needs to know the erasure is handled.
     *
     * @param principal - The verified service principal (bound target owner, event id, actor).
     * @returns `202` when a job is queued/in-flight, `200`-shaped when the account was already erased.
     * @throws {ServiceUnavailableException} (→ 503) when the outcome never settles within the attempt bound.
     * @sideEffect Inserts an `account_erasure_jobs` row, sends an SQS message, and emits a CloudWatch metric.
     */
    public async requestServiceErasure(principal: ServicePrincipal): Promise<ServiceErasureAcceptedResponse> {
        const outcome = await this.enqueueErasure({
            ownerId: principal.ownerId,
            publishRecipeIds: [],
            triggerSource: 'service',
            actor: principal.actor,
        });

        if (outcome.kind === 'alreadyErased') {
            this.logger.log(
                `service erasure no-op: owner ${principal.ownerId} already erased (event ${principal.eventId}, actor ${principal.actor})`,
            );

            return { status: 'completed', triggerSource: 'service' };
        }

        if (outcome.created) {
            // Detective control: one metric per NEWLY-created service erasure feeds the volume alarm.
            this.metrics.recordServicePrincipalErasure({ ownerId: principal.ownerId });
        }

        this.logger.log(
            `service erasure ${outcome.created ? 'created' : 'idempotent'} job ${outcome.jobId} for owner ` +
                `${principal.ownerId} (event ${principal.eventId}, actor ${principal.actor})`,
        );

        return { jobId: outcome.jobId, status: outcome.status, triggerSource: 'service' };
    }

    /**
     * The shared C-007 enqueue core: idempotently ensure exactly one in-flight erasure job for the owner,
     * deferring the "already in flight?" arbitration to the `idx_erasure_jobs_active_owner` partial unique
     * index. Both the user and service paths run it; they differ ONLY in the authorization gate that
     * precedes it and how they map its {@link ErasureEnqueueOutcome} to HTTP. Extracting it here keeps that
     * one piece of idempotency knowledge in one place (R9) rather than forked per caller.
     *
     * @param input - The owner, the DONATE election, and the R8 trigger source + actor to persist.
     * @returns The outcome: an accepted (created or pre-existing) job, or already-erased.
     * @throws {ServiceUnavailableException} (→ 503) when the outcome never settles within the attempt bound.
     * @sideEffect Inserts an `account_erasure_jobs` row and (on a fresh insert) sends an SQS message.
     */
    private async enqueueErasure(input: {
        readonly ownerId: string;
        readonly publishRecipeIds: readonly string[];
        readonly triggerSource: ErasureTriggerSource;
        readonly actor: string;
    }): Promise<ErasureEnqueueOutcome> {
        const { ownerId, publishRecipeIds, triggerSource, actor } = input;

        for (let attempt = 1; attempt <= MAX_ERASURE_REQUEST_ATTEMPTS; attempt += 1) {
            // Terminal state first: an account whose erasure already completed has nothing left to erase,
            // and the index would happily accept a new row for it (a `completed` row is outside the
            // partial index's predicate).
            if (await this.jobs.hasCompletedJob(ownerId)) {
                return { kind: 'alreadyErased' };
            }

            const jobId = await this.jobs.insertQueuedJob({ ownerId, publishRecipeIds, triggerSource, actor });

            if (jobId !== undefined) {
                await this.enqueue(ownerId, jobId, publishRecipeIds);

                return { kind: 'accepted', jobId, status: 'queued', created: true };
            }

            // The insert lost the race on `idx_erasure_jobs_active_owner` → a job is already in flight.
            // That IS the idempotent answer: hand back that job, and do not enqueue again (R9).
            const active = await this.jobs.findActiveJob(ownerId);

            if (active !== undefined) {
                return { kind: 'accepted', jobId: active.id, status: active.status, created: false };
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
     * The election rides the message as an eager carrier (U3b); the durable row remains the source of
     * truth, so a message lost before the worker reads it is reconstructed from the row by the sweeper.
     *
     * @sideEffect Sends an SQS message; logs on failure.
     */
    private async enqueue(ownerId: string, jobId: string, publishRecipeIds: readonly string[]): Promise<void> {
        const message: AccountErasureMessage = {
            ownerId,
            requestedAt: new Date().toISOString(),
            publishRecipeIds: [...publishRecipeIds],
        };

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
 * Require an exact-match confirmation phrase before an irreversible erasure (U7 — owner decision
 * 2026-07-18: the phrase is REQUIRED, not optional).
 *
 * An absent or empty phrase is rejected: erasure is unrecoverable, so it must never proceed without a
 * deliberate intent gate. The service enforces this directly rather than relying on the DTO pipe alone,
 * because a request sent with NO body at all bypasses the pipe entirely — the service always runs, so the
 * gate lives here too.
 *
 * The MATCH RULE itself is `matchesAccountErasureConfirmation` in `./account.schema.ts` — the published
 * contract — because the UI's confirm button gates on the identical rule and the two used to be independent
 * implementations of it (see that file's note 1). This function is the THROWING adapter over it: whitespace
 * tolerance and case sensitivity are the rule's, and the `400` is this layer's. The rejection deliberately
 * does NOT echo the expected phrase — a confirmation a client can learn by guessing once is not a
 * confirmation, which is also why the phrase is not published as a request `enum`.
 *
 * @param phrase - The client-supplied phrase, if any.
 * @throws {BadRequestException} (→ 400) when the phrase is absent, empty, or does not match. Pure otherwise.
 */
function assertConfirmationPhrase(phrase: string | undefined): void {
    if (phrase === undefined || !matchesAccountErasureConfirmation(phrase)) {
        throw new BadRequestException('The confirmation phrase does not match.');
    }
}
