/**
 * {@link FoodServiceClient.searchProgressive} and {@link FoodServiceClient.adoptRemoteFood} with a `fetch` double (ADR-0055
 * points 9 and 10; staff-architect review ruling 1).
 *
 * The stream is read from `response.body.getReader()` (the browser's fetch, and Expo 57's global `fetch`, which is
 * `expo/fetch`), and from the buffered body when a runtime hands over none. The client's own per-request timeout bounds
 * only the wait for the response's headers: food closes each source's frame within 8 s, so a timeout over the body
 * would cut every slow answer off before its `complete`. The caller's signal bounds the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetContractSkewLatchForTests } from '../contractSkew.js';
import {
    BadRequestError,
    FoodServiceClient,
    RemoteFoodGoneError,
    RequesterLimitReachedError,
    SearchRateLimitedError,
    SourceBusyError,
    UnauthorizedError,
    isFetchUnavailableError,
    isInvalidRequestError,
} from '../index.js';
import type { ProgressiveFrame } from '../progressiveFrames.js';

const BASE = 'https://food.example.test';
const encoder = new TextEncoder();

const DATABASE_LINE =
    '{"type":"database","catalog":{"outcome":"answered","results":[]},"authored":{"outcome":"answered","results":[]}}\n';
const SOURCE_LINE =
    '{"type":"source","source":"usda","outcome":"answered","items":[{"name":"Egg","reference":"r1"}]}\n';
const COMPLETE_LINE = '{"type":"complete"}\n';

beforeEach(() => {
    resetContractSkewLatchForTests();
});

afterEach(() => {
    vi.useRealTimers();
});

/** The calls a `fetch` double received that are API requests, excluding the `/health` skew probe. */
function apiCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
    return fetchMock.mock.calls.filter((call) => !String(call[0]).endsWith('/health'));
}

/** A body that hands over `lines` one chunk each, and records whether the client cancelled it. */
function streamedBody(lines: readonly string[]): {
    readonly body: ReadableStream<Uint8Array>;
    cancelled: () => boolean;
} {
    let wasCancelled = false;
    const queue = [...lines];

    return {
        body: new ReadableStream<Uint8Array>({
            pull(controller) {
                const next = queue.shift();

                if (next === undefined) {
                    controller.close();
                } else {
                    controller.enqueue(encoder.encode(next));
                }
            },
            cancel() {
                wasCancelled = true;
            },
        }),
        cancelled: () => wasCancelled,
    };
}

/** A `fetch` double that answers the API call with `response`, and the skew probe with a 404. */
function answering(response: () => Response): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: string) =>
        String(url).endsWith('/health') ? new Response(null, { status: 404 }) : response(),
    );
}

/** A client over `fetchMock`. */
const clientOver = (fetchMock: ReturnType<typeof vi.fn>, timeoutMs?: number): FoodServiceClient =>
    new FoodServiceClient({
        baseUrl: BASE,
        token: 'tok',
        fetch: fetchMock as unknown as typeof fetch,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

/** Every frame of one search. */
async function framesOf(client: FoodServiceClient, query: string, signal?: AbortSignal): Promise<ProgressiveFrame[]> {
    const frames: ProgressiveFrame[] = [];

    for await (const frame of client.searchProgressive(query, signal === undefined ? {} : { signal })) {
        frames.push(frame);
    }

    return frames;
}

/** An ND-JSON 200 over `body`. */
const ndjson = (body: ReadableStream<Uint8Array> | string): Response =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });

