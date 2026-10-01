/**
 * Integration (mocked, CODING_STANDARDS §7.1a): the USDA call path as phase B will compose it — the real
 * `UsdaApiClient` over the real `RateLimitedTransport`, behind the real `UsdaSourceAdapter` — with admission, the block
 * ledger and USDA itself as test doubles. No database and no network.
 *
 * It pins what only the composition can show (ADR-0053 §4 and §5, plan KTD-25):
 *
 * - a busy source reaches the adapter's caller as `SourceBusyError`, never as a timeout, because the client is told
 *   the error is the caller's own (`isCallerError`, wired with `isSourceAdmissionError`); without that, it would
 *   read as a timeout;
 * - a failure of our own admission or block ledger reaches the caller as `SourceAccountingError`, never as a
 *   timeout and never as the status USDA answered with;
 * - a 429, a 5xx or a low quota writes its block before the client classifies the response;
 * - admission runs inside the client's own deadline, so a request that times out has still been counted.
 */
import { UsdaApiClient } from '@kitchensink/usda-client';
import { describe, expect, it, vi } from 'vitest';

import {
    isSourceAccountingError,
    isSourceAdmissionError,
    isSourceApiError,
    isSourceBusyError,
    type SourceBusyReason,
} from '../src/sources/foodSource.errors.js';
import { UsdaSourceAdapter } from '../src/sources/usda/usda.adapter.js';
import { makeUsdaFoodDetailBody, makeUsdaSearchResultBody } from '../src/sources/usda/__fixtures__/usda.fixtures.js';
import { RateLimitedTransport, type FetchFn, type SourceBlock } from '../src/sources/transport/RateLimitedTransport.js';

