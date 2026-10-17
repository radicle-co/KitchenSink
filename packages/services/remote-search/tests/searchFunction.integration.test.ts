/**
 * The REAL function URL handler — the module the function runs — over the REAL USDA client and the REAL AWS SDK,
 * against loopback stand-ins for USDA (`support/usdaStubServer.ts`) and Secrets Manager
 * (`support/secretsManagerStubServer.ts`). Configuration comes from the process environment, as it does in the
 * function, and the log is the real Powertools logger's own output, read from stdout and stderr.
 *
 * Each case imports the handler afresh, which is what a new Lambda container does, so the key the function reads
 * once per container is read again per case unless the case invokes twice.
 *
 * What a unit test cannot show and this does: what crosses the wire to the source (exactly one request, with the
 * shared search statement, or none at all) and to Secrets Manager (one read per container, none for a request that
 * never reaches the source), which headers come back on each outcome, and that the API key reaches the source's
 * request and nothing else — no response body, no response header, no log line.
 */
import type { LambdaFunctionURLEvent } from 'aws-lambda';
import { USDA_QUOTA_HEADERS, USDA_SEARCH_PARAMETERS } from '@kitchensink/usda-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeSearchEvent, VALID_RID } from '../src/search/__fixtures__/searchEvent.js';
import {
    REMOTE_SEARCH_RID_HEADER,
    remoteSearchAnswerSchema,
    remoteSearchErrorSchema,
    remoteSearchNotAdmittedSchema,
} from '../src/search/remoteSearch.schema.js';
import type { SearchResponse } from '../src/search/searchResponse.js';
import { startSecretsManagerStubServer, type SecretsManagerStubServer } from './support/secretsManagerStubServer.js';
import { startUsdaStubServer, type UsdaStubMode, type UsdaStubServer } from './support/usdaStubServer.js';

const API_KEY = 'integration-usda-key-5f0c1e9a7b3d';

const SECRET_ID = 'kitchensink/test/food/usda-api-key';

const READ = 'secretsmanager.GetSecretValue';

/** The environment variables this suite sets, restored afterwards. */
const VARIABLES = [
    'USDA_API_KEY_SECRET_ID',
    'USDA_API_BASE_URL',
    'AWS_ENDPOINT_URL_SECRETS_MANAGER',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
] as const;

let upstream: UsdaStubServer;
let secrets: SecretsManagerStubServer;
let handler: (event: LambdaFunctionURLEvent) => Promise<SearchResponse>;
const saved = new Map<string, string | undefined>();

/** Everything the process wrote to stdout and stderr during the current case. */
let written = '';

beforeAll(async () => {
    upstream = await startUsdaStubServer();
    secrets = await startSecretsManagerStubServer();

    for (const name of VARIABLES) {
        saved.set(name, process.env[name]);
    }
});

beforeEach(async () => {
    process.env['USDA_API_KEY_SECRET_ID'] = SECRET_ID;
    process.env['USDA_API_BASE_URL'] = upstream.baseUrl;
    process.env['AWS_ENDPOINT_URL_SECRETS_MANAGER'] = secrets.endpoint;
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_ACCESS_KEY_ID'] = 'integration-access-key';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'integration-secret-key';
    Reflect.deleteProperty(process.env, 'AWS_SESSION_TOKEN');
    upstream.reset();
    upstream.mode = 'hits';
    secrets.reset();
    secrets.secrets.set(SECRET_ID, API_KEY);
    written = '';

    // A new container: the module, its SDK client and its once-per-container key read, all fresh.
    vi.resetModules();
    ({ handler } = await import('../src/handler.js'));

    for (const stream of [process.stdout, process.stderr]) {
        vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
            written += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');

            return true;
        });
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

afterAll(async () => {
    await upstream.close();
    await secrets.close();

    for (const [name, value] of saved) {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, name);
        } else {
            process.env[name] = value;
        }
    }
});

/**
 * Invoke the function once.
 *
 * @param event - The request.
 * @returns The response, with its body parsed by the contract.
 */
async function invoke(event: LambdaFunctionURLEvent): Promise<{ response: SearchResponse; body: unknown }> {
    const response = await handler(event);
    const raw: unknown = JSON.parse(response.body);

    switch (response.statusCode) {
        case 200:
            // A 200 holds either an answer or the notAdmitted outcome (its own status since 2026-10-05).
            return {
                response,
                body: remoteSearchAnswerSchema.safeParse(raw).success
                    ? remoteSearchAnswerSchema.parse(raw)
                    : remoteSearchNotAdmittedSchema.parse(raw),
            };
        default:
            return { response, body: remoteSearchErrorSchema.parse(raw) };
    }
}

