// @vitest-environment jsdom
/**
 * ⛔ THE WIRING TEST: every WEB card surface renders the deferred calorie figure, in every state.
 *
 * `RecipeNutritionSlot` is unit-tested on its own; this file proves the four surfaces that paint recipe cards
 * actually MOUNT it, in the card's meta row, from ONE shared batch promise:
 *
 *   - `RecipeList`            — `/[locale]/recipes`
 *   - `RecipeDiscoveryList`   — `/[locale]/discover`
 *   - `RecentRecipeGrid`      — the Home "Recent recipes" widget
 *   - `CollectionDetail`      — `/[locale]/collections/[id]`
 *
 * Why one file rather than four: the four surfaces owe the viewer the SAME four answers, and the failure this
 * guards is a surface being wired for one state and not the rest (or dropping the slot entirely because its
 * arrangement omits `RecipeCard.Meta` — which fails silently, since an unrendered optional node is
 * indistinguishable from an absent one). Stating the matrix once makes a missing cell obvious.
 *
 * ⚠️ SUSPENSE TEST CONVENTION (`@commise/web`'s `RecipeWidgetSlot.test.tsx:11-22`): resolve a Suspense with
 * `await act(...)`, NEVER `findBy`/`waitFor` — the latter wedges in a Vitest worker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { Recipe } from '@kitchensink/recipe-core';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { makeCollectionMemberRecipe, makeRecipe, makeRecipeListItem } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
import { CollectionDetail } from '../../collections/CollectionDetail.js';
import { RecentRecipeGrid } from '../../components/RecentRecipeGrid.js';
import { RecipeDiscoveryList } from '../../discovery/RecipeDiscoveryList.js';
import { RecipeList } from '../../list/RecipeList.js';
import { RecipeNutritionSlot } from '../RecipeNutritionSlot.js';
import type { RenderRecipeNutrition } from '../model.js';

afterEach(cleanup);

/** React logs a caught render error (the rejected-batch case); silence it so a passing run stays readable. */
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const RECIPE_ID = '00000000-0000-4000-8000-00000000000a';

const KNOWN_RESPONSE: RecipeNutritionResponse = {
    nutrition: {
        [RECIPE_ID]: {
            state: 'known',
            caloriesPerServing: 420,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        },
    },
};

/** A response that carries a DIFFERENT recipe — i.e. this card's id is absent ("not for you"). */
const OMITTING_RESPONSE: RecipeNutritionResponse = { nutrition: {} };

const noop = () => undefined;

const recipe: Recipe = makeRecipe({ id: RECIPE_ID, title: 'Weeknight Pasta' });

/**
 * The four surfaces, each rendered exactly as its real host renders it — with the host's ONE renderer closure
 * over the shared batch promise. A surface is in this table iff a viewer can see a recipe card on it.
 */
const SURFACES: readonly (readonly [string, (render: RenderRecipeNutrition) => ReactElement])[] = [
    [
        'RecipeList (/recipes)',
        (renderNutrition) => (
            <RecipeList
                status="ready"
                recipes={[makeRecipeListItem({ id: RECIPE_ID, title: 'Weeknight Pasta' })]}
                searchValue=""
                onSearchChange={noop}
                onSelectRecipe={noop}
                onCreateRecipe={noop}
                onRetry={noop}
                renderNutrition={renderNutrition}
            />
        ),
    ],
    [
        'RecipeDiscoveryList (/discover)',
        (renderNutrition) => (
            <RecipeDiscoveryList
                status="ready"
                results={[{ recipe }]}
                searchValue="pasta"
                onSearchChange={noop}
                onSelectRecipe={noop}
                onClone={noop}
                onRetry={noop}
                renderNutrition={renderNutrition}
            />
        ),
    ],
    [
        'RecentRecipeGrid (Home widget)',
        (renderNutrition) => (
            <RecentRecipeGrid recipes={[toRecipeCardModel(recipe)]} renderNutrition={renderNutrition} />
        ),
    ],
    [
        'CollectionDetail (/collections/[id])',
        (renderNutrition) => (
            <CollectionDetail
                collection={{
                    id: 'col_1',
                    ownerId: 'usr_1',
                    name: 'Weeknights',
                    visibility: 'private',
                    createdAt: '2026-04-18T12:00:00.000Z',
                    updatedAt: '2026-04-18T12:00:00.000Z',
                    recipes: [makeCollectionMemberRecipe({ id: RECIPE_ID, title: 'Weeknight Pasta' })],
                }}
                onSelectRecipe={noop}
                onRemoveRecipe={noop}
                onAddRecipe={noop}
                renderNutrition={renderNutrition}
            />
        ),
    ],
];

/** The host closure every real container writes: ONE promise, one slot per card. */
const rendererFor =
    (batch: Promise<RecipeNutritionResponse>): RenderRecipeNutrition =>
    (recipeId: string): ReactNode => <RecipeNutritionSlot nutritionBatchPromise={batch} recipeId={recipeId} />;

const renderSurface = async (
    surface: (render: RenderRecipeNutrition) => ReactElement,
    batch: Promise<RecipeNutritionResponse>,
) =>
    act(async () => {
        render(surface(rendererFor(batch)));
    });

describe.each(SURFACES)('%s — the deferred calorie figure', (_name, surface) => {
    it('shows the calorie SKELETON while the batch is in flight', async () => {
        await renderSurface(surface, new Promise<RecipeNutritionResponse>(() => undefined));

        expect(screen.getByText('Loading calories')).toBeTruthy();
    });

    it('shows the CHIP in the card once the batch resolves', async () => {
        await renderSurface(surface, Promise.resolve(KNOWN_RESPONSE));

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByText('Loading calories')).toBeNull();
    });

    it('shows NOTHING when the batch OMITS this recipe — and no lingering skeleton', async () => {
        await renderSurface(surface, Promise.resolve(OMITTING_RESPONSE));

        expect(screen.queryByText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        // The card itself is still there — "nothing" is an absent figure, not an absent card.
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });

    it('shows NOTHING, and no spinner, when the batch REJECTS', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        failed.catch(() => undefined);

        await renderSurface(surface, failed as Promise<RecipeNutritionResponse>);

        expect(screen.queryByText('Loading calories'), 'a failed batch must not leave a spinner').toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });

    it('renders NO nutrition line at all when the host supplies no renderer (the absent-value rule)', async () => {
        await act(async () => {
            render(surface(() => null));
        });

        expect(screen.queryByText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });
});
