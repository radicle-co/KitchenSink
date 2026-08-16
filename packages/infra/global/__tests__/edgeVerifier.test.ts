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
 *
 * WHY the spoofing test exists even though the header is not an identity assertion: the header IS the
 * cache key on recipe's owner-scoped behaviors. A viewer who can choose it can choose which cache entry
 * their request reads and writes, which is the same P0 as trap 1 arrived at from the other direction.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import type { CloudFrontRequest, CloudFrontRequestEvent, CloudFrontResultResponse } from 'aws-lambda';

import {
    EDGE_PRINCIPAL_HEADER,
    PASSTHROUGH_PATH_PATTERNS,
    isPassthroughRequest,
    matchesPathPattern,
} from '../lib/edge-verifier/edgeRoutes.js';
import { createEdgeVerifier, principalCacheKey, type EdgePrincipal } from '../lib/edge-verifier/edgeVerifier.js';
import { EDGE_JWT_KEY_GLOBAL } from '../src/edge-verifier/edgeBuildContract.js';

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
    return createEdgeVerifier(
        vi.fn(async (_token: string) => {
            if (principal instanceof Error) {
                throw principal;
            }

            return principal;
        }),
    );
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
        const result = await createEdgeVerifier(verify)(event({ method: 'OPTIONS', uri: '/api/v1/recipes' }));

        expect(asRequest(result).uri).toBe('/api/v1/recipes');
        expect(verify).not.toHaveBeenCalled();
    });

    it.each(['/health', '/health/ready'])('passes %s with no token (prod-deploy.yml expects 200)', async (uri) => {
        const verify = vi.fn();
        const result = await createEdgeVerifier(verify)(event({ uri }));

        expect(asRequest(result).uri).toBe(uri);
        expect(verify).not.toHaveBeenCalled();
    });

    it('passes the internal service-principal prefix, which carries an EdDSA token (trap 3)', async () => {
        // The erasure fan-out mints an EdDSA SERVICE token, not a Clerk one. A Clerk verifier rejects it,
        // the deletion worker rethrows, and SQS retries forever — the GDPR path silently re-breaks.
        const verify = vi.fn();
        const result = await createEdgeVerifier(verify)(
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
        const result = await createEdgeVerifier(verify)(event({ method: 'POST', uri: '/v1/internal/account/erasure' }));

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
            const result = await createEdgeVerifier(verify)(event({ authorization }));

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
        const result = await createEdgeVerifier(vi.fn())(
            event({ uri: '/health', extraHeaders: { [EDGE_PRINCIPAL_HEADER]: 'forged' } }),
        );

        expect(asRequest(result).headers[EDGE_PRINCIPAL_HEADER]).toBeUndefined();
    });
});

describe('the passthrough registry is ONE authority, matched the way CloudFront matches it', () => {
    it('lists exactly the three exemptions ADR-0020 records', () => {
        // Pinned, not merely tested through: each entry is a decision with a recorded reason, and a fourth
        // appearing without one is how an unauthenticated hole gets added to a public edge.
        expect([...PASSTHROUGH_PATH_PATTERNS]).toEqual(['/health*', '/api/v1/internal/*', '/v1/internal/*']);
    });

    it.each([
        ['/health*', '/health', true],
        ['/health*', '/health/ready', true],
        ['/health*', '/api/v1/recipes', false],
        ['/api/v1/internal/*', '/api/v1/internal/account/erasure', true],
        ['/api/v1/internal/*', '/api/v1/internally-public', false],
        ['/api/v1/recipes', '/api/v1/recipes', true],
        ['/api/v1/recipes', '/api/v1/recipes/1', false],
    ])('matches pattern %s against %s → %s', (pattern, uri, expected) => {
        expect(matchesPathPattern(pattern, uri)).toBe(expected);
    });

    it('does not exempt a path that merely CONTAINS an exempt prefix', () => {
        expect(isPassthroughRequest({ method: 'GET', uri: '/api/v1/recipes/health' })).toBe(false);
        expect(isPassthroughRequest({ method: 'POST', uri: '/api/v1/recipes/../internal/account/erasure' })).toBe(
            false,
        );
    });

    it('exempts OPTIONS regardless of path, because a preflight can precede any route', () => {
        expect(isPassthroughRequest({ method: 'OPTIONS', uri: '/api/v1/recipes/abc' })).toBe(true);
    });
});

