/**
 * The accounting both source transports share (ADR-0053 §3 and §5): admission and the block ledger wrapped so their own
 * failures are ours (`SourceAccountingError`), and one response's signals applied in one order: the block its status,
 * `Retry-After` and quota earn is written, then the publisher's reading is reported. The status is the caller's, so
 * the cache-first transport can pass the source's own status from inside the search service's wrapper.
 */
import { describe, expect, it } from 'vitest';

import { isSourceAccountingError } from '../../foodSource.errors.js';
import type { QuotaReading } from '../quotaHeaders.js';
import { admitOrThrow, applySourceSignals } from '../sourceAccounting.js';
import type { Admission, SourceBlock } from '../transportPorts.js';

/** 2026-10-01 05:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 1, 5, 0, 0);

/** What the ports saw, in order. */
interface Ledger {
    readonly events: string[];
    readonly blocks: SourceBlock[];
    readonly quotas: QuotaReading[];
}

/**
 * The block ledger and the quota sink, recording what they are given.
 *
 * @param options - Whether the ledger or the sink fails.
 * @returns The ports and what they saw.
 */
function ports(options: { readonly recordFails?: Error; readonly metricsFail?: boolean } = {}) {
    const seen: Ledger = { events: [], blocks: [], quotas: [] };

    return {
        seen,
        ports: {
            blocks: {
                record: async (block: SourceBlock) => {
                    seen.events.push('record');

                    if (options.recordFails !== undefined) {
                        throw options.recordFails;
                    }

                    seen.blocks.push(block);
                },
            },
            metrics: {
                recordSourceRateLimit: (_source: string, reading: QuotaReading) => {
                    seen.events.push('quota');

                    if (options.metricsFail === true) {
                        throw new Error('metrics sink down');
                    }

                    seen.quotas.push(reading);
                },
            },
        },
    };
}

describe('applySourceSignals', () => {
    it.each<{
        readonly name: string;
        readonly status: number;
        readonly headers: Record<string, string>;
        readonly block: SourceBlock | undefined;
        readonly quotas: QuotaReading[];
        readonly events: string[];
    }>([
        {
            name: 'a success with no reading earns nothing',
            status: 200,
            headers: {},
            block: undefined,
            quotas: [],
            events: [],
        },
        {
            name: 'a 429 with no Retry-After earns the breach block',
            status: 429,
            headers: {},
            block: { source: 'usda', reason: 'rateLimited', seconds: 3600 },
            quotas: [],
            events: ['record'],
        },
        {
            name: 'a 503 whose Retry-After is a date is read against the given time',
            status: 503,
            headers: { 'retry-after': 'Thu, 01 Oct 2026 05:01:30 GMT' },
            block: { source: 'usda', reason: 'unavailable', seconds: 90 },
            quotas: [],
            events: ['record'],
        },
        {
            name: 'a success with a tenth of the quota left blocks, then reports the reading',
            status: 200,
            headers: { 'x-ratelimit-remaining': '100', 'x-ratelimit-limit': '1000' },
            block: { source: 'usda', reason: 'quotaLow', seconds: 300 },
            quotas: [{ remaining: 100, limit: 1000 }],
            events: ['record', 'quota'],
        },
        {
            name: 'a success with quota to spare only reports the reading',
            status: 200,
            headers: { 'x-ratelimit-remaining': '742', 'x-ratelimit-limit': '1000' },
            block: undefined,
            quotas: [{ remaining: 742, limit: 1000 }],
            events: ['quota'],
        },
        {
            name: 'a status the caller read from inside a wrapper is the one judged',
            status: 429,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '1000' },
            block: { source: 'usda', reason: 'rateLimited', seconds: 3600 },
            quotas: [{ remaining: 0, limit: 1000 }],
            events: ['record', 'quota'],
        },
    ])('$name', async ({ status, headers, block, quotas, events }) => {
        const { ports: given, seen } = ports();

        const earned = await applySourceSignals(given, 'usda', { status, headers: new Headers(headers) }, NOW);

        expect(earned === undefined ? undefined : { source: 'usda', ...earned }).toStrictEqual(block);
        expect(seen.blocks).toStrictEqual(block === undefined ? [] : [block]);
        expect(seen.quotas).toStrictEqual(quotas);
        expect(seen.events).toStrictEqual(events);
    });

    it('throws SourceAccountingError (record) when the block cannot be written, before any reading is reported', async () => {
        const failure = new Error('ledger unavailable');
        const { ports: given, seen } = ports({ recordFails: failure });

        const thrown = await applySourceSignals(
            given,
            'usda',
            { status: 429, headers: new Headers({ 'x-ratelimit-remaining': '0' }) },
            NOW,
        ).catch((error: unknown) => error);

        expect(isSourceAccountingError(thrown) && { step: thrown.step, cause: thrown.cause }).toStrictEqual({
            step: 'record',
            cause: failure,
        });
        expect(seen.events).toStrictEqual(['record']);
    });

    it('returns the block when the quota sink throws: measuring the quota must not lose the answer', async () => {
        const { ports: given } = ports({ metricsFail: true });

        await expect(
            applySourceSignals(
                given,
                'usda',
                { status: 200, headers: new Headers({ 'x-ratelimit-remaining': '100', 'x-ratelimit-limit': '1000' }) },
                NOW,
            ),
        ).resolves.toStrictEqual({ reason: 'quotaLow', seconds: 300 });
    });
});

describe('admitOrThrow', () => {
    it('answers what admission answers', async () => {
        const busy: Admission = { admitted: false, reason: 'ceiling', retryAt: '2026-10-01T05:10:00.000Z' };

        await expect(admitOrThrow({ admit: async () => busy }, 'usda', 'interactive')).resolves.toBe(busy);
    });

    it('throws SourceAccountingError (admit) carrying the cause when admission itself fails', async () => {
        const failure = new Error('limiter down');

        const thrown = await admitOrThrow(
            {
                admit: async () => {
                    throw failure;
                },
            },
            'usda',
            'worker',
        ).catch((error: unknown) => error);

        expect(isSourceAccountingError(thrown) && { step: thrown.step, cause: thrown.cause }).toStrictEqual({
            step: 'admit',
            cause: failure,
        });
    });
});