/** The structured log lines written during the case. */
function logLines(): Record<string, unknown>[] {
    return written
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .map((line): Record<string, unknown> => JSON.parse(line));
}

/** The Secrets Manager reads that crossed the wire during the case. */
function secretReads(): readonly unknown[] {
    return secrets.requests.filter((request) => request.operation === READ).map((request) => request.secretId);
}

const QUOTA_997 = { [USDA_QUOTA_HEADERS.limitHeader]: '1000', [USDA_QUOTA_HEADERS.remainingHeader]: '997' };

describe('the search function — each outcome, over the wire', () => {
    it.each<
        [string, UsdaStubMode, Parameters<typeof makeSearchEvent>[0], number, string, Record<string, string>, number]
    >([
        ['found', 'hits', {}, 200, 'public, s-maxage=604800', QUOTA_997, 1],
        [
            'empty',
            'empty',
            {},
            200,
            'public, s-maxage=86400',
            { [USDA_QUOTA_HEADERS.limitHeader]: '1000', [USDA_QUOTA_HEADERS.remainingHeader]: '996' },
            1,
        ],
        ['not admitted', 'hits', { query: { admit: '0' } }, 200, 'public, s-maxage=1', {}, 0],
        ['a term that is not canonical', 'hits', { query: { q: 'Chicken Breast' } }, 400, 'no-store', {}, 0],
        ['a retired adapter revision', 'hits', { rawPath: '/v1/usda/1/search' }, 404, 'no-store', {}, 0],
        [
            'a source rate limit',
            'throttled',
            {},
            502,
            'no-store',
            {
                [USDA_QUOTA_HEADERS.limitHeader]: '1000',
                [USDA_QUOTA_HEADERS.remainingHeader]: '0',
                'retry-after': '1800',
            },
            1,
        ],
        ['a source outage', 'outage', {}, 502, 'no-store', { 'retry-after': '120' }, 1],
        [
            'a drifted body',
            'drift',
            {},
            502,
            'no-store',
            { [USDA_QUOTA_HEADERS.limitHeader]: '1000', [USDA_QUOTA_HEADERS.remainingHeader]: '995' },
            1,
        ],
        ['a dropped connection', 'drop', {}, 504, 'no-store', {}, 1],
    ])('answers %s', async (_label, mode, event, status, cacheControl, passed, upstreamRequests) => {
        upstream.mode = mode;

        const { response } = await invoke(makeSearchEvent(event));
        const headers = new Headers(response.headers);

        expect(response.statusCode).toBe(status);
        expect(headers.get('cache-control')).toBe(cacheControl);
        expect(headers.get(REMOTE_SEARCH_RID_HEADER)).toBe(VALID_RID);
        expect(upstream.requests).toHaveLength(upstreamRequests);

        for (const [name, value] of Object.entries(passed)) {
            expect(headers.get(name), name).toBe(value);
        }
    });

    it('maps the source hits into canonical items, in its order', async () => {
        const { body } = await invoke(makeSearchEvent());

        expect(body).toStrictEqual({
            outcome: 'found',
            items: [
                { externalKey: '747447', name: 'Broccoli, raw', lineageKey: 'foundation:11090' },
                { externalKey: '170379', name: 'Broccoli, raw', lineageKey: null },
                { externalKey: '2709208', name: 'Broccoli, raw', lineageKey: null },
                { externalKey: '2057648', name: 'CHEDDAR CHEESE', lineageKey: null },
            ],
        });
    });

    it('asks the source once, a POST with the shared search statement as its body and the key in the URL', async () => {
        await invoke(makeSearchEvent({ query: { q: 'crème fraîche' } }));

        const [request] = upstream.requests;

        expect(upstream.requests).toHaveLength(1);
        expect(request?.method).toBe('POST');
        expect(request?.url.pathname).toBe('/fdc/v1/foods/search');
        expect([...(request?.url.searchParams ?? [])]).toStrictEqual([['api_key', API_KEY]]);
        expect(request?.body).toStrictEqual({
            query: 'crème fraîche',
            pageSize: USDA_SEARCH_PARAMETERS.pageSize,
            dataType: [...USDA_SEARCH_PARAMETERS.dataTypes],
        });
    });

    it('carries the source status of a failure, so the caller can apply its block rule', async () => {
        upstream.mode = 'throttled';

        const { body } = await invoke(makeSearchEvent());

        expect(body).toStrictEqual({
            code: 'SOURCE_ERROR',
            message: 'The source answered 429.',
            details: { sourceStatus: 429 },
        });
    });

    it('answers a missing key secret variable as its own failure, never stored, naming the variable', async () => {
        Reflect.deleteProperty(process.env, 'USDA_API_KEY_SECRET_ID');

        const { response, body } = await invoke(makeSearchEvent());

        expect(response.statusCode).toBe(500);
        expect(new Headers(response.headers).get('cache-control')).toBe('no-store');
        expect(new Headers(response.headers).get(REMOTE_SEARCH_RID_HEADER)).toBe(VALID_RID);
        expect(body).toStrictEqual({ code: 'INTERNAL', message: 'The search failed.' });
        expect(upstream.requests).toHaveLength(0);
        expect(secretReads()).toStrictEqual([]);
        expect(logLines()).toContainEqual(
            expect.objectContaining({
                level: 'ERROR',
                message: 'remote-search-failed',
                variables: ['USDA_API_KEY_SECRET_ID'],
            }),
        );
    });
});

