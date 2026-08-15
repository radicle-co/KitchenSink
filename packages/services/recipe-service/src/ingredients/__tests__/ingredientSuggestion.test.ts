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

        it('keeps a freeform local row and a same-named catalog hit as two DISTINCT suggestions', () => {
            // Deliberate: dedup is on `food_id` (Stage 2's locked rule), and these are genuinely different
            // things — the user's own nutrition-less row vs the golden record. Provenance sections + badges
            // are what disambiguate them for the reader.
            const local = [makeIngredient({ id: 'ing-1', name: 'Chicken breast', isUserEntered: true })];
            const catalogHits = [makeCatalogHit({ foodId: 'food-1', name: 'Chicken breast' })];

            const blended = blendIngredientSuggestions({ local, promoted: [], catalogHits, limit: 10 });

            expect(blended).toHaveLength(2);
            expect(blended.map((s) => s.provenance)).toEqual(['local', 'catalog']);
        });

        it('ignores local rows that carry no food link when deduping', () => {
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
            const local = [makeIngredient({ id: 'ing-1' }), makeIngredient({ id: 'ing-2' })];
            const promoted = [makeIngredient({ id: 'ing-9', foodId: 'food-1' })];
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
