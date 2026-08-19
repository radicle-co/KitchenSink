/**
 * Stage-2 — unit tests for the PURE blend/dedup/section reduction (`ingredientSuggestion.ts`).
 *
 * This is where the Stage-2 invariant lives, so it is pinned here rather than inside the service's I/O
 * orchestration: **a food that already has an `ingredients` row appears exactly once**, in the familiar
 * ("local") section, never also as a catalog hit. Written before the module existed (TDD red → green).
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { blendIngredientSuggestions } from '../ingredientSuggestion.js';
import type { CatalogHit } from '../ingredientSuggestion.js';
import { makeIngredient } from '../__fixtures__/ingredients.fixtures.js';

/** A catalog hit with overridable fields. */
function makeCatalogHit(overrides: Partial<CatalogHit> = {}): CatalogHit {
    return { foodId: 'food-1', name: 'Chicken breast', score: 0.9, ...overrides };
}

describe('blendIngredientSuggestions', () => {
    it('returns nothing when there is nothing to blend', () => {
        expect(blendIngredientSuggestions({ local: [], promoted: [], catalogHits: [], limit: 10 })).toEqual([]);
    });

    it('sections local before catalog and never interleaves them (no reorder jank)', () => {
        const local = [makeIngredient({ id: 'ing-1', name: 'Zucchini' })];
        const catalogHits = [makeCatalogHit({ foodId: 'food-1', name: 'Apple', score: 0.99 })];

        const blended = blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 10 });

        // The catalog hit outscores the local row alphabetically AND by score, yet local still comes first.
        expect(blended).toEqual([
            { provenance: 'local', ingredient: local[0] },
            { provenance: 'catalog', foodId: 'food-1', name: 'Apple', score: 0.99 },
        ]);
    });

    it('preserves the local section order it was given (the DAL/ranking decided it)', () => {
        const local = [makeIngredient({ id: 'ing-b', name: 'Bravo' }), makeIngredient({ id: 'ing-a', name: 'Alpha' })];

        const blended = blendIngredientSuggestions({ local, promoted: [], catalogHits: [], limit: 10 });

        expect(blended.map((s) => (s.provenance === 'local' ? s.ingredient.id : s.foodId))).toEqual(['ing-b', 'ing-a']);
    });

    it('preserves the catalog section order it was given (the gateway already ranked it)', () => {
        const catalogHits = [
            makeCatalogHit({ foodId: 'food-hi', score: 0.9 }),
            makeCatalogHit({ foodId: 'food-lo', score: 0.1 }),
        ];

        const blended = blendIngredientSuggestions({ local: [], promoted: [], catalogHits, limit: 10 });

        expect(blended.map((s) => (s.provenance === 'catalog' ? s.foodId : null))).toEqual(['food-hi', 'food-lo']);
    });

    describe('dedup — a food with an existing ingredients row appears ONCE', () => {
        it('drops the catalog hit when the local search already returned that food-backed row', () => {
            const local = [makeIngredient({ id: 'ing-1', name: 'Chicken breast', foodId: 'food-1' })];
            const catalogHits = [makeCatalogHit({ foodId: 'food-1', name: 'Chicken breast, raw' })];

            const blended = blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 10 });

            expect(blended).toHaveLength(1);
            expect(blended[0]).toEqual({ provenance: 'local', ingredient: local[0] });
        });

        it('PROMOTES a food-backed row the local text search missed into the local section', () => {
            // The recipe-local FTS/trgm query did not match, but food-service did — and an `ingredients`
            // row for that food already exists. It must surface as the familiar row (with its nutrition),
            // not as a catalog hit that would need a round-trip to admit.
            const promoted = [
                makeIngredient({
                    id: 'ing-9',
                    name: 'Chicken breast',
                    foodId: 'food-1',
                    caloriesPer100g: 165,
                    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                }),
            ];
            const catalogHits = [makeCatalogHit({ foodId: 'food-1' })];

            const blended = blendIngredientSuggestions({ local: [], promoted, catalogHits, limit: 10 });

            expect(blended).toEqual([{ provenance: 'local', ingredient: promoted[0] }]);
        });

        it('orders promoted rows AFTER the local text-search hits', () => {
            const local = [makeIngredient({ id: 'ing-1', name: 'Zzz local' })];
            const promoted = [makeIngredient({ id: 'ing-9', name: 'Aaa promoted', foodId: 'food-1' })];
            const catalogHits = [makeCatalogHit({ foodId: 'food-1' })];

            const blended = blendIngredientSuggestions({ local, promoted, catalogHits, limit: 10 });

            expect(blended.map((s) => (s.provenance === 'local' ? s.ingredient.id : s.foodId))).toEqual([
                'ing-1',
                'ing-9',
            ]);
        });

        it('orders multiple promoted rows by their catalog score (best first)', () => {
            const promoted = [
                makeIngredient({ id: 'ing-lo', name: 'Low', foodId: 'food-lo' }),
                makeIngredient({ id: 'ing-hi', name: 'High', foodId: 'food-hi' }),
            ];
            const catalogHits = [
                makeCatalogHit({ foodId: 'food-hi', score: 0.9 }),
                makeCatalogHit({ foodId: 'food-lo', score: 0.1 }),
            ];

            const blended = blendIngredientSuggestions({ local: [], promoted, catalogHits, limit: 10 });

            expect(blended.map((s) => (s.provenance === 'local' ? s.ingredient.id : s.foodId))).toEqual([
                'ing-hi',
                'ing-lo',
            ]);
        });

        it('never duplicates a row that appears in BOTH local and promoted', () => {
            const row = makeIngredient({ id: 'ing-1', name: 'Chicken breast', foodId: 'food-1' });

            const blended = blendIngredientSuggestions({
                local: [row],
                promoted: [row],
                catalogHits: [makeCatalogHit({ foodId: 'food-1' })],
                limit: 10,
            });

            expect(blended).toEqual([{ provenance: 'local', ingredient: row }]);
        });

        it('REPLACES a same-named freeform local row with the catalog hit', () => {
            // ⛔ REWRITTEN 2026-08-19, and it asserts the OPPOSITE of what it used to. It previously read
            // "keeps … as two DISTINCT suggestions", arguing that dedup is on `food_id` and that the user's
            // nutrition-less row and the golden record are genuinely different things which sections and
            // badges disambiguate.
            //
            // The owner reversed that after it was MEASURED: importing 338 public-domain recipes through the
            // app's own resolution path produced 268 lines with no food record, and all 268 were pre-existing
            // freeform rows. Offering both means whoever takes the top suggestion gets the one with no
            // nutrition — permanently, since the freeform row then exists forever. Ruling: a catalog match
            // wins.
            //
            // Coverage of the ORIGINAL concern did not go away: that a freeform row and a catalog hit are
            // structurally different things is still proved by the discriminated union and by
            // 'keeps a freeform row whose name is genuinely different', which shows a non-colliding freeform
            // row surviving alongside the catalog section.
            const local = [makeIngredient({ id: 'ing-1', name: 'Chicken breast', isUserEntered: true })];
            const catalogHits = [makeCatalogHit({ foodId: 'food-1', name: 'Chicken breast' })];

            const blended = blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 10 });

            expect(blended).toHaveLength(1);
            expect(blended.map((s) => s.provenance)).toEqual(['catalog']);
        });

        it('ignores local rows that carry no food link when deduping', () => {
            // The name deliberately does NOT collide with the catalog hit's, so this exercises `food_id`
            // dedup alone rather than the name-collision rule tested above.
            const local = [makeIngredient({ id: 'ing-1', name: 'Freeform' })];
            const catalogHits = [makeCatalogHit({ foodId: 'food-1' })];

            expect(blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 10 })).toHaveLength(2);
        });
    });

    describe('per-section limit', () => {
        it('caps the local section at the limit', () => {
            const local = [1, 2, 3].map((n) => makeIngredient({ id: `ing-${n}`, name: `Local ${n}` }));

            const blended = blendIngredientSuggestions({ local, promoted: [], catalogHits: [], limit: 2 });

            expect(blended).toHaveLength(2);
        });

        it('caps the catalog section at the limit independently of the local section', () => {
            const local = [makeIngredient({ id: 'ing-1' })];
            const catalogHits = [1, 2, 3].map((n) => makeCatalogHit({ foodId: `food-${n}`, name: `Catalog ${n}` }));

            const blended = blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 2 });

            // 1 local (under its own cap) + 2 catalog (capped) — the sections are capped separately so a
            // full local section can never squeeze the catalog section out of existence.
            expect(blended.filter((s) => s.provenance === 'local')).toHaveLength(1);
            expect(blended.filter((s) => s.provenance === 'catalog')).toHaveLength(2);
        });

        it('counts promoted rows against the local cap', () => {
            // ⚠️ DISTINCT NAMES ON PURPOSE. `makeIngredient` defaults every row to 'All-purpose flour', so
            // leaving them shared would make this CAP test incidentally exercise the catalog-beats-freeform
            // rule instead — the promoted row would suppress both freeform rows and the assertion below
            // would be measuring the wrong thing. That rule has its own tests; this one is about the cap.
            const local = [
                makeIngredient({ id: 'ing-1', name: 'Rye flour' }),
                makeIngredient({ id: 'ing-2', name: 'Spelt flour' }),
            ];
            const promoted = [makeIngredient({ id: 'ing-9', name: 'Oat flour', foodId: 'food-1' })];
            const catalogHits = [makeCatalogHit({ foodId: 'food-1' })];

            const blended = blendIngredientSuggestions({ local, promoted, catalogHits, limit: 2 });

            // The promoted row is squeezed out by the cap — and its catalog hit stays suppressed, so the
            // food does not reappear under a different provenance. Bounded, never duplicated.
            expect(blended).toHaveLength(2);
            expect(blended.map((s) => (s.provenance === 'local' ? s.ingredient.id : s.foodId))).toEqual([
                'ing-1',
                'ing-2',
            ]);
        });

        it('returns nothing for a non-positive limit', () => {
            const local = [makeIngredient({ id: 'ing-1' })];
            const catalogHits = [makeCatalogHit()];

            expect(blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 0 })).toEqual([]);
        });
    });

    it('does not mutate its inputs (pure)', () => {
        const local = [makeIngredient({ id: 'ing-b', name: 'Bravo' }), makeIngredient({ id: 'ing-a', name: 'Alpha' })];
        const catalogHits = [makeCatalogHit({ foodId: 'food-b' }), makeCatalogHit({ foodId: 'food-a' })];
        const localBefore = [...local];
        const hitsBefore = [...catalogHits];

        blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 10 });

        expect(local).toEqual(localBefore);
        expect(catalogHits).toEqual(hitsBefore);
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for "a catalog match wins over a freeform row of the same name" — an owner
 * ruling (2026-08-19) that reverses one consequence of "section, don't blend".
 *
 * ## The defect, measured rather than theorised
 *
 * Importing 338 public-domain recipes through the app's OWN resolution path produced 268 ingredient lines
 * with no food record — and ALL 268 were pre-existing FREEFORM rows, "Butter" alone accounting for 138. Not
 * one name failed for any other reason. The database showed why: three ingredients matched `butter%`, and
 * TWO of them already carried a `food_id`. A catalog-backed butter existed and lost every time.
 *
 * The mechanism is this reduction. Dedup is by `food_id` (`linkedFoodIds`), and a freeform row HAS no
 * `food_id`, so it contributes nothing to that set — both rows survive, and the freeform one wins purely
 * because the local section renders first. Anyone taking the top suggestion (a hurried human, or an importer
 * behaving like one) gets the row with no nutrition. Permanently: once "butter" exists as freeform, butter
 * can never acquire USDA nutrition for anyone.
 *
 * ## What is preserved, deliberately
 *
 * "Section, don't blend" is an ANTI-JANK layout guarantee, not a ranking preference — the local section is
 * still never reordered or interleaved. This suppresses a freeform row only when a REAL catalog alternative
 * is actually on screen, so the sections keep their shape and nothing reflows.
 *
 * ## Why suppression is gated on the RENDERED catalog section
 *
 * The catalog section is capped by `limit`. Suppressing a freeform row against a hit that then gets sliced
 * away would leave the user with NEITHER — a worse outcome than the bug. So the cap is applied first and the
 * suppression reads only what survives it.
 */
