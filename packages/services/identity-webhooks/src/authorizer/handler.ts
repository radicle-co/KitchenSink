import * as Sentry from '@sentry/aws-serverless';
import type { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult, Context } from 'aws-lambda';

import type { AuthorizerContext, ClerkSessionClaims, UserId } from '@kitchensink/identity-service';
import { UserDAO } from '@kitchensink/identity-service/database/dao';

import { requireEnv } from '../common/config.js';
import { verifyClerkJwt } from '../common/jwt.js';
import { getUser as getClerkUser, setExternalId } from '../common/identityClient.js';
import { getDb } from '../common/db.js';
import { withObservability } from '../common/observability.js';

const unauthorized = (): never => {
    throw new Error('Unauthorized');
};

const parseBearerToken = (event: APIGatewayRequestAuthorizerEvent): string => {
    const raw = event.headers?.Authorization ?? event.headers?.authorization;

    if (!raw) {
        return unauthorized();
    }

    const [scheme, token] = raw.trim().split(/\s+/);

    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
        return unauthorized();
    }

    return token;
};

const buildPolicy = (
    principalId: string,
    effect: 'Allow' | 'Deny',
    methodArn: string,
    context?: Record<string, string | number | boolean>,
): APIGatewayAuthorizerResult => ({
    principalId,
    policyDocument: {
        Version: '2012-10-17',
        Statement: [
            {
                Action: 'execute-api:Invoke',
                Effect: effect,
                Resource: methodArn,
            },
        ],
    },
    ...(context ? { context } : {}),
});

const serializeContext = (ctx: AuthorizerContext): Record<string, string | number | boolean> => ({
    userId: ctx.userId,
    clerkUserId: ctx.clerkUserId,
    email: ctx.email,
    scopes: JSON.stringify(ctx.scopes),
    permissions: JSON.stringify(ctx.permissions),
    tokenType: ctx.tokenType,
});

const resolveUserId = async (claims: ClerkSessionClaims): Promise<UserId> => {
    if (claims.app_user_id) {
        return claims.app_user_id;
    }

    const db = await getDb(requireEnv('DB_SECRET_ARN'));
    const dao = new UserDAO(
        db as unknown as import('drizzle-orm/postgres-js').PostgresJsDatabase<Record<string, never>>,
    );

    const clerkUser = await getClerkUser(claims.sub);

    const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || undefined;
    const picture = clerkUser.imageUrl || undefined;

    const user = await dao.upsertByIdentityId({ identityId: claims.sub, email, name, picture });
    const userId = user.id as UserId;

    await setExternalId(claims.sub, userId);

    return userId;
};

const innerHandler = async (
    event: APIGatewayRequestAuthorizerEvent,
    _context: Context,
): Promise<APIGatewayAuthorizerResult> => {
    try {
        const token = parseBearerToken(event);
        const claims = await verifyClerkJwt(token);

        if (!claims.sub) {
            return unauthorized();
        }

        const userId = await resolveUserId(claims);

        const authContext: AuthorizerContext = {
            userId,
            email: claims.email ?? '',
            clerkUserId: claims.sub,
            scopes: [],
            permissions: [],
            tokenType: 'user',
        };

        return buildPolicy(claims.sub, 'Allow', event.methodArn, serializeContext(authContext));
    } catch (err) {
        const isRoutineDeny = err instanceof Error && err.message === 'Unauthorized';

        if (!isRoutineDeny) {
            // Unexpected failure (JWT verification, JWKS fetch, DB, Clerk API). Capture a sanitized
            // error — never the raw `cause`, which can carry the bearer token, JWT claims, or email
            // (security P1). Routine denials are filtered in the shared beforeSend.
            Sentry.captureException(new Error('authorizer unexpected failure'), {
                level: 'error',
                tags: { authorizer_outcome: 'unexpected_failure' },
            });
        }

        // Always deny with a clean, PII-free error. Intentionally NO `cause`: the caught error can
        // carry the bearer token / JWT claims / email, which Sentry would serialize (security P1).
        // `unauthorized()` throws from its own scope, so no caught error is ever attached as `cause`.
        return unauthorized();
    }
};

export const handler = withObservability(innerHandler);
