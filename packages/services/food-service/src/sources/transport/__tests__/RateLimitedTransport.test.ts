/**
 * The one path to a source (ADR-0053 §3, plan KTD-25). For each request the Decorator:
 *
 * 1. refuses a request whose signal is already aborted;
 * 2. asks admission, and when the source is busy throws `SourceBusyError` WITHOUT calling the source;
 * 3. calls the source;
 * 4. records the block the response earns (`blockRule`), shared by every task through the ledger;
 * 5. reports the publisher's quota reading, and returns the response unchanged.
 *
 * When admission or the ledger fails, the failure is ours, so it is wrapped in `SourceAccountingError`. A failure of
 * the source's own `fetch` passes through unchanged.
 *
 * Admission and the ledger are ports here (no database), so these cases pin the order and the contract.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { isSourceAccountingError, isSourceBusyError, SourceBusyError } from '../../foodSource.errors.js';
import type { sourceCallChannelEnum } from '../../../db/schema/operational.js';
import type { CallableApiSourceId } from '../../sourceRegister.js';
import type { QuotaReading } from '../quotaHeaders.js';
import {
    RateLimitedTransport,
    type Admission,
    type FetchFn,
    type RateLimitedFetch,
    type SourceBlock,
    type SourceCallChannel,
} from '../RateLimitedTransport.js';

/** 2026-10-01 05:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 1, 5, 0, 0);

const ADMITTED: Admission = { admitted: true };

/** What one test's ports saw, in the order they saw it. */
interface Harness {
    readonly transport: RateLimitedTransport;
    readonly events: string[];
    readonly blocks: SourceBlock[];
    readonly quotas: { source: string; reading: QuotaReading }[];
    readonly admissions: { source: CallableApiSourceId; lane: SourceCallChannel }[];
}

/** Build a transport over recording fakes. */
function makeHarness(options: {
    readonly admission?: Admission | Error;
    readonly respond?: () => Response | Promise<Response>;
    readonly recordFails?: Error;
    readonly metricsFail?: boolean;
}): Harness {
    const events: string[] = [];
    const blocks: SourceBlock[] = [];
    const quotas: { source: string; reading: QuotaReading }[] = [];
    const admissions: { source: CallableApiSourceId; lane: SourceCallChannel }[] = [];

    const upstream: FetchFn = async () => {
        events.push('upstream');

        return (options.respond ?? (() => new Response('{"ok":true}')))();
    };

    const transport = new RateLimitedTransport({
        admission: {
            admit: async (source, lane) => {
                events.push('admit');
                admissions.push({ source, lane });

                if (options.admission instanceof Error) {
                    throw options.admission;
                }

                return options.admission ?? ADMITTED;
            },
        },
        blocks: {
            record: async (block) => {
                events.push('record');

                if (options.recordFails !== undefined) {
                    throw options.recordFails;
                }

                blocks.push(block);
            },
        },
        metrics: {
            recordSourceRateLimit: (source, reading) => {
                events.push('quota');

                if (options.metricsFail === true) {
                    throw new Error('metrics sink down');
                }

                quotas.push({ source, reading });
            },
        },
        upstream,
        now: () => NOW,
    });

    return { transport, events, blocks, quotas, admissions };
}

