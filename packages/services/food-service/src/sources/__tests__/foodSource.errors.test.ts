/**
 * The source-boundary errors the rate-limited transport raises (plan U27, KTD-25, ADR-0053 §4 and §8).
 *
 * - `SourceBusyError`: a request refused BEFORE it reached the source, because the source's shared window is at its
 *   ceiling, a block is live, or the admission lock was contended. It is never a timeout, so it must stay its own
 *   type through every layer that classifies failures.
 * - `SourceAccountingError`: our own admission or block ledger failed. It is neither busy nor the source's answer, so
 *   it must not read as a timeout either.
 * - `isSourceAdmissionError`: the one predicate a client is given for both, so it passes them through unchanged.
 *
 * Every source a source error names is a callable one: a held or file source is never called (ADR-0052 §8), and
 * `CallableApiSourceId` already makes asking for one unrepresentable (`sourceRegister.test.ts`).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
    AdapterValidationError,
    isSourceAccountingError,
    isSourceAdmissionError,
    isSourceBusyError,
    SourceAccountingError,
    SourceApiError,
    SourceBusyError,
} from '../foodSource.errors.js';
import type { CallableApiSourceId } from '../sourceRegister.js';

describe('SourceBusyError', () => {
    it.each(['ceiling', 'blocked', 'contended'] as const)(
        'carries the source, the %s reason and the retry time',
        (reason) => {
            const error = new SourceBusyError('matvaretabellen', reason, '2026-10-01T05:00:00.000Z');

            expect({ source: error.source, reason: error.reason, retryAt: error.retryAt, name: error.name }).toEqual({
                source: 'matvaretabellen',
                reason,
                retryAt: '2026-10-01T05:00:00.000Z',
                name: 'SourceBusyError',
            });
        },
    );

    it('names the source, the reason and the retry time in its message', () => {
        const error = new SourceBusyError('usda', 'blocked', '2026-10-01T05:00:00.000Z');

        expect(error.message).toBe("Source 'usda' is busy (blocked) until 2026-10-01T05:00:00.000Z");
    });

    it('is an Error and survives instanceof after construction', () => {
        const error: unknown = new SourceBusyError('usda', 'ceiling', '2026-10-01T05:00:00.000Z');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(SourceBusyError);
    });
});

describe('isSourceBusyError', () => {
    it('accepts a SourceBusyError', () => {
        expect(isSourceBusyError(new SourceBusyError('usda', 'contended', '2026-10-01T05:00:00.000Z'))).toBe(true);
    });

    it.each([
        ['a SourceApiError, which is a failure the source answered with', new SourceApiError('usda', 429, 'busy')],
        [
            'a SourceAccountingError, which is our own failure',
            new SourceAccountingError('usda', 'admit', new Error('db')),
        ],
        ['a plain Error', new Error("Source 'usda' is busy")],
        ['a look-alike object', { name: 'SourceBusyError', source: 'usda', reason: 'ceiling' }],
        ['undefined', undefined],
    ])('refuses %s', (_, value) => {
        expect(isSourceBusyError(value)).toBe(false);
    });
});

describe('SourceAccountingError', () => {
    it.each(['admit', 'record'] as const)('carries the source, the %s step and the cause', (step) => {
        const cause = new Error('connection terminated unexpectedly');
        const error = new SourceAccountingError('matvaretabellen', step, cause);

        expect({ source: error.source, step: error.step, name: error.name }).toEqual({
            source: 'matvaretabellen',
            step,
            name: 'SourceAccountingError',
        });
        expect(error.cause).toBe(cause);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(SourceAccountingError);
    });

    it("names the source and the step in its message, and never the cause's text", () => {
        const error = new SourceAccountingError('usda', 'record', new Error('password authentication failed'));

        expect(error.message).toBe("Could not account for a call to source 'usda' (record)");
    });
});

describe('isSourceAccountingError', () => {
    it.each([
        ['a SourceBusyError', new SourceBusyError('usda', 'ceiling', '2026-10-01T05:00:00.000Z')],
        ['a SourceApiError', new SourceApiError('usda', 0, 'timeout')],
        ['a plain Error', new Error('db')],
        ['a look-alike object', { name: 'SourceAccountingError', source: 'usda', step: 'admit' }],
    ])('refuses %s', (_, value) => {
        expect(isSourceAccountingError(value)).toBe(false);
    });

    it('accepts a SourceAccountingError', () => {
        expect(isSourceAccountingError(new SourceAccountingError('usda', 'admit', undefined))).toBe(true);
    });
});

describe('isSourceAdmissionError', () => {
    it.each([
        ['a SourceBusyError', new SourceBusyError('usda', 'blocked', '2026-10-01T05:00:00.000Z')],
        ['a SourceAccountingError', new SourceAccountingError('usda', 'record', new Error('db'))],
    ])('accepts %s, which the transport raised without the source answering', (_, value) => {
        expect(isSourceAdmissionError(value)).toBe(true);
    });

    it.each([
        ['a SourceApiError, which the source answered with', new SourceApiError('usda', 429, 'rate limited')],
        ['an AdapterValidationError', new AdapterValidationError('usda', '1', 'nutrient.amount', 'bad')],
        ['a transport failure', new TypeError('fetch failed')],
        ['undefined', undefined],
    ])('refuses %s', (_, value) => {
        expect(isSourceAdmissionError(value)).toBe(false);
    });
});

// A mirror source is called (ADR-0053 §7) and its items are mapped (plan U28) before it is wired to the live path,
// so a source's own failure and a rejected mapping name any callable source, not only a wired one. A held or file
// source is never called, so no source error can name one.
describe('the source failures a mirror source can raise', () => {
    it('names only a callable source, in every error a call to a source can raise', () => {
        expectTypeOf<SourceApiError['source']>().toEqualTypeOf<CallableApiSourceId>();
        expectTypeOf<AdapterValidationError['source']>().toEqualTypeOf<CallableApiSourceId>();
        expectTypeOf<SourceBusyError['source']>().toEqualTypeOf<CallableApiSourceId>();
        expectTypeOf<SourceAccountingError['source']>().toEqualTypeOf<CallableApiSourceId>();
    });

    it('names a callable source that is not wired in a SourceApiError', () => {
        const error = new SourceApiError('matvaretabellen', 503, 'Matvaretabellen answered 503');

        expect({ source: error.source, statusCode: error.statusCode }).toEqual({
            source: 'matvaretabellen',
            statusCode: 503,
        });
    });

    it('names a callable source that is not wired in an AdapterValidationError', () => {
        const error = new AdapterValidationError('matvaretabellen', '06.178', 'Fett', 'is published in mg');

        expect({ source: error.source, key: error.externalKey, field: error.field }).toEqual({
            source: 'matvaretabellen',
            key: '06.178',
            field: 'Fett',
        });
    });
});
