/**
 * The system text scale on the recipe page's sections (owner C-1, the iOS text-cap bug): a plain React Native `Text` has no
 * cap on iOS and grows to about 3x, so every text in these sections is the design system's `Text`, which stops at its
 * role's ceiling (2x, and 1.5x for the display roles). Each test renders one section at a scale of 3.1 and asserts the
 * size it reaches is the ceiling: not the base size, which means the text ignores the scale, and not 3.1x, which means
 * nothing caps it.
 */
import { nativeTokens } from '@commise/ui/native';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';
import { guardedFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { FC, ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { recipeMessages } from '../../messages.js';
import { RecipeRatingInput } from '../../rating/RecipeRatingInput.native.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';

const { detail } = recipeMessages.en;

/** The scale of an iOS device at its largest accessibility setting. */
const SCALE = 3.1;

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.Dimensions.get('window'), width: 390, fontScale: SCALE }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

beforeEach(resetServingScale);
afterEach(cleanup);

const Scope: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>
        <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
            <FoodServiceProvider client={guardedFoodClient()} subject="user_test">
                <CookMarksTestProvider>{children}</CookMarksTestProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    </QueryClientProvider>
);

const render = (ui: ReactElement) => renderWithTamagui(<Scope>{ui}</Scope>, 'light', SCALE);

/** The size a role reaches at the ceiling: 2x, or 1.5x for the display roles. */
const ceiling = (size: number, display = false): string => `${String(size * (display ? 1.5 : 2))}px`;

const recipe = makeRecipeDetail({
    title: 'Lemon and thyme roast chicken',
    cuisine: 'British',
    status: RecipeStatus.PUBLISHED,
    visibility: RecipeVisibility.PUBLIC,
    sourceAttribution: 'Ana Lima',
    sourceUrl: 'https://example.com/chicken',
    authorDisplayName: 'Ana Lima',
    servings: 4,
    ingredients: [
        makeIngredientView({
            ingredientId: 'i1',
            name: 'unsalted butter',
            unit: 'tbsp',
            preparation: 'softened',
            groupLabel: 'Chicken',
        }),
    ],
});

const view = (): ReactElement => (
    <RecipeDetailView
        unreachableRetry={idleUnreachableRetry}
        recipe={recipe}
        viewerIsOwner={false}
        onViewVersions={vi.fn()}
    />
);

const sizeOf = (text: string | RegExp): string => resolvedStyle(screen.getByText(text), 'fontSize');

describe('the recipe page at a system text scale of 3.1 (native)', () => {
    it('caps the title at 1.5x, the display ceiling', () => {
        render(view());

        expect(sizeOf('Lemon and thyme roast chicken')).toBe(
            ceiling(nativeTokens.type.largeTitle.narrow.fontSize, true),
        );
    });

    it('caps the eyebrow, the byline and the source line at 2x', () => {
        render(view());

        expect(sizeOf('British')).toBe(ceiling(nativeTokens.type.label.fontSize));
        expect(sizeOf(/^by /u)).toBe(ceiling(nativeTokens.type.meta.fontSize));
        expect(sizeOf(detail.sourceHeading)).toBe(ceiling(nativeTokens.type.meta.fontSize));
    });

    it('caps the fact tiles at 2x, and the Screen on label', () => {
        render(view());

        expect(sizeOf(detail.totalLabel)).toBe(ceiling(nativeTokens.type.caption.fontSize));
        expect(sizeOf(detail.screenOn)).toBe(ceiling(nativeTokens.type.label.fontSize));
    });

    it('caps the ingredients heading at 1.5x and its group label, "for {n}" and rows at 2x', () => {
        render(view());

        expect(sizeOf(detail.ingredientsHeading)).toBe(ceiling(nativeTokens.type.sectionTitle.fontSize, true));
        expect(sizeOf('Chicken')).toBe(ceiling(nativeTokens.type.caption.fontSize));
        expect(sizeOf('for 4')).toBe(ceiling(nativeTokens.type.meta.fontSize));
        expect(sizeOf('softened')).toBe(ceiling(nativeTokens.type.body.fontSize));
    });

    it('caps the scaled-from caveat at 2x', () => {
        render(view());
        fireEvent.click(screen.getByRole('button', { name: detail.servingsIncrease }));

        expect(sizeOf(detail.scaledTimingCaveat)).toBe(ceiling(nativeTokens.type.caption.fontSize));
    });
});

describe('the rating card at a system text scale of 3.1 (native)', () => {
    it('caps the summary, the rate heading, Remove, the saving status and the error at 2x', () => {
        render(
            <RecipeRatingInput
                average={4.8}
                ratingCount={12}
                selectedStars={3}
                pending
                error="generic"
                onRate={vi.fn()}
                onRemove={vi.fn()}
            />,
        );

        expect(sizeOf('4.8')).toBe(ceiling(nativeTokens.type.body.fontSize));
        expect(sizeOf('12 ratings')).toBe(ceiling(nativeTokens.type.body.fontSize));
        expect(sizeOf('Rate this recipe')).toBe(ceiling(nativeTokens.type.caption.fontSize));
        expect(sizeOf('Remove my rating')).toBe(ceiling(nativeTokens.type.label.fontSize));
        expect(sizeOf('Saving your rating…')).toBe(ceiling(nativeTokens.type.meta.fontSize));
        expect(sizeOf('We couldn’t save your rating. Try again.')).toBe(ceiling(nativeTokens.type.meta.fontSize));
    });

    // Adopted from feature-card's rating text-scale test: the unrated card says "Not yet rated" at the same ceiling.
    it('caps “Not yet rated” at 2x', () => {
        render(<RecipeRatingInput ratingCount={0} onRate={vi.fn()} onRemove={vi.fn()} />);

        expect(sizeOf('Not yet rated')).toBe(ceiling(nativeTokens.type.meta.fontSize));
    });
});
