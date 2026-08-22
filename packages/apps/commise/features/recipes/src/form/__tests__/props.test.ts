/**
 * Unit tests for the difficulty picker's pure helpers (FR-001b): {@link setDifficulty} (the single
 * set/clear transition both platform leaves share) and {@link difficultyOptions} (the ordered, localized
 * option set). Kept mutation-strong: clearing must REMOVE the key (so the update mapper can distinguish
 * "not stated" from a stated value), never store an explicit `undefined`.
 */
import { describe, expect, it } from 'vitest';

import { RecipeDifficulty } from '@kitchensink/recipe-core';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import type { RecipeFormMessages } from '../messages.js';
import {
    addChip,
    difficultyOptions,
    parseQuantityBound,
    quantityInputValue,
    removeChipAt,
    setDifficulty,
    setIngredientQuantityHigh,
    setIngredientQuantityLow,
} from '../props.js';

const messages: Pick<
    RecipeFormMessages,
    'difficultyEasy' | 'difficultyMedium' | 'difficultyHard' | 'difficultyNotStated'
> = {
    difficultyEasy: 'Easy',
    difficultyMedium: 'Medium',
    difficultyHard: 'Hard',
    difficultyNotStated: 'Not stated',
};

describe('setDifficulty', () => {
    it('states a difficulty when given a value', () => {
        const next = setDifficulty(makeRecipeFormValues(), RecipeDifficulty.HARD);

        expect(next.difficulty).toBe('hard');
    });

    it('overwrites a previously-stated difficulty', () => {
        const next = setDifficulty(
            makeRecipeFormValues({ difficulty: RecipeDifficulty.EASY }),
            RecipeDifficulty.MEDIUM,
        );

        expect(next.difficulty).toBe('medium');
    });

    it('REMOVES the difficulty key when cleared (not stored as undefined)', () => {
        // Mutation guard: an implementation that set `difficulty: undefined` would keep the key present, and
        // the update mapper (which branches on `values.difficulty === undefined`) would still clear correctly
        // — but `exactOptionalPropertyTypes` forbids it and the intent is a genuine absence. Pin the absence.
        const next = setDifficulty(makeRecipeFormValues({ difficulty: RecipeDifficulty.HARD }), undefined);

        expect(next.difficulty).toBeUndefined();
        expect('difficulty' in next).toBe(false);
    });

    it('does not mutate the input values', () => {
        const values = makeRecipeFormValues({ difficulty: RecipeDifficulty.HARD });

        setDifficulty(values, undefined);

        expect(values.difficulty).toBe('hard');
    });
});

describe('difficultyOptions', () => {
    it('lists Easy, Medium, Hard, then a not-stated (clear) option in order', () => {
        const options = difficultyOptions(messages as RecipeFormMessages);

        expect(options.map((option) => option.label)).toEqual(['Easy', 'Medium', 'Hard', 'Not stated']);
        expect(options.map((option) => option.value)).toEqual([
            RecipeDifficulty.EASY,
            RecipeDifficulty.MEDIUM,
            RecipeDifficulty.HARD,
            undefined,
        ]);
    });

    it('marks ONLY the last option as the clear option (no value)', () => {
        const options = difficultyOptions(messages as RecipeFormMessages);

        expect(options.filter((option) => option.value === undefined)).toHaveLength(1);
        expect(options[options.length - 1]?.value).toBeUndefined();
    });
});

describe('addChip (U6 tag/dietary chip control)', () => {
    it('appends a trimmed token to the list', () => {
        expect(addChip(['quick'], '  easy  ')).toEqual(['quick', 'easy']);
    });

    it('drops a blank / whitespace-only token (a copy, no add)', () => {
        expect(addChip(['quick'], '   ')).toEqual(['quick']);
        expect(addChip(['quick'], '')).toEqual(['quick']);
    });

    it('drops a case-insensitive duplicate rather than adding it', () => {
        expect(addChip(['Quick', 'dinner'], 'quick')).toEqual(['Quick', 'dinner']);
    });

    it('keeps a comma inside the token verbatim (never splits — it is not a separator)', () => {
        // Mutation guard: a comma-splitting implementation would yield two chips; the chip control treats the
        // whole entry as one token.
        expect(addChip([], 'salt, pepper')).toEqual(['salt, pepper']);
    });

    it('does not mutate the input list', () => {
        const list = ['quick'];
        addChip(list, 'easy');
        expect(list).toEqual(['quick']);
    });

    it('returns a NEW array even when nothing is added (so length comparison is safe, ref differs)', () => {
        const list = ['quick'];
        const result = addChip(list, 'quick');
        expect(result).not.toBe(list);
        expect(result).toEqual(['quick']);
    });
});

