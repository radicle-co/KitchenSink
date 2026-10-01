/**
 * How long one response blocks its source for every task (ADR-0053 §5, as amended by the U27 blueprint's A1 and A2):
 *
 * | Signal                                   | Block                                             |
 * | ---------------------------------------- | ------------------------------------------------- |
 * | 429                                      | `Retry-After`, else `breachBlockSeconds`          |
 * | 502, 503 or 504                          | `Retry-After`, else `outageBlockSeconds`          |
 * | the publisher's quota at 0               | `breachBlockSeconds`                              |
 * | the publisher's quota at 10% or less     | `probeSeconds`                                    |
 *
 * When several fire, the longest wins, as the block ledger keeps the later `blocked_until`. A `Retry-After` that
 * states no future time falls back to the declared block, and one longer than the source's own window or breach
 * block is capped there, so one bad header cannot block a source for years.
 */
import { describe, expect, it } from 'vitest';

import { apiAccessOf } from '../../sourceRegister.js';
import {
    AdapterValidationError,
    SourceAccountingError,
    SourceApiError,
    SourceBusyError,
} from '../../foodSource.errors.js';
import { backpressureReasonOf, blockFor, isBlockingStatus, isSourceBackpressure } from '../blockRule.js';
import type { QuotaReading } from '../quotaHeaders.js';

const USDA = apiAccessOf('usda').rateLimit;
const MATVARETABELLEN = apiAccessOf('matvaretabellen').rateLimit;

/** 2026-10-01 05:00:00 UTC. */
const NOW = Date.UTC(2026, 9, 1, 5, 0, 0);

/** A response's signals: a status, and no `Retry-After` and no quota unless a case gives them. */
function signals(status: number, retryAfter: string | null = null, quota?: QuotaReading) {
    return { status, retryAfter, quota };
}

describe('blockFor', () => {
    describe('a 429', () => {
        it("blocks for the source's breach block when no Retry-After is given", () => {
            expect(blockFor(signals(429), USDA, NOW)).toEqual({ reason: 'rateLimited', seconds: 3600 });
        });

        it.each([
            ['delay-seconds', '120', 120],
            ['an HTTP-date', 'Thu, 01 Oct 2026 05:01:30 GMT', 90],
        ])('blocks until the Retry-After time, given as %s', (_, retryAfter, seconds) => {
            expect(blockFor(signals(429, retryAfter), USDA, NOW)).toEqual({ reason: 'rateLimited', seconds });
        });

        it.each([
            ['a zero delay', '0'],
            ['a date already past', 'Thu, 01 Oct 2026 04:59:00 GMT'],
            ['a field it cannot read', 'soon'],
        ])('falls back to the breach block on %s, which states no future time', (_, retryAfter) => {
            expect(blockFor(signals(429, retryAfter), USDA, NOW)).toEqual({ reason: 'rateLimited', seconds: 3600 });
        });

        it("caps a Retry-After longer than the source's window and breach block", () => {
            expect(blockFor(signals(429, '7200'), USDA, NOW)).toEqual({ reason: 'rateLimited', seconds: 3600 });
            expect(blockFor(signals(429, '9'.repeat(400)), USDA, NOW)).toEqual({
                reason: 'rateLimited',
                seconds: 3600,
            });
        });

        it("caps at the source's own window when that is the longer bound (Matvaretabellen counts per day)", () => {
            expect(blockFor(signals(429, '172800'), MATVARETABELLEN, NOW)).toEqual({
                reason: 'rateLimited',
                seconds: 86400,
            });
        });
    });

    describe('an outage', () => {
        it.each([502, 503, 504])("blocks a %i for the source's outage block, not its breach block (A1)", (status) => {
            expect(blockFor(signals(status), USDA, NOW)).toEqual({ reason: 'unavailable', seconds: 60 });
        });

        it('blocks until the Retry-After time when one is given', () => {
            expect(blockFor(signals(503, '30'), USDA, NOW)).toEqual({ reason: 'unavailable', seconds: 30 });
        });

        it.each([500, 501, 400, 401, 404, 422, 200, 204, 301])('does not block a %i with no quota signal', (status) => {
            expect(blockFor(signals(status, '120'), USDA, NOW)).toBeUndefined();
        });
    });

    describe("the publisher's quota", () => {
        it('blocks for the breach block when the publisher reports nothing left', () => {
            expect(blockFor(signals(200, null, { remaining: 0, limit: 1000 }), USDA, NOW)).toEqual({
                reason: 'quotaExhausted',
                seconds: 3600,
            });
        });

        // ⌊0.9 × 1000⌋ = 900 used is our own ceiling, so 100 left is the line: the key's other users have spent the
        // rest, and our next call would reach their limit (A2).
        it('blocks for the probe time at 10% or less left, and not one call above it', () => {
            expect(blockFor(signals(200, null, { remaining: 100, limit: 1000 }), USDA, NOW)).toEqual({
                reason: 'quotaLow',
                seconds: 300,
            });
            expect(blockFor(signals(200, null, { remaining: 101, limit: 1000 }), USDA, NOW)).toBeUndefined();
        });

        it("reads 10% of the publisher's own limit when it sends one", () => {
            expect(blockFor(signals(200, null, { remaining: 50, limit: 500 }), USDA, NOW)).toEqual({
                reason: 'quotaLow',
                seconds: 300,
            });
            expect(blockFor(signals(200, null, { remaining: 51, limit: 500 }), USDA, NOW)).toBeUndefined();
        });

        it('reads 10% of the declared limit when the publisher sends no limit', () => {
            expect(blockFor(signals(200, null, { remaining: 100 }), USDA, NOW)).toEqual({
                reason: 'quotaLow',
                seconds: 300,
            });
            expect(blockFor(signals(200, null, { remaining: 101 }), USDA, NOW)).toBeUndefined();
        });

        it('does not block on a limit alone, or on more left than the limit', () => {
            expect(blockFor(signals(200, null, { limit: 1000 }), USDA, NOW)).toBeUndefined();
            expect(blockFor(signals(200, null, { remaining: 50, limit: 10 }), USDA, NOW)).toBeUndefined();
        });

        it('ignores a quota reading for a source that declares no quota', () => {
            expect(blockFor(signals(200, null, { remaining: 0, limit: 24 }), MATVARETABELLEN, NOW)).toBeUndefined();
        });
    });

    describe('when several rules fire', () => {
        it('takes the longest block', () => {
            expect(blockFor(signals(429, '30', { remaining: 0, limit: 1000 }), USDA, NOW)).toEqual({
                reason: 'quotaExhausted',
                seconds: 3600,
            });
            expect(blockFor(signals(503, '600', { remaining: 50, limit: 1000 }), USDA, NOW)).toEqual({
                reason: 'unavailable',
                seconds: 600,
            });
        });

        it("names the status's reason on a tie", () => {
            expect(blockFor(signals(429, null, { remaining: 0, limit: 1000 }), USDA, NOW)).toEqual({
                reason: 'rateLimited',
                seconds: 3600,
            });
        });
    });
});