describe('the build-time key contract cannot be spelled apart', () => {
    it('defines exactly the identifier the handler declares', () => {
        // `esbuild.mjs` is a build script in `.mjs` and `handler.ts` is bundled source; neither can import
        // the other, so the identifier is a contract kept by two files agreeing on a string. A typo is not a
        // build error — it leaves the `declare`d global un-substituted, which is a ReferenceError at the
        // edge, on every request, in production only.
        const bundler = readFileSync(fileURLToPath(new URL('../esbuild.mjs', import.meta.url)), 'utf8');

        expect(bundler).toContain(`define: { ${EDGE_JWT_KEY_GLOBAL}: JSON.stringify(edgeJwtKey) }`);
    });

    it('declares that same identifier in the handler, and reads nothing from process.env', () => {
        // Lambda@Edge rejects environment variables outright, so a handler that grew a `process.env` read
        // would fail at association time — long after review.
        const handler = readFileSync(
            fileURLToPath(new URL('../src/edge-verifier/handler.ts', import.meta.url)),
            'utf8',
        );
        // Comments are stripped first: the docblock EXPLAINS why `process.env` cannot be used here, so a
        // naive substring check fires on its own rationale.
        const code = handler.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

        expect(handler).toContain(`declare const ${EDGE_JWT_KEY_GLOBAL}: string;`);
        expect(code).not.toContain('process.env');
    });
});

describe('prod-deploy.yml supplies the build-time key, in the right order', () => {
    /** The `Deploy Production` job's steps, in file order. */
    function prodDeploySteps(): readonly { readonly name?: string; readonly run?: string }[] {
        const doc = parse(
            readFileSync(
                fileURLToPath(new URL('../../../../.github/workflows/prod-deploy.yml', import.meta.url)),
                'utf8',
            ),
        ) as { jobs: Record<string, { steps?: { name?: string; run?: string }[] }> };

        return Object.values(doc.jobs)[0]?.steps ?? [];
    }

    const indexOf = (predicate: (run: string) => boolean): number =>
        prodDeploySteps().findIndex((step) => predicate(step.run ?? ''));

    it('reads the key from SSM rather than carrying a copy in repo configuration', () => {
        // One source of truth: the same parameter the identity, food and recipe task definitions resolve.
        // A GitHub variable would be a second representation of a key that rotates.
        const exporter = prodDeploySteps().find((step) => (step.run ?? '').includes('CLERK_JWT_KEY'));

        expect(exporter?.run).toContain('aws ssm get-parameter');
        expect(exporter?.run).toContain('clerk/jwt-public-key');
    });

    it('exports it BEFORE the bundle step that inlines it', () => {
        // Lambda@Edge cannot read environment variables, so the key is a BUILD-time input. Exported after
        // the bundle, `esbuild.mjs` skips the edge verifier entirely and the synth then fails on a missing
        // bundle — loud, but one deploy wasted for a fixable ordering mistake.
        const exportIndex = indexOf((run) => run.includes('CLERK_JWT_KEY'));
        const bundleIndex = indexOf((run) => /bundle:lambda/u.test(run) && /packages\/infra\/global/u.test(run));

        expect(exportIndex).toBeGreaterThanOrEqual(0);
        expect(bundleIndex).toBeGreaterThan(exportIndex);
    });

    it('exports it after AWS credentials exist, or the SSM read cannot authenticate', () => {
        const credentialsIndex = prodDeploySteps().findIndex((step) =>
            /Configure AWS credentials/iu.test(step.name ?? ''),
        );

        expect(credentialsIndex).toBeGreaterThanOrEqual(0);
        expect(indexOf((run) => run.includes('CLERK_JWT_KEY'))).toBeGreaterThan(credentialsIndex);
    });

    it('still bundles before the dev-dependency prune deletes esbuild', () => {
        // The prune is a one-way door: `esbuild` is a devDependency, so a bundle step moved past it dies
        // with exit 127 — the same trap `prodDeployBuildOrder.test.ts` records for `nest build`.
        const bundleIndex = indexOf((run) => /bundle:lambda/u.test(run) && /packages\/infra\/global/u.test(run));

        expect(indexOf((run) => run.includes('npm prune'))).toBeGreaterThan(bundleIndex);
    });
});
