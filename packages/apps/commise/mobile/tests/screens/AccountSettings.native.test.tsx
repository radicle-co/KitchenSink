/**
 * Component tests for the rebuilt mobile AccountSettingsScreen (U2) — the reachable account hub (security +
 * sign-out + danger zone). react-native-web under jsdom. The rebuild routes all copy through
 * `mobileMessages`, replaces the raw RN `<Button>` sign-out with the DS `Button`, tokenizes the surface, and
 * wraps it in a `SafeAreaView`. Destructive close/erase stay on the shared `AccountDangerZone` (its own
 * `ConfirmDialog`-backed flow, CR-002). `@clerk/expo` and `useDeleteAccount` are mocked so the hub renders
 * without a live session (matching the AppRoot suite's approach to the same module graph).
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AccountSettingsScreen } from '../../src/screens/AccountSettings.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const signOut = vi.fn();

vi.mock('@clerk/expo', () => ({
    useAuth: () => ({ signOut }),
    useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'chef@example.com' } } }),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useDeleteAccount: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
    SafeAreaView: ({ children }: { readonly children?: unknown }) =>
        createElement('div', { 'aria-label': 'safe-area-root' }, children as never),
}));

const { account } = mobileMessages.en;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('AccountSettingsScreen', () => {
    it('renders the localized hub, the signed-in email, and the safe-area wrapper', () => {
        render(<AccountSettingsScreen />);

        expect(screen.getByText(account.heading)).toBeTruthy();
        expect(screen.getByText('chef@example.com')).toBeTruthy();
        expect(screen.getByText(account.securityHeading)).toBeTruthy();
        expect(screen.getByText(account.securityBody)).toBeTruthy();
        expect(screen.getByLabelText('safe-area-root')).toBeTruthy();
    });

    it('signs out through the DS button', () => {
        render(<AccountSettingsScreen />);
        fireEvent.click(screen.getByRole('button', { name: account.signOutAction }));

        expect(signOut).toHaveBeenCalledTimes(1);
    });

    it('exposes the destructive close/erase controls (the shared danger zone)', () => {
        render(<AccountSettingsScreen />);

        // The shared AccountDangerZone (CR-002) renders both distinct, non-conflatable account actions.
        expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /erase/i })).toBeTruthy();
    });

    it('shows a back affordance only when a handler is supplied, and invokes it', () => {
        const onBack = vi.fn();
        const { rerender } = render(<AccountSettingsScreen />);
        expect(screen.queryByRole('button', { name: account.backAction })).toBeNull();

        rerender(<AccountSettingsScreen onBack={onBack} />);
        fireEvent.click(screen.getByRole('button', { name: account.backAction }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
