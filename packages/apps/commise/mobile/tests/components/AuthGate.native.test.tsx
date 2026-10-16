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

import { authBlockMessages } from '@commise/features-account';

import { AuthGate } from '../../src/components/AuthGate.js';
import { boundaryMessages } from '@commise/features-core/boundary';
import { mobileMessages } from '../../src/i18n/messages.js';
import { useAuth } from '../../src/hooks/useAuth.js';

vi.mock('../../src/hooks/useAuth', () => ({ useAuth: vi.fn() }));
// The signed-out surfaces are covered by their own suites; stub them so this suite asserts the ROUTING.
/** What a provider hook handed back for the finish step (plan 012): a stand-in, compared by identity. */
const PENDING = { signUp: { id: 'sua_1' }, fields: [{ name: 'username' }] };

type NeedsFields = (pending: typeof PENDING) => void;

vi.mock('../../src/screens/login', () => ({
    LoginScreen: ({ onSignUp, onNeedsFields }: { onSignUp: () => void; onNeedsFields: NeedsFields }) => (
        <>
            <div>stub-login</div>
            <button type="button" onClick={onSignUp}>
                stub-go-to-signup
            </button>
            <button type="button" onClick={() => onNeedsFields(PENDING)}>
                stub-login-social-needs-fields
            </button>
        </>
    ),
}));
vi.mock('../../src/screens/signup', () => ({
    SignUpScreen: ({ onBack, onNeedsFields }: { onBack: () => void; onNeedsFields: NeedsFields }) => (
        <>
            <div>stub-signup</div>
            <button type="button" onClick={onBack}>
                stub-back-to-login
            </button>
            <button type="button" onClick={() => onNeedsFields(PENDING)}>
                stub-signup-social-needs-fields
            </button>
        </>
    ),
}));
vi.mock('../../src/screens/CompleteSignUpScreen', () => ({
    CompleteSignUpScreen: (props: { signUp: unknown; fields: unknown; onStartOver: () => void }) => (
        <>
            <div>
                stub-complete-signup{' '}
                {props.signUp === PENDING.signUp && props.fields === PENDING.fields ? 'same' : 'other'}
            </div>
            <button type="button" onClick={props.onStartOver}>
                stub-start-over
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

    it.each(['stub-login-social-needs-fields', 'stub-signup-social-needs-fields'])(
        'shows the finish step with exactly the sign-up and fields the provider handed back (%s), and nothing else',
        (trigger) => {
            useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));
            render(
                <AuthGate>
                    <Text>app</Text>
                </AuthGate>,
            );

            if (trigger.startsWith('stub-signup')) {
                fireEvent.click(screen.getByText('stub-go-to-signup'));
            }

            fireEvent.click(screen.getByText(trigger));

            expect(screen.getByText('stub-complete-signup same')).toBeTruthy();
            expect(screen.queryByText('stub-login')).toBeNull();
            expect(screen.queryByText('stub-signup')).toBeNull();
        },
    );

    it('returns from the finish step to the SIGN-IN form when the cook starts over', () => {
        useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));
        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        fireEvent.click(screen.getByText('stub-go-to-signup'));
        fireEvent.click(screen.getByText('stub-signup-social-needs-fields'));
        fireEvent.click(screen.getByText('stub-start-over'));

        expect(screen.getByText('stub-login')).toBeTruthy();
    });

    it('⛔ opens on the sign-in form again after a sign-out — never on a finish step left over from the last session', () => {
        useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));
        // A fresh element per render: React skips re-rendering an element it was handed before.
        const tree = () => (
            <AuthGate>
                <Text>app</Text>
            </AuthGate>
        );
        const { rerender } = render(tree());

        fireEvent.click(screen.getByText('stub-login-social-needs-fields'));
        useAuthMock.mockReturnValue(authState({ status: 'authenticated' }));
        rerender(tree());
        expect(screen.getByText('app')).toBeTruthy();

        useAuthMock.mockReturnValue(authState({ status: 'unauthenticated' }));
        rerender(tree());

        expect(screen.getByText('stub-login')).toBeTruthy();
        expect(screen.queryByText(/stub-complete-signup/u)).toBeNull();
    });

    it.each(['account_suspended', 'impersonation_blocked'] as const)(
        'shows the shared, localized %s copy for a blocked session',
        (code) => {
            useAuthMock.mockReturnValue(authState({ status: 'blocked', reason: { code } }));

            render(
                <AuthGate>
                    <Text>app</Text>
                </AuthGate>,
            );

            expect(screen.getByText(authBlockMessages.en[code].title)).toBeTruthy();
            expect(screen.getByText(authBlockMessages.en[code].body)).toBeTruthy();
        },
    );

    it('localizes the failure heading and passes the provider diagnostic through', () => {
        useAuthMock.mockReturnValue(authState({ status: 'error', error: new Error('token endpoint down') }));

        render(
            <AuthGate>
                <Text>app</Text>
            </AuthGate>,
        );

        // The heading is the shared crash-fallback title. A regression to a hardcoded literal fails here.
        expect(screen.getByText(boundaryMessages.en.errorTitle)).toBeTruthy();
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
