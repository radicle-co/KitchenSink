/**
 * `CompleteSignUpScreen` — the step after a Google / Apple sign-up that asks ONLY for what the provider did not supply
 * (owner ruling 2026-10-13; plan 012 D6, D11). It acts on the sign-up the provider hook RETURNED (`signUp.update`,
 * which throws on failure — the legacy resource), never on the screen-level future-API signal.
 *
 * Every state is a case: the fields drawn, the address the account is for, an empty field refused without a call, a
 * completed sign-up started as a session, a sign-up that still needs more (asked next), Clerk's field error under its
 * field, any other failure in the alert, a status it cannot finish (reported), busy, and the way out.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useClerk } from '@clerk/expo';
import { ClerkAPIResponseError } from '@clerk/shared/error';
import * as Sentry from '@sentry/react-native';

import { recordedTextInput, recordedTextInputs } from '@commise/ui/testing/record-text-inputs';

import { SIGN_UP_FIELDS, type SignUpFieldName } from '../../src/auth/signUpFields.js';
import { CompleteSignUpScreen } from '../../src/screens/CompleteSignUpScreen.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const { auth } = mobileMessages.en;

vi.mock('@clerk/expo', async () => {
    const { isClerkAPIResponseError } = await import('@clerk/shared/error');

    return { useClerk: vi.fn(), isClerkAPIResponseError };
});
// React Native has no `aria-describedby`, and react-native-web drops `accessibilityHint`, so the fields are wrapped to
// record what a screen reader is actually given (`recordedTextInput`).
vi.mock('@commise/ui/text-input', async (importOriginal) => {
    const { recordingTextInputModule } = await import('@commise/ui/testing/record-text-inputs');

    return recordingTextInputModule(await importOriginal<typeof import('@commise/ui/text-input')>());
});
vi.mock('@sentry/react-native', () => ({ captureMessage: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
    SafeAreaView: ({ children }: { readonly children?: unknown }) => createElement('div', null, children as never),
}));

const setActive = vi.fn(async () => undefined);
vi.mocked(useClerk).mockReturnValue({ setActive } as never);

afterEach(() => {
    cleanup();
    recordedTextInputs.clear();
    vi.clearAllMocks();
    vi.mocked(useClerk).mockReturnValue({ setActive } as never);
});

const specs = (...names: SignUpFieldName[]) => SIGN_UP_FIELDS.filter((field) => names.includes(field.name));

/**
 * A legacy `SignUpResource` double: `update` mutates it IN PLACE, as clerk-js does, and completes it once nothing is
 * missing — unless the test supplies its own `update`.
 */
function makeSignUp(missing: SignUpFieldName[], overrides: Record<string, unknown> = {}) {
    const signUp = {
        id: 'sua_1',
        status: 'missing_requirements' as string,
        createdSessionId: null as string | null,
        emailAddress: 'relay@privaterelay.appleid.com' as string | null,
        missingFields: [...missing] as string[],
        unverifiedFields: [] as string[],
        update: vi.fn(async (params: Record<string, string>) => {
            const sent = new Set(Object.keys(params));
            const byParam = Object.fromEntries(SIGN_UP_FIELDS.map((field) => [field.param, field.name]));
            signUp.missingFields = signUp.missingFields.filter((name) => ![...sent].some((p) => byParam[p] === name));

            if (signUp.missingFields.length === 0) {
                signUp.status = 'complete';
                signUp.createdSessionId = 'sess_1';
            }

            return signUp;
        }),
        ...overrides,
    };

    return signUp;
}

function renderStep(
    signUp: ReturnType<typeof makeSignUp>,
    fields = specs(...(signUp.missingFields as SignUpFieldName[])),
) {
    const onStartOver = vi.fn();
    render(<CompleteSignUpScreen signUp={signUp as never} fields={fields} onStartOver={onStartOver} />);

    return onStartOver;
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: auth.createAccountAction }));

