/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): the search function, the module its Lambda runs, with its USDA key in
 * LocalStack's Secrets Manager — the real API, reached through the real AWS SDK at `AWS_ENDPOINT_URL` — and USDA as a
 * loopback stand-in.
 *
 * The integration tier stands Secrets Manager in with a stub; this proves the handler against the store's own
 * behaviour: a secret found by its NAME, as the stack configures the function. It never claims a deployment.
 */
import { randomUUID } from 'node:crypto';

import { CreateSecretCommand, DeleteSecretCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { LambdaFunctionURLEvent } from 'aws-lambda';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeSearchEvent } from '../../src/search/__fixtures__/searchEvent.js';
import { remoteSearchAnswerSchema } from '../../src/search/remoteSearch.schema.js';
import type { SearchResponse } from '../../src/search/searchResponse.js';
import { startUsdaStubServer, type UsdaStubServer } from '../support/usdaStubServer.js';

/** The LocalStack endpoint the job starts. Required: this tier refuses to run, rather than skip, without it. */
const ENDPOINT = process.env['AWS_ENDPOINT_URL'];

/** This run's secret, named so two runs against one LocalStack never meet. */
const RUN = randomUUID().slice(0, 8);
const USDA_SECRET_NAME = `kitchensink/e2e-${RUN}/food/usda-api-key`;
const USDA_KEY = `e2e-usda-key-${RUN}`;

let client: SecretsManagerClient;
let upstream: UsdaStubServer;

beforeAll(async () => {
    if (ENDPOINT === undefined || ENDPOINT === '') {
        throw new Error('AWS_ENDPOINT_URL must name a LocalStack endpoint: this LOCAL tier never skips.');
    }

    client = new SecretsManagerClient({});
    upstream = await startUsdaStubServer();
    await client.send(new CreateSecretCommand({ Name: USDA_SECRET_NAME, SecretString: USDA_KEY }));
});

beforeEach(() => {
    upstream.reset();
    upstream.mode = 'hits';
    vi.stubEnv('USDA_API_KEY_SECRET_ID', USDA_SECRET_NAME);
    vi.stubEnv('USDA_API_BASE_URL', upstream.baseUrl);
    vi.resetModules();
});

afterAll(async () => {
    vi.unstubAllEnvs();

    // `beforeAll` already failed the run and said why; there is nothing of this run's to clean up.
    if (ENDPOINT === undefined || ENDPOINT === '') {
        return;
    }

    await upstream.close();

    await client.send(new DeleteSecretCommand({ SecretId: USDA_SECRET_NAME, ForceDeleteWithoutRecovery: true }));
});

/**
 * The search function, loaded as a new container loads it.
 *
 * @returns Its handler.
 */
async function searchFunction(): Promise<(event: LambdaFunctionURLEvent) => Promise<SearchResponse>> {
    const { handler } = await import('../../src/handler.js');

    return handler;
}

describe('the search function, with its USDA key in Secrets Manager', () => {
    it('reads the key by the name the stack configures, and searches USDA with it', async () => {
        const handler = await searchFunction();

        const response = await handler(makeSearchEvent());

        expect(response.statusCode).toBe(200);
        expect(remoteSearchAnswerSchema.parse(JSON.parse(response.body))).toMatchObject({ outcome: 'found' });
        expect(upstream.requests.map((request) => request.url.searchParams.get('api_key'))).toStrictEqual([USDA_KEY]);
    });

    it('answers a probe it does not admit without calling USDA', async () => {
        const handler = await searchFunction();

        const response = await handler(makeSearchEvent({ query: { admit: '0' } }));

        expect(response.statusCode).toBe(428);
        expect(upstream.requests).toHaveLength(0);
    });

    it('answers its own failure when the secret it names does not exist', async () => {
        vi.stubEnv('USDA_API_KEY_SECRET_ID', `${USDA_SECRET_NAME}-absent`);

        const handler = await searchFunction();
        const response = await handler(makeSearchEvent());

        expect(response.statusCode).toBe(500);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(upstream.requests).toHaveLength(0);
    });
});
