/**
 * Unit tests for `plural.ts`, the one way this package says a count. The cases pin the contract every count-bearing
 * template relies on: the locale's plural rule picks the form, and every `{count}` in it is filled.
 */
import { describe, expect, it } from 'vitest';

import { pluralOf, type PluralText } from '../plural.js';

const RECIPES: PluralText = { one: '{count} recipe', other: '{count} recipes' };

describe('pluralOf', () => {
    it('a count of 1 takes the `one` form', () => {
        expect(pluralOf(RECIPES, 1, 'en')).toBe('1 recipe');
    });

    it('0 and 2 take the `other` form in English', () => {
        expect(pluralOf(RECIPES, 0, 'en')).toBe('0 recipes');
        expect(pluralOf(RECIPES, 2, 'en')).toBe('2 recipes');
    });

    it('fills every `{count}` in the form, and leaves other tokens for `fillTemplate`', () => {
        expect(pluralOf({ one: '{count} of {total}: {count}', other: 'x' }, 1, 'en')).toBe('1 of {total}: 1');
    });

    it('follows the locale’s rule, not the English one', () => {
        // French puts 0 in the `one` category.
        expect(pluralOf(RECIPES, 0, 'fr')).toBe('0 recipe');
    });
});
