/**
 * Component tests for the rebuilt mobile SignUpScreen (U2). react-native-web under jsdom. Mirrors the login
 * rebuild: DS `Button` (with `busy`) + tokenized `Input`, all copy from `mobileMessages`, associated field
 * labels, and a `SafeAreaView` + `KeyboardAvoidingView` shell. `@clerk/expo` is mocked; queries are by
 * role / accessible label / dictionary text.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { useClerk, useSignUp } from '@clerk/expo';
import * as Sentry from '@sentry/react-native';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { SignUpScreen } from '../../src/screens/signup.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const { auth } = mobileMessages.en;

vi.mock('@clerk/expo', async () => {
    // The REAL predicate (the screens' failure wording reads it); only the hooks are doubles.
    const { isClerkAPIResponseError } = await import('@clerk/shared/error');

    return { useSignUp: vi.fn(), useClerk: vi.fn(), isClerkAPIResponseError };
});

// An unsupported requirement is reported to Sentry; the real SDK needs a native module.
vi.mock('@sentry/react-native', () => ({ captureMessage: vi.fn() }));

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

const useSignUpMock = vi.mocked(useSignUp);
const useClerkMock = vi.mocked(useClerk);

/**
 * A hook result the screen under test reads, built from just the members it touches. The real Clerk hook results are
 * large resource types the screen uses a handful of members of; `never` is the one place that gap is bridged.
 */
const partialHook = (members: object): never => members as never;

const setActive = vi.fn(async () => undefined);

type StepResult = { error: { code?: string; message: string } | null };
const ok = async (): Promise<StepResult> => ({ error: null });

/** What the Clerk instance still wants after the four fields and a password. */
type Requirement = 'nothing' | 'emailCode' | 'phone';

/**
 * A Clerk `signUp` future-resource double that models Clerk's REAL status transitions (the sign-in double it
 * mirrors exists because a double that keeps its status hid A-001).
 *
 * - `password(...)` leaves the sign-up `complete` when `requirement` is `nothing`; otherwise `missing_requirements`
 *   with the thing still owed: an unverified `email_address` (Clerk's email-verification step), or a `username`
 *   this form has no field for.
 * - `verifications.sendEmailCode` works only while the email is unverified; `424242` is the code.
 */
function makeSignUp(requirement: Requirement = 'nothing', overrides: Record<string, unknown> = {}) {
    const signUp = {
        status: 'missing_requirements',
        createdSessionId: null as string | null,
        missingFields: ['password'] as string[],
        unverifiedFields: [] as string[],
        create: vi.fn(ok),
        password: vi.fn(async (): Promise<StepResult> => {
            if (requirement === 'nothing') {
                signUp.status = 'complete';
                signUp.createdSessionId = 'sess_1';
                signUp.missingFields = [];
            } else if (requirement === 'emailCode') {
                signUp.missingFields = [];
                signUp.unverifiedFields = ['email_address'];
            } else {
                signUp.missingFields = ['phone_number'];
            }

            return { error: null };
        }),
        verifications: {
            sendEmailCode: vi.fn(async (): Promise<StepResult> => {
                return signUp.unverifiedFields.includes('email_address')
                    ? { error: null }
                    : { error: { code: 'client_state_invalid', message: 'Nothing to verify' } };
            }),
            verifyEmailCode: vi.fn(async ({ code }: { code: string }): Promise<StepResult> => {
                if (!signUp.unverifiedFields.includes('email_address') || code !== '424242') {
                    return { error: { code: 'form_code_incorrect', message: 'Incorrect code' } };
                }

                signUp.unverifiedFields = [];
                signUp.status = 'complete';
                signUp.createdSessionId = 'sess_1';

                return { error: null };
            }),
        },
        reset: vi.fn(async (): Promise<StepResult> => {
            signUp.status = 'missing_requirements';
            signUp.unverifiedFields = [];

            return { error: null };
        }),
        ...overrides,
    };

    return signUp;
}

/** The four profile fields both Clerk instances require (owner ruling 2026-10-13), by their visible labels. */
const PROFILE = {
    [auth.firstNameLabel]: 'Ada',
    [auth.lastNameLabel]: 'Lovelace',
    [auth.usernameLabel]: 'ada',
    [auth.emailLabel]: 'a@b.com',
};

/** Fill every field except those named in `skip`, and press Create account. */
function submitCredentials(password = 'pw', skip: readonly string[] = []) {
    for (const [label, value] of Object.entries(PROFILE)) {
        if (!skip.includes(label)) {
            fireEvent.change(screen.getByLabelText(label), { target: { value } });
        }
    }

    fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: auth.createAccountAction }));
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    platform.os = undefined;
    systemScheme.current = null;
});

