import { describe, it, expect } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
import { MAX_RECENT_RECIPES, toRecipeSummary } from '../props.js';

describe('toRecipeSummary', () => {
    it('is the shared card projection (the widget and list draw the identical card)', () => {
        const recipe = makeRecipe({ id: 'rec_42', title: 'Ramen', totalTimeMinutes: 25, servings: 3 });

        // The widget card and the list card are one piece of knowledge — toRecipeSummary MUST be the same
        // projection as toRecipeCardModel, or the two surfaces could drift on which fields a card shows.
        expect(toRecipeSummary(recipe)).toEqual(toRecipeCardModel(recipe));
    });

    it('projects the card fields the mockup card renders', () => {
        const summary = toRecipeSummary(
            makeRecipe({
                id: 'rec_42',
                title: 'Ramen',
                totalTimeMinutes: 25,
                servings: 3,
                difficulty: 'easy',
                averageRating: 4.2,
                ratingCount: 8,
                coverPhotoUrl: 'https://cdn/x.jpg',
                usesPremiumCapability: false,
            }),
        );

        expect(summary).toMatchObject({
            id: 'rec_42',
            title: 'Ramen',
            totalTimeMinutes: 25,
            servings: 3,
            difficulty: 'easy',
            averageRating: 4.2,
            ratingCount: 8,
            coverPhotoUrl: 'https://cdn/x.jpg',
            usesPremiumCapability: false,
        });
    });

    it('does not leak Recipe fields outside the card view-model', () => {
        const summary = toRecipeSummary(makeRecipe({ ownerId: 'usr_secret', description: 'secret' }));

        expect(summary).not.toHaveProperty('ownerId');
        expect(summary).not.toHaveProperty('description');
        // visibility/status ARE card fields now (they drive the merged-card badges); ingredients are not.
        expect(summary).not.toHaveProperty('ingredients');
    });
});

describe('MAX_RECENT_RECIPES', () => {
    it('caps the recent-recipe list at 4 (US-0 / FR-046)', () => {
        expect(MAX_RECENT_RECIPES).toBe(4);
    });
});
