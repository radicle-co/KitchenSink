/**
 * The production wiring of the edge's CORS policy: which inputs `createClerkEdgeVerifier` hands the shared policy.
 *
 * Each case answers from the tokenless branch, so no key or token is needed: what is under test is the policy the
 * edge resolved, read off the headers of its `401`. Real tokens through the same wiring are the integration tier's
 * (`packages/infra/global/tests/edgeVerifier.integration.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { CloudFrontRequestEvent, CloudFrontResultResponse } from 'aws-lambda';

import { createClerkEdgeVerifier } from '../clerkEdgeVerifier.js';

/** A tokenless viewer request from `origin`. */
function tokenless(origin: string): CloudFrontRequestEvent {
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
                        headers: { origin: [{ key: 'Origin', value: origin }] },
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
