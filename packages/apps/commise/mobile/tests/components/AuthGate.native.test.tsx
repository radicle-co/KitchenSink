/**
 * Component tests for the mobile `AuthGate` render map (react-native-web under jsdom).
 *
 * Covers EVERY branch of the derived auth state — loading, unauthenticated (welcome → sign-up / sign-in),
 * blocked, error, authenticated — with the two U8 polish invariants asserted explicitly: the first-paint
 * spinner is NAMED (not a nameless shape), and every string the gate itself owns comes from
 * `mobileMessages`, never a literal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Text } from 'react-native';

import { AuthGate } from '../../src/components/AuthGate.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { useAuth } from '../../src/hooks/useAuth.js';

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: vi.fn() }));
// The signed-out surfaces are covered by their own suites; stub them so this suite asserts the ROUTING.
vi.mock('../../src/screens/welcome', () => ({
    WelcomeScreen: ({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) => (
        <>
            <button type="button" onClick={onGetStarted}>
                stub-get-started
            </button>
            <button type="button" onClick={onSignIn}>
                stub-sign-in
            </button>
        </>
    ),
}));
vi.mock('../../src/screens/login', () => ({ LoginScreen: () => <div>stub-login</div> }));
vi.mock('../../src/screens/signup', () => ({ SignUpScreen: () => <div>stub-signup</div> }));

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

    it('opens on the branded welcome hero when signed out', () => {
        useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        expect(screen.getByText('stub-get-started')).toBeTruthy();
    });

    it('routes the welcome CTAs into sign-up and sign-in', () => {
        useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));

        const { unmount } = render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );
        fireEvent.click(screen.getByText('stub-get-started'));
        expect(screen.getByText('stub-signup')).toBeTruthy();
        unmount();

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );
        fireEvent.click(screen.getByText('stub-sign-in'));
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
