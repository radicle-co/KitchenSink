import { describe, expect, it } from 'vitest';

import { COVER_TINT_NAMES } from '../../tokens/covers.js';
import { coverTintOf } from '../coverTint.js';

/**
 * The monogram cover's ground (`docs/design/uiOverhaul/buildSpec.md` §1.8): one of six tints, chosen by a hash of the
 * recipe's id — never by cuisine, so two recipes of one cuisine do not all wear one colour — and the same tint for the
 * same recipe on every screen and both platforms.
 */
// The tint VALUES, both themes and their contrast, are the tokens' (`tokens/__tests__/covers.test.ts`). ⚠️ REWRITTEN
// for D15: `coverTintOf` names a tint rather than returning a hex, so the theme picks the value at render.
describe('coverTintOf', () => {
    it('gives one recipe the same tint every time', () => {
        expect(coverTintOf('rec_01HZX')).toBe(coverTintOf('rec_01HZX'));
    });

    it('is the 32-bit FNV-1a hash of the id, modulo six', () => {
        // FNV-1a("a") = 0xe40c292c = 3826002220; 3826002220 mod 6 = 4. FNV-1a("") = 0x811c9dc5 = 2166136261, mod 6 = 1.
        expect(coverTintOf('a')).toBe(COVER_TINT_NAMES[4]);
        expect(coverTintOf('')).toBe(COVER_TINT_NAMES[1]);
        // The reference vector FNV-1a("foobar") = 0xbf9cf968 = 3214735720; mod 6 = 4. A multi-character id is what tells
        // the FNV prime from any other multiplier.
        expect(coverTintOf('foobar')).toBe(COVER_TINT_NAMES[3214735720 % 6]);
    });

    it('spreads ten thousand ids over all six tints, each within a fifth of an even share', () => {
        const counts = new Map<string, number>();

        for (let index = 0; index < 10_000; index += 1) {
            const tint = coverTintOf(`rec_${index.toString(36)}`);
            counts.set(tint, (counts.get(tint) ?? 0) + 1);
        }

        expect(counts.size).toBe(6);

        for (const [tint, count] of counts) {
            expect(Math.abs(count - 10_000 / 6), tint).toBeLessThan(10_000 / 6 / 5);
        }
    });
});
