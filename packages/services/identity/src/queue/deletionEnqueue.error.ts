/**
 * THE FAILURE MODE OF THE DELETION QUEUE — its typed error, and the ONE way that failure is announced.
 *
 * ⚠️ A FAILED ENQUEUE IS NOT BEST-EFFORT. IT IS THE SECURITY CONTROL FAILING.
 *
 * This service is fronted by a public ALB and therefore holds no Clerk secret; the Clerk-side mutation of a
 * lifecycle transition — the BAN that ends a closed account's sessions, the UNBAN that restores a recovered one
 * — is performed exclusively by the deletion-worker Lambda, reached through this queue. So when the enqueue
 * fails, the database says `status='tombstoned'` while **Clerk keeps the session alive and keeps minting fresh
 * JWTs for an account the user believes is closed**. The mirror case is just as bad and quieter: a reactivated
 * user stays banned, locked out, with the database insisting they are `active`.
 *
 * Both call sites (`UsersService.deleteUserMe`, `AdminService.reactivateUser`) previously wrapped the enqueue in
 * `catch { logger.warn(...) }`. A `warn` is not a signal — nothing alerts on it — so the divergence had no
 * durable record and no one to tell. That is why it went unnoticed that the deployed sandbox task role held no
 * `sqs:SendMessage` grant at all and **every** enqueue was failing with `AccessDenied`.
 *
 * The reporter lives HERE, next to the error, rather than at either call site, so the two cannot announce the
 * same failure in two different ways or at two different severities — which is how one of them ends up as a
 * `warn` again.
 *
 * ⛔ RESIDUAL RISK, RECORDED HONESTLY: this makes the failure LOUD, not self-healing. The state is still
 * divergent until an operator acts. The durable fix is a retry marker a sweep drains, and the cheapest correct
 * form needs no new column — `users.status='tombstoned'` IS already a durable marker, so a sweep in
 * `identity-webhooks` (which does hold the Clerk secret) can ask Clerk whether each tombstoned identity is
 * actually banned and ban it if not, converging the two systems without a migration. That is a follow-up
 * feature with its own tests, deliberately not smuggled in here.
 */
import * as Sentry from '@sentry/nestjs';

import { createServiceLogger } from '../observability/sentryLogging.js';
import type { DeletionEvent } from './sqs.service.js';

const logger = createServiceLogger('DeletionQueue');

/**
 * The Clerk-side lifecycle mutation was NOT queued — because the queue is unconfigured, or because the send
 * failed (an IAM denial is not transient and the SDK's own retries will not fix it).
 *
 * One type for both causes on purpose: a caller's decision does not turn on WHY the ban is missing, only on the
 * fact that it is. The original failure is preserved in `cause` so Sentry still shows the AWS error.
 */
export class DeletionEnqueueError extends Error {
    public constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'DeletionEnqueueError';
        Object.setPrototypeOf(this, DeletionEnqueueError.prototype);
    }
}

/**
 * Type guard for {@link DeletionEnqueueError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is a {@link DeletionEnqueueError}.
 */
export function isDeletionEnqueueError(error: unknown): error is DeletionEnqueueError {
    return error instanceof DeletionEnqueueError;
}

/**
 * Announce a failed lifecycle enqueue as a distinct, PAGING signal.
 *
 * Mirrors the shape of the read-through provisioning alert (`auth.provisioning: failed`) so this is a filterable
 * Sentry tag an alert rule can select, rather than a `warn` buried in a log stream. The person-linked ids travel
 * through `contexts`, which `sentryScrubbers.ts` PSEUDONYMIZES (`userid`/`identityid` are both `ID_KEYS`), so
 * the signal is correlatable without putting a raw Clerk `sub` in an issue.
 *
 * @param input - Which transition failed to queue, for whom, and why.
 * @sideEffect Captures a Sentry exception and writes an error log.
 */
export function reportDeletionEnqueueFailure(input: {
    readonly event: DeletionEvent;
    readonly userId: string;
    readonly identityId: string;
    readonly error: unknown;
}): void {
    const { event, userId, identityId, error } = input;

    logger.error(`deletion-queue: ${event} enqueue FAILED — the Clerk-side mutation was not queued`, {
        event,
        userId,
        identityId,
        outcome: 'not-queued',
        error: error instanceof Error ? error.message : String(error),
    });

    Sentry.captureException(error, {
        tags: { 'deletion.enqueue': 'failed', 'deletion.event': event },
        contexts: { deletion: { event, userId, identityId, outcome: 'not-queued' } },
    });
}
