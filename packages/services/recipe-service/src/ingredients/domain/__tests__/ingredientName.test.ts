/**
 * ⛔ THE ACCEPTANCE CRITERION for `CanonicalIngredientName` — the value object that stands between a caller's
 * string and a row in an OWNERLESS catalog every user's typeahead searches.
 *
 * The canonical FORM is proven once, in `@kitchensink/recipe-core`'s `foodName.test.ts` (NFKC, invisible
 * removal, control separation, collapse, trim), and is not restated here. What this file owns is the smart
 * constructor's own two guarantees, which are what the write paths depend on:
 *
 *  1. it PARSES — the value that comes out is canonical even when the value that went in was not; and
 *  2. it is TOTAL — a name with no visible content yields `undefined` (a branch), never `''` (a row named
 *     nothing, unfindable by any query, in a `NOT NULL` column) and never a throw.
 *
 * The brand itself is checked by the compiler, not here: `IngredientsDal`'s inputs are typed to it, so a write
 * path that skipped this constructor fails `tsc` rather than a test.
 */
import { describe, expect, it } from 'vitest';

import { canonicalIngredientName } from '../ingredientName.js';

/** U+200B ZERO WIDTH SPACE and U+FEFF BOM — escapes, because a reviewer cannot check a case they cannot see. */
const ZWSP = '\u200B';
const BOM = '\uFEFF';

describe('canonicalIngredientName', () => {
    it('passes an ordinary name through untouched', () => {
        expect(canonicalIngredientName('Flour, wheat, all-purpose')).toBe('Flour, wheat, all-purpose');
    });

    it('PARSES rather than validates — the output is canonical even when the input was not', () => {
        // The importer's prose arrives with whatever spacing the source book had; a hostile caller adds the
        // zero-width character that mints a second row rendering identically to the first.
        expect(canonicalIngredientName(`  Bro${ZWSP}wn   sugar${BOM} `)).toBe('Brown sugar');
    });

    it('is idempotent, so re-parsing at a write point cannot corrupt an already-canonical name', () => {
        const once = canonicalIngredientName(`  Cauli${ZWSP}flower, raw `);

        expect(once).toBeDefined();
        expect(canonicalIngredientName(once as string)).toBe(once);
    });

    it('⛔ returns undefined — never `""` and never a throw — for a name with no visible content', () => {
        // A branch, not an exception: one caller answers this with a `400` and the other by keeping the name
        // it already has. Both are ordinary outcomes, so neither is a programmer error.
        expect(canonicalIngredientName(`${ZWSP}${ZWSP}${BOM}`)).toBeUndefined();
        expect(canonicalIngredientName('   ')).toBeUndefined();
        expect(canonicalIngredientName('')).toBeUndefined();
        expect(canonicalIngredientName('\n\t')).toBeUndefined();
    });
});
