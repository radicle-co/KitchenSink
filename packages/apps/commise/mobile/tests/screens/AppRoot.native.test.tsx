/**
 * Component test for the mobile root `ErrorBoundary` (B18) — the app-level safety net wrapped around
 * `AppRoot`'s screen switch (the per-widget Home boundaries stay untouched; this is the layer above them).
 * A render crash anywhere under `AppRoot` must not white-screen the app: the localized, recoverable fallback
 * renders, the crash is reported through the DA9 `errorReporterToken` seam (the SAME `homeContainer` binding
 * the Home-widget boundaries already use — mirroring the web root boundary's reuse of `homeContainer`), and
 * the retry affordance re-invokes the crashed subtree.
 *
 * `@sentry/react-native` is mocked (never loaded for real) so importing `homeContainer` here doesn't drag in
 * its native module graph under jsdom, mirroring `HomeWidgetSurface.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Text } from 'react-native';

import { renderWithProviders } from '@commise/test-utils';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));

// `AppRoot` statically imports all 3 top-level screens (Home/Recipes/Profile), so importing it always pulls
// in every screen's module graph even though only one renders at a time. Two of those chains need the SAME
// stubs every other native screen test already applies: `react-native-safe-area-context` (its real module
// does not parse under jsdom/react-native-web — see e.g. `HomeWidgetSurface.native.test.tsx`) and the app's
// own `useUserProfile` hook (its real implementation imports `@clerk/expo`, likewise unparseable here).
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));
vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () => ({ data: undefined }),
    // CR-002 / U4b: ProfileScreen now composes AccountDangerZone, which reads `useDeleteAccount` and imports
    // `@clerk/expo` directly (not only through `useUserProfile`) — stub both so the real ProfileScreen module
    // graph parses even though it never renders here.
}));

vi.mock('../../src/hooks/useDeleteAccount.js', () => ({
    useDeleteAccount: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ signOut: () => undefined }) }));

const { shouldThrowRef, profileThrowsRef, resetQueryErrors } = vi.hoisted(() => ({
    shouldThrowRef: { current: true },
    profileThrowsRef: { current: false },
    resetQueryErrors: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@tanstack/react-query')>()),
    useQueryErrorResetBoundary: () => ({ reset: resetQueryErrors, clearReset: vi.fn(), isReset: () => false }),
}));

// Stub the default ('home') destination screen so a render throw is fully under this test's control — every
// other screen (`RecipesScreen`, `ProfileScreen`) is imported for real but never rendered in these cases.
vi.mock('../../src/screens/HomeScreen.js', () => ({
    HomeScreen: ({ onOpenProfile }: { readonly onOpenProfile: () => void }) => {
        if (shouldThrowRef.current) {
            throw new Error('boom');
        }

        return (
            <>
                <Text>Recovered home</Text>
                <Text accessibilityRole="button" onPress={onOpenProfile}>
                    Open profile
                </Text>
            </>
        );
    },
}));

vi.mock('../../src/screens/profile.js', () => ({
    ProfileScreen: () => {
        if (profileThrowsRef.current) {
            throw new Error('profile boom');
        }

        return <Text>Profile</Text>;
    },
}));

const { AppRoot } = await import('../../src/screens/AppRoot.js');
const { captureException } = await import('@sentry/react-native');

afterEach(() => {
    cleanup();
    shouldThrowRef.current = true;
    profileThrowsRef.current = false;
    vi.clearAllMocks();
});

describe('AppRoot root ErrorBoundary', () => {
    it('renders the recoverable fallback (not a white screen) and reports the crash via DA9', () => {
        renderWithProviders(<AppRoot />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
        expect(captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({ extra: expect.objectContaining({ boundary: 'root' }) }),
        );
    });

    it('retry re-invokes the crashed subtree, recovering once the cause clears', () => {
        renderWithProviders(<AppRoot />);
        expect(screen.getByRole('alert')).toBeTruthy();

        shouldThrowRef.current = false;
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));

        expect(screen.getByText('Recovered home')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    /**
     * ⛔ A retry that re-renders a failed READ must refetch it: a query that threw into this boundary keeps
     * `retryOnMount` off until TanStack's query-error reset boundary is reset, so Try again resets it too.
     */
    it('⛔ Try again also resets the query errors, so a failed read refetches', () => {
        renderWithProviders(<AppRoot />);

        shouldThrowRef.current = false;
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));

        expect(resetQueryErrors).toHaveBeenCalled();
    });

    it('offers Back to Home when a screen other than Home crashed, and it lands on Home', () => {
        shouldThrowRef.current = false;
        profileThrowsRef.current = true;
        renderWithProviders(<AppRoot />);

        fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText('We hit a snag loading this screen. Try again, or go back to Home.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));

        expect(screen.getByText('Recovered home')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('offers no Back to Home when Home itself crashed — it would only repeat Try again', () => {
        renderWithProviders(<AppRoot />);

        expect(screen.queryByRole('button', { name: 'Back to Home' })).toBeNull();
        expect(screen.getByText('We hit a snag loading Home. Please try again.')).toBeTruthy();
    });
});
