/**
 * The recipe card's view (`recipeCardViewOf`), which every part of both `RecipeCard` leaves draws: the PRO badge only
 * for a premium recipe (FR-003a), the meta row's names and the stated difficulty (FR-001b), the version badge past v1,
 * the draft badge that REPLACES visibility, "Created" vs "Edited" (CR-002), and an honest unrated state.
 */
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { toRecipeCardModel } from '../model.js';
import { recipeCardViewOf } from '../recipeCardView.js';

const NOW = '2026-07-24T12:00:00.000Z';
const copy = recipeMessages.en;
const viewOf = (over: Parameters<typeof makeRecipe>[0] = {}) =>
    recipeCardViewOf(toRecipeCardModel(makeRecipe(over)), copy, 'en', NOW);

describe('recipeCardViewOf — the cover', () => {
    it('names the placeholder, and offers no PRO badge for a recipe that uses no premium capability', () => {
        expect(viewOf({ usesPremiumCapability: false }).cover).toEqual({
            noPhotoLabel: 'No photo yet',
            pro: undefined,
        });
    });

    it('offers the PRO badge, with its name, for a premium recipe', () => {
        expect(viewOf({ usesPremiumCapability: true }).cover.pro).toEqual({ text: 'PRO', label: 'Premium recipe' });
    });
});

describe('recipeCardViewOf — the meta row', () => {
    it('names the total time and the servings', () => {
        const { meta } = viewOf({ totalTimeMinutes: 45, servings: 4 });

        expect(meta.duration).toBe('45 min');
        expect(meta.timeLabel).toBe('45 minutes total time');
        expect(meta.servingsLabel).toBe('Serves 4');
    });

    it('offers no difficulty pill when the author stated none', () => {
        expect(viewOf({ difficulty: undefined }).meta.difficulty).toBeUndefined();
    });

    it.each<[RecipeDifficulty, string, string]>([
        [RecipeDifficulty.EASY, 'Easy', 'success'],
        [RecipeDifficulty.MEDIUM, 'Medium', 'warning'],
        [RecipeDifficulty.HARD, 'Hard', 'error'],
    ])('labels and tones a stated difficulty: %s', (difficulty, label, tone) => {
        expect(viewOf({ difficulty }).meta.difficulty).toEqual({ label, tone });
    });
});

describe('recipeCardViewOf — the badges', () => {
    it('offers no version badge at v1', () => {
        expect(viewOf({ currentVersion: 1 }).badges.version).toBeUndefined();
    });

    it('offers the version badge, with its name, past v1', () => {
        expect(viewOf({ currentVersion: 12 }).badges.version).toEqual({ text: 'v12', label: 'Version 12' });
    });

    it.each<[string, RecipeStatus, RecipeVisibility, { kind: 'draft' | 'visibility'; text: string }]>([
        [
            'a public draft says Draft, never Public',
            RecipeStatus.DRAFT,
            RecipeVisibility.PUBLIC,
            { kind: 'draft', text: 'Draft' },
        ],
        ['a private draft says Draft', RecipeStatus.DRAFT, RecipeVisibility.PRIVATE, { kind: 'draft', text: 'Draft' }],
        [
            'a published public recipe says Public',
            RecipeStatus.PUBLISHED,
            RecipeVisibility.PUBLIC,
            { kind: 'visibility', text: 'Public' },
        ],
        [
            'a published private recipe says Private',
            RecipeStatus.PUBLISHED,
            RecipeVisibility.PRIVATE,
            { kind: 'visibility', text: 'Private' },
        ],
    ])('%s', (_case, status, visibility, badge) => {
        expect(viewOf({ status, visibility }).badges.status).toEqual(badge);
    });

    it.each<[string, string, string, string]>([
        [
            'never revised: Created, from createdAt',
            '2026-07-22T12:00:00.000Z',
            '2026-07-22T12:00:00.000Z',
            'Created 2d ago',
        ],
        ['revised: Edited, from updatedAt', '2026-06-01T12:00:00.000Z', '2026-07-23T12:00:00.000Z', 'Edited 1d ago'],
        [
            'revised under a minute ago: just now',
            '2026-06-01T12:00:00.000Z',
            '2026-07-24T11:59:30.000Z',
            'Edited just now',
        ],
    ])('the timestamp, %s', (_case, createdAt, updatedAt, timestamp) => {
        expect(viewOf({ createdAt, updatedAt }).badges.timestamp).toBe(timestamp);
    });
});

describe('recipeCardViewOf — the rating', () => {
    it('is honestly unrated with no ratings, never a 0-star score', () => {
        expect(viewOf({ ratingCount: 0 }).rating).toEqual({ kind: 'unrated', text: 'Not yet rated' });
    });

    it('is unrated on a count of 0 even beside an average, a model the fixture cannot build', () => {
        const model = { ...toRecipeCardModel(makeRecipe()), averageRating: 4, ratingCount: 0 };

        expect(recipeCardViewOf(model, copy, 'en', NOW).rating).toEqual({ kind: 'unrated', text: 'Not yet rated' });
    });

    it('names a rated recipe with its average and count, and fills its stars', () => {
        expect(viewOf({ averageRating: 3.6, ratingCount: 1 }).rating).toEqual({
            kind: 'rated',
            label: 'Rated 3.6 out of 5, 1 rating',
            fills: [true, true, true, true, false],
        });
    });
});
