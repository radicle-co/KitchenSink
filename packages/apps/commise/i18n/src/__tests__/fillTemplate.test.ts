/** Unit tests for `fillTemplate.ts` in `@commise/i18n`: the `{token}` filler every localized message goes through. */
import { describe, expect, it } from 'vitest';

import { fillTemplate } from '../fillTemplate.js';

describe('fillTemplate', () => {
    it('substitutes a single named token', () => {
        expect(fillTemplate('{count} recipes', { count: 6 })).toBe('6 recipes');
    });

    it('substitutes multiple named tokens', () => {
        expect(fillTemplate('{a} of {b}', { a: 1, b: 2 })).toBe('1 of 2');
    });

    it('leaves an unknown token untouched (never throws)', () => {
        expect(fillTemplate('{count} of {missing}', { count: 3 })).toBe('3 of {missing}');
    });

    // A name every object inherits (`constructor`, `toString`) is not a token the caller gave. `in` answers true for it
    // and would print the inherited function's source, so the filler asks whether the caller's own object holds the key.
    it('leaves a token named like an inherited object member untouched', () => {
        expect(fillTemplate('{constructor} and {toString}', { count: 3 })).toBe('{constructor} and {toString}');
    });

    it('fills a token the caller gives even when it is named like an inherited member', () => {
        expect(fillTemplate('{constructor}', { constructor: 'cook' })).toBe('cook');
    });
});
