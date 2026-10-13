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
import { ClerkAPIResponseError } from '@clerk/shared/error';
import * as Sentry from '@sentry/react-native';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { LoginScreen } from '../../src/screens/login.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const { auth } = mobileMessages.en;

vi.mock('@clerk/expo', async () => {
    // The REAL predicate (the screens' failure wording reads it); only the hooks are doubles.
    const { isClerkAPIResponseError } = await import('@clerk/shared/error');

    return { useSignIn: vi.fn(), useClerk: vi.fn(), isClerkAPIResponseError };
});

// The unsupported-status branch reports to Sentry; the real SDK needs a native module.
vi.mock('@sentry/react-native', () => ({ captureMessage: vi.fn() }));

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
type StepResult = { error: { code?: string; message: string } | null };
const ok = async (): Promise<StepResult> => ({ error: null });

/** What the Clerk instance does after a CORRECT password. */
type AfterPassword = 'complete' | 'needs_client_trust' | 'needs_second_factor';

interface SignInDoubleOptions {
    /** The password the account holds. Any other password is `form_password_incorrect`. */
    readonly correctPassword?: string;
    /** The status a correct password leaves the sign-in in (Client Trust, MFA, or done). */
    readonly afterPassword?: AfterPassword;
    /** The `email_code` second factor is offered unless a test removes it. */
    readonly secondFactors?: readonly { strategy: string }[];
}

/**
 * A Clerk `signIn` future-resource double that models Clerk's REAL status transitions, because the one this
 * replaced kept its status where a test left it and so hid A-001: the screen called `create({ identifier })`
 * with no password, Clerk answered `needs_first_factor`, the screen's own guard then skipped the password and
 * took the passwordless first-factor email-code path.
 *
 * - `create({ identifier })` → `needs_first_factor` (the password is the missing first factor).
 * - `password(...)`: a wrong password is `form_password_incorrect` and changes nothing; a correct one moves to
 *   `afterPassword`, and `supportedSecondFactors` fills in for a second-factor status.
 * - `emailCode.*` is the FIRST-factor (passwordless) strategy. This instance has it enabled, so it WORKS from
 *   `needs_first_factor`: calling it is exactly the A-001 hole, and tests assert it never happens.
 * - `mfa.sendEmailCode` / `mfa.verifyEmailCode` work only from a second-factor status, and `424242` is the code.
 */
function makeSignIn(options: SignInDoubleOptions = {}, overrides: Record<string, unknown> = {}) {
    const { correctPassword = 'pw', afterPassword = 'complete', secondFactors } = options;
    const secondFactorStatuses: readonly string[] = ['needs_client_trust', 'needs_second_factor'];
    const signIn = {
        status: 'needs_identifier',
        createdSessionId: null as string | null,
        supportedSecondFactors: [] as readonly { strategy: string }[],
        create: vi.fn(async ({ identifier }: { identifier?: string }): Promise<StepResult> => {
            if (!identifier) {
                return { error: { code: 'form_param_nil', message: 'Enter email address.' } };
            }

            signIn.status = 'needs_first_factor';

            return { error: null };
        }),
        password: vi.fn(async ({ password }: { identifier?: string; password: string }): Promise<StepResult> => {
            if (password !== correctPassword) {
                return { error: { code: 'form_password_incorrect', message: 'Incorrect password' } };
            }

            signIn.status = afterPassword;
            signIn.createdSessionId = afterPassword === 'complete' ? 'sess_1' : null;
            signIn.supportedSecondFactors =
                afterPassword === 'complete' ? [] : (secondFactors ?? [{ strategy: 'email_code' }]);

            return { error: null };
        }),
        emailCode: {
            sendCode: vi.fn(ok),
            verifyCode: vi.fn(async ({ code }: { code: string }): Promise<StepResult> => {
                if (signIn.status === 'needs_first_factor' && code === '424242') {
                    signIn.status = 'complete';
                    signIn.createdSessionId = 'sess_1';
                }

                return { error: null };
            }),
        },
        mfa: {
            sendEmailCode: vi.fn(async (): Promise<StepResult> => {
                return secondFactorStatuses.includes(signIn.status)
                    ? { error: null }
                    : { error: { code: 'client_state_invalid', message: 'Not allowed in this state' } };
            }),
            verifyEmailCode: vi.fn(async ({ code }: { code: string }): Promise<StepResult> => {
                if (!secondFactorStatuses.includes(signIn.status) || code !== '424242') {
                    return { error: { code: 'form_code_incorrect', message: 'Incorrect code' } };
                }

                signIn.status = 'complete';
                signIn.createdSessionId = 'sess_1';

                return { error: null };
            }),
        },
        reset: vi.fn(async (): Promise<StepResult> => {
            signIn.status = 'needs_identifier';
            signIn.createdSessionId = null;

            return { error: null };
        }),
        ...overrides,
    };

    return signIn;
}