describe('RateLimitedTransport', () => {
    describe('an admitted request', () => {
        it('asks admission for its source and lane, then calls the source once and returns its response unchanged', async () => {
            const response = new Response('{"foods":[]}', { status: 200 });
            const harness = makeHarness({ respond: () => response });

            const received = await harness.transport.fetchFor(
                'matvaretabellen',
                'worker',
            )('https://www.matvaretabellen.no/api/en/foods.json');

            expect(received).toBe(response);
            expect(await received.json()).toEqual({ foods: [] });
            expect(harness.events).toEqual(['admit', 'upstream']);
            expect(harness.admissions).toEqual([{ source: 'matvaretabellen', lane: 'worker' }]);
        });

        it('passes the request and its init through to the source as given', async () => {
            const seen: { input: string | URL | Request; init: RequestInit | undefined }[] = [];
            const transport = new RateLimitedTransport({
                admission: { admit: async () => ADMITTED },
                blocks: { record: async () => undefined },
                metrics: { recordSourceRateLimit: () => undefined },
                upstream: async (input, init) => {
                    seen.push({ input, init });

                    return new Response('[]');
                },
            });
            const init: RequestInit = { method: 'POST', body: '{"fdcIds":[1]}' };

            await transport.fetchFor('usda', 'interactive')('https://api.nal.usda.gov/fdc/v1/foods', init);

            expect(seen).toEqual([{ input: 'https://api.nal.usda.gov/fdc/v1/foods', init }]);
        });
    });

    describe('a busy source', () => {
        it.each(['ceiling', 'blocked', 'contended'] as const)(
            'throws SourceBusyError (%s) and never calls the source',
            async (reason) => {
                const harness = makeHarness({
                    admission: { admitted: false, reason, retryAt: '2026-10-01T05:10:00.000Z' },
                });

                const thrown = await harness.transport
                    .fetchFor(
                        'usda',
                        'interactive',
                    )('https://api.nal.usda.gov/fdc/v1/foods/search')
                    .catch((error: unknown) => error);

                expect(isSourceBusyError(thrown)).toBe(true);
                expect(thrown).toEqual(new SourceBusyError('usda', reason, '2026-10-01T05:10:00.000Z'));
                expect(thrown instanceof SourceBusyError && thrown.reason).toBe(reason);
                expect(harness.events).toEqual(['admit']);
            },
        );
    });

    describe('an aborted request', () => {
        it('is refused before admission, with the abort reason, when the init signal has aborted', async () => {
            const harness = makeHarness({});
            const controller = new AbortController();

            controller.abort(new Error('caller gave up'));

            await expect(
                harness.transport.fetchFor('usda', 'interactive')('https://api.nal.usda.gov/fdc/v1/food/1', {
                    signal: controller.signal,
                }),
            ).rejects.toThrow('caller gave up');
            expect(harness.events).toEqual([]);
        });

        it("is refused before admission when a Request's own signal has aborted", async () => {
            const harness = makeHarness({});
            const controller = new AbortController();

            controller.abort();

            await expect(
                harness.transport.fetchFor(
                    'usda',
                    'interactive',
                )(new Request('https://api.nal.usda.gov/fdc/v1/food/1', { signal: controller.signal })),
            ).rejects.toThrow(/abort/iu);
            expect(harness.events).toEqual([]);
        });
    });

    describe('the block a response earns', () => {
        it('records a 429 for every task, and still returns the response for the client to classify', async () => {
            const harness = makeHarness({ respond: () => new Response('slow down', { status: 429 }) });

            const response = await harness.transport.fetchFor('usda', 'worker')('https://api.nal.usda.gov/fdc/v1/x');

            expect(response.status).toBe(429);
            expect(await response.text()).toBe('slow down');
            expect(harness.blocks).toEqual([{ source: 'usda', reason: 'rateLimited', seconds: 3600 }]);
            expect(harness.events).toEqual(['admit', 'upstream', 'record']);
        });

        it("reads a Retry-After date against the transport's own clock", async () => {
            const harness = makeHarness({
                respond: () =>
                    new Response(null, { status: 503, headers: { 'retry-after': 'Thu, 01 Oct 2026 05:01:30 GMT' } }),
            });

            await harness.transport.fetchFor('matvaretabellen', 'worker')('https://www.matvaretabellen.no/api/x');

            expect(harness.blocks).toEqual([{ source: 'matvaretabellen', reason: 'unavailable', seconds: 90 }]);
        });

        it('records a low publisher quota on a successful response (A2)', async () => {
            const harness = makeHarness({
                respond: () =>
                    new Response('{}', {
                        status: 200,
                        headers: { 'x-ratelimit-remaining': '100', 'x-ratelimit-limit': '1000' },
                    }),
            });

            const response = await harness.transport.fetchFor('usda', 'interactive')('https://api.nal.usda.gov/x');

            expect(response.status).toBe(200);
            expect(harness.blocks).toEqual([{ source: 'usda', reason: 'quotaLow', seconds: 300 }]);
        });

        it('records nothing for a response that earns no block', async () => {
            const harness = makeHarness({
                respond: () =>
                    new Response('{}', { headers: { 'x-ratelimit-remaining': '742', 'x-ratelimit-limit': '1000' } }),
            });

            await harness.transport.fetchFor('usda', 'interactive')('https://api.nal.usda.gov/x');

            expect(harness.blocks).toEqual([]);
        });

        // Rewritten for SourceAccountingError: the ledger's failure used to escape unchanged, so the USDA client's
        // catch-all read our own database error as a USDA timeout (SourceApiError 0).
        it('rejects with SourceAccountingError (record), so a lost block is never silent', async () => {
            const failure = new Error('ledger unavailable');
            const harness = makeHarness({ respond: () => new Response(null, { status: 429 }), recordFails: failure });

            const thrown = await harness.transport
                .fetchFor(
                    'usda',
                    'worker',
                )('https://api.nal.usda.gov/x')
                .catch((error: unknown) => error);

            expect(isSourceAccountingError(thrown)).toBe(true);
            expect(isSourceAccountingError(thrown) && { source: thrown.source, step: thrown.step }).toEqual({
                source: 'usda',
                step: 'record',
            });
            expect(isSourceAccountingError(thrown) && thrown.cause).toBe(failure);
            expect(isSourceBusyError(thrown)).toBe(false);
            expect(harness.events).toEqual(['admit', 'upstream', 'record']);
        });
    });

    describe("the publisher's quota reading", () => {
        it('reports the reading on every response that carries one, a 429 included', async () => {
            const harness = makeHarness({
                respond: () =>
                    new Response(null, {
                        status: 429,
                        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '1000' },
                    }),
            });

            await harness.transport.fetchFor('usda', 'worker')('https://api.nal.usda.gov/x');

            expect(harness.quotas).toEqual([{ source: 'usda', reading: { remaining: 0, limit: 1000 } }]);
            expect(harness.events).toEqual(['admit', 'upstream', 'record', 'quota']);
        });

        it('reports nothing when the response carries no reading', async () => {
            const harness = makeHarness({});

            await harness.transport.fetchFor('usda', 'interactive')('https://api.nal.usda.gov/x');

            expect(harness.quotas).toEqual([]);
        });

        it('reads no quota for a source that declares none', async () => {
            const harness = makeHarness({
                respond: () => new Response('{}', { headers: { 'x-ratelimit-remaining': '0' } }),
            });

            await harness.transport.fetchFor('matvaretabellen', 'worker')('https://www.matvaretabellen.no/api/x');

            expect(harness.quotas).toEqual([]);
            expect(harness.blocks).toEqual([]);
        });

        it('returns the response when the metrics sink throws: measuring the quota must not lose the call', async () => {
            const response = new Response('{}', { headers: { 'x-ratelimit-remaining': '742' } });
            const harness = makeHarness({ respond: () => response, metricsFail: true });

            await expect(harness.transport.fetchFor('usda', 'interactive')('https://api.nal.usda.gov/x')).resolves.toBe(
                response,
            );
        });
    });

    describe('failures that are not the source answering', () => {
        // Rewritten for SourceAccountingError: the admission error used to escape unchanged, so a database outage
        // read as a source timeout once a client classified it.
        it('rejects with SourceAccountingError (admit) carrying the cause, and never calls the source', async () => {
            const failure = new Error('database unavailable');
            const harness = makeHarness({ admission: failure });

            const thrown = await harness.transport
                .fetchFor(
                    'matvaretabellen',
                    'worker',
                )('https://www.matvaretabellen.no/api/x')
                .catch((error: unknown) => error);

            expect(isSourceAccountingError(thrown)).toBe(true);
            expect(isSourceAccountingError(thrown) && { source: thrown.source, step: thrown.step }).toEqual({
                source: 'matvaretabellen',
                step: 'admit',
            });
            expect(isSourceAccountingError(thrown) && thrown.cause).toBe(failure);
            expect(isSourceBusyError(thrown)).toBe(false);
            expect(harness.events).toEqual(['admit']);
        });

        it('rejects with the transport error unchanged and records no block, since the source said nothing', async () => {
            const failure = new TypeError('fetch failed');
            const harness = makeHarness({
                respond: () => {
                    throw failure;
                },
            });

            await expect(harness.transport.fetchFor('usda', 'worker')('https://api.nal.usda.gov/x')).rejects.toBe(
                failure,
            );
            expect(harness.blocks).toEqual([]);
        });
    });

    describe('the lane', () => {
        it('is the lane set the call ledger persists, so the transport and the database cannot disagree', () => {
            expectTypeOf<(typeof sourceCallChannelEnum.enumValues)[number]>().toEqualTypeOf<SourceCallChannel>();
        });
    });

    describe('the brand', () => {
        it('is a fetch to every client, and a plain fetch is not a RateLimitedFetch', () => {
            const harness = makeHarness({});

            expectTypeOf(harness.transport.fetchFor('usda', 'worker')).toExtend<FetchFn>();
            expectTypeOf<typeof fetch>().not.toExtend<RateLimitedFetch>();
            expectTypeOf<FetchFn>().not.toExtend<RateLimitedFetch>();
        });

        it("carries its source, so one source's fetch cannot be handed to another source's client", () => {
            const harness = makeHarness({});

            expectTypeOf(harness.transport.fetchFor('usda', 'worker')).toEqualTypeOf<RateLimitedFetch<'usda'>>();
            expectTypeOf<RateLimitedFetch<'usda'>>().not.toExtend<RateLimitedFetch<'matvaretabellen'>>();
            expectTypeOf<RateLimitedFetch<'matvaretabellen'>>().toExtend<RateLimitedFetch>();
        });
    });
});
