/**
 * Component tests for the mobile recipe Home-widget slot (T104-mobile). Rendered via react-native-web under
 * jsdom (see `vitest.native.config.ts`). The slot code-splits the real native widget through the descriptor
 * loader (`React.lazy`) and feeds it the viewer's recent recipes from the (mocked) `useRecipes` query, so
 * these exercise the widget's three data states end-to-end: the skeleton fallback while loading, the recent
 * list when populated, and the empty state when the viewer has none — plus the "see all recipes" entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import { useRecipes } from '@kitchensink/recipe-service-client/hooks';

import { RecipeWidgetSlot } from '../../../src/components/home/RecipeWidgetSlot.js';
import { makeRecipe, makeRecipePage } from '../../__fixtures__/recipes.js';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({ useRecipes: vi.fn() }));

const useRecipesMock = vi.mocked(useRecipes);

/** Build a `useRecipes` result double from the fields the slot reads. */
function listResult(overrides: Partial<ReturnType<typeof useRecipes>> = {}): ReturnType<typeof useRecipes> {
    return { isLoading: false, data: undefined, ...overrides } as unknown as ReturnType<typeof useRecipes>;
}

const noop = (): void => undefined;

const renderSlot = (onSeeAllRecipes: () => void = noop): void => {
    render(
        <LocaleProvider locale="en">
            <RecipeWidgetSlot onSeeAllRecipes={onSeeAllRecipes} />
        </LocaleProvider>,
    );
};

afterEach(cleanup);

beforeEach(() => {
    useRecipesMock.mockReset();
});

describe('RecipeWidgetSlot (mobile)', () => {
    it('shows the skeleton card (widget title, no empty message) while the recipes query is loading', async () => {
        useRecipesMock.mockReturnValue(listResult({ isLoading: true }));

        renderSlot();

        // The lazy chunk resolves to the widget, which renders its skeleton under the loading flag.
        expect(await screen.findByText('Recent recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet. Create your first recipe to see it here.')).toBeNull();
    });

    it('renders the recent recipes once the query resolves with data', async () => {
        useRecipesMock.mockReturnValue(
            listResult({ data: makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]) }),
        );

        renderSlot();

        expect(await screen.findByText('Weeknight Pasta')).toBeTruthy();
    });

    it('renders the empty state when the viewer has no recipes', async () => {
        useRecipesMock.mockReturnValue(listResult({ data: makeRecipePage([]) }));

        renderSlot();

        expect(await screen.findByText('No recipes yet. Create your first recipe to see it here.')).toBeTruthy();
    });

    it('renders a "see all recipes" entry and forwards activation to onSeeAllRecipes', async () => {
        useRecipesMock.mockReturnValue(listResult({ data: makeRecipePage([]) }));
        const onSeeAllRecipes = vi.fn();

        renderSlot(onSeeAllRecipes);

        const entry = await screen.findByRole('button', { name: 'See all recipes' });
        fireEvent.click(entry);

        expect(onSeeAllRecipes).toHaveBeenCalledTimes(1);
    });
});
