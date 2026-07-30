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
import { addChip, difficultyOptions, removeChipAt, setDifficulty } from '../props.js';

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
