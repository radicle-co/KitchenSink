import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { UserDAO } from '@kitchensink/identity-db';

import { z } from 'zod';

import { getConfig, getWebhookConfig } from '../config/env.js';
import { getDb } from './db.js';
import { resolveRequestId } from './errorEnvelope.js';
import { emitMetric, logger } from './observability.js';
import {
    describeIssues,
    HANDLED_EVENT_TYPES,
    idpEventEnvelopeSchema,
    idpWebhookEventSchema,
    type IdpWebhookEvent,
    type WebhookRejectionReason,
} from './idpPayload.schema.js';
import { verifyWebhook } from './svix.js';

/**
 * Template-Method wrappers (S-I6): each decorator owns one invariant prologue step — resolve typed
 * config, resolve the db/DAO, verify the svix signature — and hands its result to the inner "core"
 * handler, which supplies only the variant business logic. They compose AROUND `withObservability`
 * (the sole existing wrapper, `common/observability.ts`), which stays outermost:
 *
 *   `withObservability(withDb(core))`                       — deletion-worker, reconciliation
 *   `withObservability(withVerifiedWebhook(withDb(core)))`  — identityWebhook (verify, then db)
 *
 * Every wrapper's returned function is a plain 2-arg `(event, context) => Promise<TResult>` — the
 * same shape `withObservability` already expects — so composing one more wrapper around another is
 * just ordinary function nesting, not a bespoke middleware-chain runtime.
 */

/** The db handle + `UserDAO` every handler's prologue used to build for itself. */
export type DbContext = {
    db: PostgresJsDatabase<Record<string, never>>;
    userDao: UserDAO;
};

/**
 * Resolves the typed config (memoized after the first cold-start parse — S-I5) and the warm-cached
 * `getDb` connection, then constructs the shared `UserDAO` once per invocation. A config/db failure
 * propagates (rejects) exactly as it did when each handler resolved this inline.
 *
 * @sideEffect may open a DB connection pool on a cold start (via `getDb`).
 */
const resolveDbContext = async (): Promise<DbContext> => {
    const { DB_SECRET_ARN } = getConfig();
    const db = (await getDb(DB_SECRET_ARN)) as unknown as PostgresJsDatabase<Record<string, never>>;

    return { db, userDao: new UserDAO(db, logger) };
};

/**
 * Template-Method decorator: supplies the resolved {@link DbContext} to `handler` as its third
 * argument, replacing the copy-pasted `getConfig()` + `getDb(...)` + `new UserDAO(...)` prologue
 * duplicated across `deletionWorker.ts` and `reconciliation.ts` (and, before this change, a variant
 * inline in `identityWebhook.ts`).
 */
export const withDb = <TEvent, TResult>(
    handler: (event: TEvent, context: Context, dbCtx: DbContext) => Promise<TResult>,
): ((event: TEvent, context: Context) => Promise<TResult>) => {
    return async (event, context) => {
        const dbCtx = await resolveDbContext();

        return handler(event, context, dbCtx);
    };
};

/** The verified svix payload + the resolved request id, handed to the webhook's inner handler. */
export type VerifiedWebhookContext = {
    payload: IdpWebhookEvent;
    requestId: string;
};

/**
 * Template-Method decorator: the svix signature-verification prologue extracted from
 * `identityWebhook.ts`. Resolves the webhook's (stricter) typed config first — a genuine env
 * misconfig fails the invocation outright (S-I5), never swallowed into the rejection branch below —
 * then verifies the inbound signature. On success, hands the verified {@link IdpWebhookEvent} and the
 * resolved request id to `handler`; on a missing/invalid signature OR an unreadable payload, it
 * short-circuits through {@link rejectInvalidWebhook} without ever reaching `handler` (so an unverified
 * payload can't touch the DB). That rejection answers **401 for a signature failure and 200 for a shape
 * failure** — see {@link WEBHOOK_REJECTION_STATUS} for why the two differ.
 */
