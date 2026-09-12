/**
 * ⛔ THE ACCEPTANCE CRITERION for the viewer-request decision layer of the CloudFront edge (plan U16,
 * ADR-0020). Every scenario the plan lists for the verifier is here, plus the two the ADR records as
 * SHIPPED DEFECTS of its own first design — because both are invisible in review and catastrophic in prod.
 *
 * | Invariant                                                                  | Test                                                    |
 * | -------------------------------------------------------------------------- | ------------------------------------------------------- |
 * | A valid token passes and is decorated with its cache partition              | 'forwards a verified request …'                         |
 * | An expired / malformed / wrong-issuer token is rejected AT THE EDGE         | 'rejects a token the verifier refuses'                   |
 * | The rejection cannot be cached                                              | 'answers 401 with cache-control: no-store'               |
 * | The rejection is the repo's error envelope, not a bespoke body              | 'answers 401 with the { code, message } envelope'        |
 * | CORS preflight is NEVER blocked (ADR-0020 trap 2)                           | 'passes an OPTIONS preflight carrying no credentials'    |
 * | `/health*` is NEVER blocked (trap 2 — prod-deploy curls it, expecting 200)  | 'passes /health and /health/ready with no token'         |
 * | `/api/v1/internal/*` is NEVER blocked (trap 3 — the GDPR fan-out)           | 'passes the internal service-principal prefix'           |
 * | …including the deprecated `/v1/internal/*` alias (ADR-0011)                 | 'passes the deprecated /v1 internal alias'               |
 * | Two principals NEVER share a cache partition (trap 1 — the P0 data leak)    | 'derives a DIFFERENT partition for two principals'       |
 * | A viewer cannot forge its own partition                                     | 'strips a client-supplied principal header …'            |
 * | …on the passthrough path too, where no verification runs at all             | '…even on a passthrough request'                         |
 * | The partition value is header-safe and carries no user id                   | 'emits an opaque, header-safe partition value'           |
 * | Both 401s are readable cross-origin; nothing forwarded gains a CORS header   | "the edge's 401 carries the shared CORS policy's headers" |
 *
 * WHY the spoofing test exists even though the header is not an identity assertion: the header IS the
 * cache key on recipe's owner-scoped behaviors. A viewer who can choose it can choose which cache entry
 * their request reads and writes, which is the same P0 as trap 1 arrived at from the other direction.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CloudFrontRequest, CloudFrontRequestEvent, CloudFrontResultResponse } from 'aws-lambda';

import type { AppCorsOptions } from '@kitchensink/clerk-verify';

import { EDGE_PRINCIPAL_HEADER } from '../edgeRoutes.js';
import { createEdgeVerifier, principalCacheKey, type EdgePrincipal } from '../edgeVerifier.js';

/** The web app's origin, which {@link CORS} admits. */
const WEB_ORIGIN = 'https://commise.app';

/** A policy admitting {@link WEB_ORIGIN} with credentials, shaped the way the shared policy shapes one. */
const CORS: AppCorsOptions = {
    origin: [WEB_ORIGIN],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
};

/** A minimal CloudFront viewer-request event, in the real envelope shape. */
function event(
    overrides: {
        readonly method?: string;
        readonly uri?: string;
        readonly authorization?: string;
        readonly extraHeaders?: Readonly<Record<string, string>>;
    } = {},
): CloudFrontRequestEvent {
    const headers: CloudFrontRequest['headers'] = {};

    if (overrides.authorization !== undefined) {
        headers['authorization'] = [{ key: 'Authorization', value: overrides.authorization }];
    }

    for (const [name, value] of Object.entries(overrides.extraHeaders ?? {})) {
        headers[name] = [{ key: name, value }];
    }

    return {
        Records: [
            {
                cf: {
                    config: {
                        distributionDomainName: 'd111111abcdef8.cloudfront.net',
                        distributionId: 'EDFDVBD6EXAMPLE',
                        eventType: 'viewer-request',
                        requestId: 'req-1',
                    },
                    request: {
                        clientIp: '203.0.113.1',
                        headers,
                        method: overrides.method ?? 'GET',
                        querystring: '',
                        uri: overrides.uri ?? '/api/v1/recipes',
                    },
                },
            },
        ],
    };
}

