/**
 * Unit tests for the shared unit normalization + gram conversion ({@link normalizeUnit}, {@link unitToGrams}).
 */
import { describe, it, expect } from 'vitest';

import {
    classifyUnit,
    normalizeUnit,
    unitToGrams,
    MASS_UNIT_TO_GRAMS,
    SUBJECTIVE_UNIT_VOCABULARY,
    UNIT_VOCABULARY,
} from '../units.js';

describe('normalizeUnit', () => {
    it('maps aliases + abbreviations to a canonical unit', () => {
        expect(normalizeUnit('grams')).toBe('g');
        expect(normalizeUnit('Kg')).toBe('kg');
        expect(normalizeUnit('Tbsp.')).toBe('tablespoon');
        expect(normalizeUnit('tsp')).toBe('teaspoon');
        expect(normalizeUnit('Cups')).toBe('cup');
        expect(normalizeUnit('cloves')).toBe('clove');
        expect(normalizeUnit('lbs')).toBe('lb');
    });

    it('de-pluralizes an unknown unit but leaves a known singular alone', () => {
        expect(normalizeUnit('carrots')).toBe('carrot');
        expect(normalizeUnit('cup')).toBe('cup');
    });

    /**
     * R31 — the `*ful` family. A 1900s cookbook writes `teaspoonful` where a modern one writes `teaspoon`,
     * and the de-pluralization fallback above cannot reach it: `teaspoonful` has no trailing `s`, so it
     * normalized to ITSELF and matched no portion, silently costing the line its gram conversion.
     */
    describe('the *ful family (R31)', () => {
        it.each([
            ['teaspoonful', 'teaspoon'],
            ['teaspoonfuls', 'teaspoon'],
            ['Teaspoonful.', 'teaspoon'],
            ['tablespoonful', 'tablespoon'],
            ['tablespoonfuls', 'tablespoon'],
            ['cupful', 'cup'],
            ['cupfuls', 'cup'],
        ])('normalizes %j to %j', (raw, canonical) => {
            expect(normalizeUnit(raw)).toBe(canonical);
        });

        it('converts a *ful line to grams through the SAME portion table a modern unit uses (R31)', () => {
            const portions = [{ unit: 'teaspoon', gramsPerUnit: 6 }];

            expect(unitToGrams(1, 'teaspoonful', portions)).toBe(6);
            expect(unitToGrams(2, 'tablespoonfuls', [{ unit: 'tablespoon', gramsPerUnit: 8 }])).toBe(16);
        });

        it('leaves a word that merely ENDS in "ful" alone, because it is not a measure', () => {
            expect(normalizeUnit('handful')).toBe('handful');
            expect(normalizeUnit('careful')).toBe('careful');
        });
    });

    /**
     * R32 — the historical volume units. A period cookbook writes `wineglassful`, `gill`, `saltspoon` and
     * `dessertspoon`, and each of those has a DEFINED amount (its own book's table of weights and measures,
     * or the named external standard for a unit that book leaves undefined).
     *
     * Canonicalising the spelling is what makes the equivalence LOOKUPABLE at all: `wineglassful` has no
     * trailing `s`, so the de-pluralization fallback leaves it as itself and no equivalence table keyed on
     * `wineglass` can ever be reached. This is the same defect R31 fixed for `teaspoonful`, one book older.
     */
    describe('historical volume units (R32)', () => {
        it.each([
            ['gill', 'gill'],
            ['gills', 'gill'],
            ['Gills.', 'gill'],
            ['wineglass', 'wineglass'],
            ['wineglasses', 'wineglass'],
            ['wineglassful', 'wineglass'],
            ['wineglassfuls', 'wineglass'],
            ['wine-glass', 'wineglass'],
            ['wine-glassful', 'wineglass'],
            ['saltspoon', 'saltspoon'],
            ['saltspoons', 'saltspoon'],
            ['saltspoonful', 'saltspoon'],
            ['saltspoonfuls', 'saltspoon'],
            ['dessertspoon', 'dessertspoon'],
            ['dessertspoons', 'dessertspoon'],
            ['dessertspoonful', 'dessertspoon'],
            ['dessertspoonfuls', 'dessertspoon'],
            ['dessert-spoon', 'dessertspoon'],
        ])('normalizes %j to %j', (raw, canonical) => {
            expect(normalizeUnit(raw)).toBe(canonical);
        });

        /**
         * ⛔ The boundary the R31 comment drew, redrawn rather than erased. `wineglassful` names a defined
         * amount and is now in `UNIT_ALIASES`; `glassful` and `handful` still name NO defined amount.
         *
         * ⚠️ REWRITTEN FOR U25, and the assertion is unchanged BECAUSE the invariant is unchanged. These
         * words now live in `SUBJECTIVE_UNIT_ALIASES`, which canonicalises their SPELLING and nothing else,
         * so each still normalizes to itself and `unitToGrams` still refuses to put a number on it (see the
         * subjective-unit suite below). What R40 forbids is inventing a QUANTITY the source never stated;
         * knowing how a word is spelled invents nothing.
         */
        it('still leaves the *ful words that name no defined amount alone', () => {
            expect(normalizeUnit('glassful')).toBe('glassful');
            expect(normalizeUnit('handful')).toBe('handful');
            expect(normalizeUnit('spoonful')).toBe('spoonful');
        });

        /**
         * ⚠️ A historical unit has NO ingredient-independent gram weight, and none is invented here. The
         * importer restates it in a canonical unit the food catalog's household portions cover (see
         * `@kitchensink/cookbook-import`'s `unitEquivalence.ts`) BEFORE a gram conversion is attempted.
         */
        it('does not fabricate a gram weight for a historical unit', () => {
            expect(unitToGrams(1, 'gill', [{ unit: 'cup', gramsPerUnit: 240 }])).toBeNull();
            expect(unitToGrams(1, 'wineglassful', [{ unit: 'cup', gramsPerUnit: 240 }])).toBeNull();
        });
    });
});