describe('FoodServiceClient.searchProgressive — the request', () => {
    it('GETs the progressive route with the canonical term, the bearer, an ND-JSON accept and no redirects', async () => {
        const fetchMock = answering(() => ndjson(COMPLETE_LINE));

        await framesOf(clientOver(fetchMock), '  Chicken   BREAST\t');

        const [url, init] = apiCalls(fetchMock)[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe(`${BASE}/api/v1/foods/search/progressive?query=chicken%20breast`);
        expect(init.method).toBe('GET');
        expect(init.headers['authorization']).toBe('Bearer tok');
        expect(init.headers['accept']).toBe('application/x-ndjson');
        expect(init.redirect).toBe('error');
    });

    it.each(['', '   ', 'x'.repeat(201), 'egg \uD83E'])('refuses %j before any request', async (term) => {
        const fetchMock = answering(() => ndjson(COMPLETE_LINE));

        await expect(framesOf(clientOver(fetchMock), term)).rejects.toSatisfy(isInvalidRequestError);
        expect(apiCalls(fetchMock)).toHaveLength(0);
    });

    it('fires the contract-skew probe once a response has arrived', async () => {
        const fetchMock = answering(() => ndjson(COMPLETE_LINE));

        await framesOf(clientOver(fetchMock), 'egg');

        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/health'))).toBe(true);
    });
});

describe('FoodServiceClient.searchProgressive — the body', () => {
    it('yields each frame as its chunk arrives, in order, and reads the body from its reader', async () => {
        const stream = streamedBody([DATABASE_LINE, SOURCE_LINE, COMPLETE_LINE]);

        const frames = await framesOf(clientOver(answering(() => ndjson(stream.body))), 'egg');

        expect(frames.map((frame) => frame.type)).toEqual(['database', 'source', 'complete']);
    });

    it('reads the buffered body with the same parser when the runtime hands over no stream', async () => {
        const response = ndjson(`${DATABASE_LINE}${COMPLETE_LINE}`);
        Object.defineProperty(response, 'body', { value: null });

        const frames = await framesOf(clientOver(answering(() => response)), 'egg');

        expect(frames.map((frame) => frame.type)).toEqual(['database', 'complete']);
    });

    it('lets a slow body outlive the per-request timeout: the timeout bounds only the headers', async () => {
        const slow = new ReadableStream<Uint8Array>({
            async start(controller) {
                controller.enqueue(encoder.encode(DATABASE_LINE));
                await new Promise((resolve) => setTimeout(resolve, 80));
                controller.enqueue(encoder.encode(COMPLETE_LINE));
                controller.close();
            },
        });

        const frames = await framesOf(
            clientOver(
                answering(() => ndjson(slow)),
                20,
            ),
            'egg',
        );

        expect(frames.map((frame) => frame.type)).toEqual(['database', 'complete']);
    });

    it('fails as unavailable when the headers do not arrive within the per-request timeout', async () => {
        const hung = vi.fn(
            (_url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        );

        await expect(framesOf(clientOver(hung, 20), 'egg')).rejects.toSatisfy(isFetchUnavailableError);
    });

    it('stops reading and cancels the body when the caller’s signal aborts it, keeping the frames before', async () => {
        const stream = streamedBody([DATABASE_LINE, SOURCE_LINE, COMPLETE_LINE]);
        const caller = new AbortController();
        const frames: ProgressiveFrame[] = [];

        const reading = (async () => {
            for await (const frame of clientOver(answering(() => ndjson(stream.body))).searchProgressive('egg', {
                signal: caller.signal,
            })) {
                frames.push(frame);
                caller.abort();
            }
        })();

        await expect(reading).rejects.toSatisfy(isFetchUnavailableError);
        expect(frames.map((frame) => frame.type)).toEqual(['database']);
        expect(stream.cancelled()).toBe(true);
    });

    it('cancels the body when its reader stops early', async () => {
        const stream = streamedBody([DATABASE_LINE, SOURCE_LINE, COMPLETE_LINE]);

        for await (const frame of clientOver(answering(() => ndjson(stream.body))).searchProgressive('egg')) {
            expect(frame.type).toBe('database');
            break;
        }

        expect(stream.cancelled()).toBe(true);
    });

    it('fails as unavailable when the body breaks mid-answer, after the frames that arrived', async () => {
        let pulls = 0;
        // Errored on the SECOND pull: `error()` discards whatever is still queued, so the first chunk must be read first.
        const broken = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls += 1;

                if (pulls === 1) {
                    controller.enqueue(encoder.encode(DATABASE_LINE));
                } else {
                    controller.error(new Error('socket reset'));
                }
            },
        });
        const frames: ProgressiveFrame[] = [];

        const reading = (async () => {
            for await (const frame of clientOver(answering(() => ndjson(broken))).searchProgressive('egg')) {
                frames.push(frame);
            }
        })();

        await expect(reading).rejects.toSatisfy(isFetchUnavailableError);
        expect(frames.map((frame) => frame.type)).toEqual(['database']);
    });
});

