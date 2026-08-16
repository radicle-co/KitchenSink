/**
 * Unit tests for the catalog-name canonical form.
 *
 * ADVERSARIAL by design: the catalog is ownerless, globally unique-named and shared by every user, so the
 * interesting inputs are the ones an attacker sends, not the ones a cook types. Every invisible character is
 * written as an escape rather than pasted, because a reviewer cannot check a case they cannot see.
 *
 * Traceability: findings `16.A-6` (a caller's raw string becomes the shared catalog's permanent global name)
 * and `23.S-11` (the dedup key has no Unicode discipline, so it is trivially bypassed).
 */
import { describe, expect, it } from 'vitest';

import { normalizeName, sanitizeFoodName } from '../foodName.js';

/** U+200B ZERO WIDTH SPACE — renders as nothing, keys as a different food. */
const ZWSP = '\u200B';
/** U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM). */
const BOM = '\uFEFF';
/** U+00AD SOFT HYPHEN — invisible unless the renderer breaks the line there. */
const SHY = '\u00AD';
/** U+202E RIGHT-TO-LEFT OVERRIDE / U+202C POP DIRECTIONAL FORMATTING — reorder the rendering, not the bytes. */
const RLO = '\u202E';
const PDF = '\u202C';
/** U+00A0 NO-BREAK SPACE and U+3000 IDEOGRAPHIC SPACE — spaces that `String#trim` alone does not collapse. */
const NBSP = '\u00A0';
const IDEOGRAPHIC_SPACE = '\u3000';

describe('sanitizeFoodName', () => {
    it('trims and collapses internal whitespace without altering the wording', () => {
        expect(sanitizeFoodName('  Broccoli,   RAW ')).toBe('Broccoli, RAW');
    });

    it('removes zero-width characters, which otherwise mint a second row that renders identically', () => {
        expect(sanitizeFoodName(`Bro${ZWSP}ccoli`)).toBe('Broccoli');
        expect(sanitizeFoodName(`Broccoli${BOM}`)).toBe('Broccoli');
        expect(sanitizeFoodName(`Broc${SHY}coli`)).toBe('Broccoli');
    });

    it('removes bidirectional overrides, which reorder the rendered name against its stored bytes', () => {
        expect(sanitizeFoodName(`Brocc${RLO}iloc${PDF}x`)).toBe('Broccilocx');
    });

    it('turns control characters into a separator rather than joining the words either side', () => {
        expect(sanitizeFoodName('Broccoli\nraw')).toBe('Broccoli raw');
        expect(sanitizeFoodName('Broccoli\u0000raw')).toBe('Broccoli raw');
    });

    it('applies NFKC, so a fullwidth or ligature spelling is the same name as its ASCII form', () => {
        expect(sanitizeFoodName('\uFF22\uFF52occoli')).toBe('Broccoli');
        expect(sanitizeFoodName('Cauli\uFB02ower')).toBe('Cauliflower');
    });

    it('folds non-breaking and exotic spaces into the ordinary separator', () => {
        expect(sanitizeFoodName(`Broccoli${NBSP}raw`)).toBe('Broccoli raw');
        expect(sanitizeFoodName(`Broccoli ${IDEOGRAPHIC_SPACE}raw`)).toBe('Broccoli raw');
    });

    it('returns the empty string for a name made only of invisible characters', () => {
        expect(sanitizeFoodName(`${ZWSP}${ZWSP}${BOM}`)).toBe('');
        expect(sanitizeFoodName(`  ${NBSP} `)).toBe('');
    });

    it('is idempotent — sanitizing a sanitized name changes nothing', () => {
        const once = sanitizeFoodName(`  Cauli${ZWSP}\uFB02ower, raw `);

        expect(sanitizeFoodName(once)).toBe(once);
    });

    it('preserves the accented and punctuated names real food data contains', () => {
        expect(sanitizeFoodName('Jalapeño peppers, raw')).toBe('Jalapeño peppers, raw');
        expect(sanitizeFoodName("Kellogg's Raisin Bran (2-pack)")).toBe("Kellogg's Raisin Bran (2-pack)");
    });
});

describe('normalizeName', () => {
    it('lowercases, trims, and collapses internal whitespace (the dedup grain)', () => {
        expect(normalizeName('  Broccoli,   RAW ')).toBe('broccoli, raw');
    });

    it('collapses every invisible-character variant of one name onto ONE dedup key', () => {
        const key = normalizeName('Broccoli');

        expect(normalizeName(`Bro${ZWSP}ccoli`)).toBe(key);
        expect(normalizeName(`${RLO}Broccoli${PDF}`)).toBe(key);
        expect(normalizeName('\uFF22roccoli')).toBe(key);
        expect(normalizeName(` broccoli${SHY} `)).toBe(key);
    });

    it('keeps genuinely different foods apart', () => {
        expect(normalizeName('Broccoli, raw')).not.toBe(normalizeName('Broccoli, cooked'));
    });
});
