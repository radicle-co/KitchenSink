/**
 * The recipe card's view (`recipeCardViewOf`), which every part of both `RecipeCard` leaves draws: the PRO badge only
 * for a premium recipe (FR-003a), the meta row's names and the stated difficulty (FR-001b), the version badge past v1,
 * the draft badge that REPLACES visibility, "Created" vs "Edited" (CR-002), and an honest unrated state.
 *
 * ⚠️ REWRITTEN for slice 4 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.1): the difficulty carries its
 * LEVEL (tint + meter + word; `error` is never a difficulty colour), the status names one of three recipe statuses for
 * the design-system badge, the cover carries a status chip for a draft or private recipe and a time chip in hours and
 * minutes, the tags become one line of text with "+N", the footer joins the version and the timestamp, and a rated
 * recipe carries the short "4.6 (1)" figure beside its stars.
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
        const { cover } = viewOf({ usesPremiumCapability: false });

        expect(cover.noPhotoLabel).toBe('No photo yet');
        expect(cover.pro).toBeUndefined();
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
        [RecipeDifficulty.EASY, 'Easy', 'easy'],
        [RecipeDifficulty.MEDIUM, 'Medium', 'medium'],
        [RecipeDifficulty.HARD, 'Hard', 'hard'],
    ])('labels a stated difficulty and carries its level: %s', (difficulty, label, level) => {
        expect(viewOf({ difficulty }).meta.difficulty).toEqual({ label, level });
    });

    it('says the servings as a phrase for the meta line', () => {
        expect(viewOf({ servings: 8 }).meta.servingsText).toBe('Serves 8');
    });
});

describe('recipeCardViewOf — the badges', () => {
    it('offers no version badge at v1', () => {
        expect(viewOf({ currentVersion: 1 }).badges.version).toBeUndefined();
    });

    it('offers the version badge, with its name, past v1', () => {
        expect(viewOf({ currentVersion: 12 }).badges.version).toEqual({ text: 'v12', label: 'Version 12' });
    });

    it.each<[string, RecipeStatus, RecipeVisibility, { status: 'draft' | 'private' | 'public'; text: string }]>([
        [
            'a public draft says Draft, never Public',
            RecipeStatus.DRAFT,
            RecipeVisibility.PUBLIC,
            { status: 'draft', text: 'Draft' },
        ],
        [
            'a private draft says Draft',
            RecipeStatus.DRAFT,
            RecipeVisibility.PRIVATE,
            { status: 'draft', text: 'Draft' },
        ],
        [
            'a published public recipe says Public',
            RecipeStatus.PUBLISHED,
            RecipeVisibility.PUBLIC,
            { status: 'public', text: 'Public' },
        ],
        [
            'a published private recipe says Private',
            RecipeStatus.PUBLISHED,
            RecipeVisibility.PRIVATE,
            { status: 'private', text: 'Private' },
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
        expect(viewOf({ ratingCount: 0 }).rating).toEqual({ kind: 'unrated', text: 'No ratings yet' });
    });

    it('is unrated on a count of 0 even beside an average, a model the fixture cannot build', () => {
        const model = { ...toRecipeCardModel(makeRecipe()), averageRating: 4, ratingCount: 0 };

        expect(recipeCardViewOf(model, copy, 'en', NOW).rating).toEqual({ kind: 'unrated', text: 'No ratings yet' });
    });

    it('names a rated recipe with its average and count, and fills its stars', () => {
        expect(viewOf({ averageRating: 3.6, ratingCount: 1 }).rating).toEqual({
            kind: 'rated',
            label: 'Rated 3.6 out of 5, 1 rating',
            fills: [true, true, true, true, false],
            short: '3.6 (1)',
        });
    });
});

describe('recipeCardViewOf — the cover chips', () => {
    it.each<[string, RecipeStatus, RecipeVisibility, { status: 'draft' | 'private'; text: string } | undefined]>([
        ['a draft shows Draft', RecipeStatus.DRAFT, RecipeVisibility.PUBLIC, { status: 'draft', text: 'Draft' }],
        [
            'a private draft still shows Draft',
            RecipeStatus.DRAFT,
            RecipeVisibility.PRIVATE,
            { status: 'draft', text: 'Draft' },
        ],
        [
            'a published private recipe shows Private',
            RecipeStatus.PUBLISHED,
            RecipeVisibility.PRIVATE,
            { status: 'private', text: 'Private' },
        ],
        // §4.1 row 1: the status chip is "✎ Draft" or "🔒 Private" — a published public recipe is the quiet case.
        ['a published public recipe shows no status chip', RecipeStatus.PUBLISHED, RecipeVisibility.PUBLIC, undefined],
    ])('%s', (_case, status, visibility, chip) => {
        expect(viewOf({ status, visibility }).cover.status).toEqual(chip);
    });

    it.each<[number, string]>([
        [25, '25 min'],
        [60, '1 h'],
        [330, '5 h 30 min'],
    ])('says %i minutes in hours and minutes on the time chip: %s', (totalTimeMinutes, text) => {
        expect(viewOf({ totalTimeMinutes }).cover.time).toEqual({
            text,
            label: `${totalTimeMinutes} minutes total time`,
        });
    });

    // F17 (`evaluateFinal.md`; `buildSpec.md` §1.11 `formatDuration`): a draft with no times showed "⏱ 0 min". 0 or
    // absent shows nothing — no chip on the cover, no duration in the meta line.
    it('shows no time chip and no duration for a recipe with no time', () => {
        const view = viewOf({ totalTimeMinutes: 0 });

        expect(view.cover.time).toBeUndefined();
        expect(view.meta.duration).toBeUndefined();
    });
});

describe('recipeCardViewOf — the tags line', () => {
    it('offers no tags line for a recipe with no tags', () => {
        expect(viewOf({ tags: [] }).tags).toBeUndefined();
    });

    it.each<[readonly string[], string]>([
        [['vegan'], 'vegan'],
        [['vegan', 'quick'], 'vegan · quick'],
        [['gluten-free', 'slow-cooked', 'braise', 'winter', 'lamb'], 'gluten-free · slow-cooked · +3'],
    ])('joins %j as one line of text, counting the rest', (tags, text) => {
        expect(viewOf({ tags: [...tags] }).tags).toEqual({ text, label: tags.join(', ') });
    });
});

describe('recipeCardViewOf — the footer', () => {
    it('joins the version past v1 and the timestamp', () => {
        expect(
            viewOf({ currentVersion: 12, createdAt: '2026-06-01T12:00:00.000Z', updatedAt: '2026-07-22T12:00:00.000Z' })
                .footer,
        ).toBe('v12 · Edited 2d ago');
    });

    it('says only the timestamp at v1', () => {
        expect(
            viewOf({ currentVersion: 1, createdAt: '2026-07-22T12:00:00.000Z', updatedAt: '2026-07-22T12:00:00.000Z' })
                .footer,
        ).toBe('Created 2d ago');
    });
});