describe('unitToGrams', () => {
    it('converts mass units by exact factor (ingredient-independent)', () => {
        expect(unitToGrams(200, 'g')).toBe(200);
        expect(unitToGrams(1, 'kg')).toBe(1000);
        expect(unitToGrams(1, 'oz')).toBeCloseTo(28.3495, 4);
    });

    it('converts a volumetric/count unit via a matching portion (grams-per-unit)', () => {
        const portions = [
            { unit: 'cup', gramsPerUnit: 125 },
            { unit: 'tablespoon', gramsPerUnit: 8 },
        ];

        expect(unitToGrams(2, 'cups', portions)).toBe(250); // alias 'cups' → 'cup' → 125 × 2
        expect(unitToGrams(3, 'Tbsp', portions)).toBe(24); // 'Tbsp' → 'tablespoon' → 8 × 3
    });

    it('returns null when the unit is neither a mass unit nor covered by a portion', () => {
        expect(unitToGrams(2, 'cup', [])).toBeNull();
        expect(unitToGrams(1, 'clove')).toBeNull();
    });
});

/**
 * U25 — THE UNIT VOCABULARY AND THE THREE-WAY CLASSIFICATION.
 *
 * ⛔ The vocabulary is the DERIVED IMAGE of {@link normalizeUnit}'s own alias table, never a second
 * hand-written list — "a copy of a list cannot detect that the list is incomplete" (plan U25). These tests
 * assert the DERIVATION rather than its contents, so a word added to the table is in the vocabulary the
 * moment it is added and nobody has to remember a second file.
 *
 * ⚠️ The three-way classification is what the plan's "the wire can tell `cup` from `handful`" asks for, and
 * it is a DERIVATION rather than a wire field — see {@link classifyUnit}'s own docstring for that ruling.
 */
describe('U25 — the unit vocabulary', () => {
    it('is non-empty and every member is its own canonical form (it IS the normalizer’s image)', () => {
        // Anti-vacuity: a derivation that silently stopped finding entries would otherwise pass by
        // producing nothing. The table has carried well over twenty canonical units since R32.
        expect(UNIT_VOCABULARY.length).toBeGreaterThanOrEqual(20);

        for (const unit of UNIT_VOCABULARY) {
            expect(normalizeUnit(unit)).toBe(unit);
        }
    });

    it('contains no duplicates and is stably ordered', () => {
        expect([...new Set(UNIT_VOCABULARY)]).toEqual([...UNIT_VOCABULARY]);
        expect([...UNIT_VOCABULARY].sort()).toEqual([...UNIT_VOCABULARY]);
    });

    it('every alias the normalizer knows lands INSIDE the vocabulary', () => {
        // A spot-check across each family the table carries — mass, volume, historical, count. If any of
        // these normalized to something the vocabulary does not hold, the two would have drifted.
        for (const alias of ['grams', 'Kg', 'Tbsp.', 'cups', 'lbs', 'cloves', 'wineglassful', 'millilitres']) {
            expect(UNIT_VOCABULARY).toContain(normalizeUnit(alias));
        }
    });

    it('the two vocabularies are DISJOINT — a word names an amount or it does not, never both', () => {
        const canonical = new Set(UNIT_VOCABULARY);

        for (const subjective of SUBJECTIVE_UNIT_VOCABULARY) {
            expect(canonical.has(subjective)).toBe(false);
        }

        expect(SUBJECTIVE_UNIT_VOCABULARY.length).toBeGreaterThanOrEqual(5);
    });
});

describe('U25 — classifyUnit', () => {
    it('calls every member of each vocabulary by its own kind', () => {
        for (const unit of UNIT_VOCABULARY) {
            expect(classifyUnit(unit)).toBe('canonical');
        }

        for (const unit of SUBJECTIVE_UNIT_VOCABULARY) {
            expect(classifyUnit(unit)).toBe('subjective');
        }
    });

    it.each([
        ['cup', 'canonical'],
        ['Cups', 'canonical'],
        ['Tbsp.', 'canonical'],
        ['ml', 'canonical'],
        ['millilitres', 'canonical'],
        ['handful', 'subjective'],
        ['Handfuls', 'subjective'],
        ['splashes', 'subjective'],
        ['to taste', 'subjective'],
        ['To Taste.', 'subjective'],
        ['carrots', 'unknown'],
        ['blorp', 'unknown'],
        ['', 'unknown'],
        ['   ', 'unknown'],
    ] as const)('classifies %j as %s', (raw, kind) => {
        expect(classifyUnit(raw)).toBe(kind);
    });

    it('NEVER throws, whatever it is handed — an unknown unit is accepted, never rejected', () => {
        for (const raw of ['🍰', ' ', 'a'.repeat(5000), '...', 's']) {
            expect(() => classifyUnit(raw)).not.toThrow();
            expect(['canonical', 'subjective', 'unknown']).toContain(classifyUnit(raw));
        }
    });
});

