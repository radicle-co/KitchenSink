/**
 * The local sandbox's remote search stand-in: the signature-checking edge, a handler behind it, and the USDA double.
 *
 * Real HTTP on loopback with a generated key pair, signed the way food signs (`@aws-sdk/cloudfront-signer`, canned
 * policy, SHA-256). Only the search function is a stub here: the stand-in's own job is routing, verifying and
 * serving, and the real function is proven by the LOCAL e2e (`tests/e2e`) and by provision against the local stack.
 */
import { generateKeyPairSync } from 'node:crypto';

import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { OriginEvent } from '../src/searchEdgeStandIn.js';
import { startLocalSearch, type LocalSearch } from '../src/localSearch.js';

const KEY_PAIR_ID = 'KLOCALTEST';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

let local: LocalSearch;
const seen: OriginEvent[] = [];

beforeAll(async () => {
    local = await startLocalSearch({
        publicKey,
        keyPairId: KEY_PAIR_ID,
        handler: (event) => {
            seen.push(event);

            return Promise.resolve({
                statusCode: 200,
                headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
                body: JSON.stringify({ outcome: 'found' }),
            });
        },
    });
});

afterAll(async () => {
    await local.close();
});

const signed = (url: string, expiresInSeconds = 60): string =>
    getSignedUrl({
        url,
        keyPairId: KEY_PAIR_ID,
        privateKey: PRIVATE_PEM,
        dateLessThan: new Date(Date.now() + expiresInSeconds * 1_000).toISOString(),
        algorithm: 'SHA256',
    });

describe('the edge', () => {
    it('hands a correctly signed request to the search function, with the parameters the distribution forwards', async () => {
        const response = await fetch(signed(`${local.origin}/v1/search/usda?q=tahini&admit=1&rid=abc&utm=x`));

        expect(response.status).toBe(200);
        expect(seen.at(-1)).toMatchObject({ rawPath: '/v1/search/usda', requestContext: { http: { method: 'GET' } } });
        expect(new URLSearchParams(seen.at(-1)?.rawQueryString).get('utm')).toBeNull();
        expect(new URLSearchParams(seen.at(-1)?.rawQueryString).get('q')).toBe('tahini');
    });

    it('refuses an unsigned request before it reaches the function', async () => {
        const before = seen.length;
        const response = await fetch(`${local.origin}/v1/search/usda?q=tahini`);

        expect(response.status).toBe(403);
        expect(seen).toHaveLength(before);
    });

    it('refuses a request whose query was changed after signing', async () => {
        const before = seen.length;
        const response = await fetch(signed(`${local.origin}/v1/search/usda?q=tahini`).replace('tahini', 'sumac'));

        expect(response.status).toBe(403);
        expect(seen).toHaveLength(before);
    });

    it('refuses a URL signed for another origin', async () => {
        const other = signed('http://remote-search:4010/v1/search/usda?q=tahini');
        const response = await fetch(other.replace('http://remote-search:4010', local.origin));

        expect(response.status).toBe(403);
    });
});

describe('the USDA double over HTTP', () => {
    const post = (path: string, body: unknown): Promise<Response> =>
        fetch(`${local.usdaBaseUrl}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

    it('answers a search with the foods named for the query, and the quota headers api.data.gov sends', async () => {
        const response = await post('/foods/search?api_key=k', {
            query: 'tahini',
            dataType: ['Branded'],
            pageSize: 20,
        });
        const body = (await response.json()) as { foods: { description: string }[] };

        expect(response.status).toBe(200);
        expect(response.headers.get('x-ratelimit-remaining')).not.toBeNull();
        expect(body.foods[0]?.description).toBe('Tahini, raw');
    });

    it('refuses a search that is not a POST, or whose JSON body names no query', async () => {
        expect((await fetch(`${local.usdaBaseUrl}/foods/search?api_key=k`)).status).toBe(405);
        expect((await post('/foods/search', { nope: true })).status).toBe(400);
    });

    it('fetches a listed food by id, singly and in a batch, and 404s an id it never listed', async () => {
        const search = (await (await post('/foods/search', { query: 'miso' })).json()) as {
            foods: { fdcId: number }[];
        };
        const ids = search.foods.map((food) => food.fdcId);

        expect((await fetch(`${local.usdaBaseUrl}/food/${String(ids[0])}?api_key=k`)).status).toBe(200);

        const batch = (await (await post('/foods?api_key=k', { fdcIds: ids.slice(0, 2) })).json()) as unknown[];

        expect(batch).toHaveLength(2);
        expect((await fetch(`${local.usdaBaseUrl}/food/42`)).status).toBe(404);
    });
});
