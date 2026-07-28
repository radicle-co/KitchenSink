/**
 * Component tests for the mobile recipe Home-widget slot (T104-mobile). Rendered via react-native-web under
 * jsdom (see `vitest.native.config.ts`). The slot code-splits the real native widget through the descriptor
 * loader (`React.lazy`) and feeds it the viewer's recent recipes from the (mocked) `useRecipes` query, so
 * these exercise the widget's three data states end-to-end: the skeleton fallback while loading, the recent
 * list when populated, and the empty state when the viewer has none — plus the "see all recipes" entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';
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

const renderSlot = (onSeeAllRecipes: () => void = noop, onSelectRecipe: (id: string) => void = noop): void => {
    renderWithProviders(<RecipeWidgetSlot onSeeAllRecipes={onSeeAllRecipes} onSelectRecipe={onSelectRecipe} />);
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

    it('shows NO failure notice while the widget renders normally', async () => {
        useRecipesMock.mockReturnValue(
            listResult({ data: makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]) }),
        );

        renderSlot();

        expect(await screen.findByText('Weeknight Pasta')).toBeTruthy();

        // The counterweight to `RecipeWidgetSlot.widgetFailure.native.test.tsx`: an error boundary whose
        // fallback leaked into the happy path — or a notice rendered unconditionally beside the widget — would
        // pass every failure assertion in that file and still be wrong. Nothing announces a failure here.
        expect(screen.queryByText('This section couldn’t load.')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
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

/**
 * The recent-recipe CARDS must be actionable, not decorative. The shared widget leaves already thread an
 * `onSelectRecipe` seam all the way down (widget → `RecentRecipeGrid` → `RecentRecipeItem` → `RecipeCard`);
 * this slot is the layer that fulfils it, since the presentational leaves carry no navigation.
 */
describe('RecipeWidgetSlot (mobile) — recipe card activation', () => {
    it('reports the activated recipe id upward', async () => {
        useRecipesMock.mockReturnValue(
            listResult({ data: makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]) }),
        );
        const onSelectRecipe = vi.fn();

        renderSlot(noop, onSelectRecipe);

        fireEvent.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('r1');
    });

    it('reports the id of the card that was actually tapped, not merely the first', async () => {
        useRecipesMock.mockReturnValue(
            listResult({
                data: makeRecipePage([
                    makeRecipe({ id: 'r1', title: 'Weeknight Pasta' }),
                    makeRecipe({ id: 'r2', title: 'Herb Risotto' }),
                    makeRecipe({ id: 'r3', title: 'Fish Tacos' }),
                ]),
            }),
        );
        const onSelectRecipe = vi.fn();

        renderSlot(noop, onSelectRecipe);

        // The mutation that matters: a slot that hardcoded the first id, or dropped the argument, passes the
        // single-card test above and fails here.
        fireEvent.click(await screen.findByRole('button', { name: 'Herb Risotto' }));

        expect(onSelectRecipe).toHaveBeenCalledTimes(1);
        expect(onSelectRecipe).toHaveBeenCalledWith('r2');
    });

    it('does not confuse a card activation with the "see all recipes" entry', async () => {
        useRecipesMock.mockReturnValue(
            listResult({ data: makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]) }),
        );
        const onSeeAllRecipes = vi.fn();
        const onSelectRecipe = vi.fn();

        renderSlot(onSeeAllRecipes, onSelectRecipe);

        fireEvent.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('r1');
        expect(onSeeAllRecipes).not.toHaveBeenCalled();
    });
});
