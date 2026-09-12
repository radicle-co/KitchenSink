// @vitest-environment node
/**
 * Unit tests for {@link nutritionEntryFor} — the ONE answer to "what does a nutrition entry say about a
 * food", shared by the shared (edge-cached) batch and the per-caller authored batch.
 *
 * ## What this pins, and why it is a function rather than two inline blocks
 *
 * The projection was written twice, ~25 lines each, in `FoodsService.getNutritionBatch` and
 * `FoodsService.getAuthoredNutritionBatch`. That was tolerable while both said the same thing. It stopped
 * being tolerable the moment ONE of them had to withhold macros: two copies of a rule mean the withholding
 * can be added to one and forgotten in the other, and the forgotten one is the shared, edge-CACHED path.
 *
 * ## ⛔ The withholding rule (owner ruling 6, 2026-09-07): "we don't want the macros to return"
 *
 * A withdrawn food reports its STATUS and no numbers. The accepted consequence is stated so it is a decision
 * and not a surprise: **a recipe's nutrition total changes on the day a food is withdrawn** — the line stops
 * counting and `isComplete` flips false. The retained row buys the FACT and the DATE, not the figures.
 *
 * ⛔ **The entry is RETURNED, not omitted.** Dropping the food would put its id in `unknownIds`, which
 * already means two things ("no such row" and "an authored id you do not own" — `readAuthoredNutritionBatch`
 * is caller-scoped) and would collapse a THIRD, distinguishable fact into that bucket. Recipe-service learns
 * a food was withdrawn from exactly this `status` field; there is no other channel. This is the same
 * discrimination ADR-0026 §3 protects one service over: absence is not dissent.
 *
 * ⛔ **Portions go too, and that is deliberate.** A portion (`"1 cup" = 240 g`) is a nutritional statement
 * about the substance. Returning portions while withholding macros would let a caller convert the line to
 * grams for a food we are declining to describe. The line's own quantity and unit come from
 * `recipe_ingredients`, never from here, so nothing a cook reads is lost.
 *
 * ⛔ **`DELETING` never reaches here.** It is store-internal (`publishableStatusOf` throws on it), and the
 * two are NOT interchangeable: `DELETING` is in-flight and reverts to `RESOLVED` mid-erasure, so publishing
 * it as a removal would assert a terminal fact about a state that is about to un-happen. The callers filter
 * it before this function sees it; the assertion here is that the function refuses it rather than guessing.
 *
 * DESIGN PATTERN: Pure projection over a stored record — total, table-testable, and unaware of Nest, the
 * DAO and HTTP.
 */
import { describe, expect, it } from 'vitest';

import type { NutritionRecord } from '../../dao/food.dao.js';
import { nutritionEntryFor } from '../nutritionEntry.js';

/** A record with a full macro set and one portion, so withholding is VISIBLE rather than vacuously true. */
function record(overrides: Partial<NutritionRecord> = {}): NutritionRecord {
    return {
        id: 'F-1',
        status: 'RESOLVED',
        nutrients: [
            { nutrient: 'Energy', amount: '52', unit: 'kcal', basis: 'per_100g' },
            { nutrient: 'Protein', amount: '0.3', unit: 'g', basis: 'per_100g' },
            { nutrient: 'Carbohydrate, by difference', amount: '13.8', unit: 'g', basis: 'per_100g' },
            { nutrient: 'Total lipid (fat)', amount: '0.2', unit: 'g', basis: 'per_100g' },
        ],
        // A label `normalizePortions` can actually parse — it needs a leading AMOUNT token, since it
        // answers grams per ONE unit. `'cup, sliced'` states no amount and normalizes to nothing.
        portions: [{ label: '1 cup', gramWeight: '109' }],
        ...overrides,
    };
}

describe('nutritionEntryFor — a food that is not withdrawn', () => {
    it('projects the macros and the normalized portions', () => {
        const entry = nutritionEntryFor('F-1', record());

        expect(entry).toMatchObject({
            id: 'F-1',
            status: 'RESOLVED',
            caloriesPer100g: 52,
            proteinGPer100g: 0.3,
            carbsGPer100g: 13.8,
            fatGPer100g: 0.2,
        });
        expect(entry.portions).toEqual([{ unit: 'cup', gramsPerUnit: 109 }]);
    });

    it('reports a non-RESOLVED status with whatever it has, rather than withholding', () => {
        // The projection runs regardless of status: a PENDING food reports PENDING with (usually) no
        // nutrients. Only a WITHDRAWN one is withheld, and only because an owner ruled it.
        const entry = nutritionEntryFor('F-1', record({ status: 'PENDING', nutrients: [], portions: [] }));

        expect(entry).toMatchObject({ id: 'F-1', status: 'PENDING' });
        expect(entry.portions).toEqual([]);
    });

    it('uses the id it is GIVEN, not the record`s — the response order is keyed on the request', () => {
        // The callers iterate the requested ids and look the record up, because a batched
        // `WHERE id = ANY(…)` promises no row order and the response order is part of what the edge
        // caches under the canonical URL (ADR-0020).
        expect(nutritionEntryFor('F-REQUESTED', record({ id: 'F-1' })).id).toBe('F-REQUESTED');
    });
});

describe('nutritionEntryFor — a WITHDRAWN food (owner ruling 6)', () => {
    it('reports the status, so the caller can tell "withdrawn" from "unknown"', () => {
        expect(nutritionEntryFor('F-1', record({ status: 'WITHDRAWN' })).status).toBe('WITHDRAWN');
    });

    it('⛔ withholds EVERY macro, even though the record still carries them', () => {
        const entry = nutritionEntryFor('F-1', record({ status: 'WITHDRAWN' }));

        expect(entry.caloriesPer100g).toBeUndefined();
        expect(entry.proteinGPer100g).toBeUndefined();
        expect(entry.carbsGPer100g).toBeUndefined();
        expect(entry.fatGPer100g).toBeUndefined();
    });

    it('⛔ withholds the portions too — a portion is a nutritional claim about the substance', () => {
        expect(nutritionEntryFor('F-1', record({ status: 'WITHDRAWN' })).portions).toEqual([]);
    });

    it('⛔ emits NO macro keys at all, so absence stays indistinguishable from "no qualifying row"', () => {
        // Not `{ caloriesPer100g: undefined }`. Every macro is `.optional()` on the wire and absence is
        // already meaningful there ("no nutrient row satisfied basis + name + unit"); a present key with an
        // undefined value would serialize differently and invite a client to branch on the difference.
        const entry = nutritionEntryFor('F-1', record({ status: 'WITHDRAWN' }));

        expect(Object.keys(entry).sort()).toEqual(['id', 'portions', 'status']);
    });
});

describe('nutritionEntryFor — the status it refuses', () => {
    it('⛔ throws on DELETING rather than publishing or guessing at it', () => {
        // Store-internal, and NOT a synonym for withdrawn: `DELETING` reverts to `RESOLVED` when an erasure
        // keeps a referenced food as an orphan. Mapping it to a removal would tell a cook their ingredient
        // is gone during a window that is about to un-happen. The callers must filter it; this refuses it.
        expect(() => nutritionEntryFor('F-1', record({ status: 'DELETING' }))).toThrow(/DELETING/);
    });
});
