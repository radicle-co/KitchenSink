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
import { describeRankingName, describeRankingQuery } from '../rankingTerms.js';
import { classifyRankTier } from '../rankingTiers.js';
import type { RankTier } from '../rankingTiers.js';

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

/** One difference the key deliberately preserves, and who bridges it. */
interface Handoff {
    /** What the cook types. */
    readonly a: string;
    /** The name the catalog carries. */
    readonly b: string;
    /** Which tier bridges it. */
    readonly bridgedBy: BridgedBy;
    /**
     * The rung `classifyRankTier` puts `b` on for the query `a`, now that U5/U6 have landed — `undefined`
     * when the ranking tiers do NOT bridge it and some later tier must.
     */
    readonly bridgedAt: RankTier | undefined;
}

/**
 * Differences the key deliberately preserves, and who bridges each.
 *
 * ⚠️ **UPDATED BY U5/U6 (2026-08-22), which is the point of the field.** Every row that named
 * "ranking (U5/U6)" as its intended bridge now records the RUNG it actually lands on, measured rather than
 * hoped for, so the diff shows exactly what moved:
 *
 * | typed                | catalog             | was              | now                |
 * | -------------------- | ------------------- | ---------------- | ------------------ |
 * | `all-purpose flour`  | `all purpose flour` | memo k-NN (U10)  | ranking, `tokenSet`|
 * | `eggs`               | `egg`               | ranking (open)   | ranking, `tokenSet`|
 * | `jalapeño`           | `jalapeno`          | ranking (open)   | ranking, `exact`   |
 * | `flour, all purpose` | `all purpose flour` | ranking (open)   | ranking, `tokenSet`|
 * | `Kerrygold butter`   | `butter`            | nothing yet      | ranking, `head`    |
 *
 * Two of those are worth calling out rather than burying in a table.
 *
 * **The hyphenation case moved EARLIER in the cascade, not later.** It was assigned to U10's k-NN, and U5's
 * token-set rung closes it lexically — `all-purpose flour` and `all purpose flour` tokenize identically once
 * the fold runs. That is a cheaper tier answering a question a more expensive one was reserved for, which is
 * the cascade working as designed; U10's memo tier keeps the cases the lexical rungs genuinely cannot see.
 *
 * ⛔ **The brand case is bridged to the GENERIC food, and that is NOT the same as representing the brand.**
 * `Kerrygold butter` now reaches `butter` at the `head` rung, which is the right fallback for a cook and is
 * what the earlier `nothing yet` meant was missing. What is STILL missing is any representation of Kerrygold
 * as a distinct product — that is U2's `additionalDescriptions` aliases, and no rung can invent it. The two
 * assertions below hold that distinction: the bridge lands on `head`, deliberately not on `exact`.
 */
const HANDOFFS: readonly Handoff[] = [
    { a: 'all-purpose flour', b: 'all purpose flour', bridgedBy: 'ranking (U5/U6)', bridgedAt: 'tokenSet' },
    { a: 'eggs', b: 'egg', bridgedBy: 'ranking (U5/U6)', bridgedAt: 'tokenSet' },
    { a: 'jalapeño', b: 'jalapeno', bridgedBy: 'ranking (U5/U6)', bridgedAt: 'exact' },
    { a: 'flour, all purpose', b: 'all purpose flour', bridgedBy: 'ranking (U5/U6)', bridgedAt: 'tokenSet' },
    { a: 'Kerrygold butter', b: 'butter', bridgedBy: 'ranking (U5/U6)', bridgedAt: 'head' },
];

describe('representative typed ingredient names', () => {
    it.each(CORPUS)('normalizes $typed as measured today', ({ typed, sanitized, key }) => {
        expect(sanitizeFoodName(typed)).toBe(sanitized);
        expect(normalizedIngredientKey(typed)).toBe(key);
    });

    it.each(HANDOFFS)('keeps $a and $b on different keys, bridged by $bridgedBy', ({ a, b }) => {
        // The key is an exact-match grain. Collapsing these INTO it would merge foods that are genuinely
        // distinct elsewhere in the catalog, so the difference is preserved and handed to a ranking tier.
        // ⛔ This stays true AFTER U5/U6: the ranking folds these for COMPARISON, never into the identity.
        expect(normalizedIngredientKey(a)).not.toBe(normalizedIngredientKey(b));
    });

    it.each(HANDOFFS)('ranking bridges $a to $b at the $bridgedAt rung (U5/U6)', ({ a, b, bridgedAt }) => {
        // The measured half of the handoff. Before U5 this file could only record which tier was EXPECTED
        // to bridge a difference; now the tiers exist, so the expectation is executable and a regression in
        // the fold, the plural rule or the head rule fails here as well as in the two services.
        expect(classifyRankTier(describeRankingName(b), describeRankingQuery(a))).toBe(bridgedAt);
        expect(bridgedAt).not.toBe('base');
    });

    it('⛔ bridges the BRAND to the generic food, which is not the same as representing the brand', () => {
        // `Kerrygold butter` reaching `butter` is the right fallback for a cook and closes what the earlier
        // `nothing yet` meant. It does NOT make Kerrygold a thing the catalog knows about — that is U2's
        // `additionalDescriptions` aliases, and no rung can invent it. The bridge landing on `head` rather
        // than `exact` is what keeps the two facts apart, so this assertion is the residual gap's record.
        const brand = HANDOFFS.find((handoff) => handoff.a === 'Kerrygold butter');

        expect(brand?.bridgedAt).toBe('head');
        expect(normalizedIngredientKey('Kerrygold butter')).not.toBe(normalizedIngredientKey('butter'));
    });

    it('never lets a typed name become an empty key', () => {
        // An empty-string key would collide every unnameable input into one catalog identity.
        const keys = CORPUS.map((entry) => entry.key);

        expect(keys.filter((key) => key === '')).toEqual([]);
    });
});
