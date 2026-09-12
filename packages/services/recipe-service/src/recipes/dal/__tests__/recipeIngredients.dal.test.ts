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

import { RecipeIngredientsDal, type ResolvedIngredientLine } from '../recipeIngredients.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { makeRecipeIngredientRow } from '../../../__fixtures__/index.js';

type FakeControl = FakeDrizzle<RecipeDrizzle>;

const createFakeDb = (): FakeControl => makeFakeDrizzle<RecipeDrizzle>();

const LINE: ResolvedIngredientLine = {
    ingredientId: '00000000-0000-4000-8000-0000000000ff',
    ingredientName: 'Onion',
    quantity: { kind: 'exact', value: 2 },
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
            // U8 — an exact quantity writes NULL to the upper-bound column. Asserted by `toEqual` on the
            // whole row on purpose: the write must name every column, so a bound the mapper forgot to emit
            // shows up here rather than as a row that silently keeps its previous value.
            quantityHigh: null,
            unit: 'cup',
            displayText: 'diced',
            // U11/U14 — written on EVERY insert, `null` when the line carried no transcription. Part of the
            // whole-row `toEqual` for the reason stated above: a column the mapper forgets to emit is a row
            // that silently keeps a previous value, and this is the column a verification verdict joins on.
            sourceLine: null,
            // Migration 0041 — the parsed phrase, written on EVERY insert, `null` when the line carried
            // none. In the whole-row `toEqual` for the same reason as its siblings: this is the memo tier's
            // key grain, and a mapper that stopped emitting it would silently starve the memo write.
            sourcePhrase: null,
            // U7/U11 — all three stated columns are written on EVERY line, `null` included. Asserted rather
            // than omitted: a partial write would leave a previous line's `stated_unit` attached to an amount
            // nobody restated, and this expectation is what makes that visible if the spread is ever dropped.
            statedQuantity: null,
            statedQuantityHigh: null,
            statedUnit: null,
            // U26/U27 — written on EVERY insert, `null` when the line states neither, and `null` rather than
            // `''`: migration 0030's CHECKs refuse a blank, so a `?? ''` fallback here would fail the INSERT
            // for the majority of lines. Part of the whole-row `toEqual` for the reason above.
            preparation: null,
            groupLabel: null,
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

    it('writes a preparation and a group label to their own columns (U26/U27)', async () => {
        const control = createFakeDb();
        const dal = new RecipeIngredientsDal();
        control.enqueue(undefined, [makeRecipeIngredientRow({ recipeId: 'r-1' })]);

        await dal.replaceForRecipe(control.db, 'r-1', [
            { ...LINE, preparation: 'finely chopped', groupLabel: 'For the marinade' },
        ]);

        const rows = control.calls.find((call) => call.method === 'values')?.args[0] as Record<string, unknown>[];

        // ⛔ Both land in their OWN columns and neither touches `ingredientName` or `displayText` — the two
        // fields they are most likely to be folded into by a careless mapper.
        expect(rows[0]).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
            ingredientName: 'Onion',
            displayText: 'diced',
        });
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
