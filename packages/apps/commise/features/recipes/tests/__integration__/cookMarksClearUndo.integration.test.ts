/**
 * Integration: cooking mode's Clear ticks and its Undo, through the REAL cook-marks store over the REAL
 * `sessionCookMarksBackend` (a jsdom `sessionStorage`), read back from the stored text. A unit test of the reducer cannot
 * see that the store writes the narrower command's result, that the marker survives in storage, or that a second store
 * over the same storage (a reload) reads the same marks.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { sessionCookMarksBackend } from '../../src/detail/cookMarksBackend.js';
import { cookMarksKey } from '../../src/detail/cookMarks.js';
import { createCookMarksStore } from '../../src/detail/cookMarksStore.js';
import { tickKeyOf } from '../../src/detail/__fixtures__/tickKeys.js';
import { ingredientTickKeys, tickedPositions } from '../../src/detail/ingredientTickKey.js';

const [BUTTER, LEMON, SALT, A] = [1, 2, 3, 4].map(tickKeyOf);
const COOK = 'usr_1';
const RECIPE = 'rec_1';

afterEach(() => {
    sessionStorage.clear();
});

const storeOverSession = () => createCookMarksStore(sessionCookMarksBackend(sessionStorage));

const stored = () => JSON.parse(sessionStorage.getItem(cookMarksKey(COOK, RECIPE)) ?? 'null') as unknown;

describe('Clear ticks and Undo through the real store', () => {
    it('Clear ticks keeps the current-step marker in storage, and a fresh store (a reload) reads it', () => {
        const store = storeOverSession();
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: BUTTER });
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: LEMON });
        store.dispatch(COOK, RECIPE, { kind: 'toggleStep', step: 3 });

        store.dispatch(COOK, RECIPE, { kind: 'clearIngredientTicks' });

        expect(stored()).toEqual({ lines: [], step: 3 });
        const reloaded = storeOverSession().read(COOK, RECIPE);
        expect(reloaded.lines.size).toBe(0);
        expect(reloaded.currentStep).toBe(3);
    });

    it('Undo is a union: tick butter and lemon, Clear ticks, tick salt, Undo leaves all three', () => {
        const store = storeOverSession();
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: BUTTER });
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: LEMON });
        const cleared = [...store.read(COOK, RECIPE).lines];

        store.dispatch(COOK, RECIPE, { kind: 'clearIngredientTicks' });
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: SALT });
        store.dispatch(COOK, RECIPE, { kind: 'restoreIngredientTicks', lines: cleared });

        expect([...storeOverSession().read(COOK, RECIPE).lines].sort()).toEqual([BUTTER, LEMON, SALT].sort());
    });

    it("the recipe page's Clear checks (`clear`) still removes the record, marker included", () => {
        const store = storeOverSession();
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: BUTTER });
        store.dispatch(COOK, RECIPE, { kind: 'toggleStep', step: 3 });

        store.dispatch(COOK, RECIPE, { kind: 'clear' });

        expect(stored()).toBeNull();
    });

    it('notifies subscribers on a Clear ticks and an Undo, and on nothing when there is nothing to change', () => {
        const store = storeOverSession();
        let heard = 0;
        store.subscribe(() => {
            heard += 1;
        });
        store.dispatch(COOK, RECIPE, { kind: 'clearIngredientTicks' });
        store.dispatch(COOK, RECIPE, { kind: 'restoreIngredientTicks', lines: [] });
        expect(heard).toBe(0);

        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: A });
        store.dispatch(COOK, RECIPE, { kind: 'clearIngredientTicks' });
        store.dispatch(COOK, RECIPE, { kind: 'restoreIngredientTicks', lines: [A] });
        expect(heard).toBe(3);
    });

    // ADR-0096: the recipe page reads fresh lines and cooking mode reads the lines it saved when it opened. Content
    // keys make them agree on one line even after the page's lines change underneath.
    it('the page (fresh lines, one inserted above) and cooking mode (saved lines) agree on the butter line', () => {
        const butter = { ingredientId: 'ing_butter', quantity: { kind: 'exact', value: 2 } as const, unit: 'tbsp' };
        const sugar = { ingredientId: 'ing_sugar', quantity: { kind: 'exact', value: 1 } as const, unit: 'cup' };
        const saved = [butter, { ...butter }, sugar];
        const fresh = [{ ingredientId: 'ing_new', quantity: { kind: 'absent' } as const }, ...saved];
        const store = storeOverSession();
        const savedKeys = ingredientTickKeys(saved);
        const freshKeys = ingredientTickKeys(fresh);

        // Cooking mode ticks the SECOND butter line, at position 1 of its saved lines.
        const second = savedKeys[1];

        if (second === undefined) {
            throw new Error('the fixture has three lines');
        }

        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: second });

        const ticked = storeOverSession().read(COOK, RECIPE).lines;

        expect(tickedPositions(savedKeys, ticked)).toEqual(new Set([1]));
        expect(tickedPositions(freshKeys, ticked)).toEqual(new Set([2]));
    });
});
