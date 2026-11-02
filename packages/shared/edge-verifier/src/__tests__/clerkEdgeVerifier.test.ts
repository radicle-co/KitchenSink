/**
 * The production wiring of the edge's CORS policy: which inputs `createClerkEdgeVerifier` hands the shared policy.
 *
 * Each case answers from the tokenless branch, so no key or token is needed: what is under test is the policy the
 * edge resolved, read off the headers of its `401`. Real tokens through the same wiring are the integration tier's
 * (`packages/infra/global/tests/edgeVerifier.integration.test.ts`).
 */
import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';
import type { CloudFrontRequestEvent, CloudFrontResultResponse } from 'aws-lambda';

import { createClerkEdgeVerifier } from '../clerkEdgeVerifier.js';

/** A viewer request from `origin`, carrying `authorization` when given. */
function tokenless(origin: string, authorization?: string): CloudFrontRequestEvent {
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
                        headers: {
                            origin: [{ key: 'Origin', value: origin }],
                            ...(authorization === undefined
                                ? {}
                                : { authorization: [{ key: 'Authorization', value: authorization }] }),
                        },
                        method: 'GET',
                        querystring: '',
                        uri: '/api/v1/users/me',
                    },
                },
            },
        ],
    };
}

/** The `401` an edge built for `authorizedPartiesRaw` answers a tokenless request from `origin` with. */
async function unauthorizedFrom(authorizedPartiesRaw: string, origin: string): Promise<CloudFrontResultResponse> {
    const handler = createClerkEdgeVerifier({
        jwtKey: 'unused: the tokenless branch never verifies',
        authorizedPartiesRaw,
    });
    const response = (await handler(tokenless(origin))) as CloudFrontResultResponse;

    expect(response.status).toBe('401');

    return response;
}

describe('createClerkEdgeVerifier resolves the shared policy for a deployed, prod-only edge', () => {
    it('admits each listed party, trimmed, and only those', async () => {
        const parties = ' https://commise.app , https://www.commise.app ';

        expect(
            (await unauthorizedFrom(parties, 'https://commise.app')).headers?.['access-control-allow-origin'],
        ).toEqual([{ key: 'Access-Control-Allow-Origin', value: 'https://commise.app' }]);
        expect(
            (await unauthorizedFrom(parties, 'https://www.commise.app')).headers?.['access-control-allow-origin']?.[0]
                ?.value,
        ).toBe('https://www.commise.app');
        expect(
            (await unauthorizedFrom(parties, 'https://evil.example')).headers?.['access-control-allow-origin'],
        ).toBeUndefined();
    });

    it('grants no credentials, because no service behind the edge grants them', async () => {
        const response = await unauthorizedFrom('https://commise.app', 'https://commise.app');

        expect(response.headers?.['access-control-allow-origin']?.[0]?.value).toBe('https://commise.app');
        expect(response.headers?.['access-control-allow-credentials']).toBeUndefined();
    });

    it.each(['http://localhost:3000', 'https://pr-7.sandbox.commise.app'])(
        'is DEPLOYED with no preview pattern: an empty party list admits nothing, %s included',
        async (origin) => {
            const response = await unauthorizedFrom('', origin);

            expect(response.headers?.['access-control-allow-origin']).toBeUndefined();
            expect(response.headers?.['vary']?.[0]?.value).toBe('Origin');
        },
    );
});

describe('createClerkEdgeVerifier and a suspended account (ADR-0081)', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    /** A really signed Clerk-shaped token for `user_suspended`, carrying the suspended mark. */
    function suspendedBearer(): string {
        const now = Math.floor(Date.now() / 1000);
        const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
        const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({
            sub: 'user_suspended',
            external_id: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
            public_metadata: { suspended: true },
            iat: now,
            nbf: now - 5,
            exp: now + 600,
        })}`;

        return `Bearer ${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
    }

    // The edge takes no authorization decision: the origin answers the 403, and must be able to let erasure through.
    // An edge that refused here would 401 the erasure route in front of identity.
    it('⛔ passes a genuine suspended token through to the origin instead of answering 401', async () => {
        const handler = createClerkEdgeVerifier({ jwtKey: publicKey, authorizedPartiesRaw: 'https://commise.app' });

        const result = await handler(tokenless('https://commise.app', suspendedBearer()));

        expect(result).not.toHaveProperty('status');
    });
});
