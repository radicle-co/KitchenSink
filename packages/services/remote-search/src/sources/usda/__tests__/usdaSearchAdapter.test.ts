/**
 * The USDA search adapter over the REAL `UsdaApiClient`, with only `fetch` and the secret read stubbed: it reads the
 * key from its secret when it searches, searches with the client's one search statement, maps hits through the
 * client's one mapping, classifies every failure, passes the source's quota and `Retry-After` headers through
 * unchanged, and never lets the API key out.
 */
import { USDA_QUOTA_HEADERS, USDA_SEARCH_PARAMETERS } from '@kitchensink/usda-client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { SecretReader } from '../../../secrets/secretPorts.js';
import type { SourceSearchOutcome } from '../../remoteSourceAdapter.js';
import { isSourceConfigurationError } from '../../sourceConfigurationError.js';
import {
    BRANDED_HIT,
    FNDDS_HIT,
    FOUNDATION_HIT,
    makeUsdaSearchBody,
    SR_LEGACY_HIT,
    type UsdaSearchHitBody,
} from '../__fixtures__/usdaSearchBody.js';
import { createUsdaSearchAdapter } from '../usdaSearchAdapter.js';

const API_KEY = 'unit-usda-key-0123456789abcdef';

const SECRET_ID = 'kitchensink/test/food/usda-api-key';

const ENVIRONMENT = { USDA_API_KEY_SECRET_ID: SECRET_ID, USDA_API_BASE_URL: 'https://usda.test/fdc/v1' };

/** A secret read that records the ids it was asked for. */
interface StubSecrets {
    readonly readSecret: SecretReader;
    readonly asked: string[];
}

/**
 * Build a secret read that answers every id with one value, or fails.
 *
 * @param answer - The value, or the error every read rejects with.
 * @returns The double.
 */
