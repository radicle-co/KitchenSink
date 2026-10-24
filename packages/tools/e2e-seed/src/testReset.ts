/**
 * The test principal's SELF-PURGE, from the calling side: request it, then wait for the worker to finish it.
 *
 * `POST /api/v1/account/test-reset` records a job and hands the hard purge to the account-erasure worker
 * (ADR-0040 §5); `GET /api/v1/account/test-reset/{jobId}` is the job's status. A request that returned `202` has
 * purged NOTHING yet, so a reset that stopped there would report a clean slate over a world the worker has not
 * touched — which is why the wait is part of the Command, not an option of it.
 *
 * ## What is retried, and what is not
 *
 * - **The request, once, on `404`.** The door answers `404` to anyone its two-witness gate refuses, and the second
 *   witness — the service's `test_principals` registry — is written by `AuthMiddleware` on an authenticated request.
 *   A failed registration is logged and NOT memoized, so the next authenticated request tries again: one retry
 *   covers that race. A second `404` is a real refusal (a slot `poolAdmin` never marked, or a stage that does not
 *   route the door) and fails the slot — swallowing it would be a green reset over a door that is not there.
 * - **The poll, while the job is `queued`/`running`, or while the stage blips** (a transport timeout, a `429`, a
 *   `5xx`): the purge keeps running server-side, and on a `pr-{N}` preview (one Fargate Spot task, a shared
 *   `db.t4g.micro`) a single slow answer during a minutes-long wait is ordinary. Anything else the poll hears — a
 *   `404`, a body that fails the contract — is final.
 * - **Never the request after a `failed` job.** A failed purge is the worker's verdict; re-requesting it here
 *   would hide a defect behind a retry loop.
 *
 * @pattern Command — `requestPurge`, then `awaitPurge` to a terminal state; the transport is `RecipeServiceClient`
 */
import {
    isFetchUnavailableError,
    isNotFoundError,
    isRecipeServiceClientError,
    type RecipeServiceClient,
} from '@kitchensink/recipe-service-client';
import pRetry, { AbortError } from 'p-retry';

import { isTransientStatus } from './transientStatus.js';

/** How a purge is waited on. Injected so a test does not spend real minutes. */
export interface PurgeTiming {
    /** The pause between status polls. */
    readonly intervalMs: number;
    /** How long a purge may take, from the moment its request was accepted, before the slot is failed. */
    readonly deadlineMs: number;
}

/**
 * The default wait.
 *
 * FIVE MINUTES, because the before-step that calls this is FATAL: a bound tight enough to trip on an SQS delivery
 * plus a cold worker Lambda plus a paged purge and an S3 prefix sweep turns an ordinary cold start into a red job
 * that reads like an app defect. It is not longer, because the case it cannot wait out — a lost SQS send, which the
 * erasure sweeper re-drains only once the job has been untouched for fifteen minutes — is rare and should be named
 * as a failure rather than absorbed into a job timeout that names nothing.
 */
export const DEFAULT_PURGE_TIMING: PurgeTiming = { intervalMs: 3_000, deadlineMs: 5 * 60_000 };

/** The client surface a purge uses. */
export type PurgeClient = Pick<RecipeServiceClient, 'requestTestReset' | 'getTestReset'>;

/** A job that has not reached a terminal state yet. Internal: it is only ever a retry signal. */
class PurgePendingError extends Error {
    public constructor(public readonly status: string) {
        super(`purge still ${status}`);
        this.name = 'PurgePendingError';
        Object.setPrototypeOf(this, PurgePendingError.prototype);
    }
}

/** Type guard for {@link PurgePendingError}. */
function isPurgePendingError(error: unknown): error is PurgePendingError {
    return error instanceof PurgePendingError;
}

/** A failure the stage recovers from on its own, where the job it answers about keeps running. Pure. */
function isTransient(error: unknown): boolean {
    if (isFetchUnavailableError(error)) {
        return true;
    }

    const status = isRecipeServiceClientError(error) ? error.status : undefined;

    return status !== undefined && isTransientStatus(status);
}

/**
 * Request the calling test principal's purge.
 *
 * @param client - A client authenticated as the slot whose data is to be purged.
 * @param timing - The pause before the one registration retry.
 * @returns The id of the job now purging the caller (queued, or the one already in flight).
 * @throws {Error} When the door refuses the caller twice, or the request fails any other way.
 * @sideEffect Starts a destructive, asynchronous purge of everything the caller owns.
 */
export async function requestPurge(client: PurgeClient, timing: PurgeTiming = DEFAULT_PURGE_TIMING): Promise<string> {
    try {
        const { jobId } = await pRetry(() => client.requestTestReset(), {
            retries: 1,
            minTimeout: timing.intervalMs,
            maxTimeout: timing.intervalMs,
            shouldRetry: ({ error }) => isNotFoundError(error),
        });

        return jobId;
    } catch (error) {
        if (isNotFoundError(error)) {
            throw new Error(
                'the stage does not recognise this slot as a registered test principal (the self-purge door ' +
                    'answered 404 twice) — the slot lacks the poolAdmin marker, its registration keeps failing, or ' +
                    'this stage does not route POST /api/v1/account/test-reset',
                { cause: error },
            );
        }

        throw error;
    }
}

/**
 * Wait for a purge job to complete.
 *
 * @param client - A client authenticated as the job's owner.
 * @param jobId - The id {@link requestPurge} returned.
 * @param timing - The poll interval and the deadline, measured from this call.
 * @throws {Error} When the job fails, the poll is refused, or the job has not completed by the deadline.
 * @sideEffect Polls the job's status.
 */
export async function awaitPurge(
    client: PurgeClient,
    jobId: string,
    timing: PurgeTiming = DEFAULT_PURGE_TIMING,
): Promise<void> {
    let lastStatus = 'queued';

    try {
        await pRetry(
            async () => {
                const job = await client.getTestReset(jobId);

                lastStatus = job.status;

                if (job.status === 'failed') {
                    throw new AbortError(`purge job ${jobId} failed on the worker`);
                }

                if (job.status !== 'completed') {
                    throw new PurgePendingError(job.status);
                }
            },
            {
                retries: Number.POSITIVE_INFINITY,
                minTimeout: timing.intervalMs,
                maxTimeout: timing.intervalMs,
                factor: 1,
                maxRetryTime: timing.deadlineMs,
                shouldRetry: ({ error }) => isPurgePendingError(error) || isTransient(error),
            },
        );
    } catch (error) {
        if (isPurgePendingError(error) || isTransient(error)) {
            throw new Error(
                `purge job ${jobId} did not complete within ${Math.round(timing.deadlineMs / 1_000)}s ` +
                    `(last status: ${lastStatus})`,
                { cause: error },
            );
        }

        throw error;
    }
}
