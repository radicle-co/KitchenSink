/**
 * REWRITTEN for plan 002 S7.8: {@link useIngredientSuggestionSource}, the seam that reads the ONE progressive food
 * search (ADR-0055 points 5 and 9) under two deadlines: the database part's (`FOOD_SEARCH_DEADLINE_MS`, S5 list contract
 * L1) and the whole answer's (`PROGRESSIVE_SEARCH_DEADLINE_MS`, `docs/design/rowEditorOpenDecisions.md` P3).
 *
 * The real `FoodServiceClient` and a real TanStack client are used, as the app builds them (`offlineFirst`). Only
 * `fetch` is a double: each request gets a body the test writes frames into, or a refusal, or a transport failure.
 *
 * What it pins:
 * - frames fold into the read as they arrive, and the answer ends at `complete`;
 * - with no database frame by its deadline the whole answer stops, its request is aborted, and a late frame changes
 *   nothing (P2);
 * - at the overall deadline the answer ends with what arrived, and its request is aborted (P3);
 * - a read held offline is parked, no deadline turns it into a failure, and it resumes on reconnect as a resumed answer
 *   with fresh deadlines (P2, P6);
 * - a refusal before the first byte ends the answer after ONE request, never retried (R65);
 * - Try again asks once more, under fresh deadlines.
 */
import { FoodServiceClient, resetContractSkewLatchForTests } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProgressiveRead } from '../foodSuggestions.model.js';
import {
    FOOD_SEARCH_DEADLINE_MS,
    PROGRESSIVE_SEARCH_DEADLINE_MS,
    useIngredientSuggestionSource,
} from '../ingredientSuggestionSource.js';

const DATABASE_LINE =
    '{"type":"database","catalog":{"outcome":"answered","results":[{"id":"food_flour","name":"flour","score":0.9}]},"authored":{"outcome":"answered","results":[]}}\n';
const SOURCE_LINE =
    '{"type":"source","source":"usda","outcome":"answered","items":[{"name":"Flour, rye","reference":"r1"}]}\n';
const COMPLETE_LINE = '{"type":"complete"}\n';

/** How the double answers one request. */
type Answer =
    /** A 200 whose body the test writes, through the request's `write`. */
    | { readonly kind: 'stream' }
    | {
          readonly kind: 'json';
          readonly status: number;
          readonly body: unknown;
          readonly headers?: Record<string, string>;
      }
    | { readonly kind: 'transportFailure' };

interface SentRequest {
    readonly query: string;
    readonly signal: AbortSignal | undefined;
    /** Write a line into this request's body. */
    readonly write: (line: string) => void;
    /** End this request's body. */
    readonly end: () => void;
}

const STREAM: Answer = { kind: 'stream' };
const OFFLINE: Answer = { kind: 'transportFailure' };

/**
 * A food origin whose progressive route answers from `answers`, one per request, the last repeating. Every other path
 * (the client's contract-skew probe) answers `404`.
 */
function foodOrigin(answers: Answer[]) {
    const sent: SentRequest[] = [];
    const encoder = new TextEncoder();

    const fetchDouble = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));

        if (!url.pathname.endsWith('/search/progressive')) {
            return Promise.resolve(new Response(null, { status: 404 }));
        }

        const answer = answers.length > 1 ? answers.shift() : answers[0];
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
        // A body the client cancelled takes no more writes, as a closed socket would carry none.
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            start(streamController) {
                controller = streamController;
            },
            cancel() {
                cancelled = true;
            },
        });

        sent.push({
            query: url.searchParams.get('query') ?? '',
            signal: init?.signal ?? undefined,
            write: (line) => {
                if (!cancelled) {
                    controller?.enqueue(encoder.encode(line));
                }
            },
            end: () => {
                if (!cancelled) {
                    controller?.close();
                }
            },
        });

        if (answer === undefined || answer.kind === 'transportFailure') {
            return Promise.reject(new TypeError('Failed to fetch'));
        }

        if (answer.kind === 'json') {
            return Promise.resolve(
                new Response(JSON.stringify(answer.body), {
                    status: answer.status,
                    headers: { 'content-type': 'application/json', ...answer.headers },
                }),
            );
        }

        return Promise.resolve(
            new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } }),
        );
    };

    return {
        sent,
        last: (): SentRequest => {
            const request = sent.at(-1);

            if (request === undefined) {
                throw new Error('no request was sent');
            }

            return request;
        },
        client: new FoodServiceClient({ baseUrl: 'https://food.test', token: 'tok', fetch: fetchDouble }),
    };
}

