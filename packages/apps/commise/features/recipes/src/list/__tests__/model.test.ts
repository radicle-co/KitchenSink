/**
 * Unit tests for the recipe-list model layer — the pure, platform-agnostic helpers the web and native
 * list views both render through. Each helper is tested for its real contract (projection subset, locale
 * plural selection, token substitution), not merely that it returns *a* string.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { fillTemplate, formatDurationMinutes, formatRecipeCount, toRecipeListItem } from '../model.js';

describe('fillTemplate', () => {
    it('substitutes a single named token', () => {
        expect(fillTemplate('{count} recipes', { count: 6 })).toBe('6 recipes');
    });

    it('substitutes multiple named tokens', () => {
        expect(fillTemplate('{a} of {b}', { a: 1, b: 2 })).toBe('1 of 2');
    });

    it('leaves an unknown token untouched (never throws)', () => {
        expect(fillTemplate('{count} of {missing}', { count: 3 })).toBe('3 of {missing}');
    });
});

describe('toRecipeListItem', () => {
    it('projects a full Recipe down to the list view-model subset', () => {
        const recipe = makeRecipe({
            id: 'rec_42',
            title: 'Herb Risotto',
            totalTimeMinutes: 35,
            updatedAt: '2026-05-01T12:00:00.000Z',
        });

        expect(toRecipeListItem(recipe)).toEqual({
            id: 'rec_42',
            title: 'Herb Risotto',
            totalTimeMinutes: 35,
            updatedAt: '2026-05-01T12:00:00.000Z',
        });
    });

    it('does not leak fields outside the view-model subset', () => {
        const item = toRecipeListItem(makeRecipe({ ownerId: 'usr_secret', description: 'private notes' }));

        expect(Object.keys(item).sort()).toEqual(['id', 'title', 'totalTimeMinutes', 'updatedAt'].sort());
    });
});

describe('formatRecipeCount', () => {
    const labels = { one: '{count} recipe', other: '{count} recipes' } as const;

    it('uses the singular template for the "one" plural category (en)', () => {
        expect(formatRecipeCount(1, labels, 'en')).toBe('1 recipe');
    });

    it('uses the plural template for zero (en treats 0 as "other")', () => {
        expect(formatRecipeCount(0, labels, 'en')).toBe('0 recipes');
    });

    it('uses the plural template for many', () => {
        expect(formatRecipeCount(6, labels, 'en')).toBe('6 recipes');
    });
});

describe('formatDurationMinutes', () => {
    it('fills the localized minutes template', () => {
        expect(formatDurationMinutes(45, '{minutes} min')).toBe('45 min');
    });
});
