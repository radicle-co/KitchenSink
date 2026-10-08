/**
 * Integration component test for the mobile `HomeScreen` (US-000 / FR-046 / U8). Rendered via
 * react-native-web under jsdom (see `vitest.native.config.ts`), it composes the REAL Home widget surface
 * (greeting + chrome + curated widgets) so the U8 brand adoption is verified end-to-end through the screen
 * the navigator actually mounts — not only at the surface/leaf unit level.
 *
 * What it pins:
 *  - the greeting sits on the app canvas, not in a gradient card (`docs/design/uiOverhaul/buildSpec.md` §1.6), and
 *  - the roadmap widget cards adopt the shared frosted-glass surface (`GlassCard` → `expo-blur` BlurView).
 *
 * The heavy leaves the screen pulls in are stubbed exactly as every other native screen test does: the
 * safe-area context and `useUserProfile` (real modules import native/Clerk code that will not parse under
 * jsdom), Sentry (so importing `homeContainer` does not drag in its native module graph), and the recipe
 * service `useRecipes` hook (so the live recipe widget renders without a query client). Real gradient/blur
 * rendering is emulator-only (Maestro) — here they resolve to the marked jsdom stubs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));

// Zero insets by default; the landscape case sets distinct per-edge values, so one applied to the wrong edge fails.
const safeArea = vi.hoisted(() => ({ insets: { top: 0, bottom: 0, left: 0, right: 0 } }));

vi.mock('react-native-safe-area-context', () => ({
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

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    safeArea.insets = { top: 0, bottom: 0, left: 0, right: 0 };
});

const noop = (): void => undefined;

describe('HomeScreen (mobile) — U8 brand adoption', () => {
    it('renders the greeting on the canvas and the widget cards on frosted glass', async () => {
        const { container } = renderWithProviders(
            <HomeScreen onOpenRecipes={noop} onOpenRecipe={noop} onOpenProfile={noop} />,
        );

        // The greeting (any time-of-day bucket says "Chef") is NOT wrapped in a gradient card: §1.6 deleted it, and
        // the app canvas already carries the wash.
        expect(screen.getByText(/Chef/u).closest('[data-commise-stub="linear-gradient"]')).toBeNull();

        // The roadmap widget cards load lazily; once one is present, its glass surface (the `expo-blur`
        // BlurView stub) must be on the screen — proving the frosted-glass adoption reaches the real screen.
        expect(await screen.findByText("Today's Nutrition")).toBeTruthy();
        expect(container.querySelector('[data-commise-stub="blur-view"]')).not.toBeNull();
    });
});

/**
 * In landscape a camera cutout or Android's three-button navigation bar sits on a SIDE edge, drawn over content, so
 * the screen pads by the side insets as well as the top (staff-ux-engineer landscape EVALUATE, finding 2).
 */
describe('HomeScreen (mobile) — landscape safe area', () => {
    it('pads the screen by the top and both side insets', () => {
        safeArea.insets = { top: 24, right: 48, bottom: 0, left: 59 };
        renderWithProviders(<HomeScreen onOpenRecipes={noop} onOpenRecipe={noop} onOpenProfile={noop} />);

        const frame = screen.getByText(/Chef/u).closest<HTMLElement>('[style*="padding-left"]');

        expect(frame?.style.paddingLeft).toBe('59px');
        expect(frame?.style.paddingRight).toBe('48px');
        expect(frame?.style.paddingTop).toBe('24px');
    });
});