describe('FoodServiceClient.searchProgressive — a refusal before the first byte', () => {
    it.each<[string, number, unknown, Record<string, string>, unknown]>([
        ['401', 401, { code: 'UNAUTHORIZED', message: 'no' }, {}, UnauthorizedError],
        ['400', 400, { code: 'VALIDATION_FAILED', message: 'bad' }, {}, BadRequestError],
        [
            '503',
            503,
            { code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 5 } },
            {},
            SourceBusyError,
        ],
        [
            '429 SEARCH_RATE_LIMITED',
            429,
            { code: 'SEARCH_RATE_LIMITED', message: 'limit', details: { retryAfterSeconds: 30 } },
            { 'retry-after': '30' },
            SearchRateLimitedError,
        ],
    ])('maps a %s to its typed error, and yields no frame', async (_case, status, body, headers, type) => {
        const fetchMock = answering(() => new Response(JSON.stringify(body), { status, headers }));

        await expect(framesOf(clientOver(fetchMock), 'egg')).rejects.toBeInstanceOf(type);
    });

    it('holds the route for the window a search limit named, sending nothing until it passes', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.UTC(2026, 9, 2));
        const fetchMock = answering(
            () =>
                new Response(
                    JSON.stringify({
                        code: 'SEARCH_RATE_LIMITED',
                        message: 'limit',
                        details: { retryAfterSeconds: 30 },
                    }),
                    { status: 429, headers: { 'retry-after': '30' } },
                ),
        );
        const client = clientOver(fetchMock);

        await framesOf(client, 'egg').catch(() => undefined);
        vi.setSystemTime(Date.UTC(2026, 9, 2) + 10_000);
        const refused = await framesOf(client, 'eggs').catch((thrown: unknown) => thrown);

        expect(refused).toBeInstanceOf(SearchRateLimitedError);
        expect(refused).toHaveProperty('retryAfterSeconds', 20);
        expect(apiCalls(fetchMock)).toHaveLength(1);
    });
});

/**
 * A refused bearer is replayed once, by the rule `client.test.ts` pins for the buffered calls: a `401` comes from auth
 * before the search admits any source call, so the replay spends nothing (plan 002 R65). Nothing else is replayed.
 */
describe('FoodServiceClient.searchProgressive — a refused bearer is replayed once with a fresh token', () => {
    /** A `fetch` double answering the API calls with `responses` in turn, and the skew probe with a 404. */
    function inTurn(...responses: readonly (() => Response)[]): ReturnType<typeof vi.fn> {
        const queue = [...responses];

        return vi.fn(async (url: string) =>
            String(url).endsWith('/health')
                ? new Response(null, { status: 404 })
                : (queue.shift() ?? (() => new Response(null, { status: 500 })))(),
        );
    }

    /** A token callback that mints a new token on each call. */
    function mintingToken() {
        let minted = 0;

        return vi.fn((_options?: { readonly forceRefresh?: boolean }) => {
            minted += 1;

            return `tok-${String(minted)}`;
        });
    }

    const refused = (): Response =>
        new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'expired' }), { status: 401 });

    /** A client over `fetchMock` whose bearer comes from `token`. */
    const clientWith = (fetchMock: ReturnType<typeof vi.fn>, token: ReturnType<typeof mintingToken>) =>
        new FoodServiceClient({ baseUrl: BASE, token, fetch: fetchMock as unknown as typeof fetch });

    /** The bearer each API call carried. */
    const bearers = (fetchMock: ReturnType<typeof vi.fn>): (string | undefined)[] =>
        (apiCalls(fetchMock) as [string, { headers: Record<string, string> }][]).map(
            ([, init]) => init.headers['authorization'],
        );

    it('opens the stream once after a 401, with a force-refreshed token, and yields the replay’s frames', async () => {
        const token = mintingToken();
        const fetchMock = inTurn(refused, () => ndjson(`${DATABASE_LINE}${COMPLETE_LINE}`));

        const frames = await framesOf(clientWith(fetchMock, token), 'egg');

        expect(frames.map((frame) => frame.type)).toEqual(['database', 'complete']);
        expect(bearers(fetchMock)).toStrictEqual(['Bearer tok-1', 'Bearer tok-2']);
        expect(token.mock.calls.map(([options]) => options?.forceRefresh === true)).toStrictEqual([false, true]);
    });

    it('waits out IDENTITY_SYNC_PENDING by the shared back-off, then opens the stream with a fresh token', async () => {
        const token = mintingToken();
        const waits: number[] = [];
        const syncPending = (): Response =>
            new Response(JSON.stringify({ code: 'IDENTITY_SYNC_PENDING', message: 'sync' }), { status: 401 });
        const fetchMock = inTurn(syncPending, () => ndjson(`${DATABASE_LINE}${COMPLETE_LINE}`));
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token,
            fetch: fetchMock as unknown as typeof fetch,
            sleep: async (ms) => {
                waits.push(ms);
            },
        });

        const frames = await framesOf(client, 'egg');

        expect(frames.map((frame) => frame.type)).toEqual(['database', 'complete']);
        expect(waits).toStrictEqual([250]);
        expect(bearers(fetchMock)).toStrictEqual(['Bearer tok-1', 'Bearer tok-2']);
    });

    it('does not replay when the fresh mint answers the token food refused', async () => {
        const token = vi.fn((_options?: { readonly forceRefresh?: boolean }) => 'tok-forwarded');
        const fetchMock = inTurn(refused, () => ndjson(COMPLETE_LINE));

        await expect(framesOf(clientWith(fetchMock, token), 'egg')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(apiCalls(fetchMock)).toHaveLength(1);
        expect(token).toHaveBeenLastCalledWith({ forceRefresh: true });
    });

    it('replays at most once: a second 401 is the answer, after exactly two requests', async () => {
        const fetchMock = inTurn(refused, refused, () => ndjson(COMPLETE_LINE));

        await expect(framesOf(clientWith(fetchMock, mintingToken()), 'egg')).rejects.toBeInstanceOf(UnauthorizedError);
        expect(apiCalls(fetchMock)).toHaveLength(2);
    });

    it('never replays a 503: a refusal that is not the bearer’s', async () => {
        const token = mintingToken();
        const busy = (): Response =>
            new Response(
                JSON.stringify({ code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 5 } }),
                { status: 503 },
            );
        const fetchMock = inTurn(busy, () => ndjson(COMPLETE_LINE));

        await expect(framesOf(clientWith(fetchMock, token), 'egg')).rejects.toBeInstanceOf(SourceBusyError);
        expect(apiCalls(fetchMock)).toHaveLength(1);
        expect(token).toHaveBeenCalledTimes(1);
    });

    it('never replays a body that breaks after the first byte', async () => {
        const token = mintingToken();
        let pulls = 0;
        const broken = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls += 1;

                if (pulls === 1) {
                    controller.enqueue(encoder.encode(DATABASE_LINE));
                } else {
                    controller.error(new Error('socket reset'));
                }
            },
        });
        const fetchMock = inTurn(
            () => ndjson(broken),
            () => ndjson(COMPLETE_LINE),
        );

        await expect(framesOf(clientWith(fetchMock, token), 'egg')).rejects.toSatisfy(isFetchUnavailableError);
        expect(apiCalls(fetchMock)).toHaveLength(1);
        expect(token).toHaveBeenCalledTimes(1);
    });
});

