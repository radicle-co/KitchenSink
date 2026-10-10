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

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

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

// The platform is react-native-web's unless a test sets it, so a case can ask what the avoider does on Android.
const platform = vi.hoisted(() => ({ os: undefined as 'android' | 'ios' | undefined }));
vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...withSystemScheme(actual),
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os ?? actual.Platform.OS;
            },
        },
        KeyboardAvoidingView: ({ children, behavior }: { readonly children?: unknown; readonly behavior?: string }) =>
            createElement('div', { 'aria-label': 'keyboard-avoiding', 'data-behavior': behavior }, children as never),
    };
});

const useSignInMock = vi.mocked(useSignIn);
const useClerkMock = vi.mocked(useClerk);

/**
 * A hook result the screen under test reads, built from just the members it touches. The real Clerk hook results are
 * large resource types the screen uses a handful of members of; `never` is the one place that gap is bridged.
 */
const partialHook = (members: object): never => members as never;

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
    useClerkMock.mockReturnValue(partialHook({ setActive }));
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    platform.os = undefined;
    systemScheme.current = null;
});

describe('LoginScreen — chrome + design system', () => {
    // An edge-to-edge Android window is not resized for the keyboard (E2 I6), so the avoider pads on both platforms; this
    // screen padded on iOS only. The rule is `@commise/ui/keyboard-avoider`'s, the one avoider the apps use.
    it.each(['android', 'ios'] as const)('pads its form above the keyboard on %s', (os) => {
        platform.os = os;
        const signIn = makeSignIn();
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();

        expect(screen.getByLabelText('keyboard-avoiding').getAttribute('data-behavior')).toBe('padding');
    });

    it('renders the DS primary button, localized labelled fields, and the safe-area + keyboard-avoiding wrappers', () => {
        const signIn = makeSignIn();
        useSignInMock.mockReturnValue(partialHook({ signIn }));
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
        useSignInMock.mockReturnValue(partialHook({ signIn }));
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
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        render(<LoginScreen onSignUp={onSignUp} />);

        fireEvent.click(screen.getByRole('button', { name: auth.signUpLink }));

        expect(onSignUp).toHaveBeenCalledTimes(1);
    });
});

describe('LoginScreen — sign-in flow', () => {
    it('signs in directly when the password attempt completes', async () => {
        const signIn = makeSignIn({ status: 'complete' });
        useSignInMock.mockReturnValue(partialHook({ signIn }));
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
        useSignInMock.mockReturnValue(partialHook({ signIn }));
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
        useSignInMock.mockReturnValue(partialHook({ signIn }));
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
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        expect((await screen.findByRole('alert')).textContent).toContain(auth.signInFailed);
    });
});

describe('LoginScreen — Section 8 native: order, copy and field hints', () => {
    function setup(overrides: Record<string, unknown> = {}) {
        const signIn = makeSignIn(overrides);
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();

        return signIn;
    }

    it('reads mark → H1 “Sign in to Commise” → the brand line → email → password → Sign in → the sign-up link', () => {
        setup();

        const ordered = [
            screen.getByText(auth.brand),
            screen.getByRole('heading', { name: auth.signInTitle, level: 1 }),
            screen.getByText(auth.brandLine),
            screen.getByLabelText(auth.emailLabel),
            screen.getByLabelText(auth.passwordLabel),
            screen.getByRole('button', { name: auth.signInAction }),
            screen.getByText(auth.noAccountPrompt),
            screen.getByRole('button', { name: auth.signUpLink }),
        ];

        ordered.slice(1).forEach((node, index) => {
            const before = ordered[index] as HTMLElement;

            expect(
                before.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
                auth.brandLine,
            ).toBeTruthy();
        });
    });

    it('uses the spec copy: the brand line, and “New to Commise? Create an account”', () => {
        setup();

        expect(auth.brandLine).toBe('Your recipes, in one place.');
        expect(auth.noAccountPrompt).toBe('New to Commise?');
        expect(auth.signUpLink).toBe('Create an account');
    });

    it('asks the OS for email, current-password autofill, and a numeric one-time-code', async () => {
        const signIn = setup({ status: 'needs_first_factor' });

        expect(screen.getByLabelText(auth.emailLabel).getAttribute('autocomplete')).toBe('email');
        expect(screen.getByLabelText(auth.passwordLabel).getAttribute('autocomplete')).toBe('current-password');

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));
        const code = await screen.findByLabelText(auth.codeLabel);

        expect(signIn.emailCode.sendCode).toHaveBeenCalled();
        expect(code.getAttribute('autocomplete')).toBe('one-time-code');
        expect(code.getAttribute('inputmode')).toBe('numeric');
    });

    it('locks the form while a sign-in is in flight', async () => {
        setup({ create: vi.fn(() => new Promise<StepResult>(() => undefined)) });

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        await waitFor(() => expect(screen.getByLabelText(auth.emailLabel).hasAttribute('readonly')).toBe(true));
        expect(screen.getByLabelText(auth.passwordLabel).hasAttribute('readonly')).toBe(true);
    });
});

