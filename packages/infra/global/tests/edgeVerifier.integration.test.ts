/**
 * INTEGRATION tier for the Lambda@Edge viewer-request verifier (plan U16, ADR-0020).
 *
 * ## What is REAL here, and why the unit tier cannot stand alone
 *
 * `edgeVerifier.test.ts` drives the decision layer with a STUB verifier. That proves the branching, and it
 * structurally cannot prove the property this unit exists for: that the **passthrough list is evaluated
 * BEFORE verification**. With a stub, "the verifier was not called" is a statement about a spy. Here the
 * verifier is real, so a request that reached it would be REJECTED — every passthrough case below carries a
 * credential the real Clerk verifier refuses (or none at all), and passes anyway. That is the difference
 * between asserting the ordering and demonstrating it.
 *
 * - **Real**: a freshly generated RSA keypair; real RS256 Clerk-shaped session tokens minted with `jose`;
 *   the real `@kitchensink/clerk-verify` networkless verification (`@clerk/backend`'s `verifyToken`); the
 *   real production wiring `src/edge-verifier/handler.ts` ships (`createClerkEdgeVerifier`); real CloudFront
 *   viewer-request event envelopes; a real Ed25519 SERVICE token of the shape identity mints for the erasure
 *   fan-out.
 * - **Stubbed**: nothing. No network is involved because the verification is networkless BY CONSTRUCTION —
 *   a `jwtKey` is passed, never a `secretKey`, so there is no JWKS round trip to fake.
 *
 * It lives in `__tests__/` beside the package's other suites because `@kitchensink/infra-global` has a
 * single test tier and this spec needs no external service — the same reasoning
 * `cdkNagSynth.integration.test.ts` and `deployGate.integration.test.ts` record.
 *
 * | Plan U16 test scenario                                                  | Test                                          |
 * | ----------------------------------------------------------------------- | --------------------------------------------- |
 * | A request with a valid Clerk token passes the edge verifier             | 'forwards a genuinely signed session token'   |
 * | An expired / malformed / wrong-issuer token is rejected at the edge      | 'rejects …' (four cases)                      |
 * | An OPTIONS preflight with no Authorization reaches the origin            | 'passes a real CORS preflight …'              |
 * | GET /health with no token reaches the origin                             | 'passes an unauthenticated /health probe'     |
 * | /api/v1/internal/* carrying an EdDSA service token reaches the origin    | 'passes a real EdDSA service token …'         |
 * | Two valid tokens on the same owner-scoped URL do NOT share a cache entry | 'partitions two real principals …'            |
 */
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { SignJWT, importPKCS8 } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CloudFrontRequest, CloudFrontRequestEvent, CloudFrontResultResponse } from 'aws-lambda';

import { EDGE_PRINCIPAL_HEADER } from '../lib/edge-verifier/edgeRoutes.js';
import { createClerkEdgeVerifier } from '../src/edge-verifier/clerkEdgeVerifier.js';
import { EDGE_JWT_KEY_GLOBAL } from '../src/edge-verifier/edgeBuildContract.js';

/** An RSA keypair standing in for a Clerk instance's signing key. Generated per run — never committed. */
function issuerKeys(): { readonly publicPem: string; readonly privatePkcs8: string } {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

    return {
        publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privatePkcs8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
}

const clerk = issuerKeys();
const impostor = issuerKeys();

/** Mint a real RS256 token shaped like a Clerk session token. */
async function sessionToken(
    claims: Readonly<Record<string, unknown>>,
    options: { readonly privatePkcs8?: string; readonly expiresAt?: number; readonly issuedAt?: number } = {},
): Promise<string> {
    const signer = await importPKCS8(options.privatePkcs8 ?? clerk.privatePkcs8, 'RS256');

    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'ins_test' })
        .setIssuer('https://clerk.commise.app')
        .setIssuedAt(options.issuedAt)
        .setExpirationTime(options.expiresAt ?? '5m')
        .sign(signer);
}

/**
 * A real Ed25519 service token, of the shape identity mints for the erasure fan-out.
 *
 * ⛔ Its whole point is that the Clerk verifier CANNOT accept it: a different algorithm, a different key,
 * a different issuer. If the passthrough list did not precede verification, this would be a `401` — and the
 * deletion worker would rethrow, SQS would retry forever, and the GDPR erasure path would silently break.
 */