describe('the search function — the key comes from its secret, once per container', () => {
    it('reads the secret once, however many admitted searches the container serves', async () => {
        await invoke(makeSearchEvent());
        await invoke(makeSearchEvent({ query: { q: 'crème fraîche' } }));

        expect(secretReads()).toStrictEqual([SECRET_ID]);
        expect(upstream.requests.map((request) => request.url.searchParams.get('api_key'))).toStrictEqual([
            API_KEY,
            API_KEY,
        ]);
    });

    it.each<[string, Parameters<typeof makeSearchEvent>[0], number]>([
        ['a probe it does not admit', { query: { admit: '0' } }, 200],
        ['a term that is not canonical', { query: { q: 'EGG' } }, 400],
        ['a path that is no search', { rawPath: '/v1/usda/1/search' }, 404],
    ])('never reads the secret for %s', async (_label, event, status) => {
        const { response } = await invoke(makeSearchEvent(event));

        expect(response.statusCode).toBe(status);
        expect(secretReads()).toStrictEqual([]);
    });

    it('answers an unreadable secret as its own failure, never stored, and reads it again next time', async () => {
        secrets.refuseReads = 1;

        const first = await invoke(makeSearchEvent());

        expect(first.response.statusCode).toBe(500);
        expect(new Headers(first.response.headers).get('cache-control')).toBe('no-store');
        expect(new Headers(first.response.headers).get(REMOTE_SEARCH_RID_HEADER)).toBe(VALID_RID);
        expect(first.body).toStrictEqual({ code: 'INTERNAL', message: 'The search failed.' });
        expect(upstream.requests).toHaveLength(0);
        expect(logLines()).toContainEqual(
            expect.objectContaining({ message: 'remote-search-failed', errorName: 'AccessDeniedException' }),
        );

        const second = await invoke(makeSearchEvent());

        expect(second.response.statusCode).toBe(200);
        expect(secretReads()).toStrictEqual([SECRET_ID, SECRET_ID]);
        expect(upstream.requests).toHaveLength(1);
    });

    it('answers a secret that holds no key as its own failure, and calls no source', async () => {
        secrets.secrets.set(SECRET_ID, '');

        const { response } = await invoke(makeSearchEvent());

        expect(response.statusCode).toBe(500);
        expect(upstream.requests).toHaveLength(0);
        expect(logLines()).toContainEqual(
            expect.objectContaining({ message: 'remote-search-failed', errorName: 'SecretUnavailableError' }),
        );
    });
});

describe('the search function — the key never leaves the source request', () => {
    it.each<[string, UsdaStubMode, Parameters<typeof makeSearchEvent>[0]]>([
        ['found', 'hits', {}],
        ['empty', 'empty', {}],
        ['not admitted', 'hits', { query: { admit: '0' } }],
        ['a bad term', 'hits', { query: { q: 'EGG' } }],
        ['a source rate limit', 'throttled', {}],
        ['a source outage', 'outage', {}],
        ['a drifted body', 'drift', {}],
        ['a dropped connection', 'drop', {}],
    ])('keeps the key out of the response and the log for %s', async (_label, mode, event) => {
        upstream.mode = mode;

        const { response } = await invoke(makeSearchEvent(event));
        const lines = logLines();

        // Non-vacuity: the log was captured, and it is this request's line.
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ message: 'remote-search', rid: VALID_RID, status: response.statusCode });

        expect(response.body).not.toContain(API_KEY);
        expect(JSON.stringify(response.headers)).not.toContain(API_KEY);
        expect(written).not.toContain(API_KEY);
    });
});
