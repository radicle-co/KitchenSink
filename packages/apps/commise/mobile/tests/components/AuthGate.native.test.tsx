/**
 * Component tests for the mobile `AuthGate` render map (react-native-web under jsdom).
 *
 * Covers EVERY branch of the derived auth state — loading, unauthenticated (sign-in ⇄ sign-up), blocked,
 * error, authenticated — with the two U8 polish invariants asserted explicitly: the first-paint spinner is
 * NAMED (not a nameless shape), and every string the gate itself owns comes from `mobileMessages`, never a
 * literal.
 *
 * Owner decision, 2026-07-28: there is no welcome/landing screen. A signed-out session opens DIRECTLY on the
 * sign-in form (web's locale root redirects to `/sign-in` for the same reason), and sign-up stays reachable
 * from it. The stubs below therefore expose the login screen's `onSignUp` and the sign-up screen's `onBack`,
 * which are the only two signed-out transitions that exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Text } from 'react-native';

import { AuthGate } from '../../src/components/AuthGate.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { useAuth } from '../../src/hooks/useAuth.js';

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: vi.fn() }));
// The signed-out surfaces are covered by their own suites; stub them so this suite asserts the ROUTING.
vi.mock('../../src/screens/login', () => ({
    LoginScreen: ({ onSignUp }: { onSignUp: () => void }) => (
        <>
            <div>stub-login</div>
            <button type="button" onClick={onSignUp}>
                stub-go-to-signup
            </button>
        </>
    ),
}));
vi.mock('../../src/screens/signup', () => ({
    SignUpScreen: ({ onBack }: { onBack: () => void }) => (
        <>
            <div>stub-signup</div>
            <button type="button" onClick={onBack}>
                stub-back-to-login
            </button>
        </>
    ),
}));

const useAuthMock = vi.mocked(useAuth);

const authState = (state: unknown): ReturnType<typeof useAuth> =>
    ({ state, getToken: vi.fn(), signOut: vi.fn() }) as unknown as ReturnType<typeof useAuth>;

afterEach(cleanup);
beforeEach(() => {
    useAuthMock.mockReset();
});

describe('AuthGate', () => {
    it('names the first-paint loading affordance from the dictionary (never a bare spinner)', () => {
        useAuthMock.mockReturnValue(authState({ status: 'loading' }));

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        const label = mobileMessages.en.auth.sessionLoading;
        expect(screen.getByRole('progressbar', { name: label })).toBeTruthy();
        // …and the same context is visible, not screen-reader-only.
        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.queryByText('app')).toBeNull();
    });

    it('opens DIRECTLY on the sign-in form when signed out — no landing surface first', () => {
        useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        expect(screen.getByText('stub-login')).toBeTruthy();
        // The regression this guards (owner decision 2026-07-28): the gate used to open on a branded welcome
        // hero, so the sign-in form was two taps away. Nothing else may stand in front of it.
        expect(screen.queryByText('stub-signup')).toBeNull();
    });

    it('keeps sign-up reachable FROM the sign-in form, and back again', () => {
        // The welcome hero was the app's only "Get started" entry into sign-up. With it gone, the login
        // screen's own sign-up control is the ONLY route to registration on mobile — so it is asserted, in
        // both directions, rather than assumed.
        useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        fireEvent.click(screen.getByText('stub-go-to-signup'));
        expect(screen.getByText('stub-signup')).toBeTruthy();
        expect(screen.queryByText('stub-login')).toBeNull();

        fireEvent.click(screen.getByText('stub-back-to-login'));
        expect(screen.getByText('stub-login')).toBeTruthy();
    });

    it('shows the shared block reason for a blocked session', () => {
        useAuthMock.mockReturnValue(
            authState({ status: 'blocked', reason: { title: 'Account suspended', body: 'Contact support.' } }),
        );

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        expect(screen.getByText('Account suspended')).toBeTruthy();
        expect(screen.getByText('Contact support.')).toBeTruthy();
    });

    it('localizes the failure heading and passes the provider diagnostic through', () => {
        useAuthMock.mockReturnValue(authState({ status: 'error', error: new Error('token endpoint down') }));

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        // The heading is APP copy → dictionary. A regression to a hardcoded literal fails here.
        expect(screen.getByText(mobileMessages.en.common.somethingWentWrong)).toBeTruthy();
        expect(screen.getByText('token endpoint down')).toBeTruthy();
    });

    it('renders the app once the session is authenticated', () => {
        useAuthMock.mockReturnValue(authState({ status: 'authenticated', userId: 'usr_1' }));

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        expect(screen.getByText('app')).toBeTruthy();
        expect(screen.queryByRole('progressbar')).toBeNull();
    });
});
