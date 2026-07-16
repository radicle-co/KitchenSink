/**
 * Unit tests for the shared recipe-card model layer — the pure, platform-agnostic helpers the web and
 * native recipe cards (Home widget + list) both render through, so the two platforms can never drift on the
 * card's projection, difficulty tone, star rounding, or number/plural formatting. Each helper is asserted on
 * its real contract (would fail if the mapping, rounding, or invariant were broken), not merely "returns a
 * value".
 */
import { describe, expect, it } from 'vitest';

import { RecipeDifficulty } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import {
    STAR_COUNT,
    difficultyTone,
    formatAverageRating,
    formatRatingCount,
    toRecipeCardModel,
    toStarFills,
} from '../model.js';

describe('toRecipeCardModel', () => {
    it('projects the full card view-model from a Recipe', () => {
        const recipe = makeRecipe({
            id: 'rec_42',
            title: 'Herb Risotto',
            totalTimeMinutes: 35,
            servings: 6,
            difficulty: RecipeDifficulty.HARD,
            averageRating: 3.8,
            ratingCount: 9,
            coverPhotoUrl: 'https://cdn.commise.app/r/42.jpg',
            updatedAt: '2026-05-01T12:00:00.000Z',
        });

        expect(toRecipeCardModel(recipe)).toEqual({
            id: 'rec_42',
            title: 'Herb Risotto',
            totalTimeMinutes: 35,
            servings: 6,
            difficulty: 'hard',
            averageRating: 3.8,
            ratingCount: 9,
            usesPremiumCapability: true,
            coverPhotoUrl: 'https://cdn.commise.app/r/42.jpg',
            updatedAt: '2026-05-01T12:00:00.000Z',
        });
    });

    it('omits difficulty entirely when the author stated none (never a default)', () => {
        const model = toRecipeCardModel(makeRecipe({ difficulty: undefined }));

        expect(model).not.toHaveProperty('difficulty');
    });

    it('omits averageRating and keeps ratingCount 0 for an unrated recipe (no fabricated score)', () => {
        const model = toRecipeCardModel(makeRecipe({ ratingCount: 0 }));

        expect(model).not.toHaveProperty('averageRating');
        expect(model.ratingCount).toBe(0);
    });

    it('omits coverPhotoUrl when the recipe has no photo (no placeholder URL leaks in)', () => {
        const model = toRecipeCardModel(makeRecipe({ coverPhotoUrl: undefined }));

        expect(model).not.toHaveProperty('coverPhotoUrl');
    });

    it('carries the PRO flag straight from the materialized field — never re-derived from visibility', () => {
        // A public recipe is not PRO even though the projection sees its visibility; the flag is authoritative.
        expect(toRecipeCardModel(makeRecipe({ usesPremiumCapability: false })).usesPremiumCapability).toBe(false);
        expect(toRecipeCardModel(makeRecipe({ usesPremiumCapability: true })).usesPremiumCapability).toBe(true);
    });

    it('does not leak Recipe fields outside the card view-model', () => {
        const model = toRecipeCardModel(makeRecipe({ ownerId: 'usr_secret', description: 'private notes' }));

        expect(model).not.toHaveProperty('ownerId');
        expect(model).not.toHaveProperty('description');
        expect(model).not.toHaveProperty('visibility');
    });
});

describe('difficultyTone', () => {
    it('maps easy → success, medium → warning, hard → error (mockup pill colors)', () => {
        expect(difficultyTone(RecipeDifficulty.EASY)).toBe('success');
        expect(difficultyTone(RecipeDifficulty.MEDIUM)).toBe('warning');
        expect(difficultyTone(RecipeDifficulty.HARD)).toBe('error');
    });
});

describe('toStarFills', () => {
    it('produces exactly STAR_COUNT booleans', () => {
        expect(toStarFills(3)).toHaveLength(STAR_COUNT);
        expect(STAR_COUNT).toBe(5);
    });

    it('fills the first N stars by rounding the average to whole stars', () => {
        expect(toStarFills(4)).toEqual([true, true, true, true, false]);
        expect(toStarFills(3.8)).toEqual([true, true, true, true, false]);
        expect(toStarFills(4.5)).toEqual([true, true, true, true, true]);
        expect(toStarFills(1)).toEqual([true, false, false, false, false]);
    });
});

describe('formatAverageRating', () => {
    it('formats to one fractional digit via Intl (never string concatenation)', () => {
        expect(formatAverageRating(4.5, 'en')).toBe('4.5');
        expect(formatAverageRating(4, 'en')).toBe('4.0');
    });
});

describe('formatRatingCount', () => {
    const labels = { one: '{count} rating', other: '{count} ratings' } as const;

    it('selects the singular template for one rating (en)', () => {
        expect(formatRatingCount(1, labels, 'en')).toBe('1 rating');
    });

    it('selects the plural template for many ratings (en)', () => {
        expect(formatRatingCount(12, labels, 'en')).toBe('12 ratings');
    });
});