/** The app's client, as `createAppQueryClient` builds it for reads that set their own retry. */
const appQueryClient = (): QueryClient =>
    new QueryClient({ defaultOptions: { queries: { networkMode: 'offlineFirst', retry: 3, retryDelay: 0 } } });

function renderSource(
    client: FoodServiceClient,
    initial: { query: string; enabled?: boolean },
    onLimited?: (until: number) => void,
) {
    const queryClient = appQueryClient();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <FoodServiceProvider client={client} subject="user_1">
                {children}
            </FoodServiceProvider>
        </QueryClientProvider>
    );

    return renderHook(
        ({ query, enabled }: { query: string; enabled: boolean }) =>
            useIngredientSuggestionSource(query, enabled, onLimited),
        { wrapper, initialProps: { query: initial.query, enabled: initial.enabled ?? true } },
    );
}

/** Advance the fake clock, letting promises and React settle between timers. */
async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

/** The read's kind, whether its database part is in, how many sources answered, and whether it completed. */
const shape = (read: ProgressiveRead) =>
    read.kind === 'parked'
        ? { kind: 'parked' }
        : {
              kind: read.kind,
              database: read.answer.database !== undefined,
              sources: read.answer.sources.length,
              complete: read.answer.complete,
              resumed: read.resumed,
          };

beforeEach(() => {
    vi.useFakeTimers();
    resetContractSkewLatchForTests();
    onlineManager.setOnline(true);
});

afterEach(() => {
    vi.useRealTimers();
    onlineManager.setOnline(true);
});

