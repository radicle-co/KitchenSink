/**
 * Unit tests for {@link IngredientLinesDal} — the recipe LINE's table gateway under the 0051 grain — over a
 * hand-rolled fake Drizzle client.
 *
 * Every builder method is chainable and each awaited chain shifts one preconfigured result off a FIFO queue,
 * while `.values()` payloads are recorded for assertion. Pins the gateway's own logic: delete-then-insert
 * replacement, the row mapping, the empty-set short circuit, and the one refusal it makes — a line naming a
 * binding that does not exist. The SQL and its locks are covered by the LOCAL e2e tier.
 */
import { describe, it, expect } from 'vitest';

import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { IngredientLinesDal, type IngredientLineInput } from '../ingredientLines.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle, methodsOf, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { makeIngredientLineRow } from '../../../__fixtures__/index.js';
import { isRecipeDomainError } from '../../recipe.error.js';

type FakeControl = FakeDrizzle<RecipeDrizzle>;

const createFakeDb = (): FakeControl => makeFakeDrizzle<RecipeDrizzle>();

const LINE: IngredientLineInput = {
    foodLookupId: '00000000-0000-4000-8000-0000000000ff',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    displayText: 'diced',
    sortOrder: 0,
};

describe('IngredientLinesDal.replaceForRecipe', () => {
    it('deletes the existing lines then inserts the mapped rows, naming every column', async () => {
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        const inserted = [makeIngredientLineRow({ recipeId: 'r-1' })];
        // The bindings read (await) → the settled-failure read (await) → delete.where (await) → insert.returning.
        control.enqueue([{ id: LINE.foodLookupId }], [], undefined, inserted);

        const result = await dal.replaceForRecipe(control.db, 'r-1', [LINE]);
        const methods = methodsOf(control);
        const beforeDelete = methods.slice(0, methods.indexOf('delete'));

        expect(result).toEqual(inserted);
        // ⛔ BOTH locking reads before the delete: the other order deadlocks with a settle (the e2e race proves it).
        expect(methods).toContain('delete');
        expect(beforeDelete.filter((method) => method === 'for')).toHaveLength(2);

        const rows = control.calls.find((call) => call.method === 'values')?.args[0] as Record<string, unknown>[];

        // The whole row, so a column the mapper forgets to emit shows up here rather than as a row that silently
        // keeps a previous value. ⛔ No `ingredientName` and no `isUserEntered`: both are derived by following
        // the binding (0051), and a mapper that wrote them would not compile against the table.
        expect(rows[0]).toEqual({
            recipeId: 'r-1',
            foodLookupId: LINE.foodLookupId,
            quantity: '2',
            quantityHigh: null,
            unit: 'cup',
            displayText: 'diced',
            sourceLine: null,
            sourcePhrase: null,
            statedQuantity: null,
            statedQuantityHigh: null,
            statedUnit: null,
            preparation: null,
            groupLabel: null,
            sortOrder: 0,
            userCalories: null,
            userProteinG: null,
            userCarbsG: null,
            userFatG: null,
        });
    });

    it('serializes per-line user-entered nutrition overrides to the numeric columns (FR-007a)', async () => {
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        control.enqueue([{ id: LINE.foodLookupId }], [], undefined, [makeIngredientLineRow({ recipeId: 'r-1' })]);

        await dal.replaceForRecipe(control.db, 'r-1', [
            { ...LINE, userCalories: 120, userProteinG: 4.5, userCarbsG: 20, userFatG: 2 },
        ]);

        const rows = control.calls.find((call) => call.method === 'values')?.args[0] as Record<string, unknown>[];
        expect(rows[0]).toMatchObject({ userCalories: '120', userProteinG: '4.5', userCarbsG: '20', userFatG: '2' });
    });

    it('writes a preparation and a group label to their own columns (U26/U27)', async () => {
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        control.enqueue([{ id: LINE.foodLookupId }], [], undefined, [makeIngredientLineRow({ recipeId: 'r-1' })]);

        await dal.replaceForRecipe(control.db, 'r-1', [
            { ...LINE, preparation: 'finely chopped', groupLabel: 'For the marinade' },
        ]);

        const rows = control.calls.find((call) => call.method === 'values')?.args[0] as Record<string, unknown>[];
        expect(rows[0]).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
            displayText: 'diced',
        });
    });

    it('⛔ stores a line naming a SETTLED failure on the settle target (plan 002 R13)', async () => {
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        control.enqueue(
            [{ id: LINE.foodLookupId }],
            [{ lookupId: LINE.foodLookupId, settledLookupId: '00000000-0000-4000-8000-00000000beef' }],
            undefined,
            [makeIngredientLineRow({ recipeId: 'r-1' })],
        );

        await dal.replaceForRecipe(control.db, 'r-1', [LINE]);

        const rows = control.calls.find((call) => call.method === 'values')?.args[0] as Record<string, unknown>[];

        expect(rows.map((row) => row['foodLookupId'])).toStrictEqual(['00000000-0000-4000-8000-00000000beef']);
        expect(control.calls.some((call) => call.method === 'for')).toBe(true);
    });

    it('deletes but never inserts when the line set is empty', async () => {
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        control.enqueue(undefined);

        const result = await dal.replaceForRecipe(control.db, 'r-1', []);

        expect(result).toEqual([]);
        expect(control.calls.some((call) => call.method === 'delete')).toBe(true);
        expect(control.calls.some((call) => call.method === 'insert')).toBe(false);
    });

    it('⛔ answers UNKNOWN_INGREDIENT naming a binding that does not exist, and writes nothing', async () => {
        // A save that raced a binding's delete names an id nothing holds. That is the caller's stale id, a 400,
        // never a 500, and it is decided by a read rather than by parsing the database's localised refusal.
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        control.enqueue([]);

        const outcome = await dal.replaceForRecipe(control.db, 'r-1', [LINE]).then(
            () => 'resolved',
            (error: unknown) => error,
        );

        expect(isRecipeDomainError(outcome) && outcome.code === RecipeErrorCode.UNKNOWN_INGREDIENT).toBe(true);
        expect(control.calls.some((call) => call.method === 'delete' || call.method === 'insert')).toBe(false);
    });

    it('rethrows a database error from the write unchanged', async () => {
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        const other = Object.assign(new Error('deadlock detected'), { code: '40P01' });
        control.enqueue([{ id: LINE.foodLookupId }], [], undefined, Promise.reject(other));

        await expect(dal.replaceForRecipe(control.db, 'r-1', [LINE])).rejects.toBe(other);
    });
});

describe('IngredientLinesDal.loadByRecipeIds', () => {
    it('selects and returns the lines for the given recipes', async () => {
        const control = createFakeDb();
        const dal = new IngredientLinesDal();
        const rows = [makeIngredientLineRow()];
        control.enqueue(rows);

        expect(await dal.loadByRecipeIds(control.db, ['r-1'])).toEqual(rows);
        expect(control.calls.some((call) => call.method === 'select')).toBe(true);
    });

    it('reads nothing for no recipes', async () => {
        const control = createFakeDb();

        expect(await new IngredientLinesDal().loadByRecipeIds(control.db, [])).toEqual([]);
        expect(control.calls).toHaveLength(0);
    });
});
