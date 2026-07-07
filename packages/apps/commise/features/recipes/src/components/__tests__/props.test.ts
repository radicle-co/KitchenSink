import { describe, it, expect } from 'vitest';

import type { Recipe } from '@kitchensink/recipe-core';

import { MAX_RECENT_RECIPES, toRecipeSummary } from '../props.js';

const makeRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
    id: 'rec_1',
    ownerId: 'usr_1',
    title: 'Weeknight Pasta',
    description: 'A quick dinner',
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    totalTimeMinutes: 25,
    servings: 2,
    visibility: 'private',
    sourceType: 'user_created',
    hasSubstantiveEdit: false,
    dietaryFlags: [],
    tags: ['dinner'],
    hasPartialNutrition: false,
    currentVersion: 1,
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z',
    ...overrides,
});

describe('toRecipeSummary', () => {
    it('projects a Recipe down to exactly id, title, and updatedAt', () => {
        const recipe = makeRecipe();

        expect(toRecipeSummary(recipe)).toEqual({
            id: 'rec_1',
            title: 'Weeknight Pasta',
            updatedAt: '2026-04-19T09:30:00.000Z',
        });
    });

    it('drops every other Recipe field (no leakage of the full DTO shape)', () => {
        const summary = toRecipeSummary(makeRecipe({ description: 'secret', ownerId: 'usr_secret' }));

        expect(Object.keys(summary).sort()).toEqual(['id', 'title', 'updatedAt']);
        expect(summary).not.toHaveProperty('ownerId');
        expect(summary).not.toHaveProperty('description');
    });

    it('carries through the exact field values from the source recipe', () => {
        const recipe = makeRecipe({ id: 'rec_42', title: 'Ramen', updatedAt: '2026-05-01T00:00:00.000Z' });
        const summary = toRecipeSummary(recipe);

        expect(summary.id).toBe('rec_42');
        expect(summary.title).toBe('Ramen');
        expect(summary.updatedAt).toBe('2026-05-01T00:00:00.000Z');
    });
});

describe('MAX_RECENT_RECIPES', () => {
    it('caps the recent-recipe list at 4 (US-0 / FR-046)', () => {
        expect(MAX_RECENT_RECIPES).toBe(4);
    });
});