describe('SignUpScreen — chrome + design system', () => {
    // An edge-to-edge Android window is not resized for the keyboard (E2 I6), so the avoider pads on both platforms; this
    // screen padded on iOS only. The rule is `@commise/ui/keyboard-avoider`'s, the one avoider the apps use.
    it.each(['android', 'ios'] as const)('pads its form above the keyboard on %s', (os) => {
        platform.os = os;
        const signUp = makeSignUp();
        useSignUpMock.mockReturnValue(partialHook({ signUp }));
        useClerkMock.mockReturnValue(partialHook({ setActive }));
        render(<SignUpScreen onBack={() => undefined} />);

        expect(screen.getByLabelText('keyboard-avoiding').getAttribute('data-behavior')).toBe('padding');
    });

    it('renders the DS create button, localized labelled fields, and the safe-area + keyboard-avoiding wrappers', () => {
        const signUp = makeSignUp();
        useSignUpMock.mockReturnValue(partialHook({ signUp }));
        useClerkMock.mockReturnValue(partialHook({ setActive }));
        render(<SignUpScreen onBack={() => undefined} />);

        expect(screen.getByText(auth.brand)).toBeTruthy();
        expect(screen.getByText(auth.createHeading)).toBeTruthy();
        expect(screen.getByRole('button', { name: auth.createAccountAction })).toBeTruthy();
        expect(screen.getByRole('link', { name: auth.signInLink })).toBeTruthy();

        expect(screen.getByLabelText(auth.emailLabel)).toBeTruthy();
        expect(screen.getByLabelText(auth.passwordLabel)).toBeTruthy();

        expect(screen.getByLabelText('safe-area-root')).toBeTruthy();
        expect(screen.getByLabelText('keyboard-avoiding')).toBeTruthy();
    });

    it('routes the toggle link to onBack', () => {
        const onBack = vi.fn();
        const signUp = makeSignUp();
        useSignUpMock.mockReturnValue(partialHook({ signUp }));
        useClerkMock.mockReturnValue(partialHook({ setActive }));
        render(<SignUpScreen onBack={onBack} />);

        fireEvent.click(screen.getByRole('link', { name: auth.signInLink }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('shows the busy spinner and disables the create button while sign-up is in flight', async () => {
        const signUp = makeSignUp('nothing', { create: vi.fn(() => new Promise<StepResult>(() => undefined)) });
        useSignUpMock.mockReturnValue(partialHook({ signUp }));
        useClerkMock.mockReturnValue(partialHook({ setActive }));
        render(<SignUpScreen onBack={() => undefined} />);

        submitCredentials();

        await waitFor(() => {
            const button = screen.getByRole('button', { name: auth.createAccountAction });
            expect(within(button).getByRole('progressbar', { hidden: true })).toBeTruthy();
            expect(button.getAttribute('aria-disabled')).toBe('true');
        });
    });
});

describe('SignUpScreen — sign-up flow', () => {
    function setup(requirement: Requirement = 'nothing', overrides: Record<string, unknown> = {}) {
        const signUp = makeSignUp(requirement, overrides);
        useSignUpMock.mockReturnValue(partialHook({ signUp }));
        useClerkMock.mockReturnValue(partialHook({ setActive }));
        render(<SignUpScreen onBack={() => undefined} />);

        return signUp;
    }

    it('creates the account and activates the session on the happy path', async () => {
        const signUp = setup('nothing');

        submitCredentials('pw');

        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
        expect(signUp.create).toHaveBeenCalledWith({
            firstName: 'Ada',
            lastName: 'Lovelace',
            username: 'ada',
            emailAddress: 'a@b.com',
        });
        expect(signUp.password).toHaveBeenCalledWith({ password: 'pw' });
        expect(signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
    });

    it('asks for the emailed code when the email still needs verifying, then activates the session (W-05)', async () => {
        const signUp = setup('emailCode');

        submitCredentials('pw');

        // The code-entry UI appears (labelled, one-time-code) and exactly one code was sent.
        const codeField = await screen.findByLabelText(auth.codeLabel);
        expect(codeField.getAttribute('autocomplete')).toBe('one-time-code');
        expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
        expect(setActive).not.toHaveBeenCalled();
        expect(screen.queryByText(auth.additionalVerification)).toBeNull();

        fireEvent.change(codeField, { target: { value: '424242' } });
        fireEvent.click(screen.getByRole('button', { name: auth.verifyAction }));

        await waitFor(() => expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: '424242' }));
        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
    });

    it('a wrong code shows the error, stays on the code step and starts no session', async () => {
        setup('emailCode');
        submitCredentials('pw');
        fireEvent.change(await screen.findByLabelText(auth.codeLabel), { target: { value: '000000' } });

        fireEvent.click(screen.getByRole('button', { name: auth.verifyAction }));

        expect((await screen.findByRole('alert')).textContent).toBe('Incorrect code');
        expect(screen.getByLabelText(auth.codeLabel)).toBeTruthy();
        expect(setActive).not.toHaveBeenCalled();
    });

    it('falls back to the localized message when the code check fails without a Clerk message', async () => {
        const signUp = setup('emailCode');
        signUp.verifications.verifyEmailCode = vi.fn(async () => ({ error: { message: '' } }));
        submitCredentials('pw');
        fireEvent.change(await screen.findByLabelText(auth.codeLabel), { target: { value: '1' } });

        fireEvent.click(screen.getByRole('button', { name: auth.verifyAction }));

        expect((await screen.findByRole('alert')).textContent).toBe(auth.verifyFailed);
    });

    it('stays on the form with the localized message when the verification code cannot be sent', async () => {
        const signUp = setup('emailCode');
        signUp.verifications.sendEmailCode = vi.fn(async () => ({ error: { message: '' } }));

        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toBe(auth.sendCodeFailed);
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
    });

    it('says more is needed, and reports it, when the instance wants something this form has no field for', async () => {
        const signUp = setup('phone');

        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toBe(auth.additionalVerification);
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
        expect(signUp.verifications.sendEmailCode).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(setActive).not.toHaveBeenCalled();
    });

    it('resends the code and starts over with a reset', async () => {
        const signUp = setup('emailCode');
        submitCredentials('pw');
        await screen.findByLabelText(auth.codeLabel);

        fireEvent.click(screen.getByRole('button', { name: auth.resendCodeAction }));
        await waitFor(() => expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(2));
        // The controls lock while the resend is in flight; wait for them to free up.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: auth.startOverAction }).getAttribute('aria-disabled')).not.toBe(
                'true',
            ),
        );

        fireEvent.click(screen.getByRole('button', { name: auth.startOverAction }));

        await waitFor(() => expect(signUp.reset).toHaveBeenCalledTimes(1));
        expect(await screen.findByLabelText(auth.passwordLabel)).toBeTruthy();
        expect(screen.queryByLabelText(auth.codeLabel)).toBeNull();
    });

    it.each([
        [auth.firstNameLabel, auth.firstNameRequired],
        [auth.lastNameLabel, auth.lastNameRequired],
        [auth.usernameLabel, auth.usernameRequired],
        [auth.emailLabel, auth.emailRequired],
    ])('refuses an empty %s without calling Clerk, and says why UNDER that field', async (label, message) => {
        const signUp = setup('nothing');

        submitCredentials('pw', [label]);

        const field = screen.getByLabelText(label);
        const described = await screen.findByText(message);

        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(described.id);
        expect(signUp.create).not.toHaveBeenCalled();
    });

    it('a blank-only name is empty: names are trimmed before they are judged and sent', async () => {
        const signUp = setup('nothing');

        fireEvent.change(screen.getByLabelText(auth.firstNameLabel), { target: { value: '   ' } });
        submitCredentials('pw', [auth.firstNameLabel]);

        expect(await screen.findByText(auth.firstNameRequired)).toBeTruthy();
        expect(signUp.create).not.toHaveBeenCalled();
    });

    it('puts Clerk’s error on the field it names (a taken username), not in the alert', async () => {
        const { ClerkAPIResponseError } = await import('@clerk/shared/error');
        const taken = new ClerkAPIResponseError('That username is taken. Please try another.', {
            data: [
                {
                    code: 'form_identifier_exists',
                    message: 'That username is taken. Please try another.',
                    long_message: 'That username is taken. Please try another.',
                    meta: { param_name: 'username' },
                },
            ],
            status: 422,
        });
        setup('nothing', { create: vi.fn(async () => ({ error: taken })) });

        submitCredentials('pw');

        const described = await screen.findByText('That username is taken. Please try another.');

        expect(screen.getByLabelText(auth.usernameLabel).getAttribute('aria-describedby')?.split(' ')).toContain(
            described.id,
        );
        expect(screen.queryByRole('alert')).toBeNull();
        expect(setActive).not.toHaveBeenCalled();
    });

    it('clears a field’s error once the person edits it', async () => {
        setup('nothing');
        submitCredentials('pw', [auth.usernameLabel]);
        await screen.findByText(auth.usernameRequired);

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'ada' } });

        expect(screen.queryByText(auth.usernameRequired)).toBeNull();
        expect(screen.getByLabelText(auth.usernameLabel).getAttribute('aria-invalid')).not.toBe('true');
    });

    it('falls back to the localized message when a failure carries no Clerk message', async () => {
        setup('nothing', {
            create: vi.fn(async () => {
                throw new Error();
            }),
        });

        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toContain(auth.signUpFailed);
    });
});

