/**
 * Component tests for the mobile recipe Home-widget slot (T104-mobile). Rendered via react-native-web under
 * jsdom (see `vitest.native.config.ts`). The slot code-splits the real native widget through the descriptor
 * loader (`React.lazy`) and feeds it the viewer's recent recipes from the (mocked) `useRecipes` query, so
 * these exercise the widget's three data states end-to-end: the skeleton fallback while loading, the recent
 * list when populated, and the empty state when the viewer has none — plus the "see all recipes" entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';

import { computedContrast, renderWithRecipeClient } from '@commise/test-utils';
import { palette } from '@commise/ui';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { RecipeWidgetSlot } from '../../../src/components/home/RecipeWidgetSlot.js';
import { makeRecipe, makeRecipePage } from '../../__fixtures__/recipes.js';

// The screens under test now START the deferred calorie batch (ADR-0021 §6) through this shared hook, which
// reaches the real recipe-service client and query cache. This file is not about nutrition, so the lookup is
// stubbed to "no batch covers this recipe" — the branch that renders no nutrition line at all, leaving every
// assertion below unchanged. The wiring itself is covered by `tests/screens/screenNutrition.native.test.tsx`.
vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

/** The recipe-service client the slot reads through — a real client, network-guarded, stubbed per test. */
let client: RecipeServiceClient;

const noop = (): void => undefined;

const renderSlot = (
    onSeeAllRecipes: () => void = noop,
    onSelectRecipe: (id: string) => void = noop,
    onWidgetError?: (error: unknown) => void,
): void => {
    renderWithRecipeClient(
        <RecipeWidgetSlot
            onSeeAllRecipes={onSeeAllRecipes}
            onSelectRecipe={onSelectRecipe}
            {...(onWidgetError === undefined ? {} : { onWidgetError })}
        />,
        client,
    );
};

afterEach(cleanup);

beforeEach(() => {
    client = createFakeRecipeServiceClient();
});

describe('RecipeWidgetSlot (mobile)', () => {
    it('shows the skeleton card (widget title, no empty message) while the recipes query is loading', async () => {
        vi.spyOn(client, 'listRecipes').mockReturnValue(new Promise(() => undefined));

        renderSlot();

        // The lazy chunk resolves to the widget, which renders its skeleton under the loading flag.
        expect(await screen.findByText('Recent recipes')).toBeTruthy();
        expect(screen.queryByText('No recipes yet. Create your first recipe to see it here.')).toBeNull();
    });

    it('renders the recent recipes once the query resolves with data', async () => {
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]),
        );

        renderSlot();

        expect(await screen.findByText('Weeknight Pasta')).toBeTruthy();
    });

    it('renders the empty state when the viewer has no recipes', async () => {
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makeRecipePage([]));

        renderSlot();

        expect(await screen.findByText('No recipes yet. Create your first recipe to see it here.')).toBeTruthy();
    });

    /**
     * ⛔ A FAILED read is not an empty library. The slot used to pass only the data and a loading flag to the widget,
     * so a recipe service outage told the cook they had no recipes and invited them to create their first one.
     */
    it('⛔ shows the widget failure notice — not the empty state — when the recipes read fails, and reports it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(client, 'listRecipes').mockRejectedValue(new Error('recipe service unavailable'));
        const onWidgetError = vi.fn();

        renderSlot(noop, noop, onWidgetError);

        expect(await screen.findByText('This section couldn’t load.')).toBeTruthy();
        expect(screen.queryByText('No recipes yet. Create your first recipe to see it here.')).toBeNull();
        expect(onWidgetError).toHaveBeenCalledWith(expect.objectContaining({ message: 'recipe service unavailable' }));
        // The route off Home survives the failure.
        expect(screen.getByRole('button', { name: 'See all recipes' })).toBeTruthy();
    });

    it('shows NO failure notice while the widget renders normally', async () => {
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]),
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
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makeRecipePage([]));
        const onSeeAllRecipes = vi.fn();

        renderSlot(onSeeAllRecipes);

        const entry = await screen.findByRole('button', { name: 'See all recipes' });
        fireEvent.click(entry);

        expect(onSeeAllRecipes).toHaveBeenCalledTimes(1);
    });

    it('keeps the "see all recipes" label WCAG-AA legible on the Home surface', async () => {
        vi.spyOn(client, 'listRecipes').mockResolvedValue(makeRecipePage([]));

        renderSlot();

        // Bare text on the Home screen's `sand` background — no tint of its own — so the ratio is the token
        // against that surface: seafoam scored 3.73:1, under the 4.5:1 body floor (SC 1.4.3). Mirrors the web
        // slot's link, which is the same control on the other platform (§14).
        const label = within(await screen.findByRole('button', { name: 'See all recipes' })).getByText(
            'See all recipes',
        );

        expect(computedContrast(label, { surface: palette.sand }), '“See all recipes” label').toBeGreaterThanOrEqual(
            4.5,
        );
    });
});

/**
 * The recent-recipe CARDS must be actionable, not decorative. The shared widget leaves already thread an
 * `onSelectRecipe` seam all the way down (widget → `RecentRecipeGrid` → `RecentRecipeItem` → `RecipeCard`);
 * this slot is the layer that fulfils it, since the presentational leaves carry no navigation.
 */
describe('RecipeWidgetSlot (mobile) — recipe card activation', () => {
    it('reports the activated recipe id upward', async () => {
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]),
        );
        const onSelectRecipe = vi.fn();

        renderSlot(noop, onSelectRecipe);

        fireEvent.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('r1');
    });

    it('reports the id of the card that was actually tapped, not merely the first', async () => {
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipePage([
                makeRecipe({ id: 'r1', title: 'Weeknight Pasta' }),
                makeRecipe({ id: 'r2', title: 'Herb Risotto' }),
                makeRecipe({ id: 'r3', title: 'Fish Tacos' }),
            ]),
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
        vi.spyOn(client, 'listRecipes').mockResolvedValue(
            makeRecipePage([makeRecipe({ id: 'r1', title: 'Weeknight Pasta' })]),
        );
        const onSeeAllRecipes = vi.fn();
        const onSelectRecipe = vi.fn();

        renderSlot(onSeeAllRecipes, onSelectRecipe);

        fireEvent.click(await screen.findByRole('button', { name: 'Weeknight Pasta' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('r1');
        expect(onSeeAllRecipes).not.toHaveBeenCalled();
    });
});