describe('CompleteSignUpScreen', () => {
    it('asks only for the missing fields, under its own heading, naming the address the account is for', () => {
        renderStep(makeSignUp(['username']));

        expect(screen.getByRole('heading', { name: auth.finishTitle, level: 1 })).toBeTruthy();
        expect(screen.getByText(auth.finishPrompt)).toBeTruthy();
        expect(screen.getByText('Signing up as relay@privaterelay.appleid.com')).toBeTruthy();
        expect(screen.getByLabelText(auth.usernameLabel)).toBeTruthy();
        expect(screen.queryByLabelText(auth.firstNameLabel)).toBeNull();
        expect(screen.queryByLabelText(auth.emailLabel)).toBeNull();
        expect(screen.queryByLabelText(auth.passwordLabel)).toBeNull();
    });

    it('omits the "signing up as" line when Clerk holds no address', () => {
        renderStep(makeSignUp(['username'], { emailAddress: null }));

        expect(screen.queryByText(/Signing up as/u)).toBeNull();
    });

    it('sends the names and the username, trimmed, to the RETURNED sign-up, then starts the session', async () => {
        const signUp = makeSignUp(['first_name', 'last_name', 'username']);
        renderStep(signUp);

        fireEvent.change(screen.getByLabelText(auth.firstNameLabel), { target: { value: ' Ada ' } });
        fireEvent.change(screen.getByLabelText(auth.lastNameLabel), { target: { value: 'Lovelace' } });
        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'ada ' } });
        submit();

        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
        expect(signUp.update).toHaveBeenCalledWith({ firstName: 'Ada', lastName: 'Lovelace', username: 'ada' });
    });

    it('refuses an empty field without calling Clerk, and says why under it', async () => {
        const signUp = makeSignUp(['username']);
        renderStep(signUp);

        submit();

        await screen.findByText(auth.usernameRequired);
        // REWRITTEN: this asserted `aria-describedby` in the DOM, which a device ignores. The error LEADS the hint.
        expect(recordedTextInput('complete-signup-username').accessibilityHint).toBe(
            `${auth.usernameRequired} ${auth.usernameHint}`,
        );
        expect(recordedTextInput('complete-signup-username').accessibilityLabel).toBe(auth.usernameLabel);
        expect(signUp.update).not.toHaveBeenCalled();
    });

    it('puts Clerk’s error on the field it names (a taken username)', async () => {
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
        renderStep(makeSignUp(['username'], { update: vi.fn(async () => Promise.reject(taken)) }));

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'ada' } });
        submit();

        expect(await screen.findByText('That username is taken. Please try another.')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(setActive).not.toHaveBeenCalled();
    });

    it('routes EVERY error Clerk returns, and one on a field this step does not show goes to the alert', async () => {
        const two = new ClerkAPIResponseError('Two problems', {
            data: [
                {
                    code: 'form_identifier_exists',
                    message: 'That address is in use.',
                    long_message: 'That address is in use.',
                    meta: { param_name: 'email_address' },
                },
                {
                    code: 'form_username_invalid_character',
                    message: 'Usernames may only contain letters and numbers.',
                    long_message: 'Usernames may only contain letters and numbers.',
                    meta: { param_name: 'username' },
                },
            ],
            status: 422,
        });
        renderStep(makeSignUp(['username'], { update: vi.fn(async () => Promise.reject(two)) }));

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'a-b' } });
        submit();

        await screen.findByText('Usernames may only contain letters and numbers.');

        expect(recordedTextInput('complete-signup-username').accessibilityHint).toBe(
            `Usernames may only contain letters and numbers. ${auth.usernameHint}`,
        );
        expect((await screen.findByRole('alert')).textContent).toBe('That address is in use.');
    });

    it('sends a username typed with one leading "@" without it', async () => {
        const signUp = makeSignUp(['username']);
        renderStep(signUp);

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: '@ada' } });
        submit();

        await waitFor(() => expect(signUp.update).toHaveBeenCalledWith({ username: 'ada' }));
    });

    it('moves focus to the FIRST field in error', async () => {
        renderStep(makeSignUp(['first_name', 'last_name', 'username']));

        fireEvent.change(screen.getByLabelText(auth.firstNameLabel), { target: { value: 'Ada' } });
        submit();

        await screen.findByText(auth.lastNameRequired);
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(auth.lastNameLabel)));
    });

    it('shows any other failure in the alert (an unreachable service)', async () => {
        renderStep(
            makeSignUp(['username'], {
                update: vi.fn(async () => Promise.reject(new TypeError('Network request failed'))),
            }),
        );

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'ada' } });
        submit();

        expect((await screen.findByRole('alert')).textContent).toBe(auth.networkError);
    });

    it('asks next for what Clerk still lists, keeping what was typed', async () => {
        const signUp = makeSignUp(['username'], {
            update: vi.fn(async () => {
                signUp.missingFields = ['first_name'];

                return signUp;
            }),
        });
        renderStep(signUp);

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'ada' } });
        submit();

        expect(await screen.findByLabelText(auth.firstNameLabel)).toBeTruthy();
        expect(screen.queryByLabelText(auth.usernameLabel)).toBeNull();
        expect(setActive).not.toHaveBeenCalled();
    });

    it('says more is needed, and reports it, when the sign-up then wants something this step cannot ask', async () => {
        const signUp = makeSignUp(['username'], {
            update: vi.fn(async () => {
                signUp.missingFields = ['legal_accepted'];

                return signUp;
            }),
        });
        renderStep(signUp);

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'ada' } });
        submit();

        expect((await screen.findByRole('alert')).textContent).toBe(auth.signUpUnsupported);
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
            'Native social sign-up reached a status it cannot finish',
            expect.objectContaining({ extra: expect.objectContaining({ missingFields: ['legal_accepted'] }) }),
        );
    });

    it('locks the fields and both actions while the update is in flight', async () => {
        renderStep(makeSignUp(['username'], { update: vi.fn(() => new Promise(() => undefined)) }));

        fireEvent.change(screen.getByLabelText(auth.usernameLabel), { target: { value: 'ada' } });
        submit();

        await waitFor(() => expect(screen.getByLabelText(auth.usernameLabel).hasAttribute('readonly')).toBe(true));
        expect(screen.getByRole('button', { name: auth.startOverAction }).getAttribute('aria-disabled')).toBe('true');
    });

    it('starts over without calling Clerk: the abandoned attempt simply expires', () => {
        const signUp = makeSignUp(['username']);
        const onStartOver = renderStep(signUp);

        fireEvent.click(screen.getByRole('button', { name: auth.startOverAction }));

        expect(onStartOver).toHaveBeenCalledTimes(1);
        expect(signUp.update).not.toHaveBeenCalled();
    });
});
