/**
 * The recipe Home-widget slot must not let a WIDGET-BODY failure take the "see all recipes" NAVIGATION entry
 * with it.
 *
 * Why this is its own file: the slot builds its `React.lazy` at MODULE scope, and `React.lazy` CACHES a
 * rejected loader promise — once it rejects, every later render re-throws the same error for the life of the
 * module. So the rejecting-loader double has to own a fresh module registry rather than share the happy-path
 * file's.
 *
 * The failure this pins was observed in CI: Home rendered its three roadmap placeholders and then simply
 * STOPPED — no recipe widget, no "See all recipes", just blank space where the slot should be (Maestro
 * `signin.yaml` then timed out scrolling for that entry, taking `photos` and `discover-recent-searches` with
 * it). Because the slot renders the entry unconditionally, the only way to get nothing is the host's
 * per-widget `ErrorBoundary` catching a throw — and its `fallback={null}` erased the whole slot, navigation
 * included. `Suspense` does not help here: it handles a PENDING lazy chunk, never a REJECTED one.
 *
 * The widget's content is allowed to disappear when its chunk fails. The route out of Home is not — and the
 * error must still be reported, never swallowed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { renderWithProviders } from '@commise/test-utils';
import { useRecipes } from '@kitchensink/recipe-service-client/hooks';
import { Text } from 'react-native';

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({ useRecipes: vi.fn() }));

// The descriptor's loader seam REJECTS — the real-world shape of an async chunk that fails to fetch.
vi.mock('@commise/features-recipes', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes')>()),
    recipeHomeWidgetDescriptor: {
        id: 'recipes',
        capability: 'recipes',
        defaultWeight: 1000,
        load: () => Promise.reject(new Error('chunk load failed')),
    },
}));

const { RecipeWidgetSlot } = await import('../../../src/components/home/RecipeWidgetSlot.js');

const useRecipesMock = vi.mocked(useRecipes);

afterEach(cleanup);

beforeEach(() => {
    useRecipesMock.mockReset();
    useRecipesMock.mockReturnValue({ isLoading: false, data: undefined } as unknown as ReturnType<typeof useRecipes>);
    // React logs the caught boundary error; silence it so a PASSING run has clean output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/**
 * Mirrors production composition: `HomeWidgetSurface` draws every widget through a per-widget
 * `ErrorBoundary`. Without that wrapper here, a slot-level escape would fail the render outright instead of
 * reproducing the silent-erasure this file guards against.
 *
 * Its fallback is a DISTINCT sentinel rather than the real host copy on purpose: both boundaries now render
 * the SAME localized notice, so a shared string could not tell "the inner boundary contained the failure"
 * apart from "the failure escaped and erased the navigation too" — the very regression this file exists for.
 */
const HOST_BOUNDARY_SENTINEL = 'host-boundary-fired';

const HostBoundary = ({ children }: { readonly children: ReactNode }): JSX.Element => (
    <ErrorBoundary fallback={<Text>{HOST_BOUNDARY_SENTINEL}</Text>}>{children}</ErrorBoundary>
);

/**
 * Let the REJECTED lazy chunk propagate through the boundaries before asserting. Without this the entry is
 * still on screen from the first (pending-chunk) render pass, so an immediate query passes even when the
 * rejection goes on to erase the whole slot — the exact regression under test.
 */
async function settleChunkRejection(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });
    });
}

describe('RecipeWidgetSlot (mobile) — the widget chunk fails to load', () => {
    it('keeps the "see all recipes" entry usable when the widget chunk rejects', async () => {
        const onSeeAllRecipes = vi.fn();

        renderWithProviders(
            <HostBoundary>
                <RecipeWidgetSlot onSeeAllRecipes={onSeeAllRecipes} onSelectRecipe={() => undefined} />
            </HostBoundary>,
        );

        await settleChunkRejection();

        const entry = screen.getByRole('button', { name: 'See all recipes' });
        fireEvent.click(entry);

        expect(onSeeAllRecipes).toHaveBeenCalledTimes(1);
    });

    it('explains the loss with a localized notice instead of leaving blank space', async () => {
        renderWithProviders(
            <HostBoundary>
                <RecipeWidgetSlot onSeeAllRecipes={() => undefined} onSelectRecipe={() => undefined} />
            </HostBoundary>,
        );

        await settleChunkRejection();

        // The drift this fixes: mobile's inner boundary rendered `null`, so a failed widget left unexplained
        // blank space — and a screen-reader user got NOTHING at all. Web renders its localized `widgetError`
        // here; the two platforms must degrade identically (FR-044 / §14), so the copy is the SAME literal.
        expect(screen.getByText('This section couldn’t load.')).toBeTruthy();

        // Announced, not merely painted — the accessibility half of the same defect.
        expect(screen.getByRole('alert')).toBeTruthy();

        // …and the notice must come from the INNER boundary. If the throw had escaped to the host boundary the
        // sentinel would be showing and the navigation entry would be gone — a silent regression that a bare
        // "is the message on screen?" assertion would happily pass.
        expect(screen.queryByText(HOST_BOUNDARY_SENTINEL)).toBeNull();
        expect(screen.getByRole('button', { name: 'See all recipes' })).toBeTruthy();
    });

    it('does not offer a retry affordance it cannot honour (React.lazy caches the rejection)', async () => {
        renderWithProviders(
            <HostBoundary>
                <RecipeWidgetSlot onSeeAllRecipes={() => undefined} onSelectRecipe={() => undefined} />
            </HostBoundary>,
        );

        await settleChunkRejection();

        // Deliberate, and matched by web: the ONLY control in the failed slot is the route out of Home. React's
        // `lazyInitializer` moves the payload to `_status = 2` on rejection and thereafter re-`throw`s the
        // cached `_result` WITHOUT re-invoking the loader, so a "try again" that merely reset this boundary
        // would re-throw instantly and appear dead. A retry that silently fails is worse than none; see the
        // boundary's comment in `RecipeWidgetSlot.tsx` for what a real retry would have to do instead.
        const controls = screen.getAllByRole('button');

        expect(controls).toHaveLength(1);
        expect(controls[0]?.textContent).toBe('See all recipes');
    });

    it('reports the widget failure rather than swallowing it', async () => {
        const onWidgetError = vi.fn();

        renderWithProviders(
            <HostBoundary>
                <RecipeWidgetSlot
                    onSeeAllRecipes={() => undefined}
                    onSelectRecipe={() => undefined}
                    onWidgetError={onWidgetError}
                />
            </HostBoundary>,
        );

        await settleChunkRejection();

        expect(screen.getByRole('button', { name: 'See all recipes' })).toBeTruthy();
        expect(onWidgetError).toHaveBeenCalledTimes(1);
        expect(onWidgetError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    });
});
