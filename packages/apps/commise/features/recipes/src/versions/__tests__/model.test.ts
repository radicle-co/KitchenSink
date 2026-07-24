/**
 * Unit tests for the version-surface model layer — the pure ordering, timestamp, and conflict-field
 * projections shared by the web and native leaves. Assert exact outputs (and non-mutation) so a broken
 * sort, a drifted format, or a dropped/reordered conflict field fails.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeFormValues } from '../../form/model.js';
import { makeRecipeDetail, makeRecipeFormValues } from '../../__fixtures__/index.js';
import { makeRecipeVersion } from '../__fixtures__/index.js';
import { recipeVersionMessages } from '../messages.js';
import {
    buildRecipeMergeFields,
    composeMergedRecipe,
    formatVersionTimestamp,
    sortVersionsDescending,
    toConflictSideFields,
    type RecipeMergeSelections,
} from '../model.js';

const conflict = recipeVersionMessages.en.conflict;

describe('sortVersionsDescending', () => {
    it('orders versions newest-first by version number', () => {
        const ordered = sortVersionsDescending([
            makeRecipeVersion({ versionNumber: 1 }),
            makeRecipeVersion({ versionNumber: 3 }),
            makeRecipeVersion({ versionNumber: 2 }),
        ]);

        expect(ordered.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
    });

    it('does not mutate the input array', () => {
        const input = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })];

        sortVersionsDescending(input);

        expect(input.map((version) => version.versionNumber)).toEqual([1, 2]);
    });
});

describe('formatVersionTimestamp', () => {
    it('formats an ISO instant in UTC (timezone-independent) for the locale', () => {
        expect(formatVersionTimestamp('2026-04-01T09:00:00.000Z', 'en')).toContain('Apr 1, 2026');
    });
});

describe('toConflictSideFields', () => {
    it('projects the title, servings, times, and counts in order', () => {
        const detail = makeRecipeDetail({
            servings: 6,
            prepTimeMinutes: 15,
            cookTimeMinutes: 25,
            totalTimeMinutes: 50,
            ingredients: [
                { ingredientId: 'ing_1', name: 'A', quantity: 1, isUserEntered: false },
                { ingredientId: 'ing_2', name: 'B', quantity: 1, isUserEntered: false },
                { ingredientId: 'ing_3', name: 'C', quantity: 1, isUserEntered: false },
            ],
            steps: [
                { stepNumber: 1, instruction: 'One' },
                { stepNumber: 2, instruction: 'Two' },
            ],
        });

        const fields = toConflictSideFields('My Draft Title', detail, conflict, 'en');

        expect(fields.map((field) => field.key)).toEqual([
            'title',
            'servings',
            'prep',
            'cook',
            'total',
            'ingredients',
            'steps',
        ]);
        expect(fields.map((field) => field.value)).toEqual([
            'My Draft Title',
            '6',
            '15 min',
            '25 min',
            '50 min',
            '3 ingredients',
            '2 steps',
        ]);
    });

    it('pluralizes single-item counts correctly', () => {
        const detail = makeRecipeDetail({
            ingredients: [{ ingredientId: 'ing_1', name: 'A', quantity: 1, isUserEntered: false }],
            steps: [{ stepNumber: 1, instruction: 'One' }],
        });

        const fields = toConflictSideFields('Solo', detail, conflict, 'en');
        const byKey = Object.fromEntries(fields.map((field) => [field.key, field.value]));

        expect(byKey['ingredients']).toBe('1 ingredient');
        expect(byKey['steps']).toBe('1 step');
    });
});

describe('buildRecipeMergeFields (T070 / FR-007c field-by-field merge)', () => {
    it('projects every editable field with each side’s formatted value', () => {
        const mine = makeRecipeFormValues({
            title: 'My Title',
            description: 'My description',
            cuisine: 'Thai',
            tags: ['spicy'],
            dietaryFlags: ['vegan'],
            servings: 6,
            prepTimeMinutes: 15,
            cookTimeMinutes: 25,
            visibility: 'public',
            ingredients: [
                { ingredientId: 'a', name: 'A', quantity: 1 },
                { ingredientId: 'b', name: 'B', quantity: 1 },
                { ingredientId: 'c', name: 'C', quantity: 1 },
            ],
            steps: [{ instruction: 'One' }, { instruction: 'Two' }],
        });
        const theirs = makeRecipeFormValues({
            title: 'Their Title',
            description: '',
            cuisine: 'Italian',
            tags: [],
            dietaryFlags: ['vegetarian', 'gluten-free'],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
            visibility: 'private',
            ingredients: [{ ingredientId: 'x', name: 'X', quantity: 1 }],
            steps: [{ instruction: 'Only' }],
        });

        const fields = buildRecipeMergeFields(mine, theirs, conflict, 'en');
        const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));

        // Field set + order is driven by the form shape.
        expect(fields.map((field) => field.key)).toEqual([
            'title',
            'description',
            'cuisine',
            'servings',
            'prepTimeMinutes',
            'cookTimeMinutes',
            'visibility',
            'tags',
            'dietaryFlags',
            'ingredients',
            'steps',
        ]);

        expect(byKey['title']).toMatchObject({ label: 'Title', mineValue: 'My Title', theirsValue: 'Their Title' });
        // An empty free-text field renders the localized empty marker, not a blank.
        expect(byKey['description']?.theirsValue).toBe('None');
        expect(byKey['servings']).toMatchObject({ mineValue: '6', theirsValue: '4' });
        expect(byKey['prepTimeMinutes']).toMatchObject({ mineValue: '15 min', theirsValue: '10 min' });
        expect(byKey['visibility']).toMatchObject({ mineValue: 'Public', theirsValue: 'Private' });
        expect(byKey['tags']).toMatchObject({ mineValue: 'spicy', theirsValue: 'None' });
        expect(byKey['dietaryFlags']?.theirsValue).toBe('vegetarian, gluten-free');
        expect(byKey['ingredients']).toMatchObject({ mineValue: '3 ingredients', theirsValue: '1 ingredient' });
        expect(byKey['steps']).toMatchObject({ mineValue: '2 steps', theirsValue: '1 step' });
    });

    it('renders EVERY field even when both sides are identical (no field is hidden)', () => {
        const same = makeRecipeFormValues();

        const fields = buildRecipeMergeFields(same, same, conflict, 'en');

        // The whole editable field set is present — nothing is silently dropped because it happens to match.
        expect(fields).toHaveLength(11);
        expect(fields.every((field) => field.mineValue === field.theirsValue)).toBe(true);
    });

    it('includes a field the form gains later that has no curated descriptor (never silently omitted)', () => {
        // Simulate a future `RecipeFormValues` field (e.g. CR-001's `difficulty`) not yet in the registry.
        const mine = { ...makeRecipeFormValues(), difficulty: 'hard' } as unknown as RecipeFormValues;
        const theirs = { ...makeRecipeFormValues(), difficulty: 'easy' } as unknown as RecipeFormValues;

        const fields = buildRecipeMergeFields(mine, theirs, conflict, 'en');
        const difficulty = fields.find((field) => field.key === 'difficulty');

        expect(difficulty).toBeDefined();
        expect(difficulty?.mineValue).toBe('hard');
        expect(difficulty?.theirsValue).toBe('easy');
    });
});

describe('composeMergedRecipe (FR-007c — per-field, never last-write-wins)', () => {
    const mine = makeRecipeFormValues({
        title: 'My Title',
        servings: 6,
        cuisine: 'Thai',
        ingredients: [{ ingredientId: 'mine', name: 'Mine', quantity: 1 }],
    });
    const theirs = makeRecipeFormValues({
        title: 'Their Title',
        servings: 4,
        cuisine: 'Italian',
        ingredients: [
            { ingredientId: 'x', name: 'X', quantity: 1 },
            { ingredientId: 'y', name: 'Y', quantity: 2 },
        ],
    });

    it('all-mine selections reproduce the draft exactly (an absent key defaults to "mine")', () => {
        expect(composeMergedRecipe(mine, theirs, {})).toEqual(mine);
    });

    it('takes each field from its chosen side — a real merge, not one whole side (mutation lens)', () => {
        // Keep my title + my cuisine, but pull in THEIR servings and THEIR ingredients.
        const selections: RecipeMergeSelections = {
            title: 'mine',
            servings: 'theirs',
            cuisine: 'mine',
            ingredients: 'theirs',
        };

        const merged = composeMergedRecipe(mine, theirs, selections);

        // A merge that ignored per-field choice and took one whole side would fail at least one of these.
        expect(merged.title).toBe('My Title');
        expect(merged.cuisine).toBe('Thai');
        expect(merged.servings).toBe(4);
        expect(merged.ingredients).toEqual(theirs.ingredients);
        // And it must equal NEITHER pure side.
        expect(merged).not.toEqual(mine);
        expect(merged).not.toEqual(theirs);
    });

    it('a field left at its default (absent from selections) resolves to the user’s draft', () => {
        const merged = composeMergedRecipe(mine, theirs, { servings: 'theirs' });

        expect(merged.servings).toBe(4);
        expect(merged.title).toBe('My Title');
        expect(merged.cuisine).toBe('Thai');
    });

    it('does not mutate either input', () => {
        const mineSnapshot = structuredClone(mine);
        const theirsSnapshot = structuredClone(theirs);

        composeMergedRecipe(mine, theirs, { title: 'theirs', servings: 'theirs' });

        expect(mine).toEqual(mineSnapshot);
        expect(theirs).toEqual(theirsSnapshot);
    });
});
