/** Unit tests for `format/fillTemplate.ts`: the `{token}` filler every localized message goes through. */
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
});
