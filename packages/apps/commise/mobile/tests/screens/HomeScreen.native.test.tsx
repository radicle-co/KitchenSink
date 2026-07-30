/**
 * Integration component test for the mobile `HomeScreen` (US-000 / FR-046 / U8). Rendered via
 * react-native-web under jsdom (see `vitest.native.config.ts`), it composes the REAL Home widget surface
 * (greeting + chrome + curated widgets) so the U8 brand adoption is verified end-to-end through the screen
 * the navigator actually mounts — not only at the surface/leaf unit level.
 *
 * What it pins:
 *  - the greeting sits on the brand beach-glow gradient hero (the shared `GradientSurface`, `hero`), and
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

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () => ({ data: { account: { subscriptionTier: 'free' }, user: { displayName: 'Jane Doe' } } }),
}));

// The live recipe widget slot reads the viewer's recent recipes; a resolved empty page renders the widget's
// empty state with no query client, keeping this screen-level render self-contained.
vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipes: () => ({ isLoading: false, data: { data: [], nextCursor: undefined } }),
}));

const { HomeScreen } = await import('../../src/screens/HomeScreen.js');

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const noop = (): void => undefined;

describe('HomeScreen (mobile) — U8 brand adoption', () => {
    it('renders the greeting on the brand gradient hero and the widget cards on frosted glass', async () => {
        const { container } = renderWithProviders(
            <HomeScreen onOpenRecipes={noop} onOpenRecipe={noop} onOpenProfile={noop} />,
        );

        // The greeting (any time-of-day bucket says "Chef") sits inside the hero gradient surface — the
        // `expo-linear-gradient` stub, projecting the hero beach-glow ramp (terminal cool tint `#E8F4F8`).
        const greeting = screen.getByText(/Chef/u);
        const hero = greeting.closest('[data-commise-stub="linear-gradient"]');
        expect(hero).not.toBeNull();
        expect(hero?.getAttribute('data-colors')).toContain('#E8F4F8');

        // The roadmap widget cards load lazily; once one is present, its glass surface (the `expo-blur`
        // BlurView stub) must be on the screen — proving the frosted-glass adoption reaches the real screen.
        expect(await screen.findByText("Today's Nutrition")).toBeTruthy();
        expect(container.querySelector('[data-commise-stub="blur-view"]')).not.toBeNull();
    });
});