describe('SignUpScreen — Section 8 native: order, copy and field hints', () => {
    function setup(overrides: Record<string, unknown> = {}) {
        useSignUpMock.mockReturnValue(partialHook({ signUp: makeSignUp('nothing', overrides) }));
        useClerkMock.mockReturnValue(partialHook({ setActive }));
        render(<SignUpScreen onBack={() => undefined} />);
    }

    it('reads mark → H1 → the brand line → first, last, username, email → password → Create account → sign-in link', () => {
        setup();

        const ordered = [
            screen.getByText(auth.brand),
            screen.getByRole('heading', { name: auth.createHeading, level: 1 }),
            screen.getByText(auth.brandLine),
            screen.getByLabelText(auth.firstNameLabel),
            screen.getByLabelText(auth.lastNameLabel),
            screen.getByLabelText(auth.usernameLabel),
            screen.getByLabelText(auth.emailLabel),
            screen.getByLabelText(auth.passwordLabel),
            screen.getByRole('button', { name: auth.createAccountAction }),
            screen.getByRole('link', { name: auth.signInLink }),
        ];

        ordered.slice(1).forEach((node, index) => {
            expect(
                (ordered[index] as HTMLElement).compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
        });
    });

    it('asks the OS for email and NEW-password autofill (so the manager offers to save, not to fill)', () => {
        setup();

        expect(screen.getByLabelText(auth.emailLabel).getAttribute('autocomplete')).toBe('email');
        expect(screen.getByLabelText(auth.passwordLabel).getAttribute('autocomplete')).toBe('new-password');
    });

    it('asks the OS for name and username autofill (SC 1.3.5), and never autocorrects a username', () => {
        setup();

        expect(screen.getByLabelText(auth.firstNameLabel).getAttribute('autocomplete')).toBe('given-name');
        expect(screen.getByLabelText(auth.lastNameLabel).getAttribute('autocomplete')).toBe('family-name');
        expect(screen.getByLabelText(auth.usernameLabel).getAttribute('autocomplete')).toBe('username');
        expect(screen.getByLabelText(auth.usernameLabel).getAttribute('autocorrect')).toBe('off');
        expect(screen.getByLabelText(auth.usernameLabel).getAttribute('autocapitalize')).toBe('none');
    });

    it('says what the username is for, under its label', () => {
        setup();

        expect(screen.getByText(auth.usernameHint)).toBeTruthy();
    });

    it('locks the form while the sign-up is in flight', async () => {
        setup({ create: vi.fn(() => new Promise<StepResult>(() => undefined)) });

        submitCredentials();

        await waitFor(() => expect(screen.getByLabelText(auth.emailLabel).hasAttribute('readonly')).toBe(true));

        for (const label of [auth.firstNameLabel, auth.lastNameLabel, auth.usernameLabel, auth.passwordLabel]) {
            expect(screen.getByLabelText(label).hasAttribute('readonly'), label).toBe(true);
        }
    });

    it('names an unreachable service on a network failure, but not for a rejected password', async () => {
        setup({
            create: vi.fn(async () => {
                throw new TypeError('Network request failed');
            }),
        });
        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toBe(auth.networkError);
    });

    it('keeps Clerk’s own message for a rejected password', async () => {
        setup({
            password: vi.fn(async () => ({
                error: { code: 'form_password_pwned', message: 'Password found in a breach' },
            })),
        });
        submitCredentials('pw');

        expect((await screen.findByRole('alert')).textContent).toBe('Password found in a breach');
    });
});

describe.each([
    ['light', role],
    ['dark', roleDark],
] as const)('SignUpScreen — the %s theme reads colour from roles', (name, roles) => {
    it('paints the mark and H1 in ink, the brand line and prompt in inkMuted, and the alert in dangerText', async () => {
        systemScheme.current = name;
        useSignUpMock.mockReturnValue({
            signUp: makeSignUp('nothing', { create: vi.fn(async () => ({ error: { message: 'No' } })) }),
        } as unknown as ReturnType<typeof useSignUp>);
        useClerkMock.mockReturnValue(partialHook({ setActive }));
        render(<SignUpScreen onBack={() => undefined} />);

        const colour = (node: HTMLElement) => window.getComputedStyle(node).color;

        expect(colour(screen.getByText(auth.brand))).toBe(rgb(roles.ink));
        expect(colour(screen.getByRole('heading', { name: auth.createHeading }))).toBe(rgb(roles.ink));
        expect(colour(screen.getByText(auth.brandLine))).toBe(rgb(roles.inkMuted));
        expect(colour(screen.getByText(auth.haveAccountPrompt))).toBe(rgb(roles.inkMuted));

        submitCredentials('pw');
        expect(colour(await screen.findByRole('alert'))).toBe(rgb(roles.dangerText));
    });
});
