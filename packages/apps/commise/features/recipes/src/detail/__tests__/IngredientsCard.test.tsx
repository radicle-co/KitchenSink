// @vitest-environment jsdom
/**
 * The web ingredients card, as `RecipeDetailAndroid384` draws it (`nativeBoards/buildLists.md` item 13): one paper card
 * holding the heading with "for {n}" and the stepper, the owner's Edit under the heading, group headings, and rows with
 * a hairline between them. The web twin of `IngredientsCard.native.test.tsx`.
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { renderWithRecipeClient } from '@commise/test-utils';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { DetailTestScope } from '../../__fixtures__/detailScope.js';
import { recipeMessages } from '../../messages.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.js';

const { detail } = recipeMessages.en;

beforeEach(resetServingScale);
afterEach(cleanup);

const render = (ui: ReactElement): ReturnType<typeof renderWithRecipeClient> =>
    renderWithRecipeClient(
        <FoodServiceProvider
            client={
                new FoodServiceClient({
                    baseUrl: 'https://food.test',
                    fetch: () => Promise.reject(new Error('offline')),
                })
            }
            subject="user_test"
        >
            <DetailTestScope>{ui}</DetailTestScope>
        </FoodServiceProvider>,
        createFakeRecipeServiceClient(),
    );

const recipe = makeRecipeDetail({
    servings: 4,
    ingredients: [
        makeIngredientView({ ingredientId: 'i1', name: 'unsalted butter', unit: 'tbsp', groupLabel: 'Chicken' }),
        makeIngredientView({ ingredientId: 'i2', name: 'fresh thyme', unit: 'sprigs', groupLabel: 'Chicken' }),
        makeIngredientView({ ingredientId: 'i3', name: 'waxy potatoes', unit: 'g', groupLabel: 'Vegetables' }),
    ],
});

const view = (owner = true): ReactElement => (
    <RecipeDetailView
        unreachableRetry={idleUnreachableRetry}
        recipe={recipe}
        editHref="/en/recipes/r1/edit"
        {...(owner ? { viewerIsOwner: true } : {})}
    />
);

const section = (): HTMLElement => screen.getByRole('region', { name: detail.ingredientsHeading });
const follows = (earlier: Element, later: Element): boolean =>
    Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the ingredients card (web)', () => {
    it('is one paper card with the large radius and the medium shadow, holding the heading and every row', () => {
        render(view());

        const classes = section().className.split(' ');

        expect(classes).toEqual(expect.arrayContaining(['bg-paper', 'rounded-lg', 'shadow-md']));
        expect(section().contains(screen.getByRole('checkbox', { name: /waxy potatoes/u }))).toBe(true);
    });

    it('reads "for {n}" and then the servings stepper after the heading', () => {
        render(view());

        const forCount = screen.getByText('for 4');
        const stepper = screen.getByRole('group', { name: detail.servingsAdjustLabel });

        expect(follows(screen.getByRole('heading', { name: detail.ingredientsHeading }), forCount)).toBe(true);
        expect(follows(forCount, stepper)).toBe(true);
    });

    it('puts the owner’s Edit under the heading row, before the first group', () => {
        render(view());

        const edit = screen.getByRole('link', { name: detail.editIngredientsLabel });
        const headingRow = screen.getByRole('heading', { name: detail.ingredientsHeading })
            .parentElement as HTMLElement;

        expect(headingRow.contains(edit)).toBe(false);
        expect(follows(screen.getByRole('group', { name: detail.servingsAdjustLabel }), edit)).toBe(true);
        expect(follows(edit, screen.getByText('Chicken'))).toBe(true);
    });

    it('offers another cook no Edit', () => {
        render(view(false));

        expect(screen.queryByRole('link', { name: detail.editIngredientsLabel })).toBeNull();
    });

    it('draws a hairline between the rows of a group, and none above its first row', () => {
        render(view());

        const hasDivider = (name: RegExp): boolean =>
            (screen.getByRole('checkbox', { name }).closest('li') as HTMLElement).className.includes(
                'before:bg-line-divider',
            );

        expect(hasDivider(/unsalted butter/u)).toBe(false);
        expect(hasDivider(/fresh thyme/u)).toBe(true);
        expect(hasDivider(/waxy potatoes/u)).toBe(false);
    });

    it('sets a row in the body role', () => {
        render(view());

        const line = screen.getByRole('checkbox', { name: /unsalted butter/u }).querySelector('[data-line-text]');

        expect(line?.className.split(' ')).toContain('text-body');
        expect(line?.className.split(' ')).not.toContain('text-list');
    });

    it('draws the scaled caveat as the caption role in ink', () => {
        render(view());
        fireEvent.click(screen.getByRole('button', { name: detail.servingsIncrease }));

        const caveat = screen.getByText(detail.scaledTimingCaveat);

        expect(caveat.className.split(' ')).toEqual(expect.arrayContaining(['text-caption', 'text-ink']));
    });
});