describe('removeChipAt (U6 tag/dietary chip control)', () => {
    it('removes the chip at the given index', () => {
        expect(removeChipAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    });

    it('is a no-op copy for an out-of-range index', () => {
        expect(removeChipAt(['a', 'b'], 5)).toEqual(['a', 'b']);
    });

    it('does not mutate the input list', () => {
        const list = ['a', 'b'];
        removeChipAt(list, 0);
        expect(list).toEqual(['a', 'b']);
    });
});

describe('parseQuantityBound (U9 — a quantity field states an amount or states nothing)', () => {
    it('parses a stated amount', () => {
        expect(parseQuantityBound('2')).toBe(2);
    });

    it('parses a fractional amount', () => {
        expect(parseQuantityBound('0.5')).toBe(0.5);
    });

    it('reports a BLANK field as no bound at all — never as a zero (R40)', () => {
        // ⛔ The mutation this pins: `Number('')` is `0`, so the obvious `parseNumericInput` reuse turns an
        // emptied field into a stated amount of zero. `undefined` is what lets `absent` stay absent.
        expect(parseQuantityBound('')).toBeUndefined();
        expect(parseQuantityBound('   ')).toBeUndefined();
    });

    it('reports unparseable text as no bound', () => {
        expect(parseQuantityBound('abc')).toBeUndefined();
    });

    it('keeps a zero or a negative as the STATED number, so validation can refuse it', () => {
        // Not coerced to `undefined`: the user typed a number, and telling them it is not an amount is a
        // different message from silently deciding they stated nothing.
        expect(parseQuantityBound('0')).toBe(0);
        expect(parseQuantityBound('-1')).toBe(-1);
    });
});

describe('quantityInputValue (U9 — what a quantity field DISPLAYS)', () => {
    it('shows a stated amount', () => {
        expect(quantityInputValue(2)).toBe('2');
    });

    it('shows an absent bound as an EMPTY field, not a zero and not "NaN" (R40)', () => {
        expect(quantityInputValue(undefined)).toBe('');
        expect(quantityInputValue(Number.NaN)).toBe('');
    });

    it('shows a zero the user actually typed', () => {
        expect(quantityInputValue(0)).toBe('0');
    });
});

describe('setIngredientQuantityLow (U9)', () => {
    const values = makeRecipeFormValues();

    it('states the lower bound', () => {
        expect(setIngredientQuantityLow(values, 0, 3).ingredients[0]?.quantity).toBe(3);
    });

    it('clears the lower bound to the draft`s absent sentinel', () => {
        expect(setIngredientQuantityLow(values, 0, undefined).ingredients[0]?.quantity).toBeNaN();
    });

    it('leaves other fields on the line untouched', () => {
        const next = setIngredientQuantityLow(values, 0, 3);

        expect(next.ingredients[0]?.unit).toBe('tbsp');
        expect(next.title).toBe(values.title);
    });
});

describe('setIngredientQuantityHigh (U9)', () => {
    const values = makeRecipeFormValues();

    it('states the upper bound', () => {
        expect(setIngredientQuantityHigh(values, 0, 3).ingredients[0]?.quantityHigh).toBe(3);
    });

    it('REMOVES the key when the upper bound is cleared (never an explicit undefined)', () => {
        // Mirrors `setDifficulty`: `exactOptionalPropertyTypes` forbids storing `undefined`, and an absent
        // key is what `statedQuantity` reads as "one value, not a range".
        const stated = setIngredientQuantityHigh(values, 0, 3);
        const cleared = setIngredientQuantityHigh(stated, 0, undefined);

        expect('quantityHigh' in (cleared.ingredients[0] ?? {})).toBe(false);
    });

    it('does not touch the lower bound', () => {
        expect(setIngredientQuantityHigh(values, 0, 3).ingredients[0]?.quantity).toBe(2);
    });

    it('patches only the addressed line', () => {
        const twoLines = makeRecipeFormValues({
            ingredients: [
                { ingredientId: 'a', name: 'Flour', quantity: 2 },
                { ingredientId: 'b', name: 'Water', quantity: 1 },
            ],
        });

        const next = setIngredientQuantityHigh(twoLines, 1, 2);

        expect(next.ingredients[0]?.quantityHigh).toBeUndefined();
        expect(next.ingredients[1]?.quantityHigh).toBe(2);
    });
});
