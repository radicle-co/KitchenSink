// @vitest-environment jsdom
/**
 * Tests for the recipe card's contexts and their one reader (`recipeCardContext.ts`, W9-f P7): the Root carries the
 * card's view and its nutrition slot to the parts, and a part rendered outside a card is a stated error rather than a
 * silent `null`. What each part draws from the view is `RecipeCard.test.tsx` and its native twin.
 */
import { renderHook } from '@testing-library/react';
import { createElement, useContext, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { makeRecipe } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { toRecipeCardModel } from '../model.js';
import { RecipeCardNutritionContext, RecipeCardViewContext, useCardView } from '../recipeCardContext.js';
import { recipeCardViewOf } from '../recipeCardView.js';

const VIEW = recipeCardViewOf(toRecipeCardModel(makeRecipe()), recipeMessages.en, 'en', '2026-07-24T12:00:00.000Z');

describe('useCardView', () => {
    it('reads the view the nearest card carries', () => {
        const wrapper = ({ children }: { readonly children: ReactNode }) =>
            createElement(RecipeCardViewContext.Provider, { value: VIEW }, children);

        const { result } = renderHook(() => useCardView(), { wrapper });

        expect(result.current).toBe(VIEW);
    });

    it('a part read outside any card is a stated error that names the card, never a silent null', () => {
        expect(() => renderHook(() => useCardView())).toThrow(
            'RecipeCard.* parts must be rendered inside a <RecipeCard>.',
        );
    });
});

describe('RecipeCardNutritionContext', () => {
    it('holds nothing outside a card, so an absent slot draws nothing', () => {
        const { result } = renderHook(() => useContext(RecipeCardNutritionContext));

        expect(result.current).toBeNull();
    });
});