/** The verifier under test, wired to a stub token verifier. */
function verifierFor(principal: EdgePrincipal | Error): ReturnType<typeof createEdgeVerifier> {
    return createEdgeVerifier({
        verify: vi.fn(async (_token: string) => {
            if (principal instanceof Error) {
                throw principal;
            }

            return principal;
        }),
        cors: CORS,
    });
}

const OWNER: EdgePrincipal = { sub: 'user_2abc', userId: '01J9ZK8N7QF3B2X4M6T0V5C1AB' };

/** Narrow a handler result to the forwarded request (it is a request when it carries a `uri`). */
function asRequest(result: Awaited<ReturnType<ReturnType<typeof createEdgeVerifier>>>): CloudFrontRequest {
    expect(result).toBeDefined();
    expect(result).toHaveProperty('uri');

    return result as CloudFrontRequest;
}

/** Narrow a handler result to a generated response (it is a response when it carries a `status`). */
function asResponse(result: Awaited<ReturnType<ReturnType<typeof createEdgeVerifier>>>): CloudFrontResultResponse {
    expect(result).toBeDefined();
    expect(result).toHaveProperty('status');

    return result as CloudFrontResultResponse;
}

describe('the edge verifier admits what it must', () => {
    it('forwards a verified request, decorated with its cache partition', async () => {
        const result = await verifierFor(OWNER)(event({ authorization: 'Bearer good.token' }));
        const request = asRequest(result);

        expect(request.uri).toBe('/api/v1/recipes');
        expect(request.headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value).toBe(principalCacheKey(OWNER));
    });

    it('passes an OPTIONS preflight carrying no credentials (ADR-0020 trap 2)', async () => {
        // CORS preflights carry no credentials BY SPECIFICATION. Rejecting them blocks every browser call
        // while the service is perfectly healthy to curl — the exact failure `classifyPreflight` exists for.
        const verify = vi.fn();
        const result = await createEdgeVerifier({ verify, cors: CORS })(
            event({ method: 'OPTIONS', uri: '/api/v1/recipes' }),
        );

        expect(asRequest(result).uri).toBe('/api/v1/recipes');
        expect(verify).not.toHaveBeenCalled();
    });

    it.each(['/health', '/health/ready'])('passes %s with no token (prod-deploy.yml expects 200)', async (uri) => {
        const verify = vi.fn();
        const result = await createEdgeVerifier({ verify, cors: CORS })(event({ uri }));

        expect(asRequest(result).uri).toBe(uri);
        expect(verify).not.toHaveBeenCalled();
    });

    it('passes the internal service-principal prefix, which carries an EdDSA token (trap 3)', async () => {
        // The erasure fan-out mints an EdDSA SERVICE token, not a Clerk one. A Clerk verifier rejects it,
        // the deletion worker rethrows, and SQS retries forever — the GDPR path silently re-breaks.
        const verify = vi.fn();
        const result = await createEdgeVerifier({ verify, cors: CORS })(
            event({
                method: 'POST',
                uri: '/api/v1/internal/account/erasure',
                authorization: 'Bearer eyJhbGciOiJFZERTQSJ9.service.token',
            }),
        );

        expect(asRequest(result).uri).toBe('/api/v1/internal/account/erasure');
        expect(verify).not.toHaveBeenCalled();
    });

    it('passes the deprecated /v1 internal alias too (ADR-0011 — it is live in production)', async () => {
        const verify = vi.fn();
        const result = await createEdgeVerifier({ verify, cors: CORS })(
            event({ method: 'POST', uri: '/v1/internal/account/erasure' }),
        );

        expect(asRequest(result).uri).toBe('/v1/internal/account/erasure');
        expect(verify).not.toHaveBeenCalled();
    });
});

