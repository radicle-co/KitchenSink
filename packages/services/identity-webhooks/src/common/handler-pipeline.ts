import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { UserDAO } from '@kitchensink/identity-db';

import { getConfig, getWebhookConfig } from '../config/env.js';
import { getDb } from './db.js';
import { resolveRequestId } from './error-envelope.js';
import { logger } from './observability.js';
import { verifyWebhook, type IdpWebhookEvent } from './svix.js';

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
 * duplicated across `deletion-worker.ts` and `reconciliation.ts` (and, before this change, a variant
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
 * misconfig fails the invocation outright (S-I5), never swallowed into the 401 branch below — then
 * verifies the inbound signature. On success, hands the verified {@link IdpWebhookEvent} and the
 * resolved request id to `handler`; on a missing/invalid signature, short-circuits to a 401 without
 * ever reaching `handler` (so an unverified payload can't touch the DB).
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

        let payload: IdpWebhookEvent;

        try {
            const rawBody = event.body ?? '';
            payload = verifyWebhook(event.headers as Record<string, string>, rawBody, config.IDP_WEBHOOK_SECRET);
        } catch (err) {
            logger.warn('identity-webhook: signature verification failed', {
                requestId,
                error: (err as Error).message,
            });

            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
        }

        return handler(event, context, { payload, requestId });
    };
};
