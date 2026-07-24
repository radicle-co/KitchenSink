// @vitest-environment jsdom
/**
 * Component tests for the web recipe Home-widget slot (T104-web). The slot code-splits the real widget
 * through the descriptor loader (`next/dynamic`) and feeds it the viewer's recent recipes as a promise from
 * the injected recipe client, so these exercise the widget's three data states end-to-end (skeleton while
 * pending, recent list when populated, empty state when none) plus the slot's own "see all recipes" link.
 *
 * DETERMINISM — why this file no longer flakes (the prior 15s/20s timeout band-aids did not help, because the
 * cause was a wedge, not slowness). Two root causes, each fixed:
 *
 *  1. Resolve the Suspense with `await act(...)`, never `findBy`/`waitFor`. The widget's loading state is a real
 *     `<Suspense>` that `use()`s the recipes promise. Reproduced in isolation: the FIRST such render in a Vitest
 *     worker resolved fine, but every SUBSEQUENT one wedged when driven by `findBy` polling — the Suspense retry
 *     never flushed and the assertion waited out the whole timeout. Wrapping the resolving render in
 *     `await act(async () => render(...))` flushes the promise resolution + Suspense retry synchronously, so the
 *     content is present immediately and `getBy*` suffices. This mirrors the widget's own passing test
 *     (`features/recipes/.../RecipeHomeWidget.test.tsx`), which renders the same `use()`+Suspense widget four
 *     times in one worker without flaking.
 *  2. Render the widget directly in place of the `next/dynamic` async chunk load. The slot loads the widget via
 *     `next/dynamic(ssr:false)`, whose client-only bailout adds an async mount cycle that `act` cannot flush
 *     deterministically under jsdom. The mock resolves the SAME module the descriptor's loader imports, so the
 *     real widget, its data Suspense, and the slot's promise wiring all stay under test — only the bundler
 *     chunk-load seam is removed (real browsers exercise it; the Playwright suite covers it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

// Render the real recipe widget synchronously in place of the `next/dynamic` code-split (see DETERMINISM #2).
// The mock resolves the SAME module the descriptor's loader imports — nothing about the widget is stubbed.
vi.mock('next/dynamic', async () => {
    const widgetModule = await import('@commise/features-recipes/widget/web');

    return { default: (): ComponentType<{ recipesPromise: Promise<readonly Recipe[]> }> => widgetModule.default };
});

import type { Recipe } from '@kitchensink/recipe-core';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';

import { renderWithProviders } from '@commise/test-utils';

import { RecipeWidgetSlot } from '../RecipeWidgetSlot';

afterEach(cleanup);

const makeRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
    id: 'rec_1',
    ownerId: 'usr_1',
    title: 'Weeknight Pasta',
    description: 'A quick dinner',
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    totalTimeMinutes: 25,
    servings: 2,
    difficulty: 'medium',
    visibility: 'private',
    status: 'published',
    sourceType: 'user_created',
    hasSubstantiveEdit: false,
    dietaryFlags: [],
    tags: ['dinner'],
    hasPartialNutrition: false,
    currentVersion: 1,
    averageRating: 4.5,
    ratingCount: 12,
    usesPremiumCapability: true,
    coverPhotoUrl: 'https://cdn.commise.app/recipes/rec_1/cover.jpg',
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z',
    ...overrides,
});

/**
 * A real, network-guarded {@link RecipeServiceClient} (see `@kitchensink/recipe-service-client/testing`)
 * whose `listRecipes` is stubbed via a type-checked `vi.spyOn` to resolve the supplied recipes — replacing
 * the former hand-built `{ listRecipes }` object force-cast `as unknown as RecipeServiceClient`, which let a
 * client-method rename/reshape pass `tsc` silently.
 */
const clientReturning = (recipes: () => Promise<readonly Recipe[]>): RecipeServiceClient => {
    const client = createFakeRecipeServiceClient();

    vi.spyOn(client, 'listRecipes').mockImplementation(() =>
        recipes().then((data) => ({
            data: [...data],
            total: data.length,
            page: 1,
            pageSize: data.length,
            hasMore: false,
        })),
    );

    return client;
};

const slot = (client: RecipeServiceClient): ReactElement => (
    <RecipeServiceProvider client={client}>
        <RecipeWidgetSlot />
    </RecipeServiceProvider>
);

/** Render the slot and flush the recipes-promise resolution + Suspense retry, so `getBy*` sees the content. */
const renderResolved = async (client: RecipeServiceClient): Promise<void> => {
    await act(async () => {
        renderWithProviders(slot(client));
    });
};

describe('RecipeWidgetSlot (web)', () => {
    it('shows the skeleton card (widget title, no recipes) while the recipes promise is pending', () => {
        // A pending (never-settling) promise keeps the widget suspended → the skeleton fallback renders. This is
        // a synchronous render with no `await`, so it leaves no resolved Suspense work (and nothing to flush).
        renderWithProviders(slot(clientReturning(() => new Promise<readonly Recipe[]>(() => {}))));

        expect(screen.getByText('Recent recipes')).toBeTruthy(); // the skeleton card title
        expect(screen.queryByText('No recipes yet. Create your first recipe to see it here.')).toBeNull();
    });

    it('renders the recent recipes once the promise resolves', async () => {
        await renderResolved(clientReturning(() => Promise.resolve([makeRecipe({ title: 'Weeknight Pasta' })])));

        expect(screen.getByText('Weeknight Pasta')).toBeTruthy();
    });

    it('renders the empty state when the viewer has no recipes', async () => {
        await renderResolved(clientReturning(() => Promise.resolve([])));

        expect(screen.getByText('No recipes yet. Create your first recipe to see it here.')).toBeTruthy();
    });

    it('renders a "see all recipes" entry point into the recipes surface', async () => {
        await renderResolved(clientReturning(() => Promise.resolve([])));

        const link = screen.getByRole('link', { name: 'See all recipes' });
        expect(link.getAttribute('href')).toContain('/recipes');
    });
});
