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
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: 'ing_butter' });
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: 'ing_lemon' });
        store.dispatch(COOK, RECIPE, { kind: 'toggleStep', step: 3 });

        store.dispatch(COOK, RECIPE, { kind: 'clearIngredientTicks' });

        expect(stored()).toEqual({ lines: [], step: 3 });
        const reloaded = storeOverSession().read(COOK, RECIPE);
        expect(reloaded.lines.size).toBe(0);
        expect(reloaded.currentStep).toBe(3);
    });

    it('Undo is a union: tick butter and lemon, Clear ticks, tick salt, Undo leaves all three', () => {
        const store = storeOverSession();
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: 'ing_butter' });
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: 'ing_lemon' });
        const cleared = [...store.read(COOK, RECIPE).lines];

        store.dispatch(COOK, RECIPE, { kind: 'clearIngredientTicks' });
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: 'ing_salt' });
        store.dispatch(COOK, RECIPE, { kind: 'restoreIngredientTicks', lines: cleared });

        expect([...storeOverSession().read(COOK, RECIPE).lines].sort()).toEqual([
            'ing_butter',
            'ing_lemon',
            'ing_salt',
        ]);
    });

    it("the recipe page's Clear checks (`clear`) still removes the record, marker included", () => {
        const store = storeOverSession();
        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: 'ing_butter' });
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

        store.dispatch(COOK, RECIPE, { kind: 'toggleLine', line: 'ing_a' });
        store.dispatch(COOK, RECIPE, { kind: 'clearIngredientTicks' });
        store.dispatch(COOK, RECIPE, { kind: 'restoreIngredientTicks', lines: ['ing_a'] });
        expect(heard).toBe(3);
    });
});
