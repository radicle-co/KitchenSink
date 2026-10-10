/**
 * Integration component test for the mobile `HomeScreen` (US-000 / FR-046 / U8). Rendered via
 * react-native-web under jsdom (see `vitest.native.config.ts`), it composes the REAL Home widget surface
 * (greeting + chrome + curated widgets) so the U8 brand adoption is verified end-to-end through the screen
 * the navigator actually mounts — not only at the surface/leaf unit level.
 *
 * What it pins:
 *  - the greeting sits on the app canvas, not in a gradient card (`docs/design/uiOverhaul/buildSpec.md` §1.6), and
 *  - the roadmap placeholders sit under one "Coming soon" heading, after the recent recipes (`buildSpec.md` §4.2).
 *
 * The heavy leaves the screen pulls in are stubbed exactly as every other native screen test does: the
 * safe-area context and `useUserProfile` (real modules import native/Clerk code that will not parse under
 * jsdom), Sentry (so importing `homeContainer` does not drag in its native module graph), and the recipe
 * service `useRecipes` hook (so the live recipe widget renders without a query client). Real gradient
 * rendering is emulator-only (Maestro) — here it resolves to the marked jsdom stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));

// Zero insets by default; the landscape case sets distinct per-edge values, so one applied to the wrong edge fails.
const safeArea = vi.hoisted(() => ({ insets: { top: 0, bottom: 0, left: 0, right: 0 } }));

vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSafeAreaInsets: () => safeArea.insets,
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () => ({ data: { account: { subscriptionTier: 'free' }, user: { displayName: 'Jane Doe' } } }),
}));

// The live recipe widget slot reads the viewer's recent recipes; a resolved empty page renders the widget's
// empty state with no query client, keeping this screen-level render self-contained.
vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useRecipes: () => ({ isLoading: false, data: { data: [], nextCursor: undefined } }),
}));

const { HomeScreen } = await import('../../src/screens/HomeScreen.js');
const { ScrollHost } = await import('@commise/ui/scroll-host');
const { RECENT_RECIPE_LIMIT } = await import('../../src/components/home/RecipeWidgetSlot.js');

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    safeArea.insets = { top: 0, bottom: 0, left: 0, right: 0 };
});

const noop = (): void => undefined;

/** Render Home in its scroll host, as the Home tab's root does, handing back a way to scroll it. */
function renderHome(
    onOpenProfile = noop,
    onCreateRecipe = noop,
    queryClient = new QueryClient(),
): { scroll: (y: number) => void } {
    const seen: { scroll?: (y: number) => void } = {};

    renderWithProviders(
        <QueryClientProvider client={queryClient}>
            <ScrollHost>
                {(bind) => {
                    seen.scroll = (y) =>
                        bind.onScroll({
                            nativeEvent: {
                                contentOffset: { y },
                                layoutMeasurement: { height: 800 },
                                contentSize: { height: 3000 },
                            },
                        });

                    return (
                        <HomeScreen
                            scrollBind={bind}
                            onOpenRecipes={noop}
                            onOpenRecipe={noop}
                            onOpenProfile={onOpenProfile}
                            onCreateRecipe={onCreateRecipe}
                            onPasteIngredients={noop}
                            onFindOnDiscover={noop}
                        />
                    );
                }}
            </ScrollHost>
        </QueryClientProvider>,
    );

    return { scroll: (y) => act(() => seen.scroll?.(y)) };
}

/**
 * Slice 3 (`buildSpec.md` §4.2, §3.3, §3.4): Home's large title is the greeting with the cook's name, its action the
 * avatar (Profile, pushed); the floating "New recipe" sits over the screen's foot; the condensed bar shows only once the
 * title scrolls under the top.
 */
describe('HomeScreen (mobile) — the large title, the avatar and the create button', () => {
    it('greets the cook by name in the screen’s one header, on the canvas', () => {
        renderHome();

        const heading = screen.getByRole('heading', { name: /, Jane Doe\??$/u });

        expect(heading.closest('[data-commise-stub="linear-gradient"]')).toBeNull();
    });

    it('opens Profile from the avatar, named "Profile, Jane Doe"', () => {
        const onOpenProfile = vi.fn();
        renderHome(onOpenProfile);

        fireEvent.click(screen.getByRole('button', { name: 'Profile, Jane Doe' }));

        expect(onOpenProfile).toHaveBeenCalledOnce();
    });

    it('floats the "New recipe" create button over the screen', () => {
        renderHome();

        expect(screen.getByRole('button', { name: 'New recipe' })).toBeTruthy();
    });

    // §3.4: the first run's own start buttons (Add your first recipe, Paste ingredients) take the button's place.
    it('hides the "New recipe" create button while the cook has no recipes', async () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }), {
            data: [],
            total: 0,
            page: 1,
            pageSize: RECENT_RECIPE_LIMIT,
            hasMore: false,
        });

        renderHome(noop, noop, queryClient);

        await waitFor(() => expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull());
    });

    it('keeps the condensed title bar hidden at the top', () => {
        renderHome();

        const bar = screen.getAllByText(/, Jane Doe\??$/u).find((node) => node.getAttribute('aria-hidden') === 'true');

        expect(bar?.closest('[aria-hidden="true"][style*="position"]') ?? bar).toBeTruthy();
        expect(getComputedStyle(bar as Element).opacity).toBe('0');
    });

    it('still renders the roadmap placeholders under the recent recipes', async () => {
        renderHome();

        expect(await screen.findByText('Today’s nutrition')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Coming soon' })).toBeTruthy();
    });
});
