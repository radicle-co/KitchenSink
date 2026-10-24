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
 * The transport's errors name a callable source: a held or file source is never called (ADR-0052 §8), and
 * `CallableApiSourceId` already makes asking for one unrepresentable (`sourceRegister.test.ts`). An adapter's errors
 * name the wired source it adapts.
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
import type { FoodSourceId } from '../foodSourceAdapter.js';
import type { CallableApiSourceId } from '../sourceRegister.js';

describe('SourceBusyError', () => {
    it.each(['ceiling', 'blocked', 'contended'] as const)(
        'carries the source, the %s reason and the retry time',
        (reason) => {
            const error = new SourceBusyError('usda', reason, '2026-10-01T05:00:00.000Z');

            expect({ source: error.source, reason: error.reason, retryAt: error.retryAt, name: error.name }).toEqual({
                source: 'usda',
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
        const error = new SourceAccountingError('usda', step, cause);

        expect({ source: error.source, step: error.step, name: error.name }).toEqual({
            source: 'usda',
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

// The transport admits and blocks any callable source, so its errors name one. An adapter's errors come from the
// live path, so they name the wired source the adapter wraps. A held or file source is never called, so no source
// error can name one.
describe('the source each error names', () => {
    it('names a callable source in the transport’s errors, and a wired source in an adapter’s', () => {
        expectTypeOf<SourceBusyError['source']>().toEqualTypeOf<CallableApiSourceId>();
        expectTypeOf<SourceAccountingError['source']>().toEqualTypeOf<CallableApiSourceId>();
        expectTypeOf<SourceApiError['source']>().toEqualTypeOf<FoodSourceId>();
        expectTypeOf<AdapterValidationError['source']>().toEqualTypeOf<FoodSourceId>();
    });

    it('carries the source, the key and the field in an AdapterValidationError', () => {
        const error = new AdapterValidationError('usda', '171688', 'nutrient.amount', 'is out of range');

        expect({ source: error.source, key: error.externalKey, field: error.field }).toEqual({
            source: 'usda',
            key: '171688',
            field: 'nutrient.amount',
        });
    });
});