export const withVerifiedWebhook = (
    handler: (
        event: APIGatewayProxyEvent,
        context: Context,
        verified: VerifiedWebhookContext,
    ) => Promise<APIGatewayProxyResult>,
): ((event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>) => {
    return async (event, context) => {
        const config = getWebhookConfig();
        const requestId = resolveRequestId(context, event.requestContext?.requestId);
        const svixId = event.headers?.['svix-id'] ?? '';

        let verified: IdpWebhookEvent;

        try {
            const rawBody = event.body ?? '';
            const signed = verifyWebhook(event.headers as Record<string, string>, rawBody, config.IDP_WEBHOOK_SECRET);

            // TWO checks, ONE rejection PATH, TWO statuses. The signature proves Clerk sent it; the parse
            // proves we can read it. A failure of either is invalid input that must never reach the DB, so
            // both take the SAME path below and report a `reason` — but the STATUS is derived from that
            // reason, because retrying rescues exactly one of them (see `WEBHOOK_REJECTION_STATUS`).
            //
            // The envelope is read FIRST so an event type we simply do not handle is not mistaken for an
            // invalid one — see `idpEventEnvelopeSchema`. That case is a quiet 200, not an alarm.
            const envelope = idpEventEnvelopeSchema.parse(signed);

            if (!HANDLED_EVENT_TYPES.has(envelope.type)) {
                logger.warn('identity-webhook: unhandled event type, acknowledged without processing', {
                    requestId,
                    svixId,
                    type: envelope.type,
                });

                return { statusCode: 200, body: JSON.stringify({ ok: true, unhandled: envelope.type }) };
            }

            verified = idpWebhookEventSchema.parse(signed);
        } catch (err) {
            const reason: WebhookRejectionReason = err instanceof z.ZodError ? 'shape' : 'signature';

            return rejectInvalidWebhook({ reason, err, requestId, svixId });
        }

        return handler(event, context, { payload: verified, requestId });
    };
};

/**
 * The HTTP status each rejection reason answers with. A complete `Record`, so adding a reason fails to compile
 * until its retry disposition is decided — there is no silent default.
 *
 * **The two are NOT interchangeable, and collapsing them onto one status breaks something either way.** svix
 * retries on ANY non-2xx, across a schedule spanning hours; the question each reason must answer is therefore
 * "would a redelivery ever succeed?"
 *
 * - **`shape` → 200.** The signature already verified, so the caller IS svix and the payload IS Clerk's. A
 *   payload we cannot parse today parses identically on every redelivery, so retrying replays one permanent
 *   failure on a schedule. Acknowledging takes it off that schedule; the ERROR log is what makes the drop
 *   visible (a shape failure behind a valid signature means Clerk's contract moved).
 * - **`signature` → 401.** Two causes, and BOTH argue against 200. If the caller is not Clerk, a 200 tells a
 *   forger their forgery was accepted — and this endpoint is public with no gateway auth (`POST
 *   /api/v1/webhooks/users`), so the signature is the only trust boundary there is. If the caller IS Clerk and
 *   OUR SIGNING SECRET is stale (a rotation not yet propagated to the secret store), then the condition is
 *   TRANSIENT and operator-fixable, and svix's retry window is exactly the mechanism that rescues it: fix the
 *   secret and the queued deliveries land. Answering 200 says "delivered" and discards every real event
 *   permanently, behind a green check. That is the incident already on record — a dropped `user.created`
 *   leaving Clerk holding a user the database does not.
 *
 * An earlier revision of this module reasoned that a wrong secret "every retry reproduces" and so returned 200
 * for both. That is the half that was wrong: it treats an operator-fixable misconfiguration as permanent, and
 * pays for the mistake with irrecoverable data loss rather than a retry.
 */
export const WEBHOOK_REJECTION_STATUS: Readonly<Record<WebhookRejectionReason, number>> = {
    shape: 200,
    signature: 401,
};

/**
 * The ONE rejection path for an invalid inbound webhook — a bad signature or an unreadable shape.
 *
 * The status comes from {@link WEBHOOK_REJECTION_STATUS} (401 signature / 200 shape); everything else about the
 * two rejections is identical, which is why this is one function with a `reason` field rather than two branches
 * that can drift apart.
 *
 * **"Do not retry" MUST NOT collapse into "fail silently"** — that distinction is the whole value of this
 * path, so the rejection is alarmed, not swallowed. A shape failure behind a VALID signature means Clerk
 * changed their payload contract and a real user's account state is now diverging from ours with nobody
 * watching; that is precisely the class of silent drift this service has been bitten by before. Hence ERROR,
 * not `warn`: this Lambda's log group is subscribed to the Sentry log drain (`WebhooksLogDrain` in
 * `WebhooksStack.ts`), and the forwarder classifies severity by matching the message text, so an ERROR
 * record surfaces as a Sentry ERROR.
 *
 * The body is NEVER logged — it carries the user's email address and legal name, and these logs leave the
 * account. Only zod issue PATHS and codes go out (see `describeIssues`).
 *
 * @param reason - Which check failed. A FIELD, not a branch, so an alert can threshold signature noise (this
 *   endpoint is public and unauthenticated by design, so it receives internet background scanning) separately
 *   from shape failures, which are the ones that mean Clerk's contract moved. It ALSO selects the status.
 * @returns The reason's mapped status, carrying the reason in the body so the rejection is visible to the
 *   caller and in logs.
 * @sideEffect Emits one ERROR log record and one rejection metric.
 */
const rejectInvalidWebhook = ({
    reason,
    err,
    requestId,
    svixId,
}: {
    reason: WebhookRejectionReason;
    err: unknown;
    requestId: string;
    svixId: string;
}): APIGatewayProxyResult => {
    logger.error('identity-webhook: rejected invalid payload, acknowledged without processing', {
        reason,
        requestId,
        svixId,
        // Paths + codes for a shape failure; svix's own message for a signature failure (it names the failure
        // mode — missing header, timestamp skew, bad signature — and contains no payload data).
        ...(err instanceof z.ZodError
            ? { issues: describeIssues(err) }
            : { error: err instanceof Error ? err.message : String(err) }),
    });

    // A separate metric DIMENSION per reason, so an alarm can fire on `shape` (Clerk changed their contract)
    // without being buried by `signature` volume from unauthenticated internet noise.
    emitMetric('IdentityWebhookRejected', 1, { reason });

    return { statusCode: WEBHOOK_REJECTION_STATUS[reason], body: JSON.stringify({ ok: false, rejected: reason }) };
};
