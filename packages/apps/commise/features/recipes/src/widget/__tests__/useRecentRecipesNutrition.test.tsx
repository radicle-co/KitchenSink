/**
 * The Home recipe widget's deferred calorie lookup (ADR-0021 §6), once for both apps: it was written out in web's
 * `RecipeWidgetNutritionContainer` and in mobile's `RecentRecipesWidget`, and the two had drifted. Web asked about the
 * recipes the widget SHOWS (the first `MAX_RECENT_RECIPES`); mobile asked about every recipe the page returned.
 *
 * `useRecipeNutritionBatches` is replaced here by a recorder: this file pins WHICH ids the widget asks about and how a
 * card's slot is built from the answer. The real hook's request, caching and promise-identity behaviour has its own
 * suite, and the apps' Home suites run it end to end.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Recipe } from '@kitchensink/recipe-core';

import { MAX_RECENT_RECIPES } from '../../components/props.js';
import { RecipeNutritionSlot } from '../../nutrition/RecipeNutritionSlot.js';
import { RECENT_RECIPE_LIMIT } from '../recentRecipeLimit.js';

const { lookupRef, pagesSeen } = vi.hoisted(() => ({
    lookupRef: { current: (_id: string): Promise<unknown> | null => null },
    pagesSeen: [] as (readonly (readonly string[])[])[],
}));

vi.mock('../../hooks/useRecipeNutritionBatches.js', () => ({
    useRecipeNutritionBatches: (pages: readonly (readonly string[])[]) => {
        pagesSeen.push(pages);

        return (id: string) => lookupRef.current(id);
    },
}));

const { useRecentRecipesNutrition } = await import('../useRecentRecipesNutrition.js');

const recipesOf = (count: number): readonly Recipe[] =>
    Array.from({ length: count }, (_unused, index) => ({ id: `recipe-${index + 1}` }) as Recipe);

beforeEach(() => {
    pagesSeen.length = 0;
    lookupRef.current = () => null;
});

describe('RECENT_RECIPE_LIMIT', () => {
    it('is the number of recipes the widget shows: the page size it reads and the cap it paints are one rule', () => {
        expect(RECENT_RECIPE_LIMIT).toBe(MAX_RECENT_RECIPES);
    });
});

describe('useRecentRecipesNutrition', () => {
    it('asks about the recipes the widget SHOWS, in one page', () => {
        renderHook(() => useRecentRecipesNutrition(recipesOf(3)));

        expect(pagesSeen.at(-1)).toStrictEqual([['recipe-1', 'recipe-2', 'recipe-3']]);
    });

    it('⛔ slices to the shown count BEFORE batching when the page carries more', () => {
        renderHook(() => useRecentRecipesNutrition(recipesOf(MAX_RECENT_RECIPES + 2)));

        expect(pagesSeen.at(-1)).toStrictEqual([
            Array.from({ length: MAX_RECENT_RECIPES }, (_unused, index) => `recipe-${index + 1}`),
        ]);
    });

    it('hands the batch hook one empty page for no recipes (it sends nothing for an empty page)', () => {
        renderHook(() => useRecentRecipesNutrition([]));

        expect(pagesSeen.at(-1)).toStrictEqual([[]]);
    });

    it('builds a card’s nutrition slot from the batch that covers it', () => {
        const batch = Promise.resolve({ nutrition: {} });
        lookupRef.current = () => batch;

        const { result } = renderHook(() => useRecentRecipesNutrition(recipesOf(2)));
        const slot = result.current('recipe-2');

        expect(slot).toMatchObject({
            type: RecipeNutritionSlot,
            props: { recipeId: 'recipe-2', nutritionBatchPromise: batch },
        });
    });

    // ⛔ THE PERMANENT-SKELETON GUARD. `null` from the lookup means "no batch covers this recipe" (we never asked); the
    // host must turn it into a decision to render NOTHING. A non-null assertion would crash the card, and a stand-in
    // promise would mount a boundary with nothing to settle: a shimmer for the life of the page.
    it('renders nothing at all for a recipe no batch covers', () => {
        const { result } = renderHook(() => useRecentRecipesNutrition(recipesOf(1)));

        expect(result.current('recipe-1')).toBeNull();
    });
});