/** The statuses a caller stops on are exactly those `blockFor` blocks on by status alone. */
describe('isBlockingStatus', () => {
    it.each([200, 400, 404, 422, 500, 501, 505])('%i does not block', (status) => {
        expect(isBlockingStatus(status)).toBe(false);
        expect(blockFor(signals(status), USDA, NOW)).toBeUndefined();
    });

    it.each([429, 502, 503, 504])('%i blocks', (status) => {
        expect(isBlockingStatus(status)).toBe(true);
        expect(blockFor(signals(status), USDA, NOW)).toBeDefined();
    });
});

/**
 * Back-pressure: the source is busy or blocked for every task, or our own accounting failed, so a caller stops calling
 * it rather than charging the food an attempt (ADR-0053 §4). The worker's fan-out and refresh and change-refresh all
 * read this one predicate, and log the reason this one function derives.
 */
describe('isSourceBackpressure and backpressureReasonOf', () => {
    const RETRY_AT = '2026-10-01T06:00:00.000Z';

    it.each([
        ['a ceiling refusal', new SourceBusyError('usda', 'ceiling', RETRY_AT), 'ceiling'],
        ['a block refusal', new SourceBusyError('usda', 'blocked', RETRY_AT), 'blocked'],
        ['a contended refusal', new SourceBusyError('usda', 'contended', RETRY_AT), 'contended'],
        ['a failed admission', new SourceAccountingError('usda', 'admit', new Error('down')), 'accounting'],
        [
            'a block that could not be written',
            new SourceAccountingError('usda', 'record', new Error('down')),
            'accounting',
        ],
        ['a 429', new SourceApiError('usda', 429, 'rate limited'), '429'],
        ['a 502', new SourceApiError('usda', 502, 'bad gateway'), '502'],
        ['a 503', new SourceApiError('usda', 503, 'unavailable'), '503'],
        ['a 504', new SourceApiError('usda', 504, 'gateway timeout'), '504'],
    ])('%s is back-pressure', (_, error, reason) => {
        expect(isSourceBackpressure(error)).toBe(true);
        expect(backpressureReasonOf(error)).toBe(reason);
    });

    it.each([
        ['a 500', new SourceApiError('usda', 500, 'server error')],
        ['a 422 schema drift', new SourceApiError('usda', 422, 'schema')],
        ['a 404', new SourceApiError('usda', 404, 'not found')],
        ['a client timeout', new SourceApiError('usda', 0, 'timed out')],
        ['a validation failure', new AdapterValidationError('usda', '1', 'dataType', 'not admitted')],
        ['a plain error', new Error('boom')],
        ['a thrown non-error', 'boom'],
    ])('%s is not back-pressure', (_, error) => {
        expect(isSourceBackpressure(error)).toBe(false);
    });
});