describe('LoginScreen — the network error (§8 “States”)', () => {
    function setup(overrides: Record<string, unknown>) {
        useSignInMock.mockReturnValue(partialHook({ signIn: makeSignIn(overrides) }));
        renderLogin();
        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));
    }

    it('names an unreachable service when the call THROWS a network failure', async () => {
        setup({
            create: vi.fn(async () => {
                throw new TypeError('Network request failed');
            }),
        });

        expect((await screen.findByRole('alert')).textContent).toBe(auth.networkError);
    });

    it('names an unreachable service when Clerk RETURNS a network_error', async () => {
        setup({ create: vi.fn(async () => ({ error: { code: 'network_error', message: 'Browser is offline' } })) });

        expect((await screen.findByRole('alert')).textContent).toBe(auth.networkError);
    });

    it('shows the alert above the primary action', async () => {
        setup({
            create: vi.fn(async () => {
                throw new TypeError('Network request failed');
            }),
        });

        const alert = await screen.findByRole('alert');

        expect(
            alert.compareDocumentPosition(screen.getByRole('button', { name: auth.signInAction })) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('does NOT blame the network for a wrong password', async () => {
        setup({
            password: vi.fn(async () => ({
                error: { code: 'form_password_incorrect', message: 'Incorrect password' },
            })),
        });

        const alert = await screen.findByRole('alert');

        expect(alert.textContent).toBe('Incorrect password');
        expect(screen.queryByText(auth.networkError)).toBeNull();
    });

    it('names an unreachable service when sending the new-device code fails on the network', async () => {
        const signIn = makeSignIn({ status: 'needs_first_factor' });
        signIn.emailCode.sendCode = vi.fn(async () => ({ error: { code: 'network_error', message: 'x' } }));
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();
        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        expect((await screen.findByRole('alert')).textContent).toBe(auth.networkError);
    });
});

describe.each([
    ['light', role],
    ['dark', roleDark],
] as const)('LoginScreen — the %s theme reads colour from roles', (name, roles) => {
    it('paints the mark and H1 in ink, the brand line and prompt in inkMuted, and the alert in dangerText', async () => {
        systemScheme.current = name;
        useSignInMock.mockReturnValue({
            signIn: makeSignIn({ create: vi.fn(async () => ({ error: { message: 'No' } })) }),
        } as unknown as ReturnType<typeof useSignIn>);
        renderLogin();

        const colour = (node: HTMLElement) => window.getComputedStyle(node).color;

        expect(colour(screen.getByText(auth.brand))).toBe(rgb(roles.ink));
        expect(colour(screen.getByRole('heading', { name: auth.signInTitle }))).toBe(rgb(roles.ink));
        expect(colour(screen.getByText(auth.brandLine))).toBe(rgb(roles.inkMuted));
        expect(colour(screen.getByText(auth.noAccountPrompt))).toBe(rgb(roles.inkMuted));

        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));
        expect(colour(await screen.findByRole('alert'))).toBe(rgb(roles.dangerText));
    });
});