async function serviceToken(): Promise<string> {
    const { privateKey } = generateKeyPairSync('ed25519');
    const signer = await importPKCS8(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'EdDSA');

    return new SignJWT({ sub: 'identity-service', aud: 'recipe-service' })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('60s')
        .sign(signer);
}

/** A realistic CloudFront viewer-request event. */
function viewerRequest(input: {
    readonly method?: string;
    readonly uri?: string;
    readonly querystring?: string;
    readonly headers?: Readonly<Record<string, string>>;
}): CloudFrontRequestEvent {
    const headers: CloudFrontRequest['headers'] = {
        host: [{ key: 'Host', value: 'recipe.commise.app' }],
        'user-agent': [{ key: 'User-Agent', value: 'Mozilla/5.0' }],
    };

    for (const [name, value] of Object.entries(input.headers ?? {})) {
        headers[name.toLowerCase()] = [{ key: name, value }];
    }

    return {
        Records: [
            {
                cf: {
                    config: {
                        distributionDomainName: 'd111111abcdef8.cloudfront.net',
                        distributionId: 'EDFDVBD6EXAMPLE',
                        eventType: 'viewer-request',
                        requestId: 'MRVMF7KydIvxMWfJIglgwHQwZsbG2IhRJ07sn9AkKUFSHS9EXAMPLE==',
                    },
                    request: {
                        clientIp: '203.0.113.178',
                        headers,
                        method: input.method ?? 'GET',
                        querystring: input.querystring ?? '',
                        uri: input.uri ?? '/api/v1/recipes',
                    },
                },
            },
        ],
    };
}

let verify: ReturnType<typeof createClerkEdgeVerifier>;

beforeAll(() => {
    verify = createClerkEdgeVerifier(clerk.publicPem);
});

/** The forwarded request, failing loudly if the edge generated a response instead. */
function forwarded(result: Awaited<ReturnType<typeof verify>>): CloudFrontRequest {
    expect(result, 'expected the request to reach the origin, but the edge generated a response').not.toHaveProperty(
        'status',
    );

    return result as CloudFrontRequest;
}

/** The generated response, failing loudly if the request was forwarded instead. */
function generated(result: Awaited<ReturnType<typeof verify>>): CloudFrontResultResponse {
    expect(result, 'expected the edge to answer, but the request was forwarded to the origin').toHaveProperty('status');

    return result as CloudFrontResultResponse;
}

