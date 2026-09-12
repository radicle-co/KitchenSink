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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType, ReactElement } from 'react';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

// The slot owns the widget's navigation, so it reads the App Router. There is no router context under jsdom,
// so `useRouter` is stubbed to a spy we can assert the pushed route against.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

// Render the real recipe widget synchronously in place of the `next/dynamic` code-split (see DETERMINISM #2).
// The mock resolves the SAME module the descriptor's loader imports — nothing about the widget is stubbed.
vi.mock('next/dynamic', async () => {
    const widgetModule = await import('@commise/features-recipes/widget/web');

    return { default: (): ComponentType<{ recipesPromise: Promise<readonly Recipe[]> }> => widgetModule.default };
});

import type { Recipe } from '@kitchensink/recipe-core';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { renderWithRecipeClient, utilityContrast } from '@commise/test-utils';

import { RecipeWidgetSlot } from '../RecipeWidgetSlot';

afterEach(cleanup);
beforeEach(() => pushMock.mockReset());

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

/**
 * The slot under its production provider stack. `renderWithRecipeClient` (not the bare `renderWithProviders`
 * + a hand-nested `RecipeServiceProvider`) because the slot now also starts the deferred calorie batch
 * through the shared query cache — `RecipeProviders` mounts exactly this pair, `QueryClientProvider` +
 * `RecipeServiceProvider`, in `[locale]/layout.tsx`, so this harness is the real tree rather than a subset
 * of it. Nothing about the assertions below changed.
 */
const slot = (): ReactElement => <RecipeWidgetSlot />;

/**
 * Render the slot and flush the recipes-promise resolution + Suspense retry, returning RTL's result so a
 * caller that needs the DOM root (e.g. a layout assertion) can reach it.
 */
const renderResolvedResult = async (client: RecipeServiceClient): Promise<RenderResult> => {
    let result!: RenderResult;

    await act(async () => {
        result = renderWithRecipeClient(slot(), client);
    });

    return result;
};

/** Render the slot and flush the recipes-promise resolution + Suspense retry, so `getBy*` sees the content. */
const renderResolved = async (client: RecipeServiceClient): Promise<void> => {
    await renderResolvedResult(client);
};

describe('RecipeWidgetSlot (web)', () => {
    it('shows the skeleton card (widget title, no recipes) while the recipes promise is pending', () => {
        // A pending (never-settling) promise keeps the widget suspended → the skeleton fallback renders. This is
        // a synchronous render with no `await`, so it leaves no resolved Suspense work (and nothing to flush).
        renderWithRecipeClient(
            slot(),
            clientReturning(() => new Promise<readonly Recipe[]>(() => {})),
        );

        expect(screen.getByText('Recent recipes')).toBeTruthy(); // the skeleton card title
        expect(screen.queryByText('No recipes yet. Create your first recipe to see it here.')).toBeNull();

        // ⛔ And the route off Home is STILL THERE while the widget waits. The slot suspends internally now
        // (its inner container has to resolve the recipes before it can start the deferred calorie batch), and
        // a boundary drawn one level too high — around this whole slot rather than around the widget — blanks
        // the link for the entire duration of the fetch. That is the same loss the inner ErrorBoundary exists
        // to prevent, arriving through the loading path instead of the failure path, and it is invisible to
        // every other assertion in this file.
        expect(screen.getByRole('link', { name: 'See all recipes' })).toBeTruthy();
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

    it('keeps the "see all recipes" link WCAG-AA legible on the Home surface', async () => {
        await renderResolved(clientReturning(() => Promise.resolve([])));

        // The slot's only navigation affordance is bare text on the Home surface — no tint of its own — so
        // the ratio is the token against the surface: seafoam scored 4.02:1, under the 4.5:1 body-text floor
        // (SC 1.4.3). See the palette JSDoc in `@commise/ui` for when seafoam IS still the right token.
        const link = screen.getByRole('link', { name: 'See all recipes' });

        expect(utilityContrast(link.className), '“See all recipes” link').toBeGreaterThanOrEqual(4.5);
    });

    it('lays the recent recipes out as the mockup card grid (2-up, 4-up from md)', async () => {
        const { container } = await renderResolvedResult(
            clientReturning(() => Promise.resolve([makeRecipe({ id: 'rec_1' })])),
        );

        const className = container.querySelector('ul')?.className ?? '';
        expect(className).toContain('grid-cols-2');
        expect(className).toContain('md:grid-cols-4');
    });

    it('navigates to the activated recipe’s locale-prefixed detail route (the slot owns routing)', async () => {
        const user = userEvent.setup();
        await renderResolved(
            clientReturning(() =>
                Promise.resolve([
                    makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
                    makeRecipe({ id: 'rec_2', title: 'Chana Masala' }),
                ]),
            ),
        );

        await user.click(screen.getByRole('button', { name: 'Chana Masala' }));

        // The SECOND recipe's id, under the active locale prefix — a bare `/recipes/rec_2` or the first
        // recipe's id would both fail here.
        expect(pushMock).toHaveBeenCalledExactlyOnceWith('/en/recipes/rec_2');
    });

    it('does not navigate merely from rendering the grid (routing happens only on activation)', async () => {
        await renderResolved(clientReturning(() => Promise.resolve([makeRecipe({ id: 'rec_1' })])));

        expect(pushMock).not.toHaveBeenCalled();
    });
});