/**
 * U25 — the SUBJECTIVE table, and the boundary R31/R40 drew, redrawn rather than erased.
 *
 * R31's comment excluded `handful`, `spoonful` and `glassful` from `UNIT_ALIASES` because they "genuinely
 * name no amount and supplying one would invent a quantity the source never stated". That reasoning STANDS,
 * and these tests are what hold it: the words now live in a table of their own, so their SPELLING can be
 * canonicalised (exactly what R32's comment says is "all that happens here" for a historical unit), while
 * `unitToGrams` still refuses to put a number on any of them.
 */
describe('U25 — subjective units name no amount, and none is invented for them', () => {
    it.each([
        ['handful', 'handful'],
        ['handfuls', 'handful'],
        ['Handful.', 'handful'],
        ['spoonful', 'spoonful'],
        ['spoonfuls', 'spoonful'],
        ['glassful', 'glassful'],
        ['splash', 'splash'],
        // ⛔ The naive de-pluralization fallback reads this as `splashe`, which is why the table is needed
        // for the SPELLING and not only for the classification.
        ['splashes', 'splash'],
        ['drizzle', 'drizzle'],
        ['knobs', 'knob'],
        ['to taste', 'to taste'],
        ['as needed', 'as needed'],
    ])('normalizes %j to %j', (raw, canonical) => {
        expect(normalizeUnit(raw)).toBe(canonical);
    });

    it('never converts to grams — R40 stands, and canonicalising a spelling does not weaken it', () => {
        for (const unit of SUBJECTIVE_UNIT_VOCABULARY) {
            expect(unitToGrams(1, unit)).toBeNull();
        }
    });
});

/**
 * U25 — the volume families the derivation EXPOSED as missing.
 *
 * ⚠️ Deriving the vocabulary from the table is what made this visible: the table carried `cup`,
 * `tablespoon` and `teaspoon` and no metric volume at all, so a vocabulary shipped off it would have called
 * `ml` unrecognised — the commonest unit in half the world's recipes.
 *
 * ⛔ And the British spellings were a live DEFECT, not a cosmetic gap. `millilitresPerUnit`
 * (`@kitchensink/recipe-import-core`) feeds `normalizeUnit`'s output to `parse-ingredient`'s `convertUnit`,
 * which was measured 2026-08-25 to answer `null` for `millilitre` and `litre` while answering for
 * `milliliter` and `liter`. Canonicalising onto the American spelling is what makes a British source
 * convertible at all — and it is why the canonical forms here are the SPELLED-OUT words, matching `cup` /
 * `tablespoon` / `teaspoon`, rather than the abbreviations the MASS family uses.
 *
 * ⛔ `fl oz` maps to `fluid ounce` and NEVER to `oz`: `oz` is a key of {@link MASS_UNIT_TO_GRAMS}, so that
 * alias would silently weigh a volume as a mass.
 */
describe('U25 — the metric and imperial volume families', () => {
    it.each([
        ['ml', 'milliliter'],
        ['mL', 'milliliter'],
        ['milliliters', 'milliliter'],
        ['millilitre', 'milliliter'],
        ['millilitres', 'milliliter'],
        ['l', 'liter'],
        ['liters', 'liter'],
        ['litre', 'liter'],
        ['litres', 'liter'],
        ['pints', 'pint'],
        ['quarts', 'quart'],
        ['gallons', 'gallon'],
        ['fl oz', 'fluid ounce'],
        ['floz', 'fluid ounce'],
        ['fluid ounces', 'fluid ounce'],
    ])('normalizes %j to %j', (raw, canonical) => {
        expect(normalizeUnit(raw)).toBe(canonical);
    });

    it('keeps a FLUID ounce apart from a mass ounce', () => {
        expect(normalizeUnit('fl oz')).not.toBe(normalizeUnit('oz'));
        expect(unitToGrams(1, 'fl oz')).toBeNull();
        expect(unitToGrams(1, 'oz')).toBeCloseTo(28.3495, 4);
        expect(MASS_UNIT_TO_GRAMS[normalizeUnit('fl oz')]).toBeUndefined();
    });

    it('does not fabricate a gram weight for a volume — that comes from the food’s own portion', () => {
        expect(unitToGrams(1, 'ml')).toBeNull();
        expect(unitToGrams(2, 'liters', [{ unit: 'liter', gramsPerUnit: 1000 }])).toBe(2000);
    });
});