describe('a genuinely signed Clerk token, through the real networkless verifier', () => {
    it('forwards a genuinely signed session token, carrying its cache partition', async () => {
        const token = await sessionToken({
            sub: 'user_2abcDEF',
            external_id: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
            azp: 'https://commise.app',
        });
        const request = forwarded(
            await verify(
                viewerRequest({
                    uri: '/api/v1/recipes',
                    querystring: 'limit=20',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            ),
        );

        expect(request.headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    });

    it('forwards a token that has no external_id yet, so IDENTITY_SYNC_PENDING still reaches the client', async () => {
        // The origin — not the edge — owns that contract: it answers 401 with a `code` the client keys on to
        // refresh and retry. An edge that required `external_id` would replace it with an opaque 401.
        const token = await sessionToken({ sub: 'user_no_ulid', azp: 'https://commise.app' });
        const request = forwarded(await verify(viewerRequest({ headers: { Authorization: `Bearer ${token}` } })));

        expect(request.headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value).toBeDefined();
    });

    it('replaces a forged partition header on an otherwise valid request', async () => {
        const token = await sessionToken({ sub: 'user_a', external_id: '01JAAA', azp: 'https://commise.app' });
        const honest = forwarded(await verify(viewerRequest({ headers: { Authorization: `Bearer ${token}` } })));
        const forged = forwarded(
            await verify(
                viewerRequest({
                    headers: { Authorization: `Bearer ${token}`, [EDGE_PRINCIPAL_HEADER]: 'victims-partition' },
                }),
            ),
        );

        expect(forged.headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value).toBe(
            honest.headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value,
        );
    });
});

describe('the real verifier rejects every token that is not currently valid', () => {
    it('rejects an expired token', async () => {
        // ⚠️ The expiry is ABSOLUTE. `setExpirationTime('1s')` resolves relative to NOW even when `iat` is
        // backdated, so the obvious spelling mints a token expiring one second in the FUTURE — measured, and
        // it made this test pass against a verifier that had not checked anything. `@clerk/backend` also
        // allows 5s of clock skew, so an hour is comfortably outside it.
        const hourAgo = Math.floor(Date.now() / 1000) - 3600;
        const token = await sessionToken(
            { sub: 'user_x', external_id: '01JXXX' },
            { issuedAt: hourAgo, expiresAt: hourAgo + 60 },
        );

        expect(generated(await verify(viewerRequest({ headers: { Authorization: `Bearer ${token}` } }))).status).toBe(
            '401',
        );
    });

    it('rejects a token signed by a different issuer key', async () => {
        const token = await sessionToken(
            { sub: 'user_x', external_id: '01JXXX' },
            { privatePkcs8: impostor.privatePkcs8 },
        );

        expect(generated(await verify(viewerRequest({ headers: { Authorization: `Bearer ${token}` } }))).status).toBe(
            '401',
        );
    });

    it('rejects a structurally malformed token', async () => {
        expect(generated(await verify(viewerRequest({ headers: { Authorization: 'Bearer not.a.jwt' } }))).status).toBe(
            '401',
        );
    });

    it('rejects a token whose payload was edited after signing', async () => {
        // The attack the signature exists to stop, exercised rather than assumed: swap the subject in an
        // otherwise genuine token and re-serialize it.
        const token = await sessionToken({ sub: 'user_a', external_id: '01JAAA', azp: 'https://commise.app' });
        const [header, payload, signature] = token.split('.');
        const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
        const tampered = [
            header,
            Buffer.from(JSON.stringify({ ...decoded, sub: 'user_victim' }), 'utf8').toString('base64url'),
            signature,
        ].join('.');

        expect(
            generated(await verify(viewerRequest({ headers: { Authorization: `Bearer ${tampered}` } }))).status,
        ).toBe('401');
    });

    it('answers with an uncacheable envelope, so a rejection never poisons the cache', async () => {
        const response = generated(await verify(viewerRequest({ headers: { Authorization: 'Bearer nope' } })));

        expect(response.headers?.['cache-control']?.[0]?.value).toBe('no-store');
        expect(JSON.parse(String(response.body))).toMatchObject({ code: 'UNAUTHORIZED' });
    });
});

describe('the passthrough list is evaluated BEFORE verification — proven with the real verifier', () => {
    it('passes a real CORS preflight, which carries no credentials by specification', async () => {
        const request = forwarded(
            await verify(
                viewerRequest({
                    method: 'OPTIONS',
                    uri: '/api/v1/recipes',
                    headers: {
                        Origin: 'https://commise.app',
                        'Access-Control-Request-Method': 'POST',
                        'Access-Control-Request-Headers': 'authorization,content-type',
                    },
                }),
            ),
        );

        expect(request.method).toBe('OPTIONS');
    });

    it.each(['/health', '/health/ready'])('passes an unauthenticated %s probe', async (uri) => {
        expect(forwarded(await verify(viewerRequest({ uri }))).uri).toBe(uri);
    });

    it('passes a real EdDSA service token on the internal prefix, and REJECTS the same token elsewhere', async () => {
        const token = await serviceToken();
        const authorization = `Bearer ${token}`;
        const internal = await verify(
            viewerRequest({
                method: 'POST',
                uri: '/api/v1/internal/account/erasure',
                headers: { Authorization: authorization },
            }),
        );
        const elsewhere = await verify(
            viewerRequest({ uri: '/api/v1/recipes', headers: { Authorization: authorization } }),
        );

        // The pair is the proof. The same credential passes on the exempt prefix and is refused off it, so
        // what let it through was the passthrough decision — not a verifier that accepts EdDSA tokens.
        expect(forwarded(internal).uri).toBe('/api/v1/internal/account/erasure');
        expect(generated(elsewhere).status).toBe('401');
    });

    it('never mints a partition for a passthrough request, however the caller decorates it', async () => {
        const request = forwarded(
            await verify(viewerRequest({ uri: '/health', headers: { [EDGE_PRINCIPAL_HEADER]: 'forged' } })),
        );

        expect(request.headers[EDGE_PRINCIPAL_HEADER]).toBeUndefined();
    });
});

describe('two principals never share an owner-scoped cache entry (ADR-0020 trap 1, the P0)', () => {
    const url = { uri: '/api/v1/recipes', querystring: 'limit=20' };

    it('partitions two real principals asking for the identical owner-scoped URL', async () => {
        const alice = await sessionToken({ sub: 'user_alice', external_id: '01JALICE', azp: 'https://commise.app' });
        const bob = await sessionToken({ sub: 'user_bob', external_id: '01JBOB', azp: 'https://commise.app' });

        const alicePartition = forwarded(
            await verify(viewerRequest({ ...url, headers: { Authorization: `Bearer ${alice}` } })),
        ).headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value;
        const bobPartition = forwarded(
            await verify(viewerRequest({ ...url, headers: { Authorization: `Bearer ${bob}` } })),
        ).headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value;

        expect(alicePartition).toBeDefined();
        expect(alicePartition).not.toBe(bobPartition);
    });

    it('gives the SAME principal the same partition across two DISTINCT tokens, so the cache still hits', async () => {
        // The mirror of the leak: a partition that changed per token would key every request uniquely and
        // the cache would never serve anything, which is a silent, expensive kind of correct.
        const first = await sessionToken({ sub: 'user_alice', external_id: '01JALICE', azp: 'https://commise.app' });
        const second = await sessionToken({
            sub: 'user_alice',
            external_id: '01JALICE',
            azp: 'https://app.commise.app',
        });

        expect(first).not.toBe(second);

        const partitionOf = async (token: string): Promise<string | undefined> =>
            forwarded(await verify(viewerRequest({ ...url, headers: { Authorization: `Bearer ${token}` } }))).headers[
                EDGE_PRINCIPAL_HEADER
            ]?.[0]?.value;

        expect(await partitionOf(first)).toBe(await partitionOf(second));
    });
});

describe('the artifact esbuild actually ships to the edge', () => {
    /**
     * The REAL bundle, built the way `esbuild.mjs` builds it, into a temporary directory.
     *
     * A temp outdir rather than the package's `dist-edge/`, so a test run cannot leave a fixture-key bundle
     * where a later manual deploy would find it. (`EdgeStack` would refuse that bundle anyway — this keeps
     * the two independent.)
     */
    async function bundleEdgeVerifier(jwtKey: string): Promise<string> {
        const outdir = mkdtempSync(path.join(tmpdir(), 'kitchensink-edge-real-'));

        await build({
            entryPoints: [
                path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/edge-verifier/handler.ts'),
            ],
            outdir,
            bundle: true,
            platform: 'node',
            target: 'node22',
            format: 'cjs',
            define: { [EDGE_JWT_KEY_GLOBAL]: JSON.stringify(jwtKey) },
            logLevel: 'silent',
        });

        return path.join(outdir, 'handler.js');
    }

    let bundled: string;

    beforeAll(async () => {
        bundled = await bundleEdgeVerifier(clerk.publicPem);
    }, 120_000);

    it('loads as CommonJS and verifies a genuinely signed token, key and all', async () => {
        // Everything the unit tier cannot see: that `define` substituted the declared global, that
        // `@clerk/backend` bundles at all, and that Lambda would find `handler` on the CJS exports.
        const module = createRequire(import.meta.url)(bundled) as {
            handler: (event: CloudFrontRequestEvent) => Promise<CloudFrontRequest | CloudFrontResultResponse>;
        };
        const token = await sessionToken({
            sub: 'user_bundled',
            external_id: '01JBUNDLED',
            azp: 'https://commise.app',
        });

        expect(typeof module.handler).toBe('function');

        const accepted = (await module.handler(
            viewerRequest({ headers: { Authorization: `Bearer ${token}` } }),
        )) as CloudFrontRequest;
        const refused = (await module.handler(
            viewerRequest({ headers: { Authorization: 'Bearer forged' } }),
        )) as CloudFrontResultResponse;

        expect(accepted.headers[EDGE_PRINCIPAL_HEADER]?.[0]?.value).toBeDefined();
        expect(refused.status).toBe('401');
    });

    it('fits inside the 1 MB Lambda@Edge viewer-request code limit, with room to spare', () => {
        // AWS's ceiling for a viewer-request function. Measured at ~70 kB unminified / ~19 kB zipped, but
        // the number that matters is the direction: this fails long before a dependency quietly makes the
        // bundle undeployable, which is otherwise a deploy-time error on a 5–15 minute loop.
        expect(statSync(bundled).size).toBeLessThan(1_000_000);
    });
});
