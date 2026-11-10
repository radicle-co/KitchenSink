/**
 * `escapeRegExp`: text the cook or a vocabulary supplies, matched as itself inside a larger pattern.
 */
import { describe, expect, it } from 'vitest';

import { escapeRegExp } from '../escapeRegExp.js';

describe('escapeRegExp', () => {
    it.each([
        ['every metacharacter', '.*+?^$' + '{}()|[]\\/'],
        ['an inch mark and a period', 'in.'],
        ['a fraction', '1/2'],
        ['plain words', 'pie pastry'],
    ])('%s matches only itself', (_label, text) => {
        const pattern = new RegExp(`^${escapeRegExp(text)}$`, 'u');

        expect(pattern.test(text)).toBe(true);
        expect(pattern.test(`${text}x`)).toBe(false);
    });

    it('leaves a period literal, so "in." does not match "inX"', () => {
        expect(new RegExp(`^${escapeRegExp('in.')}$`, 'u').test('inX')).toBe(false);
    });
});
