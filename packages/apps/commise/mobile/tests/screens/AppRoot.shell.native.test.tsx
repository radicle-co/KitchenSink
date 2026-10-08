/**
 * The app root's shell (M1, `docs/design/uiOverhaul/evaluateShellAndLists.md`; spec `specShellAndLists.md` §S.3).
 *
 * The bottom tab bar used to render only inside Home, and Recipes had no Home control and declined a back press at
 * its root. So Android's Back left the app from Recipes, and on iOS — which has no system Back — a cook who opened
 * Recipes was stuck there. Now the ROOT owns the tab bar and shows it on every top-level screen (Home, Recipes,
 * Profile), never on the account hub, which is a pushed task with its own Back. The root also answers a back press
 * nothing else took: Recipes or Profile goes Home, the account hub goes to Profile, and Home declines it so Android
 * leaves the app.
 *
 * The destination screens are stubbed: each one's own behaviour has its own suite. The Recipes stub renders the
 * `footer` it is handed, because showing it is Recipes' decision (`RecipesScreen.native.test.tsx`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { renderWithProviders } from '@commise/test-utils';
import { installHardwareBackHandler, type HardwareBackHandle } from '@commise/ui/testing/hardware-back';

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));
vi.mock('../../src/hooks/useUserProfile.js', () => ({ useUserProfile: () => ({ data: undefined }) }));
vi.mock('../../src/hooks/useDeleteAccount.js', () => ({
    useDeleteAccount: () => ({ mutate: () => undefined, isPending: false }),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ signOut: () => undefined }), useUser: () => ({ user: null }) }));

vi.mock('../../src/screens/HomeScreen.js', () => ({ HomeScreen: () => <Text>Home screen</Text> }));
vi.mock('../../src/screens/RecipesScreen.js', () => ({
    RecipesScreen: ({ footer }: { readonly footer?: ReactElement }) => (
        <View>
            <Text>Recipes screen</Text>
            {footer}
        </View>
    ),
}));
vi.mock('../../src/screens/profile.js', () => ({
    ProfileScreen: ({ onOpenAccountSettings }: { readonly onOpenAccountSettings: () => void }) => (
        <>
            <Text>Profile screen</Text>
            <Text accessibilityRole="button" onPress={onOpenAccountSettings}>
                Account settings
            </Text>
        </>
    ),
}));
vi.mock('../../src/screens/AccountSettings.js', () => ({
    AccountSettingsScreen: () => <Text>Account hub</Text>,
}));

const { AppRoot } = await import('../../src/screens/AppRoot.js');

/** Installed per test; restored here because the helper replaces the method rather than spying. */
let back: HardwareBackHandle;

afterEach(() => {
    cleanup();
    back.restore();
});

function renderRoot(): void {
    back = installHardwareBackHandler();
    renderWithProviders(<AppRoot />);
}

/** The app's bottom tab bar. */
const tabBar = () => screen.queryByRole('tablist', { name: 'Main' });

/** The selected tab in the app's bottom tab bar. */
const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');

describe('AppRoot — the bottom tab bar on every top-level screen (M1)', () => {
    it('shows it on Home, with Home selected', () => {
        renderRoot();

        expect(screen.getByText('Home screen')).toBeTruthy();
        expect(tabBar()).not.toBeNull();
        expect(selectedTab()?.textContent).toContain('Home');
    });

    it('hands it to Recipes, with Recipes selected', () => {
        renderRoot();

        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        expect(screen.getByText('Recipes screen')).toBeTruthy();
        expect(tabBar()).not.toBeNull();
        expect(selectedTab()?.textContent).toContain('Recipes');
    });

    it('takes the cook back Home from Recipes through the Home tab', () => {
        renderRoot();
        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        fireEvent.click(screen.getByRole('tab', { name: 'Home' }));

        expect(screen.getByText('Home screen')).toBeTruthy();
    });

    it('shows it on Profile, with Profile selected', () => {
        renderRoot();

        fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));

        expect(screen.getByText('Profile screen')).toBeTruthy();
        expect(selectedTab()?.textContent).toContain('Profile');
    });

    it('hides it on the account hub, a pushed task with its own Back', () => {
        renderRoot();
        fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));

        fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));

        expect(screen.getByText('Account hub')).toBeTruthy();
        expect(tabBar()).toBeNull();
    });
});

describe('AppRoot — a back press nothing else took (M1)', () => {
    it('goes Home from Recipes', () => {
        renderRoot();
        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        expect(back.press()).toBe(true);
        expect(screen.getByText('Home screen')).toBeTruthy();
    });

    it('goes Home from Profile', () => {
        renderRoot();
        fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));

        expect(back.press()).toBe(true);
        expect(screen.getByText('Home screen')).toBeTruthy();
    });

    it('goes back to Profile from the account hub', () => {
        renderRoot();
        fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
        fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));

        expect(back.press()).toBe(true);
        expect(screen.getByText('Profile screen')).toBeTruthy();
    });

    it('declines it on Home, so Android leaves the app', () => {
        renderRoot();

        expect(back.press()).toBe(false);
        expect(screen.getByText('Home screen')).toBeTruthy();
    });

    it('holds exactly one platform subscription', () => {
        renderRoot();
        fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }));

        expect(back.subscriberCount()).toBe(1);
    });
});
