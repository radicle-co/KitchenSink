/**
 * What a cook actually types, measured against the normalization it flows through.
 *
 * ## Why this corpus exists, and why the plan's does not cover it
 *
 * The plan's evidence is a 448-recipe import of 1919 cookbook prose, and every success criterion is
 * denominated in it. That corpus measures the IMPORTER's distribution. It is not what a cook types, and the
 * two differ in shape: prose carries number words and instruction clauses, a typed ingredient name carries
 * brands, percentages, ampersands, plurals and typos.
 *
 * The distinction matters more than it looks, because there is **no user-facing ingredient-line parser at
 * all**. `parseIngredientLine` is imported only by `cookbook-import`; the recipe form takes a numeric
 * quantity, a unit and a name as SEPARATE fields. So the only thing standing between a cook's keystrokes and
 * the catalog is name normalization — `sanitizeFoodName` and `normalizedIngredientKey` — and with 92.8% of
 * import lines decided on the local table, that is the surface where a resolution defect actually lives.
 *
 * ## This is a CHARACTERIZATION baseline, not a wish list
 *
 * Every expectation below is what the code does **today**, measured on 2026-08-21, not what it ought to do.
 * That is deliberate: U1's job is to make behaviour measurable before U5 and U6 change it, and a test
 * asserting the desired end state would be red for the whole plan and get disabled. When a later unit closes
 * one of the gaps, the assertion here changes in the same commit and the diff shows exactly what moved.
 *
 * ⚠️ Authoring synthetic input is legitimate HERE and is not in `goldenCorpusParse.ts`. That golden quotes a
 * real book, so it carries a verbatim rule to stop it drifting into fiction. This corpus models user input,
 * of which we have no captured sample — so it is representative BY CONSTRUCTION and says so. It is not a
 * substitute for measuring real typed input once there is any.
 *
 * ## The gaps are recorded with the tier expected to close them
 *
 * The key is an exact-match grain: trim, lower-case, Unicode hygiene. It folds none of hyphenation, plurals,
 * diacritics or comma inversion — correctly, because collapsing those into the KEY would merge foods that
 * are genuinely distinct (`2% milk` and `2 milk` are not the same product). Bridging them is a ranking job.
 * Each row below therefore names which tier is expected to bridge it, so "the key does not fold plurals"
 * reads as a measured handoff rather than a bug nobody owns.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeFoodName } from '../../foodName.js';
import { normalizedIngredientKey } from '../normalizedKey.js';

/** Which tier is expected to bridge a difference the key deliberately preserves. */
type BridgedBy = 'key' | 'ranking (U5/U6)' | 'memo k-NN (U10)' | 'nothing yet';

/** One representative typed ingredient name and what today's normalization makes of it. */
interface TypedInput {
    /** What the cook types into the ingredient name field. */
    readonly typed: string;
    /** `sanitizeFoodName`'s output — the shared display name. */
    readonly sanitized: string;
    /** `normalizedIngredientKey`'s output — the exact-match grain. `undefined` when the input yields none. */
    readonly key: string | undefined;
    /** Why this row is in the corpus. */
    readonly why: string;
}

const CORPUS: readonly TypedInput[] = [
    {
        typed: 'Butter',
        sanitized: 'Butter',
        key: 'butter',
        why: 'the ordinary case: display keeps the case a cook typed, the key does not',
    },
    {
        typed: ' butter ',
        sanitized: 'butter',
        key: 'butter',
        why: 'stray whitespace from a paste must not create a second catalog row',
    },
    {
        typed: 'all-purpose flour',
        sanitized: 'all-purpose flour',
        key: 'all-purpose flour',
        why: 'the most-typed flour, hyphenated',
    },
    {
        typed: 'all purpose flour',
        sanitized: 'all purpose flour',
        key: 'all purpose flour',
        why: 'the same food unhyphenated — a DIFFERENT key by design',
    },
    { typed: 'eggs', sanitized: 'eggs', key: 'eggs', why: 'cooks type the plural; the catalog names the singular' },
    {
        typed: 'jalapeño',
        sanitized: 'jalapeño',
        key: 'jalapeño',
        why: 'diacritics survive: folding them into the key would merge distinct foods elsewhere',
    },
    {
        typed: 'flour, all purpose',
        sanitized: 'flour, all purpose',
        key: 'flour, all purpose',
        why: "USDA's own inverted form, typed back by a cook who saw it",
    },
    {
        typed: 'Kerrygold butter',
        sanitized: 'Kerrygold butter',
        key: 'kerrygold butter',
        why: 'a brand the catalog does not carry — U2 aliases are the intended bridge',
    },
    {
        typed: '2% milk',
        sanitized: '2% milk',
        key: '2% milk',
        why: 'a percentage is part of the food identity, not noise to strip',
    },
    {
        typed: 'salt & pepper',
        sanitized: 'salt & pepper',
        key: 'salt & pepper',
        why: 'two foods on one line — resolution must not invent a single match',
    },
    {
        typed: 'chikcen',
        sanitized: 'chikcen',
        key: 'chikcen',
        why: 'a transposition typo, which only fuzzy ranking can rescue',
    },
    {
        typed: '   ',
        sanitized: '',
        key: undefined,
        why: 'whitespace alone yields no key rather than an empty-string key',
    },
];

/** Differences the key deliberately preserves, and who is expected to bridge each. */
const HANDOFFS: readonly { readonly a: string; readonly b: string; readonly bridgedBy: BridgedBy }[] = [
    { a: 'all-purpose flour', b: 'all purpose flour', bridgedBy: 'memo k-NN (U10)' },
    { a: 'eggs', b: 'egg', bridgedBy: 'ranking (U5/U6)' },
    { a: 'jalapeño', b: 'jalapeno', bridgedBy: 'ranking (U5/U6)' },
    { a: 'flour, all purpose', b: 'all purpose flour', bridgedBy: 'ranking (U5/U6)' },
    { a: 'Kerrygold butter', b: 'butter', bridgedBy: 'nothing yet' },
];

describe('representative typed ingredient names', () => {
    it.each(CORPUS)('normalizes $typed as measured today', ({ typed, sanitized, key }) => {
        expect(sanitizeFoodName(typed)).toBe(sanitized);
        expect(normalizedIngredientKey(typed)).toBe(key);
    });

    it.each(HANDOFFS)('keeps $a and $b on different keys, bridged by $bridgedBy', ({ a, b }) => {
        // The key is an exact-match grain. Collapsing these INTO it would merge foods that are genuinely
        // distinct elsewhere in the catalog, so the difference is preserved and handed to a ranking tier.
        expect(normalizedIngredientKey(a)).not.toBe(normalizedIngredientKey(b));
    });

    it('records one difference no tier currently bridges', () => {
        // A brand a cook types that the catalog does not carry. U2's aliases are the intended mechanism, but
        // only USDA Survey foods carry them and the bulk seed does not include Survey — so today this
        // resolves on ranking alone. Named here so it is a known gap rather than a surprise at U15.
        expect(HANDOFFS.filter((handoff) => handoff.bridgedBy === 'nothing yet')).toHaveLength(1);
    });

    it('never lets a typed name become an empty key', () => {
        // An empty-string key would collide every unnameable input into one catalog identity.
        const keys = CORPUS.map((entry) => entry.key);

        expect(keys.filter((key) => key === '')).toEqual([]);
    });
});