describe('FoodServiceClient.adoptRemoteFood', () => {
    it('POSTs the reference to the adopt route and answers the root’s id', async () => {
        const fetchMock = answering(() => new Response(JSON.stringify({ id: 'food_42' }), { status: 200 }));

        await expect(clientOver(fetchMock).adoptRemoteFood('sealed.ref')).resolves.toStrictEqual({ id: 'food_42' });

        const [url, init] = apiCalls(fetchMock)[0] as [
            string,
            { readonly method: string; readonly body: string; readonly headers: Record<string, string> },
        ];
        expect(url).toBe(`${BASE}/api/v1/foods/remote/adopt`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toStrictEqual({ reference: 'sealed.ref' });
        expect(init.headers['authorization']).toBe('Bearer tok');
    });

    it.each<[string, number, unknown, Record<string, string>, unknown]>([
        ['409 REMOTE_FOOD_GONE', 409, { code: 'REMOTE_FOOD_GONE', message: 'gone' }, {}, RemoteFoodGoneError],
        [
            '503 while a drain holds the placeholder',
            503,
            { code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 2 } },
            { 'retry-after': '2' },
            SourceBusyError,
        ],
        [
            '429 REQUESTER_LIMIT_REACHED',
            429,
            { code: 'REQUESTER_LIMIT_REACHED', message: 'limit', details: { retryAfterSeconds: 600 } },
            { 'retry-after': '600' },
            RequesterLimitReachedError,
        ],
    ])('maps %s to its typed error', async (_case, status, body, headers, type) => {
        const fetchMock = answering(() => new Response(JSON.stringify(body), { status, headers }));

        await expect(clientOver(fetchMock).adoptRemoteFood('sealed.ref')).rejects.toBeInstanceOf(type);
    });

    it('refuses an empty reference before any request', async () => {
        const fetchMock = answering(() => new Response(JSON.stringify({ id: 'food_42' }), { status: 200 }));

        await expect(clientOver(fetchMock).adoptRemoteFood('')).rejects.toSatisfy(isInvalidRequestError);
        expect(apiCalls(fetchMock)).toHaveLength(0);
    });
});