function stubSecrets(answer: string | Error = API_KEY): StubSecrets {
    const asked: string[] = [];

    return {
        asked,
        readSecret: (secretId) => {
            asked.push(secretId);

            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
    };
}

/** One request the stub `fetch` was asked for. */
interface StubRequest {
    readonly url: string;
    readonly method: string;
    readonly contentType: string | null;
    readonly body: unknown;
}

/**
 * A `fetch` double that records each request and answers it with one response. Like USDA, it answers only a search
 * sent as a POST with a JSON body whose `dataType` is an array (ADR-0055 point 1), and refuses anything else with a
 * `400`, so a client that searches any other way fails here.
 */
interface StubFetch {
    readonly fetchFn: typeof fetch;
    readonly requests: StubRequest[];
}

/** The part of a search body the stub checks: the data types, as an array. */
const searchBodySchema = z.object({ dataType: z.array(z.string()) });

/**
 * Whether a request is the search USDA answers. Pure.
 *
 * @param request - The recorded request.
 * @returns True for a POST with a JSON body whose `dataType` is an array.
 */
function isUsdaSearch(request: StubRequest): boolean {
    return (
        request.method === 'POST' &&
        request.contentType === 'application/json' &&
        searchBodySchema.safeParse(request.body).success
    );
}

/**
 * Build a stub `fetch`.
 *
 * @param answer - Builds each response, or throws as a failed transport does.
 * @returns The double.
 */
function stubFetch(answer: () => Response): StubFetch {
    const requests: StubRequest[] = [];

    const fetchFn: typeof fetch = (input, init) => {
        const text = typeof init?.body === 'string' ? init.body : undefined;
        const request: StubRequest = {
            url: input instanceof Request ? input.url : input.toString(),
            method: init?.method ?? 'GET',
            contentType: new Headers(init?.headers).get('content-type'),
            body: text === undefined ? undefined : JSON.parse(text),
        };

        requests.push(request);

        return Promise.resolve().then(() => (isUsdaSearch(request) ? answer() : json(400, { error: 'bad request' })));
    };

    return { fetchFn, requests };
}

/**
 * A JSON response.
 *
 * @param status - The status.
 * @param body - The body, serialized.
 * @param headers - Extra headers.
 * @returns The response.
 */
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

/** The quota headers api.data.gov sends, plus headers that must never be passed on. */
const UPSTREAM_HEADERS = {
    [USDA_QUOTA_HEADERS.limitHeader]: '1000',
    [USDA_QUOTA_HEADERS.remainingHeader]: '997',
    'set-cookie': 'session=abc',
    'x-api-umbrella-request-id': 'umbrella-1',
    via: '1.1 api-umbrella',
} as const;

/** What the adapter passes on from {@link UPSTREAM_HEADERS}. */
const PASSED_QUOTA = { [USDA_QUOTA_HEADERS.limitHeader]: '1000', [USDA_QUOTA_HEADERS.remainingHeader]: '997' };

/**
 * Search once through an adapter over a stub.
 *
 * @param answer - The stub's response.
 * @returns The outcome and the stub.
 */
async function searchOnce(answer: () => Response): Promise<{ outcome: SourceSearchOutcome; stub: StubFetch }> {
    const stub = stubFetch(answer);
    const outcome = await createUsdaSearchAdapter(ENVIRONMENT, {
        fetchFn: stub.fetchFn,
        readSecret: stubSecrets().readSecret,
    }).search('broccoli raw');

    return { outcome, stub };
}

describe('the USDA search adapter — what it asks', () => {
    it('makes exactly one POST, with the shared search statement and the term as its body and the key in the URL', async () => {
        const { stub } = await searchOnce(() => json(200, makeUsdaSearchBody()));

        expect(stub.requests).toHaveLength(1);

        const [request] = stub.requests;
        const url = new URL(request?.url ?? '');

        expect(request?.method).toBe('POST');
        expect(`${url.origin}${url.pathname}`).toBe('https://usda.test/fdc/v1/foods/search');
        expect([...url.searchParams]).toStrictEqual([['api_key', API_KEY]]);
        expect(request?.body).toStrictEqual({
            query: 'broccoli raw',
            pageSize: USDA_SEARCH_PARAMETERS.pageSize,
            dataType: [...USDA_SEARCH_PARAMETERS.dataTypes],
        });
    });

    it('reaches USDA itself when no base URL is configured', async () => {
        const stub = stubFetch(() => json(200, makeUsdaSearchBody({ foods: [] })));

        await createUsdaSearchAdapter(
            { USDA_API_KEY_SECRET_ID: SECRET_ID },
            { fetchFn: stub.fetchFn, readSecret: stubSecrets().readSecret },
        ).search('egg');

        expect(new URL(stub.requests[0]?.url ?? '').origin).toBe('https://api.nal.usda.gov');
    });
});

describe('the USDA search adapter — the key comes from its secret', () => {
    it('reads the secret the environment names, when it searches and not before', async () => {
        const stub = stubFetch(() => json(200, makeUsdaSearchBody()));
        const secrets = stubSecrets();
        const adapter = createUsdaSearchAdapter(ENVIRONMENT, { fetchFn: stub.fetchFn, readSecret: secrets.readSecret });

        expect(secrets.asked).toStrictEqual([]);

        await adapter.search('broccoli raw');

        expect(secrets.asked).toStrictEqual([SECRET_ID]);
        expect(new URL(stub.requests[0]?.url ?? '').searchParams.get('api_key')).toBe(API_KEY);
    });

    it('fails the search, and calls no source, when the secret cannot be read', async () => {
        const stub = stubFetch(() => json(200, makeUsdaSearchBody()));
        const failure = new Error('AccessDeniedException');
        const adapter = createUsdaSearchAdapter(ENVIRONMENT, {
            fetchFn: stub.fetchFn,
            readSecret: stubSecrets(failure).readSecret,
        });

        await expect(adapter.search('broccoli raw')).rejects.toBe(failure);
        expect(stub.requests).toHaveLength(0);
    });
});

describe('the USDA search adapter — mapping real response shapes', () => {
    it.each<[string, readonly UsdaSearchHitBody[], readonly unknown[]]>([
        [
            'one hit of each searched data type, in USDA order',
            [FOUNDATION_HIT, SR_LEGACY_HIT, FNDDS_HIT, BRANDED_HIT],
            [
                { externalKey: '747447', name: 'Broccoli, raw', lineageKey: 'foundation:11090' },
                { externalKey: '170379', name: 'Broccoli, raw', lineageKey: null },
                { externalKey: '2709208', name: 'Broccoli, raw', lineageKey: null },
                { externalKey: '2057648', name: 'CHEDDAR CHEESE', lineageKey: null },
            ],
        ],
        [
            'a Foundation hit whose NDB number is a string',
            [{ ...FOUNDATION_HIT, ndbNumber: '11090' }],
            [{ externalKey: '747447', name: 'Broccoli, raw', lineageKey: 'foundation:11090' }],
        ],
        [
            'a Foundation hit with no NDB number',
            [{ fdcId: 747447, description: 'Broccoli, raw', dataType: 'Foundation' }],
            [{ externalKey: '747447', name: 'Broccoli, raw', lineageKey: null }],
        ],
        [
            'a hit of a data type the client does not know',
            [{ ...FOUNDATION_HIT, dataType: 'Agricultural Acquisition' }],
            [{ externalKey: '747447', name: 'Broccoli, raw', lineageKey: null }],
        ],
        ['no hits', [], []],
    ])('maps %s', async (_label, foods, items) => {
        const { outcome } = await searchOnce(() => json(200, makeUsdaSearchBody({ foods }), UPSTREAM_HEADERS));

        expect(outcome).toStrictEqual({ kind: 'answered', items, passthroughHeaders: PASSED_QUOTA });
    });

    it('reads an envelope with no foods array as no hits', async () => {
        const { outcome } = await searchOnce(() => json(200, { totalHits: 0, currentPage: 1 }));

        expect(outcome).toStrictEqual({ kind: 'answered', items: [], passthroughHeaders: {} });
    });
});

describe('the USDA search adapter — failures', () => {
    it.each<[string, () => Response, SourceSearchOutcome]>([
        [
            'a 429 with the quota spent',
            () =>
                json(
                    429,
                    { error: { code: 'OVER_RATE_LIMIT' } },
                    {
                        ...UPSTREAM_HEADERS,
                        [USDA_QUOTA_HEADERS.remainingHeader]: '0',
                        'Retry-After': '1800',
                    },
                ),
            {
                kind: 'sourceStatus',
                sourceStatus: 429,
                passthroughHeaders: {
                    ...PASSED_QUOTA,
                    [USDA_QUOTA_HEADERS.remainingHeader]: '0',
                    'Retry-After': '1800',
                },
            },
        ],
        [
            'a 503 with a Retry-After date',
            () => json(503, {}, { 'Retry-After': 'Fri, 02 Oct 2026 21:00:00 GMT' }),
            {
                kind: 'sourceStatus',
                sourceStatus: 503,
                passthroughHeaders: { 'Retry-After': 'Fri, 02 Oct 2026 21:00:00 GMT' },
            },
        ],
        ['a 500', () => json(500, {}), { kind: 'sourceStatus', sourceStatus: 500, passthroughHeaders: {} }],
        ['a 404', () => json(404, {}), { kind: 'sourceStatus', sourceStatus: 404, passthroughHeaders: {} }],
        [
            'a 403 for a key USDA refuses',
            () => json(403, { error: { code: 'API_KEY_INVALID' } }, UPSTREAM_HEADERS),
            { kind: 'sourceStatus', sourceStatus: 403, passthroughHeaders: PASSED_QUOTA },
        ],
        [
            'a 200 whose foods is not an array',
            () => json(200, { totalHits: 1, foods: 'broccoli' }, UPSTREAM_HEADERS),
            { kind: 'invalidResponse', passthroughHeaders: PASSED_QUOTA },
        ],
        [
            'a 200 with a hit that has no description',
            () => json(200, { totalHits: 1, foods: [{ fdcId: 1 }] }),
            { kind: 'invalidResponse', passthroughHeaders: {} },
        ],
        [
            'a 200 whose body is not JSON',
            () => new Response('<html>gateway</html>', { status: 200, headers: UPSTREAM_HEADERS }),
            { kind: 'timeout', passthroughHeaders: PASSED_QUOTA },
        ],
        [
            'a transport that fails',
            () => {
                throw new TypeError('fetch failed');
            },
            { kind: 'timeout', passthroughHeaders: {} },
        ],
    ])('classifies %s', async (_label, answer, expected) => {
        const { outcome, stub } = await searchOnce(answer);

        expect(outcome).toStrictEqual(expected);
        expect(stub.requests).toHaveLength(1);
    });
});

describe('the USDA search adapter — configuration', () => {
    it.each<[string, Record<string, string | undefined>, readonly string[]]>([
        ['no key secret', { USDA_API_BASE_URL: 'https://usda.test' }, ['USDA_API_KEY_SECRET_ID']],
        ['an empty key secret', { USDA_API_KEY_SECRET_ID: '' }, ['USDA_API_KEY_SECRET_ID']],
        ['the key itself, and no secret', { USDA_API_KEY: API_KEY }, ['USDA_API_KEY_SECRET_ID']],
        [
            'a base URL that is not a URL',
            { USDA_API_KEY_SECRET_ID: SECRET_ID, USDA_API_BASE_URL: 'usda' },
            ['USDA_API_BASE_URL'],
        ],
    ])('refuses %s, naming the variable and never its value', (_label, environment, variables) => {
        const stub = stubFetch(() => json(200, makeUsdaSearchBody()));
        const secrets = stubSecrets();
        const thrown = ((): unknown => {
            try {
                createUsdaSearchAdapter(environment, { fetchFn: stub.fetchFn, readSecret: secrets.readSecret });

                return undefined;
            } catch (error) {
                return error;
            }
        })();

        expect(isSourceConfigurationError(thrown)).toBe(true);
        expect(isSourceConfigurationError(thrown) ? thrown.variables : []).toStrictEqual(variables);
        expect(String(thrown)).not.toContain(API_KEY);
        expect(stub.requests).toHaveLength(0);
        expect(secrets.asked).toStrictEqual([]);
    });
});

describe('the USDA search adapter — the key stays in the request', () => {
    it.each<[string, () => Response]>([
        ['an answer', () => json(200, makeUsdaSearchBody(), UPSTREAM_HEADERS)],
        ['a 429', () => json(429, {}, { ...UPSTREAM_HEADERS, 'Retry-After': '60' })],
        ['a 502 that echoes the request URL', () => json(502, { url: `https://usda.test/?api_key=${API_KEY}` })],
        [
            'a header that echoes the request URL',
            () => json(200, makeUsdaSearchBody(), { 'x-request-url': `https://usda.test/?api_key=${API_KEY}` }),
        ],
        ['a drifted body', () => json(200, { foods: 'x' })],
        [
            'a transport failure that names the URL',
            () => {
                throw new TypeError(`fetch failed for https://usda.test/?api_key=${API_KEY}`);
            },
        ],
    ])('keeps the key out of the outcome of %s', async (_label, answer) => {
        const { outcome } = await searchOnce(answer);

        expect(JSON.stringify(outcome)).not.toContain(API_KEY);
    });
});
