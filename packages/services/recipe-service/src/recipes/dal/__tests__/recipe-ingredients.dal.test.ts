/**
 * T043b — unit tests for {@link RecipeIngredientsDal} over a hand-rolled fake Drizzle client.
 *
 * Mirrors the `recipes.dal.test.ts` harness: every builder method is chainable and each awaited chain
 * shifts one preconfigured result off a FIFO queue, while `.values()` payloads are recorded for
 * assertion. Pins the junction DAL's real logic — delete-then-insert replacement, the row mapping
 * (numeric `quantity` serialized to string, `displayText` defaulting to null), the empty-set short
 * circuit, and the empty-ids read short circuit — without a database (integration covers the SQL).
 */
import { describe, it, expect } from 'vitest';

import { RecipeIngredientsDal, type ResolvedIngredientLine } from '../recipe-ingredients.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle, type FakeDrizzle } from '../../../__testing__/make-fake-drizzle.js';
import { makeRecipeIngredientRow } from '../../../__fixtures__/index.js';

type FakeControl = FakeDrizzle<RecipeDrizzle>;

const createFakeDb = (): FakeControl => makeFakeDrizzle<RecipeDrizzle>();

const LINE: ResolvedIngredientLine = {
    ingredientId: '00000000-0000-4000-8000-0000000000ff',
    ingredientName: 'Onion',
    quantity: 2,
    unit: 'cup',
    displayText: 'diced',
    sortOrder: 0,
    isUserEntered: false,
};

describe('RecipeIngredientsDal.replaceForRecipe', () => {
    it('deletes existing links then inserts the mapped rows (quantity → string)', async () => {
        const control = createFakeDb();
        const dal = new RecipeIngredientsDal();
        const inserted = [makeRecipeIngredientRow({ recipeId: 'r-1', ingredientName: 'Onion' })];
        // delete.where (await) → insert.returning (await).
        control.enqueue(undefined, inserted);

        const result = await dal.replaceForRecipe(control.db, 'r-1', [LINE]);

        expect(result).toEqual(inserted);
        expect(control.calls.some((call) => call.method === 'delete')).toBe(true);

        const valuesCall = control.calls.find((call) => call.method === 'values');
        const rows = valuesCall?.args[0] as Record<string, unknown>[];
        expect(rows[0]).toEqual({
            recipeId: 'r-1',
            ingredientId: LINE.ingredientId,
            ingredientName: 'Onion',
            quantity: '2',
            unit: 'cup',
            displayText: 'diced',
            sortOrder: 0,
            isUserEntered: false,
            // No per-line nutrition override supplied → the numeric columns are null.
            userCalories: null,
            userProteinG: null,
            userCarbsG: null,
            userFatG: null,
        });
    });

    it('serializes per-line user-entered nutrition overrides to the numeric columns (FR-007a)', async () => {
        const control = createFakeDb();
        const dal = new RecipeIngredientsDal();
        control.enqueue(undefined, [makeRecipeIngredientRow({ recipeId: 'r-1' })]);

        await dal.replaceForRecipe(control.db, 'r-1', [
            { ...LINE, userCalories: 120, userProteinG: 4.5, userCarbsG: 20, userFatG: 2 },
        ]);

        const rows = control.calls.find((call) => call.method === 'values')?.args[0] as Record<string, unknown>[];
        expect(rows[0]).toMatchObject({
            userCalories: '120',
            userProteinG: '4.5',
            userCarbsG: '20',
            userFatG: '2',
        });
    });

    it('deletes but never inserts when the link set is empty', async () => {
        const control = createFakeDb();
        const dal = new RecipeIngredientsDal();
        control.enqueue(undefined); // the delete only

        const result = await dal.replaceForRecipe(control.db, 'r-1', []);

        expect(result).toEqual([]);
        expect(control.calls.some((call) => call.method === 'delete')).toBe(true);
        expect(control.calls.some((call) => call.method === 'insert')).toBe(false);
    });

    it('defaults displayText to null when the line omits it', async () => {
        const control = createFakeDb();
        const dal = new RecipeIngredientsDal();
        control.enqueue(undefined, []);
        const { displayText: _omit, ...noNotes } = LINE;

        await dal.replaceForRecipe(control.db, 'r-1', [noNotes]);

        const valuesCall = control.calls.find((call) => call.method === 'values');
        const rows = valuesCall?.args[0] as Record<string, unknown>[];
        expect(rows[0]?.['displayText']).toBeNull();
    });
});

describe('RecipeIngredientsDal.loadByRecipeIds', () => {
    it('returns [] without querying when given no recipe ids', async () => {
        const control = createFakeDb();
        const dal = new RecipeIngredientsDal();

        const result = await dal.loadByRecipeIds(control.db, []);

        expect(result).toEqual([]);
        expect(control.calls).toHaveLength(0);
    });

    it('selects and returns the link rows for the given recipe ids', async () => {
        const control = createFakeDb();
        const dal = new RecipeIngredientsDal();
        const rows = [makeRecipeIngredientRow({ recipeId: 'r-1' })];
        control.enqueue(rows);

        const result = await dal.loadByRecipeIds(control.db, ['r-1']);

        expect(result).toEqual(rows);
        expect(control.calls.some((call) => call.method === 'select')).toBe(true);
        expect(control.calls.some((call) => call.method === 'orderBy')).toBe(true);
    });
});