/** Fill the credentials and press Sign in. */
function submitCredentials(password = 'pw') {
    fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));
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
        expect(screen.getByRole('link', { name: auth.signUpLink })).toBeTruthy();

        // Every field is associated with its visible label (assistive tech names it).
        expect(screen.getByLabelText(auth.emailLabel)).toBeTruthy();
        expect(screen.getByLabelText(auth.passwordLabel)).toBeTruthy();

        // The form is wrapped in a SafeAreaView + KeyboardAvoidingView (RC-4/RC-5).
        expect(screen.getByLabelText('safe-area-root')).toBeTruthy();
        expect(screen.getByLabelText('keyboard-avoiding')).toBeTruthy();
    });

    it('shows the busy spinner and disables the primary button while a sign-in is in flight', async () => {
        // A never-settling `password` holds the screen in its busy state so the button's busy props are observable.
        const signIn = makeSignIn({}, { password: vi.fn(() => new Promise<StepResult>(() => undefined)) });
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

        fireEvent.click(screen.getByRole('link', { name: auth.signUpLink }));

        expect(onSignUp).toHaveBeenCalledTimes(1);
    });
});

describe('LoginScreen — sign-in flow (A-001: the password is ALWAYS checked)', () => {
    function setup(options: SignInDoubleOptions = {}, overrides: Record<string, unknown> = {}) {
        const signIn = makeSignIn(options, overrides);
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();

        return signIn;
    }

    it('sends the typed email and password to Clerk in ONE password call', async () => {
        const signIn = setup();

        submitCredentials('pw');

        await waitFor(() => expect(signIn.password).toHaveBeenCalledWith({ identifier: 'a@b.com', password: 'pw' }));
        expect(signIn.password).toHaveBeenCalledTimes(1);
    });

    it('refuses an empty email without calling Clerk, and says why', async () => {
        const signIn = setup();

        fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        expect((await screen.findByRole('alert')).textContent).toBe(auth.emailRequired);
        expect(signIn.password).not.toHaveBeenCalled();
        expect(signIn.create).not.toHaveBeenCalled();
    });

    it('says the email is not valid when Clerk rejects the identifier’s format, in our words', async () => {
        setup(
            {},
            {
                password: vi.fn(async () => ({
                    error: new ClerkAPIResponseError('Identifier is invalid.', {
                        data: [
                            {
                                code: 'form_param_format_invalid',
                                message: 'is invalid',
                                long_message: 'Identifier is invalid.',
                                meta: { param_name: 'identifier' },
                            },
                        ],
                        status: 422,
                    }),
                })),
            },
        );

        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toBe(auth.emailInvalid);
    });

    it('a WRONG password shows the error, sends no code, and never reaches the code step', async () => {
        // The instance has the first-factor email code enabled and trusts no device: before the fix, an email
        // code alone signed this user in.
        const signIn = setup({ afterPassword: 'needs_client_trust' });

        submitCredentials('wrong');

        expect((await screen.findByRole('alert')).textContent).toBe('Incorrect password');
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
        expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
        expect(signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
        expect(setActive).not.toHaveBeenCalled();
        expect(signIn.status).not.toBe('complete');
    });

    it('a wrong password then the right one sends exactly ONE second-factor code and never the passwordless one', async () => {
        const signIn = setup({ afterPassword: 'needs_client_trust' });

        submitCredentials('wrong');
        expect((await screen.findByRole('alert')).textContent).toBe('Incorrect password');

        fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        expect(await screen.findByLabelText(auth.codeLabel)).toBeTruthy();
        expect(signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1);
        expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a wrong password with no second-factor requirement still stops at the password', async () => {
        const signIn = setup({ afterPassword: 'complete' });

        submitCredentials('wrong');

        expect((await screen.findByRole('alert')).textContent).toBe('Incorrect password');
        expect(setActive).not.toHaveBeenCalled();
        expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
    });

    it('signs in directly when the right password completes the sign-in', async () => {
        const signIn = setup({ afterPassword: 'complete' });

        submitCredentials('pw');

        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
        expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
        expect(signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
    });

    it.each(['needs_client_trust', 'needs_second_factor'] as const)(
        'a right password that lands on %s sends ONE second-factor email code, then verifies it and signs in',
        async (afterPassword) => {
            const signIn = setup({ afterPassword });

            submitCredentials('pw');

            // The code-entry UI appears (labelled, one-time-code) and exactly one code was sent.
            const codeField = await screen.findByLabelText(auth.codeLabel);
            expect(codeField.getAttribute('autocomplete')).toBe('one-time-code');
            expect(signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(1);
            expect(setActive).not.toHaveBeenCalled();

            fireEvent.change(codeField, { target: { value: '424242' } });
            fireEvent.click(screen.getByRole('button', { name: auth.verifyAction }));

            await waitFor(() => expect(signIn.mfa.verifyEmailCode).toHaveBeenCalledWith({ code: '424242' }));
            await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
            // The FIRST-factor (passwordless) strategy is never used: it is how the password was bypassed.
            expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
            expect(signIn.emailCode.verifyCode).not.toHaveBeenCalled();
        },
    );

    it('a wrong verification code shows the error, stays on the code step and signs nobody in', async () => {
        const signIn = setup({ afterPassword: 'needs_client_trust' });
        submitCredentials('pw');
        fireEvent.change(await screen.findByLabelText(auth.codeLabel), { target: { value: '000000' } });

        fireEvent.click(screen.getByRole('button', { name: auth.verifyAction }));

        expect((await screen.findByRole('alert')).textContent).toBe('Incorrect code');
        expect(screen.getByLabelText(auth.codeLabel)).toBeTruthy();
        expect(signIn.mfa.verifyEmailCode).toHaveBeenCalledWith({ code: '000000' });
        expect(setActive).not.toHaveBeenCalled();
    });

    it('falls back to the localized message when the code check fails without a Clerk message', async () => {
        const signIn = setup({ afterPassword: 'needs_client_trust' });
        signIn.mfa.verifyEmailCode = vi.fn(async () => ({ error: { message: '' } }));
        submitCredentials('pw');
        fireEvent.change(await screen.findByLabelText(auth.codeLabel), { target: { value: '1' } });

        fireEvent.click(screen.getByRole('button', { name: auth.verifyAction }));

        expect((await screen.findByRole('alert')).textContent).toBe(auth.verifyFailed);
    });

    it('stays on the credentials step with the localized message when the second-factor code cannot be sent', async () => {
        const signIn = setup({ afterPassword: 'needs_client_trust' });
        signIn.mfa.sendEmailCode = vi.fn(async () => ({ error: { message: '' } }));

        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toBe(auth.sendCodeFailed);
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
        expect(setActive).not.toHaveBeenCalled();
    });

    it('says more verification is needed, and reports it, when no email-code second factor is offered', async () => {
        const signIn = setup({ afterPassword: 'needs_second_factor', secondFactors: [{ strategy: 'totp' }] });

        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toBe(auth.additionalVerification);
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
        expect(signIn.mfa.sendEmailCode).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(setActive).not.toHaveBeenCalled();
    });

    it('resends the code through the second-factor path and starts over with a reset', async () => {
        const signIn = setup({ afterPassword: 'needs_client_trust' });
        submitCredentials('pw');
        await screen.findByLabelText(auth.codeLabel);

        fireEvent.click(screen.getByRole('button', { name: auth.resendCodeAction }));
        await waitFor(() => expect(signIn.mfa.sendEmailCode).toHaveBeenCalledTimes(2));
        expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
        // The controls lock while the resend is in flight; wait for them to free up.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: auth.startOverAction }).getAttribute('aria-disabled')).not.toBe(
                'true',
            ),
        );

        fireEvent.click(screen.getByRole('button', { name: auth.startOverAction }));

        await waitFor(() => expect(signIn.reset).toHaveBeenCalledTimes(1));
        expect(await screen.findByLabelText(auth.passwordLabel)).toBeTruthy();
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
    });

    it('surfaces the Clerk-supplied error when the password is rejected', async () => {
        setup({}, { password: vi.fn(async () => ({ error: { message: 'Too many attempts' } })) });

        submitCredentials('anything');

        expect((await screen.findByRole('alert')).textContent).toContain('Too many attempts');
        expect(setActive).not.toHaveBeenCalled();
    });

    it('falls back to the localized message when a failure carries no Clerk message', async () => {
        setup(
            {},
            {
                password: vi.fn(async () => {
                    throw new Error();
                }),
            },
        );

        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toContain(auth.signInFailed);
    });
});

describe('LoginScreen — Section 8 native: order, copy and field hints', () => {
    function setup(options: SignInDoubleOptions = {}, overrides: Record<string, unknown> = {}) {
        const signIn = makeSignIn(options, overrides);
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
            screen.getByRole('link', { name: auth.signUpLink }),
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
        setup({ afterPassword: 'needs_client_trust' });

        expect(screen.getByLabelText(auth.emailLabel).getAttribute('autocomplete')).toBe('email');
        expect(screen.getByLabelText(auth.passwordLabel).getAttribute('autocomplete')).toBe('current-password');

        submitCredentials('pw');
        const code = await screen.findByLabelText(auth.codeLabel);

        expect(code.getAttribute('autocomplete')).toBe('one-time-code');
        expect(code.getAttribute('inputmode')).toBe('numeric');
    });

    it('locks the form while a sign-in is in flight', async () => {
        setup({}, { password: vi.fn(() => new Promise<StepResult>(() => undefined)) });

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.signInAction }));

        await waitFor(() => expect(screen.getByLabelText(auth.emailLabel).hasAttribute('readonly')).toBe(true));
        expect(screen.getByLabelText(auth.passwordLabel).hasAttribute('readonly')).toBe(true);
    });
});

