import { describe, expect, it } from 'vitest';

import { canonicalHex } from '../surfaceToneCascade';

/**
 * A computed custom property keeps the text the stylesheet was minified to, so `--tw-ring-offset-color` reads `#fff`
 * where the token says `#FFFFFF`. The cascade spec compares colours, not spellings: both sides go through
 * `canonicalHex`. Mutation lens: return the input unchanged and the shorthand rows fail.
 */
describe('canonicalHex', () => {
    it.each([
        ['#fff', '#ffffff'],
        ['#FFF', '#ffffff'],
        ['#1e1b18', '#1e1b18'],
        ['#FCFDFF', '#fcfdff'],
        ['  #abc ', '#aabbcc'],
    ])('reads %s as %s', (spelling, canonical) => {
        expect(canonicalHex(spelling)).toBe(canonical);
    });

    it('leaves a value that is not a hex colour alone, so a mismatch still reports what it saw', () => {
        expect(canonicalHex('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    });
});
