/**
 * Unit tests for the version-surface model layer — the pure ordering, timestamp, and conflict-field
 * projections shared by the web and native leaves. Assert exact outputs (and non-mutation) so a broken
 * sort, a drifted format, or a dropped/reordered conflict field fails.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { makeRecipeVersion } from '../__fixtures__/index.js';
import { recipeVersionMessages } from '../messages.js';
import { formatVersionTimestamp, sortVersionsDescending, toConflictSideFields } from '../model.js';

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