describe('LoginScreen — the network error (§8 “States”)', () => {
    function setup(options: SignInDoubleOptions, overrides: Record<string, unknown>) {
        const signIn = makeSignIn(options, overrides);
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();
        submitCredentials('pw');

        return signIn;
    }

    it('names an unreachable service when the call THROWS a network failure', async () => {
        setup(
            {},
            {
                password: vi.fn(async () => {
                    throw new TypeError('Network request failed');
                }),
            },
        );

        expect((await screen.findByRole('alert')).textContent).toBe(auth.networkError);
    });

    it('names an unreachable service when Clerk RETURNS a network_error', async () => {
        setup(
            {},
            { password: vi.fn(async () => ({ error: { code: 'network_error', message: 'Browser is offline' } })) },
        );

        expect((await screen.findByRole('alert')).textContent).toBe(auth.networkError);
    });

    it('shows the alert above the primary action', async () => {
        setup(
            {},
            {
                password: vi.fn(async () => {
                    throw new TypeError('Network request failed');
                }),
            },
        );

        const alert = await screen.findByRole('alert');

        expect(
            alert.compareDocumentPosition(screen.getByRole('button', { name: auth.signInAction })) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('does NOT blame the network for a wrong password', async () => {
        const signIn = makeSignIn({ correctPassword: 'other' });
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();
        submitCredentials('pw');

        const alert = await screen.findByRole('alert');

        expect(alert.textContent).toBe('Incorrect password');
        expect(screen.queryByText(auth.networkError)).toBeNull();
    });

    it('names an unreachable service when sending the new-device code fails on the network', async () => {
        const signIn = makeSignIn({ afterPassword: 'needs_client_trust' });
        signIn.mfa.sendEmailCode = vi.fn(async () => ({ error: { code: 'network_error', message: 'x' } }));
        useSignInMock.mockReturnValue(partialHook({ signIn }));
        renderLogin();
        submitCredentials('pw');

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
            signIn: makeSignIn({ correctPassword: 'other' }),
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
