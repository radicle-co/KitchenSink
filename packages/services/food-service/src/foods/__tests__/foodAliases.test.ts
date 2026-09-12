/**
 * Unit tests for the stored form of `food.aliases` (plan U2 / KTD-2).
 *
 * The column is a single `text` and NOT a `text[]`, for a measured reason the tests below encode: the
 * alias tsvector is a STORED GENERATED column, which requires an IMMUTABLE expression, and Postgres marks
 * `array_to_string` **STABLE** (`provolatile = 's'`, verified on PG 16.14) — `CREATE TABLE … tsvector
 * GENERATED ALWAYS AS (to_tsvector('english', array_to_string(a,' '))) STORED` fails with "generation
 * expression is not immutable". So the list is flattened at the write boundary, ONCE, here.
 *
 * That makes the delimiter part of the stored contract, which is why {@link joinAliases} re-punctuates a
 * value containing it rather than emitting a string that cannot be read back unambiguously.
 *
 * Mutation lens: each case reds if the delimiter reservation is dropped, if the empty case starts
 * returning `''` (a GR-019 sentinel — the plan's own scenario "persists null, not `''`"), if the dedup
 * stops folding case, if ordering stops being preserved, or if either bound is removed.
 */
import { describe, expect, it } from 'vitest';

import { ALIAS_DELIMITER, ALIAS_MAX_LENGTH, MAX_ALIASES, joinAliases, normalizeAliases } from '../foodAliases.js';

describe('normalizeAliases', () => {
    it('preserves USDA rank order — the curation signal is the order, not the set', () => {
        expect(normalizeAliases(['sharp cheese', 'Tillamook', 'Wisconsin'])).toEqual([
            'sharp cheese',
            'Tillamook',
            'Wisconsin',
        ]);
    });

    it('applies the catalog name hygiene: NFKC, invisible characters dropped, whitespace collapsed', () => {
        // An alias is shared, searched catalog text with exactly the identity-split hazard `sanitizeFoodName`
        // exists for — `Tilla<ZWSP>mook` must not index as two lexemes.
        expect(normalizeAliases(['  Tilla​mook  ', 'sharp\t\ncheese'])).toEqual(['Tillamook', 'sharp cheese']);
    });

    it('drops values that carry no visible content at all', () => {
        expect(normalizeAliases(['', '   ', '​', 'Coon'])).toEqual(['Coon']);
    });

    it('folds case-insensitive duplicates onto the FIRST spelling seen', () => {
        expect(normalizeAliases(['Tillamook', 'TILLAMOOK', 'tillamook', 'Coon'])).toEqual(['Tillamook', 'Coon']);
    });

    it('drops an over-length alias rather than truncating it into a value nobody wrote', () => {
        const tooLong = 'x'.repeat(ALIAS_MAX_LENGTH + 1);

        expect(normalizeAliases([tooLong, 'Coon'])).toEqual(['Coon']);
        expect(normalizeAliases(['x'.repeat(ALIAS_MAX_LENGTH)])).toHaveLength(1);
    });

    it('caps the list, keeping the highest-ranked aliases', () => {
        const many = Array.from({ length: MAX_ALIASES + 5 }, (_unused, index) => `alias-${index}`);
        const kept = normalizeAliases(many);

        expect(kept).toHaveLength(MAX_ALIASES);
        expect(kept[0]).toBe('alias-0');
        expect(kept.at(-1)).toBe(`alias-${MAX_ALIASES - 1}`);
    });

    it('is idempotent — re-normalizing a stored list changes nothing', () => {
        const once = normalizeAliases(['  Sharp Cheese ', 'Tillamook']);

        expect(normalizeAliases(once)).toEqual(once);
    });
});

describe('joinAliases', () => {
    it('flattens the list onto the stored delimiter', () => {
        expect(joinAliases(['sharp cheese', 'Tillamook'])).toBe(`sharp cheese${ALIAS_DELIMITER}Tillamook`);
    });

    it('returns NULL, never an empty string, when nothing survives (GR-019: no sentinels)', () => {
        expect(joinAliases([])).toBeNull();
        expect(joinAliases(['', '   '])).toBeNull();
    });

    it('re-punctuates a delimiter inside a value so the stored form stays unambiguous', () => {
        // USDA's search envelope already `;`-joins these, so a `;` inside one is upstream corruption rather
        // than data. Emitting it verbatim would silently split one alias into two on any future read.
        expect(joinAliases(['Colby; Colby Jack'])).toBe('Colby, Colby Jack');
        expect(joinAliases(['a;b', 'c'])).toBe(`a,b${ALIAS_DELIMITER}c`);
    });

    it('never emits a value that would split back into a different list', () => {
        const joined = joinAliases(['Colby; Colby Jack', 'Tillamook']);

        expect(joined?.split(ALIAS_DELIMITER)).toEqual(['Colby, Colby Jack', 'Tillamook']);
    });
});