describe('blendIngredientSuggestions — a catalog match beats a freeform row of the same name', () => {
    it('⛔ suppresses the freeform row when a catalog hit carries the same name', () => {
        // The measured case: 138 recipe lines took this branch and got no nutrition.
        const result = blendIngredientSuggestions({
            local: [makeIngredient({ id: 'ing-freeform', name: 'Butter', foodId: undefined })],
            promoted: [],
            catalogHits: [{ foodId: 'food-butter', name: 'Butter', score: 9 }],
            limit: 10,
        });

        expect(result.filter((s) => s.provenance === 'local')).toHaveLength(0);
        expect(result.map((s) => (s.provenance === 'catalog' ? s.foodId : s.ingredient.id))).toStrictEqual([
            'food-butter',
        ]);
    });

    it('matches on a normalized name — case and surrounding whitespace do not rescue the shadow', () => {
        const result = blendIngredientSuggestions({
            local: [makeIngredient({ id: 'ing-freeform', name: '  BUTTER ', foodId: undefined })],
            promoted: [],
            catalogHits: [{ foodId: 'food-butter', name: 'Butter', score: 9 }],
            limit: 10,
        });

        expect(result.every((s) => s.provenance === 'catalog')).toBe(true);
    });

    it('keeps a freeform row whose name is genuinely different', () => {
        // Suppression must be a name COLLISION, not "a catalog hit exists". A cook's own blend is not butter.
        const result = blendIngredientSuggestions({
            local: [makeIngredient({ id: 'ing-blend', name: "Grandma's browned butter blend", foodId: undefined })],
            promoted: [],
            catalogHits: [{ foodId: 'food-butter', name: 'Butter', score: 9 }],
            limit: 10,
        });

        expect(result.filter((s) => s.provenance === 'local')).toHaveLength(1);
    });

    it('⛔ KEEPS SUPPRESSING once the food has a local row — the fix must not defeat itself', () => {
        // The bug my first attempt shipped. `linkedFoodIds` deliberately drops a catalog hit whose food
        // already has a local row, so reading the CATALOG SECTION alone meant the first caller to benefit
        // admitted that row, the hit vanished, its name left the suppression set, and the freeform row
        // shadowed everything afterwards — permanently. Observed live three seconds apart in a 448-recipe
        // run: `Honey` resolved for one recipe and went freeform for the next.
        const result = blendIngredientSuggestions({
            local: [
                makeIngredient({ id: 'ing-freeform', name: 'Honey', foodId: undefined }),
                makeIngredient({ id: 'ing-linked', name: 'Honey', foodId: 'food-honey' }),
            ],
            promoted: [],
            // Filtered out of the catalog section by `linkedFoodIds` — exactly the condition that broke it.
            catalogHits: [{ foodId: 'food-honey', name: 'Honey', score: 9 }],
            limit: 10,
        });

        expect(result.map((s) => (s.provenance === 'local' ? s.ingredient.id : s.foodId))).toStrictEqual([
            'ing-linked',
        ]);
    });

    it('⛔ rescues the freeform row when its food-backed twin is beyond the cap', () => {
        // The other half of the guard: suppression is only justified while the replacement is ON SCREEN.
        // Here the twin sits past `limit` and its catalog hit is filtered out as already-linked, so
        // suppressing would leave the reader with NEITHER — worse than the shadowing being fixed.
        const result = blendIngredientSuggestions({
            local: [
                makeIngredient({ id: 'ing-a', name: 'Alpha', foodId: 'food-a' }),
                makeIngredient({ id: 'ing-freeform', name: 'Honey', foodId: undefined }),
                makeIngredient({ id: 'ing-linked', name: 'Honey', foodId: 'food-honey' }),
            ],
            promoted: [],
            catalogHits: [{ foodId: 'food-honey', name: 'Honey', score: 9 }],
            limit: 2,
        });

        expect(result.some((s) => s.provenance === 'local' && s.ingredient.name === 'Honey')).toBe(true);
    });

    it('⛔ keeps the freeform row when the colliding hit is CAPPED AWAY — never leave the user with neither', () => {
        // limit 1 renders one catalog hit; the butter hit is second and never appears, so suppressing the
        // freeform row against it would remove the only usable option.
        const result = blendIngredientSuggestions({
            local: [makeIngredient({ id: 'ing-freeform', name: 'Butter', foodId: undefined })],
            promoted: [],
            catalogHits: [
                { foodId: 'food-other', name: 'Buttermilk', score: 9 },
                { foodId: 'food-butter', name: 'Butter', score: 8 },
            ],
            limit: 1,
        });

        expect(result.filter((s) => s.provenance === 'local')).toHaveLength(1);
    });

    it('leaves a catalog-BACKED local row alone — food_id dedup already owns that case', () => {
        // The pre-existing rule: a local row that already links the food suppresses the catalog hit, not the
        // other way round. Picking it needs no admission round-trip, so it is the better option.
        const result = blendIngredientSuggestions({
            local: [makeIngredient({ id: 'ing-linked', name: 'Butter', foodId: 'food-butter' })],
            promoted: [],
            catalogHits: [{ foodId: 'food-butter', name: 'Butter', score: 9 }],
            limit: 10,
        });

        expect(result).toHaveLength(1);
        expect(result[0]?.provenance).toBe('local');
    });
});
