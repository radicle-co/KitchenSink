/**
 * Component tests for the rebuilt mobile LoginScreen (U2). Rendered via react-native-web under jsdom (see
 * `vitest.native.config.ts`). The rebuild swaps the raw Tamagui `Button`/`Input` for the `@commise/ui`
 * design-system `Button` (with its real `busy` spinner) + tokenized `Input`, routes ALL copy through
 * `mobileMessages` (no hard-coded English), associates every field label, wraps the form in a
 * `SafeAreaView` + `KeyboardAvoidingView`, and marks the verification-code field with
 * `textContentType="oneTimeCode"`.
 *
 * The `SafeAreaView` and `KeyboardAvoidingView` wrappers are replaced with labelled sentinels so a test can
 * prove the screen actually composes them (RC-4/RC-5) — the real `react-native-safe-area-context` does not
 * parse under jsdom anyway (see the AppRoot suite). `@clerk/expo` is mocked so no live instance is needed;
 * queries are by role / accessible label / dictionary text (never by raw English literal).
 */
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { useClerk, useSignIn } from '@clerk/expo';

import { LoginScreen } from '../../src/screens/login.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const { auth } = mobileMessages.en;

vi.mock('@clerk/expo', () => ({
    useSignIn: vi.fn(),
    useClerk: vi.fn(),
}));

// Labelled sentinels: the real safe-area module does not parse under jsdom, and these let a test assert the
// screen composes the safe-area + keyboard-avoiding wrappers (RC-4/RC-5) without a device.
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
    SafeAreaView: ({ children }: { readonly children?: unknown }) =>
        createElement('div', { 'aria-label': 'safe-area-root' }, children as never),
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        KeyboardAvoidingView: ({ children }: { readonly children?: unknown }) =>
            createElement('div', { 'aria-label': 'keyboard-avoiding' }, children as never),
    };
});

const useSignInMock = vi.mocked(useSignIn);
const useClerkMock = vi.mocked(useClerk);

const setActive = vi.fn(async () => undefined);

/** A step result whose `error` can be reassigned to a failure in individual tests. */
type StepResult = { error: { message: string } | null };
const ok = async (): Promise<StepResult> => ({ error: null });

/** A mutable Clerk `signIn` future-resource double whose `status` the tests advance between calls. */
function makeSignIn(overrides: Record<string, unknown> = {}) {
    return {
        status: 'needs_identifier',
        createdSessionId: 'sess_1',
        create: vi.fn(ok),
        password: vi.fn(ok),
        emailCode: {
            sendCode: vi.fn(ok),
            verifyCode: vi.fn(ok),
        },
        ...overrides,
    };
}

function renderLogin() {
    render(<LoginScreen onSignUp={() => undefined} />);
}

beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useClerkMock.mockReturnValue({ setActive } as any);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('LoginScreen — chrome + design system', () => {
    it('renders the DS primary button, localized labelled fields, and the safe-area + keyboard-avoiding wrappers', () => {
        const signIn = makeSignIn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        // Copy comes from the dictionary — a hard-coded literal would break these.
        expect(screen.getByText(auth.brand)).toBeTruthy();
        expect(screen.getByRole('button', { name: auth.signInAction })).toBeTruthy();
        expect(screen.getByRole('button', { name: auth.signUpLink })).toBeTruthy();

        // Every field is associated with its visible label (assistive tech names it).
        expect(screen.getByLabelText(auth.emailLabel)).toBeTruthy();
        expect(screen.getByLabelText(auth.passwordLabel)).toBeTruthy();

        // The form is wrapped in a SafeAreaView + KeyboardAvoidingView (RC-4/RC-5).
        expect(screen.getByLabelText('safe-area-root')).toBeTruthy();
        expect(screen.getByLabelText('keyboard-avoiding')).toBeTruthy();
    });

    it('shows the busy spinner and disables the primary button while a sign-in is in flight', async () => {
        // A never-settling `create` holds the screen in its busy state so the button's busy props are observable.
        const signIn = makeSignIn({ create: vi.fn(() => new Promise<StepResult>(() => undefined)) });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        await waitFor(() => {
            const button = screen.getByRole('button', { name: auth.signInAction });
            // The busy DS Button swaps its icon for an ActivityIndicator (role=progressbar, rendered in the
            // decorative — aria-hidden — icon slot) and disables itself so the sign-in cannot be double-fired.
            expect(within(button).getByRole('progressbar', { hidden: true })).toBeTruthy();
            expect(button.getAttribute('aria-disabled')).toBe('true');
        });
    });

    it('routes the toggle link to onSignUp', () => {
        const onSignUp = vi.fn();
        const signIn = makeSignIn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        render(<LoginScreen onSignUp={onSignUp} />);

        fireEvent.click(screen.getByRole('button', { name: auth.signUpLink }));

        expect(onSignUp).toHaveBeenCalledTimes(1);
    });
});

describe('LoginScreen — sign-in flow', () => {
    it('signs in directly when the password attempt completes', async () => {
        const signIn = makeSignIn({ status: 'complete' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
        expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
    });

    it('advances to the email-code step (oneTimeCode field) and completes verification for a new device', async () => {
        const signIn = makeSignIn({ status: 'needs_first_factor' });
        signIn.emailCode.verifyCode = vi.fn(async () => {
            signIn.status = 'complete';

            return { error: null };
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        // The code-entry UI appears (labelled, one-time-code) and a code was sent.
        const codeField = await screen.findByLabelText(auth.codeLabel);
        expect(codeField.getAttribute('autocomplete')).toBe('one-time-code');
        expect(signIn.emailCode.sendCode).toHaveBeenCalled();

        fireEvent.change(codeField, { target: { value: '424242' } });
        fireEvent.click(screen.getByRole('button', { name: auth.verifyAction }));

        await waitFor(() => expect(signIn.emailCode.verifyCode).toHaveBeenCalledWith({ code: '424242' }));
        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
    });

    it('surfaces the Clerk-supplied error when the password is rejected', async () => {
        const signIn = makeSignIn();
        signIn.password = vi.fn(async () => ({ error: { message: 'Incorrect password' } }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        expect((await screen.findByRole('alert')).textContent).toContain('Incorrect password');
        expect(setActive).not.toHaveBeenCalled();
    });

    it('falls back to the localized message when a failure carries no Clerk message', async () => {
        const signIn = makeSignIn();
        signIn.create = vi.fn(async () => {
            throw new Error();
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        expect((await screen.findByRole('alert')).textContent).toContain(auth.signInFailed);
    });
});