describe('the edge verifier rejects what it must', () => {
    it('rejects a token the verifier refuses (expired, malformed, wrong issuer, bad signature)', async () => {
        const result = await verifierFor(new Error('verification failed'))(event({ authorization: 'Bearer stale' }));

        expect(asResponse(result).status).toBe('401');
    });

    it('rejects a request carrying no Authorization header at all', async () => {
        const result = await verifierFor(OWNER)(event({}));

        expect(asResponse(result).status).toBe('401');
    });

    it.each(['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer   ', 'bearertoken'])(
        'rejects a malformed authorization header (%s) without consulting the verifier',
        async (authorization) => {
            const verify = vi.fn();
            const result = await createEdgeVerifier({ verify, cors: CORS })(event({ authorization }));

            expect(asResponse(result).status).toBe('401');
            expect(verify).not.toHaveBeenCalled();
        },
    );

    it('answers 401 with cache-control: no-store, so a rejection never populates the cache', async () => {
        const response = asResponse(await verifierFor(new Error('nope'))(event({ authorization: 'Bearer bad' })));

        expect(response.headers?.['cache-control']?.[0]?.value).toBe('no-store');
    });

    it('answers 401 with the repo-wide { code, message } error envelope', async () => {
        // Every service normalizes failures into this shape (@kitchensink/nest-error-envelope). A bespoke
        // edge body would be the one 401 a client cannot parse, on the path every request now takes.
        const response = asResponse(await verifierFor(new Error('nope'))(event({ authorization: 'Bearer bad' })));

        expect(response.headers?.['content-type']?.[0]?.value).toBe('application/json');
        expect(JSON.parse(String(response.body))).toEqual({
            code: 'UNAUTHORIZED',
            message: expect.any(String),
        });
    });

    it('leaks nothing about WHY verification failed', async () => {
        const response = asResponse(
            await verifierFor(new Error('jwt expired at 2026-01-01 for user_2abc'))(
                event({ authorization: 'Bearer bad' }),
            ),
        );

        expect(String(response.body)).not.toContain('expired');
        expect(String(response.body)).not.toContain('user_2abc');
    });
});

describe('the cache partition cannot leak one principal to another (ADR-0020 trap 1)', () => {
    it('derives a DIFFERENT partition for two principals asking for the same URL', () => {
        const other: EdgePrincipal = { sub: 'user_2xyz', userId: '01JAAAAAAAAAAAAAAAAAAAAAAA' };

        expect(principalCacheKey(OWNER)).not.toBe(principalCacheKey(other));
    });

    it('derives the SAME partition for the same principal (a cache key must be stable)', () => {
        expect(principalCacheKey(OWNER)).toBe(principalCacheKey({ ...OWNER }));
    });

    it('partitions on the Clerk sub when the app-user ULID is not yet minted', () => {
        // The first-token sync race: `external_id` is absent until identity backfills it. The origin
        // answers IDENTITY_SYNC_PENDING; the edge must still partition per PRINCIPAL rather than collapsing
        // every such caller onto one shared key.
        const pending: EdgePrincipal = { sub: 'user_pending' };
        const alsoPending: EdgePrincipal = { sub: 'user_other_pending' };

        expect(principalCacheKey(pending)).not.toBe(principalCacheKey(alsoPending));
    });

    it('never collides a ULID namespace with a Clerk-sub namespace', () => {
        expect(principalCacheKey({ sub: 'collide' })).not.toBe(principalCacheKey({ sub: 'x', userId: 'collide' }));
    });

    it('emits an opaque, header-safe partition value that is not the user id', () => {
        const key = principalCacheKey(OWNER);

        expect(key).toMatch(/^[A-Za-z0-9_-]+$/u);
        expect(key).not.toContain(OWNER.userId);
        expect(key).not.toContain(OWNER.sub);
    });

    it('strips a client-supplied principal header before deciding anything', async () => {
        const result = await verifierFor(OWNER)(
            event({
                authorization: 'Bearer good.token',
                extraHeaders: { [EDGE_PRINCIPAL_HEADER]: 'someone-elses-partition' },
            }),
        );

        expect(asRequest(result).headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value).toBe(principalCacheKey(OWNER));
    });

    it('strips a client-supplied principal header even on a passthrough request', async () => {
        // Passthrough runs BEFORE verification and mints no partition of its own, so a forged header would
        // otherwise survive untouched into the cache key of whatever behavior served it.
        const result = await createEdgeVerifier({ verify: vi.fn(), cors: CORS })(
            event({ uri: '/health', extraHeaders: { [EDGE_PRINCIPAL_HEADER]: 'forged' } }),
        );

        expect(asRequest(result).headers[EDGE_PRINCIPAL_HEADER]).toBeUndefined();
    });
});

/**
 * ⛔ THE 401 IS READABLE BY THE BROWSER THAT CAUSED IT (plan 002 C1, ADR-0047). Without CORS headers on the edge's own
 * `401`, a browser reports a network error instead of the status, so the web app cannot tell an expired session from
 * an outage. The headers are the ones the origins' `cors` middleware sends on a non-preflight response.
 */
