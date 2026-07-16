/**
 * Unit tests for the recipe-list model layer — the pure, platform-agnostic helpers the web and native
 * list views both render through. Each helper is tested for its real contract (projection subset, locale
 * plural selection, token substitution), not merely that it returns *a* string.
 */
import { describe, expect, it } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
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
    it('is the shared card projection (the list and widget draw the identical card)', () => {
        const recipe = makeRecipe({ id: 'rec_42', title: 'Herb Risotto', totalTimeMinutes: 35 });

        // The list card and the Home-widget card are one piece of knowledge — this MUST be the same
        // projection as toRecipeCardModel, or the two surfaces could drift on which fields a card shows.
        expect(toRecipeListItem(recipe)).toEqual(toRecipeCardModel(recipe));
    });

    it('projects the card fields the list card renders', () => {
        const item = toRecipeListItem(
            makeRecipe({ id: 'rec_42', title: 'Herb Risotto', totalTimeMinutes: 35, servings: 6, difficulty: 'hard' }),
        );

        expect(item).toMatchObject({
            id: 'rec_42',
            title: 'Herb Risotto',
            totalTimeMinutes: 35,
            servings: 6,
            difficulty: 'hard',
        });
    });

    it('does not leak Recipe fields outside the card view-model', () => {
        const item = toRecipeListItem(makeRecipe({ ownerId: 'usr_secret', description: 'private notes' }));

        expect(item).not.toHaveProperty('ownerId');
        expect(item).not.toHaveProperty('description');
        expect(item).not.toHaveProperty('visibility');
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
