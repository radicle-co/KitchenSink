/**
 * ⛔ THE WIRING TEST, NATIVE HALF: every React Native card surface renders the deferred calorie figure, in
 * every state. The twin of `cardSurfaces.nutrition.test.tsx` — same matrix, same states, same assertions,
 * against the `.native.tsx` leaves.
 *
 * Why the web file does not cover this (the §14 argument `omittedRecipe.native.test.tsx` already makes): the
 * slot's model is shared, but the tree that MOUNTS it is a different component per platform. A web-only
 * assertion would leave "the figure reaches the meta row" and "no skeleton outlives the request" unproven on
 * the platform where a spinner in a virtualized list is hardest to notice — and native has its own way to
 * lose the slot, since `RecipeDiscoveryCard.native` and `CollectionMemberRow.native` compose CUSTOM
 * `RecipeCard` arrangements and an arrangement that omits `RecipeCard.Meta` drops the node SILENTLY.
 *
 * ⚠️ ONE SURFACE MORE THAN WEB. `RecipeBrowseRails` is native's fifth card surface here because it is the
 * DEFAULT state of Discover on both platforms (the rails render `RecipeDiscoveryCard`s), and it was missing
 * from the web table — a card grid with no figure on the screen a viewer sees first. Web owes it the same
 * row; see the report.
 *
 * ⚠️ SUSPENSE TEST CONVENTION: resolve a Suspense with `await act(...)`, NEVER `findBy`/`waitFor` — the
 * latter wedges in a Vitest worker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { Recipe } from '@kitchensink/recipe-core';
import type { RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { makeCollectionMemberRecipe, makeRecipe, makeRecipeListItem } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionDetail } from '../../collections/CollectionDetail.native.js';
import { RecentRecipeGrid } from '../../components/RecentRecipeGrid.native.js';
import { RecipeBrowseRails } from '../../discovery/RecipeBrowseRails.native.js';
import { RecipeDiscoveryList } from '../../discovery/RecipeDiscoveryList.native.js';
import { RecipeList } from '../../list/RecipeList.native.js';
import { RecipeNutritionSlot } from '../RecipeNutritionSlot.native.js';
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

/** A response that carries NO entry for this recipe — the "not for you" absence, which renders blank. */
const OMITTING_RESPONSE: RecipeNutritionResponse = { nutrition: {} };

const noop = () => undefined;

const recipe: Recipe = makeRecipe({ id: RECIPE_ID, title: 'Weeknight Pasta' });

/**
 * Every native surface that paints a recipe card, rendered exactly as its real host renders it — with the
 * host's ONE renderer closure over the shared batch promise. A surface belongs in this table iff a viewer can
 * see a recipe card on it.
 */
const SURFACES: readonly (readonly [string, (render: RenderRecipeNutrition) => ReactElement])[] = [
    [
        'RecipeList (native)',
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
        'RecipeDiscoveryList (native)',
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
        'RecipeBrowseRails (native — Discover’s DEFAULT state)',
        (renderNutrition) => (
            <RecipeBrowseRails
                rails={[{ id: 'trending', status: 'ready', results: [{ recipe }], onSeeAll: noop }]}
                cuisines={[]}
                onSelectRecipe={noop}
                onClone={noop}
                renderNutrition={renderNutrition}
            />
        ),
    ],
    [
        'RecentRecipeGrid (native — the Home widget)',
        (renderNutrition) => (
            <RecentRecipeGrid recipes={[toRecipeCardModel(recipe)]} renderNutrition={renderNutrition} />
        ),
    ],
    [
        'CollectionDetail (native)',
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

        // React Native has no live region, so the skeleton's copy is its accessible NAME (see the leaf).
        expect(screen.getByLabelText('Loading calories')).toBeTruthy();
    });

    it('shows the CHIP in the card once the batch resolves', async () => {
        await renderSurface(surface, Promise.resolve(KNOWN_RESPONSE));

        expect(screen.getByRole('img', { name: '420 cal' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading calories')).toBeNull();
    });

    it('shows NOTHING when the batch OMITS this recipe — and no lingering skeleton', async () => {
        await renderSurface(surface, Promise.resolve(OMITTING_RESPONSE));

        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        // The card itself is still there — "nothing" is an absent figure, not an absent card.
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });

    it('shows NOTHING, and no spinner, when the batch REJECTS', async () => {
        const failed = Promise.reject(new Error('food service unavailable'));
        failed.catch(() => undefined);

        await renderSurface(surface, failed as Promise<RecipeNutritionResponse>);

        expect(screen.queryByLabelText('Loading calories'), 'a failed batch must not leave a spinner').toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });

    it('renders NO nutrition line at all when the host supplies no renderer (the absent-value rule)', async () => {
        await act(async () => {
            render(surface(() => null));
        });

        expect(screen.queryByLabelText('Loading calories')).toBeNull();
        expect(screen.queryByText(/cal$/u)).toBeNull();
        expect(screen.getAllByText('Weeknight Pasta').length).toBeGreaterThan(0);
    });
});
