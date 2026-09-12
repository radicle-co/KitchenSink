/**
 * Unit tests for the `food` table's dedup key.
 *
 * ⚠️ The `sanitizeFoodName` suite MOVED to `@kitchensink/recipe-core`
 * (`packages/shared/recipe-core/src/__tests__/foodName.test.ts`) with the function it covers, per plan U3 —
 * the display rule is now shared by both ownerless catalogs. Nothing was dropped; what remains here is the
 * part food owns, and it is tested against the same adversarial inputs because the key is precisely what an
 * invisible character is used to split.
 */
import { describe, expect, it } from 'vitest';

import { normalizeName } from '../foodName.js';

/** U+200B ZERO WIDTH SPACE — renders as nothing, keys as a different food. */
const ZWSP = '\u200B';
/** U+00AD SOFT HYPHEN — invisible unless the renderer breaks the line there. */
const SHY = '\u00AD';
/** U+202E RIGHT-TO-LEFT OVERRIDE / U+202C POP DIRECTIONAL FORMATTING — reorder the rendering, not the bytes. */
const RLO = '\u202E';
const PDF = '\u202C';
/** U+FF22 FULLWIDTH LATIN CAPITAL LETTER B — NFKC folds it onto ASCII `B`. */
const FULLWIDTH_B = '\uFF22';

describe('normalizeName', () => {
    it('lowercases, trims, and collapses internal whitespace (the dedup grain)', () => {
        expect(normalizeName('  Broccoli,   RAW ')).toBe('broccoli, raw');
    });

    it('collapses every invisible-character variant of one name onto ONE dedup key', () => {
        const key = normalizeName('Broccoli');

        expect(normalizeName(`Bro${ZWSP}ccoli`)).toBe(key);
        expect(normalizeName(`${RLO}Broccoli${PDF}`)).toBe(key);
        expect(normalizeName(`${FULLWIDTH_B}roccoli`)).toBe(key);
        expect(normalizeName(` broccoli${SHY} `)).toBe(key);
    });

    it('keeps genuinely different foods apart', () => {
        expect(normalizeName('Broccoli, raw')).not.toBe(normalizeName('Broccoli, cooked'));
    });
});