/** The adapter over the client over the transport, and what each double saw. */
function makeUsdaPath(options: {
    readonly upstream: FetchFn;
    readonly busy?: SourceBusyReason;
    /** Admission throws this, as a database outage would. */
    readonly admissionFails?: Error;
    /** The block ledger throws this, as a database outage would. */
    readonly recordFails?: Error;
    readonly claimCallerErrors?: boolean;
    readonly timeoutMs?: number;
    /** Receives the adapter's warnings. */
    readonly logger?: { readonly warn: (message: string, context?: Record<string, unknown>) => void };
}) {
    const admissions: string[] = [];
    const blocks: SourceBlock[] = [];
    const quotas: unknown[] = [];
    let upstreamCalls = 0;
    const transport = new RateLimitedTransport({
        admission: {
            admit: async (source, lane) => {
                admissions.push(`${source}:${lane}`);

                if (options.admissionFails !== undefined) {
                    throw options.admissionFails;
                }

                return options.busy === undefined
                    ? { admitted: true }
                    : { admitted: false, reason: options.busy, retryAt: '2026-10-01T06:00:00.000Z' };
            },
        },
        blocks: {
            record: async (block) => {
                if (options.recordFails !== undefined) {
                    throw options.recordFails;
                }

                blocks.push(block);
            },
        },
        metrics: { recordSourceRateLimit: (_, reading) => void quotas.push(reading) },
        upstream: async (input, init) => {
            upstreamCalls += 1;

            return options.upstream(input, init);
        },
    });
    const client = new UsdaApiClient({
        apiKey: 'test-key',
        fetchFn: transport.fetchFor('usda', 'interactive'),
        ...(options.claimCallerErrors === false ? {} : { isCallerError: isSourceAdmissionError }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });

    return {
        adapter: new UsdaSourceAdapter(client, options.logger),
        admissions,
        blocks,
        quotas,
        upstreamCalls: () => upstreamCalls,
    };
}

/** A USDA batch answer holding the given detail bodies. */
function batchAnswer(details: readonly unknown[]): FetchFn {
    return async () => new Response(JSON.stringify(details), { status: 200 });
}

/** A USDA search answer with the given status and headers. */
function searchAnswer(status: number, headers: Record<string, string> = {}): FetchFn {
    return async () => new Response(JSON.stringify(makeUsdaSearchResultBody()), { status, headers });
}

describe('the USDA call path through the rate-limited transport', () => {
    it('charges one admission on the caller lane and returns the candidates', async () => {
        const path = makeUsdaPath({ upstream: searchAnswer(200) });

        const candidates = await path.adapter.searchByName('broccoli');

        expect(candidates.map((candidate) => candidate.externalKey)).toEqual(['171688', '170379']);
        expect(path.admissions).toEqual(['usda:interactive']);
        expect(path.blocks).toEqual([]);
    });

    it.each(['ceiling', 'blocked', 'contended'] as const)(
        'surfaces a busy source (%s) to the caller as SourceBusyError, never calling USDA',
        async (busy) => {
            const path = makeUsdaPath({ upstream: searchAnswer(200), busy });

            const thrown = await path.adapter.searchByName('broccoli').catch((error: unknown) => error);

            expect(isSourceBusyError(thrown)).toBe(true);
            expect(isSourceBusyError(thrown) && { reason: thrown.reason, retryAt: thrown.retryAt }).toEqual({
                reason: busy,
                retryAt: '2026-10-01T06:00:00.000Z',
            });
            expect(path.upstreamCalls()).toBe(0);
        },
    );

    // The reason `isCallerError` must be wired in phase B: without it the client's catch-all turns the refusal into
    // a timeout, which the worker counts as a transient upstream failure.
    it('reads a busy source as a timeout when the client is not told the error is the caller’s', async () => {
        const path = makeUsdaPath({ upstream: searchAnswer(200), busy: 'ceiling', claimCallerErrors: false });

        const thrown = await path.adapter.searchByName('broccoli').catch((error: unknown) => error);

        expect(isSourceApiError(thrown) && thrown.statusCode).toBe(0);
    });

    it('surfaces a failed admission as SourceAccountingError, never a timeout, and never calls USDA', async () => {
        const failure = new Error('connection terminated unexpectedly');
        const path = makeUsdaPath({ upstream: searchAnswer(200), admissionFails: failure });

        const thrown = await path.adapter.searchByName('broccoli').catch((error: unknown) => error);

        expect(isSourceApiError(thrown)).toBe(false);
        expect(isSourceAccountingError(thrown) && { step: thrown.step, cause: thrown.cause }).toEqual({
            step: 'admit',
            cause: failure,
        });
        expect(path.upstreamCalls()).toBe(0);
    });

    it("surfaces a block the ledger could not write as SourceAccountingError, not as USDA's 429", async () => {
        const failure = new Error('connection terminated unexpectedly');
        const path = makeUsdaPath({ upstream: searchAnswer(429), recordFails: failure });

        const thrown = await path.adapter.searchByName('broccoli').catch((error: unknown) => error);

        expect(isSourceApiError(thrown)).toBe(false);
        expect(isSourceAccountingError(thrown) && { step: thrown.step, cause: thrown.cause }).toEqual({
            step: 'record',
            cause: failure,
        });
        expect(path.upstreamCalls()).toBe(1);
    });

    it('writes the block a 429 earns, then lets the adapter classify the 429', async () => {
        const path = makeUsdaPath({ upstream: searchAnswer(429) });

        const thrown = await path.adapter.searchByName('broccoli').catch((error: unknown) => error);

        expect(isSourceApiError(thrown) && thrown.statusCode).toBe(429);
        expect(path.blocks).toEqual([{ source: 'usda', reason: 'rateLimited', seconds: 3600 }]);
    });

    it("writes a 503's stated block, not the hour a breach earns", async () => {
        const path = makeUsdaPath({ upstream: searchAnswer(503, { 'Retry-After': '30' }) });

        const thrown = await path.adapter.searchByName('broccoli').catch((error: unknown) => error);

        expect(isSourceApiError(thrown) && thrown.statusCode).toBe(503);
        expect(path.blocks).toEqual([{ source: 'usda', reason: 'unavailable', seconds: 30 }]);
    });

    it("answers the search and blocks the source when USDA's own count shows 10% or less left", async () => {
        const path = makeUsdaPath({
            upstream: searchAnswer(200, { 'X-RateLimit-Remaining': '100', 'X-RateLimit-Limit': '1000' }),
        });

        const candidates = await path.adapter.searchByName('broccoli');

        expect(candidates).toHaveLength(2);
        expect(path.blocks).toEqual([{ source: 'usda', reason: 'quotaLow', seconds: 300 }]);
        expect(path.quotas).toEqual([{ remaining: 100, limit: 1000 }]);
    });

    it("counts a request that then times out, since admission runs inside the client's deadline", async () => {
        const path = makeUsdaPath({
            timeoutMs: 20,
            upstream: async (_, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(init.signal?.reason);
                    });
                }),
        });

        const thrown = await path.adapter.searchByName('broccoli').catch((error: unknown) => error);

        expect(isSourceApiError(thrown) && thrown.statusCode).toBe(0);
        expect(path.admissions).toEqual(['usda:interactive']);
        expect(path.blocks).toEqual([]);
    });

    // A batch is one request whatever it holds (FR-023). One item no admitted dataset covers used to fail the whole
    // chunk, and the worker then re-fetched every key one by one: up to 21 admitted calls for what cost one.
    it('answers a batch holding Experimental and untyped items with the admitted rest, in ONE call, logging once', async () => {
        const warn = vi.fn();
        const path = makeUsdaPath({
            logger: { warn },
            upstream: batchAnswer([
                makeUsdaFoodDetailBody({ fdcId: 1, dataType: 'Foundation' }),
                makeUsdaFoodDetailBody({ fdcId: 2, dataType: 'Experimental' }),
                makeUsdaFoodDetailBody({ fdcId: 3, dataType: 'SR Legacy' }),
                makeUsdaFoodDetailBody({ fdcId: 4, dataType: undefined }),
            ]),
        });

        const candidates = await path.adapter.fetchByKeys(['1', '2', '3', '4']);

        expect(candidates.map((candidate) => candidate.externalKey)).toEqual(['1', '3']);
        expect(path.admissions).toEqual(['usda:interactive']);
        expect(path.upstreamCalls()).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[1]).toEqual({
            skipped: [
                { externalKey: '2', dataType: 'Experimental' },
                { externalKey: '4', dataType: null },
            ],
        });
    });
});