describe("the edge's 401 carries the shared CORS policy's headers", () => {
    /** The CORS headers a response carries, by lower-cased name. */
    function corsHeadersOf(response: CloudFrontResultResponse): Record<string, string | undefined> {
        const headers = response.headers ?? {};

        return {
            allowOrigin: headers['access-control-allow-origin']?.[0]?.value,
            vary: headers['vary']?.[0]?.value,
            allowCredentials: headers['access-control-allow-credentials']?.[0]?.value,
            exposeHeaders: headers['access-control-expose-headers']?.[0]?.value,
        };
    }

    /** The same request with `origin` added, or `undefined` for none. */
    const fromOrigin = (origin: string | undefined, rest: Parameters<typeof event>[0] = {}): CloudFrontRequestEvent =>
        event({ ...rest, extraHeaders: { ...rest.extraHeaders, ...(origin === undefined ? {} : { origin }) } });

    it.each<[string, Parameters<typeof event>[0]]>([
        ['no Authorization header', {}],
        ['a malformed Authorization header', { authorization: 'Basic dXNlcjpwYXNz' }],
    ])('admits the web origin on the 401 for %s, before the verifier is consulted', async (_label, rest) => {
        const verify = vi.fn();
        const response = asResponse(await createEdgeVerifier({ verify, cors: CORS })(fromOrigin(WEB_ORIGIN, rest)));

        expect(response.status).toBe('401');
        expect(verify).not.toHaveBeenCalled();
        expect(corsHeadersOf(response)).toEqual({
            allowOrigin: WEB_ORIGIN,
            vary: 'Origin',
            allowCredentials: 'true',
            exposeHeaders: 'Retry-After',
        });
    });

    it('admits the web origin on the 401 for a token the verifier refuses', async () => {
        const response = asResponse(
            await verifierFor(new Error('expired'))(fromOrigin(WEB_ORIGIN, { authorization: 'Bearer stale' })),
        );

        expect(response.status).toBe('401');
        expect(corsHeadersOf(response)).toEqual({
            allowOrigin: WEB_ORIGIN,
            vary: 'Origin',
            allowCredentials: 'true',
            exposeHeaders: 'Retry-After',
        });
    });

    it.each<[string, string | undefined]>([
        ['an origin the policy does not list', 'https://evil.example'],
        ['no Origin at all (the mobile app, a server)', undefined],
    ])('sends no Allow-Origin, and the rest, for %s', async (_label, origin) => {
        const response = asResponse(
            await verifierFor(new Error('expired'))(fromOrigin(origin, { authorization: 'Bearer stale' })),
        );

        expect(corsHeadersOf(response)).toEqual({
            allowOrigin: undefined,
            vary: 'Origin',
            allowCredentials: 'true',
            exposeHeaders: 'Retry-After',
        });
    });

    it('keeps the 401 uncacheable and enveloped beside the CORS headers', async () => {
        const response = asResponse(
            await verifierFor(new Error('nope'))(fromOrigin(WEB_ORIGIN, { authorization: 'Bearer x' })),
        );

        expect(response.headers?.['cache-control']?.[0]?.value).toBe('no-store');
        expect(response.headers?.['content-type']?.[0]?.value).toBe('application/json');
    });

    /** Every header name on a forwarded request. The edge adds response headers to nothing it forwards. */
    const headerNames = (request: CloudFrontRequest): readonly string[] => Object.keys(request.headers).sort();

    it.each<[string, Parameters<typeof event>[0]]>([
        ['an OPTIONS preflight', { method: 'OPTIONS' }],
        ['a /health probe', { uri: '/health' }],
    ])('adds no CORS header to %s it passes through', async (_label, rest) => {
        const request = asRequest(
            await createEdgeVerifier({ verify: vi.fn(), cors: CORS })(fromOrigin(WEB_ORIGIN, rest)),
        );

        expect(headerNames(request)).toEqual(['origin']);
    });

    it('adds no CORS header to a verified request it forwards', async () => {
        const request = asRequest(await verifierFor(OWNER)(fromOrigin(WEB_ORIGIN, { authorization: 'Bearer good' })));

        expect(headerNames(request)).toEqual(['authorization', EDGE_PRINCIPAL_HEADER, 'origin'].sort());
    });
});
