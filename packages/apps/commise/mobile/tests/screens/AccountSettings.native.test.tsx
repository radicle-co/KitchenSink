/**
 * Component tests for the rebuilt mobile AccountSettingsScreen (U2) — the reachable account hub (security +
 * sign-out + danger zone). react-native-web under jsdom. The rebuild routes all copy through
 * `mobileMessages`, replaces the raw RN `<Button>` sign-out with the DS `Button`, tokenizes the surface, and
 * wraps it in a `SafeAreaView`. Destructive close/erase stay on the shared `AccountDangerZone` (its own
 * `ConfirmDialog`-backed flow, CR-002). `@clerk/expo` and `useDeleteAccount` are mocked so the hub renders
 * without a live session (matching the AppRoot suite's approach to the same module graph).
 *
 * The SIGN OUT control's full state matrix is covered here (ADR-0009, mobile half): it issues the app's one
 * sign-out COMMAND (never Clerk's `signOut` directly), it AWAITS it, it shows an in-flight state that cannot
 * be double-fired, and a failure surfaces a LOCALIZED alert — never a raw error string — and stays
 * retryable. The command's own mechanism (load-safe wrapper + fail-closed post-condition) is covered in
 * `tests/hooks/useSignOutAndVerify.native.test.tsx`.
 */
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AccountSettingsScreen } from '../../src/screens/AccountSettings.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const signOut = vi.fn();
const signOutAndVerify = vi.fn();

vi.mock('@clerk/expo', () => ({
    useAuth: () => ({ signOut }),
    useClerk: () => ({ signOut, loaded: true, status: 'ready', session: null }),
    useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'chef@example.com' } } }),
}));

vi.mock('../../src/hooks/useSignOutAndVerify.js', () => ({
    useSignOutAndVerify: () => ({ signOutAndVerify }),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({
    useDeleteAccount: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
    SafeAreaView: ({ children }: { readonly children?: unknown }) =>
        createElement('div', { 'aria-label': 'safe-area-root' }, children as never),
}));

const { account } = mobileMessages.en;

beforeEach(() => {
    signOut.mockReset().mockResolvedValue(undefined);
    signOutAndVerify.mockReset().mockResolvedValue(undefined);
});

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

describe('AccountSettingsScreen — sign out (ADR-0009)', () => {
    it('issues the app’s sign-out COMMAND, never Clerk’s signOut directly', async () => {
        render(<AccountSettingsScreen />);

        fireEvent.click(screen.getByRole('button', { name: account.signOutAction }));

        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(1));
        // A raw `signOut()` skips the fail-closed post-condition — that is the hole the command closes.
        expect(signOut).not.toHaveBeenCalled();
    });

    it('reports no failure when the sign-out succeeds', async () => {
        render(<AccountSettingsScreen />);

        fireEvent.click(screen.getByRole('button', { name: account.signOutAction }));

        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(account.signOutFailed)).toBeNull();
    });

    it('shows the in-flight state and cannot be double-fired while the sign-out is pending', async () => {
        let release = (): void => undefined;
        signOutAndVerify.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = () => resolve();
                }),
        );
        render(<AccountSettingsScreen />);

        fireEvent.click(screen.getByRole('button', { name: account.signOutAction }));

        const busy = await screen.findByRole('button', { name: account.signingOut });
        expect(busy.getAttribute('aria-disabled')).toBe('true');
        // A real spinner, not merely a swapped label.
        expect(screen.getByRole('progressbar', { hidden: true })).toBeTruthy();

        fireEvent.click(busy);
        expect(signOutAndVerify).toHaveBeenCalledTimes(1);

        await act(async () => {
            release();
        });
    });

    it('surfaces a LOCALIZED failure — never the raw error — and releases the busy state', async () => {
        signOutAndVerify.mockRejectedValue(new Error('sign-out did not take effect: session sess_live is active'));
        render(<AccountSettingsScreen />);

        fireEvent.click(screen.getByRole('button', { name: account.signOutAction }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe(account.signOutFailed);
        expect(screen.queryByText(/sess_live/)).toBeNull();
        // Retryable, not stuck: the control is back to its idle label and enabled.
        const trigger = screen.getByRole('button', { name: account.signOutAction });
        expect(trigger.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('clears a previous failure when the sign-out is retried', async () => {
        signOutAndVerify.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined);
        render(<AccountSettingsScreen />);

        fireEvent.click(screen.getByRole('button', { name: account.signOutAction }));
        expect((await screen.findByRole('alert')).textContent).toBe(account.signOutFailed);

        fireEvent.click(screen.getByRole('button', { name: account.signOutAction }));

        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
        expect(signOutAndVerify).toHaveBeenCalledTimes(2);
    });
});