describe('useIngredientSuggestionSource', () => {
    it('folds each frame into the read as it arrives, and ends the answer at complete', async () => {
        const origin = foodOrigin([STREAM]);
        const { result } = renderSource(origin.client, { query: 'flour' });

        await advance(0);
        expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: false });
        expect(origin.sent.map((each) => each.query)).toEqual(['flour']);

        origin.last().write(DATABASE_LINE);
        await advance(0);
        expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: true, sources: 0 });

        origin.last().write(SOURCE_LINE);
        await advance(0);
        expect(shape(result.current.read)).toMatchObject({ kind: 'asking', sources: 1 });

        origin.last().write(COMPLETE_LINE);
        origin.last().end();
        await advance(0);
        expect(shape(result.current.read)).toStrictEqual({
            kind: 'ended',
            database: true,
            sources: 1,
            complete: true,
            resumed: false,
        });
    });

    it('asks nothing while disabled', async () => {
        const origin = foodOrigin([STREAM]);

        renderSource(origin.client, { query: 'flour', enabled: false });
        await advance(PROGRESSIVE_SEARCH_DEADLINE_MS * 2);

        expect(origin.sent).toEqual([]);
    });

    it('keeps the read stable across renders that change nothing', async () => {
        const origin = foodOrigin([STREAM]);
        const { result, rerender } = renderSource(origin.client, { query: 'flour' });

        await advance(0);
        origin.last().write(DATABASE_LINE);
        await advance(0);
        const before = result.current.read;
        rerender({ query: 'flour', enabled: true });

        expect(result.current.read).toBe(before);
    });

    describe('the database part’s deadline (L1, P2)', () => {
        it('stops the whole answer when no database frame arrives in time, and aborts its request', async () => {
            const origin = foodOrigin([STREAM]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(FOOD_SEARCH_DEADLINE_MS - 1);
            expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: false });

            await advance(1);
            expect(shape(result.current.read)).toMatchObject({ kind: 'ended', database: false });
            expect(origin.last().signal?.aborted).toBe(true);
        });

        it('never shows a database frame that arrives after the deadline', async () => {
            const origin = foodOrigin([STREAM]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(FOOD_SEARCH_DEADLINE_MS);
            origin.last().write(DATABASE_LINE);
            await advance(FOOD_SEARCH_DEADLINE_MS);

            expect(shape(result.current.read)).toMatchObject({ kind: 'ended', database: false });
        });

        it('does not stop an answer whose database frame came in time', async () => {
            const origin = foodOrigin([STREAM]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(0);
            origin.last().write(DATABASE_LINE);
            await advance(FOOD_SEARCH_DEADLINE_MS * 2);

            expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: true });
            expect(origin.last().signal?.aborted).toBe(false);
        });

        it('gives a new text its own deadline', async () => {
            const origin = foodOrigin([STREAM]);
            const { result, rerender } = renderSource(origin.client, { query: 'flour' });

            await advance(FOOD_SEARCH_DEADLINE_MS - 1_000);
            rerender({ query: 'flours', enabled: true });
            await advance(FOOD_SEARCH_DEADLINE_MS - 1);

            expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: false });
        });
    });

    describe('the whole answer’s deadline (P3)', () => {
        it('ends the answer with what arrived, and aborts its request', async () => {
            const origin = foodOrigin([STREAM]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(0);
            origin.last().write(DATABASE_LINE);
            await advance(PROGRESSIVE_SEARCH_DEADLINE_MS - 1);
            expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: true });

            await advance(1);
            expect(shape(result.current.read)).toStrictEqual({
                kind: 'ended',
                database: true,
                sources: 0,
                complete: false,
                resumed: false,
            });
            expect(origin.last().signal?.aborted).toBe(true);
        });
    });

    describe('offline (P2, P6)', () => {
        it('parks without asking, and no deadline makes it a failure', async () => {
            onlineManager.setOnline(false);
            const origin = foodOrigin([STREAM]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(PROGRESSIVE_SEARCH_DEADLINE_MS * 2);

            expect(shape(result.current.read)).toStrictEqual({ kind: 'parked' });
            expect(origin.sent).toEqual([]);
        });

        it('resumes on reconnect as a resumed answer, under fresh deadlines', async () => {
            onlineManager.setOnline(false);
            const origin = foodOrigin([STREAM]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(PROGRESSIVE_SEARCH_DEADLINE_MS * 2);
            act(() => onlineManager.setOnline(true));
            await advance(FOOD_SEARCH_DEADLINE_MS - 1);

            expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: false, resumed: true });

            origin.last().write(DATABASE_LINE);
            origin.last().write(COMPLETE_LINE);
            origin.last().end();
            await advance(0);

            expect(shape(result.current.read)).toMatchObject({ kind: 'ended', complete: true, resumed: true });
            expect(origin.sent).toHaveLength(1);
        });
    });

    describe('a refusal ends the answer after one request (R65)', () => {
        it.each<[string, Answer]>([
            [
                'the per-minute search limit (`429 SEARCH_RATE_LIMITED`)',
                {
                    kind: 'json',
                    status: 429,
                    body: { code: 'SEARCH_RATE_LIMITED', message: 'slow down', details: { retryAfterSeconds: 30 } },
                    headers: { 'retry-after': '30' },
                },
            ],
            [
                'a busy food (`503`)',
                {
                    kind: 'json',
                    status: 503,
                    body: { code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 5 } },
                },
            ],
            ['a transport failure', OFFLINE],
        ])('%s', async (_case, refusal) => {
            const origin = foodOrigin([refusal]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(0);

            expect(shape(result.current.read)).toMatchObject({ kind: 'ended', database: false });
            expect(origin.sent).toHaveLength(1);
        });
    });

    // System change 9: "A food refusal sets it, and so does a source frame that reports the cook's limit."
    describe('the cook’s limit from a source frame', () => {
        it('holds the session’s limit until the minute the frame’s wait ends, from when it arrived (item 10)', async () => {
            vi.setSystemTime(Date.UTC(2026, 9, 2, 12, 0, 0));
            const onLimited = vi.fn();
            const origin = foodOrigin([STREAM]);
            renderSource(origin.client, { query: 'flour' }, onLimited);

            await advance(0);
            origin.last().write(DATABASE_LINE);
            origin.last().write('{"type":"source","source":"usda","outcome":"limited","retryAfterSeconds":90}\n');
            await advance(0);

            expect(onLimited).toHaveBeenCalledWith(Date.UTC(2026, 9, 2, 12, 2, 0));
        });

        it('holds nothing for an answer whose sources all answered', async () => {
            const onLimited = vi.fn();
            const origin = foodOrigin([STREAM]);
            renderSource(origin.client, { query: 'flour' }, onLimited);

            await advance(0);
            origin.last().write(DATABASE_LINE);
            origin.last().write(SOURCE_LINE);
            await advance(0);

            expect(onLimited).not.toHaveBeenCalled();
        });
    });

    describe('Try again', () => {
        it('asks once more, under fresh deadlines', async () => {
            const origin = foodOrigin([STREAM]);
            const { result } = renderSource(origin.client, { query: 'flour' });

            await advance(FOOD_SEARCH_DEADLINE_MS);
            expect(shape(result.current.read)).toMatchObject({ kind: 'ended', database: false });

            act(() => result.current.refetch());
            await advance(FOOD_SEARCH_DEADLINE_MS - 1);

            expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: false, resumed: false });
            expect(origin.sent).toHaveLength(2);

            origin.last().write(DATABASE_LINE);
            await advance(0);
            expect(shape(result.current.read)).toMatchObject({ kind: 'asking', database: true });
        });
    });
});
