/**
 * Tests for {@link isSourceLimited} and {@link limitEndOf}, the pure rules of the cook's own limit on source lookups
 * (`docs/design/rowEditorOpenDecisions.md` item 10). MOVED from `useSourceLimit.test.ts` unchanged: the rules left the
 * hook's module so a server-rendered module can import them without React's hooks (`detail/model.ts` reaches them
 * through `progressiveNotes.ts`, and the web build refused that import).
 */
import { describe, expect, it } from 'vitest';

import { isSourceLimited, limitEndOf } from '../sourceLimit.model.js';

const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

describe('isSourceLimited', () => {
    it.each([
        { case: 'no limit held', retryAt: undefined, now: T0, expected: false },
        { case: 'before the stated time', retryAt: T0 + 60_000, now: T0 + 59_999, expected: true },
        { case: 'at the stated time', retryAt: T0 + 60_000, now: T0 + 60_000, expected: false },
        { case: 'after it', retryAt: T0 + 60_000, now: T0 + 61_000, expected: false },
    ])('$case → $expected', ({ retryAt, now, expected }) => {
        expect(isSourceLimited({ retryAt }, now)).toBe(expected);
    });
});

/** Item 10: the stated time is rounded UP to the next minute, so the minute a surface states never fails. */
describe('limitEndOf', () => {
    it.each([
        { case: 'inside a minute', until: T0 + 1_000, expected: T0 + 60_000 },
        { case: 'on a minute', until: T0 + 60_000, expected: T0 + 60_000 },
        { case: 'just past one', until: T0 + 60_001, expected: T0 + 120_000 },
    ])('$case → the next whole minute', ({ until, expected }) => {
        expect(limitEndOf(until)).toBe(expected);
    });
});
