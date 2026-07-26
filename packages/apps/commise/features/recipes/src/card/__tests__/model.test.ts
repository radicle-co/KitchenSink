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
    formatRelativeTime,
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
            createdAt: '2026-04-28T12:00:00.000Z',
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
            createdAt: '2026-04-28T12:00:00.000Z',
            updatedAt: '2026-05-01T12:00:00.000Z',
            // Merged-card fields (CR-002); the fixture leaves cuisine/calories absent so they are omitted.
            tags: [],
            currentVersion: 1,
            visibility: 'private',
            status: 'published',
        });
    });

    it('projects the merged-card fields (cuisine, calories, tags, version, visibility, status)', () => {
        const recipe = makeRecipe({
            cuisine: 'Mediterranean',
            leadCaloriesPerServing: 420,
            tags: ['grill', 'summer'],
            currentVersion: 12,
            visibility: 'public',
            status: 'draft',
        });

        expect(toRecipeCardModel(recipe)).toMatchObject({
            cuisine: 'Mediterranean',
            leadCaloriesPerServing: 420,
            tags: ['grill', 'summer'],
            currentVersion: 12,
            visibility: 'public',
            status: 'draft',
        });
    });

    it('omits cuisine and calories entirely when the recipe has neither (never a default)', () => {
        const model = toRecipeCardModel(makeRecipe({ cuisine: undefined, leadCaloriesPerServing: undefined }));

        expect(model).not.toHaveProperty('cuisine');
        expect(model).not.toHaveProperty('leadCaloriesPerServing');
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

    it('does not leak non-card Recipe fields outside the view-model', () => {
        const model = toRecipeCardModel(makeRecipe({ ownerId: 'usr_secret', description: 'private notes' }));

        // ownerId/description are not card concerns; visibility/status ARE (they drive the merged-card badges).
        expect(model).not.toHaveProperty('ownerId');
        expect(model).not.toHaveProperty('description');
        expect(model).not.toHaveProperty('ingredients');
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

describe('formatRelativeTime', () => {
    const JUST_NOW = 'just now';

    it('renders the localized "just now" term for a sub-minute-old instant', () => {
        expect(formatRelativeTime('2026-07-24T11:59:30.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            JUST_NOW,
        );
    });

    it('renders "just now" for an exact-instant match (no elapsed time)', () => {
        expect(formatRelativeTime('2026-07-24T12:00:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            JUST_NOW,
        );
    });

    it('renders "just now" rather than a negative duration under clock skew (instant is in the future)', () => {
        expect(formatRelativeTime('2026-07-24T12:05:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            JUST_NOW,
        );
    });

    it('buckets to whole elapsed minutes, floored', () => {
        expect(formatRelativeTime('2026-07-24T11:55:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            '5m ago',
        );
        expect(formatRelativeTime('2026-07-24T11:01:30.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            '58m ago',
        );
    });

    it('buckets to whole elapsed hours once at least one hour has elapsed', () => {
        expect(formatRelativeTime('2026-07-24T09:00:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            '3h ago',
        );
    });

    it('buckets to whole elapsed days once at least one day has elapsed (the wireframe\'s "2d ago")', () => {
        expect(formatRelativeTime('2026-07-22T12:00:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            '2d ago',
        );
    });

    it('buckets to whole elapsed weeks once at least one week has elapsed (the wireframe\'s "1w ago")', () => {
        expect(formatRelativeTime('2026-07-17T12:00:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            '1w ago',
        );
        expect(formatRelativeTime('2026-07-10T12:00:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            '2w ago',
        );
    });

    it('stays at the day bucket right up to (but not past) a full elapsed week', () => {
        expect(formatRelativeTime('2026-07-17T13:00:00.000Z', '2026-07-24T12:00:00.000Z', 'en', JUST_NOW)).toBe(
            '6d ago',
        );
    });
});
