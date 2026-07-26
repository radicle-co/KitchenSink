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

import { SignUpScreen } from '../../src/screens/signup.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const { auth } = mobileMessages.en;

vi.mock('@clerk/expo', () => ({
    useSignUp: vi.fn(),
    useClerk: vi.fn(),
}));

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

const useSignUpMock = vi.mocked(useSignUp);
const useClerkMock = vi.mocked(useClerk);

const setActive = vi.fn(async () => undefined);

type StepResult = { error: { message: string } | null };
const ok = async (): Promise<StepResult> => ({ error: null });

function makeSignUp(overrides: Record<string, unknown> = {}) {
    return {
        status: 'complete',
        createdSessionId: 'sess_1',
        create: vi.fn(ok),
        password: vi.fn(ok),
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('SignUpScreen — chrome + design system', () => {
    it('renders the DS create button, localized labelled fields, and the safe-area + keyboard-avoiding wrappers', () => {
        const signUp = makeSignUp();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignUpMock.mockReturnValue({ signUp } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useClerkMock.mockReturnValue({ setActive } as any);
        render(<SignUpScreen onBack={() => undefined} />);

        expect(screen.getByText(auth.brand)).toBeTruthy();
        expect(screen.getByText(auth.createHeading)).toBeTruthy();
        expect(screen.getByRole('button', { name: auth.createAccountAction })).toBeTruthy();
        expect(screen.getByRole('button', { name: auth.signInLink })).toBeTruthy();

        expect(screen.getByLabelText(auth.emailLabel)).toBeTruthy();
        expect(screen.getByLabelText(auth.passwordLabel)).toBeTruthy();

        expect(screen.getByLabelText('safe-area-root')).toBeTruthy();
        expect(screen.getByLabelText('keyboard-avoiding')).toBeTruthy();
    });

    it('routes the toggle link to onBack', () => {
        const onBack = vi.fn();
        const signUp = makeSignUp();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignUpMock.mockReturnValue({ signUp } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useClerkMock.mockReturnValue({ setActive } as any);
        render(<SignUpScreen onBack={onBack} />);

        fireEvent.click(screen.getByRole('button', { name: auth.signInLink }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('shows the busy spinner and disables the create button while sign-up is in flight', async () => {
        const signUp = makeSignUp({ create: vi.fn(() => new Promise<StepResult>(() => undefined)) });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignUpMock.mockReturnValue({ signUp } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useClerkMock.mockReturnValue({ setActive } as any);
        render(<SignUpScreen onBack={() => undefined} />);

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.createAccountAction }));

        await waitFor(() => {
            const button = screen.getByRole('button', { name: auth.createAccountAction });
            expect(within(button).getByRole('progressbar', { hidden: true })).toBeTruthy();
            expect(button.getAttribute('aria-disabled')).toBe('true');
        });
    });
});

describe('SignUpScreen — sign-up flow', () => {
    it('creates the account and activates the session on the happy path', async () => {
        const signUp = makeSignUp({ status: 'complete' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignUpMock.mockReturnValue({ signUp } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useClerkMock.mockReturnValue({ setActive } as any);
        render(<SignUpScreen onBack={() => undefined} />);

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: auth.createAccountAction }));

        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
    });

    it('surfaces the localized additional-verification message when the sign-up does not complete', async () => {
        const signUp = makeSignUp({ status: 'missing_requirements', createdSessionId: null });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignUpMock.mockReturnValue({ signUp } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useClerkMock.mockReturnValue({ setActive } as any);
        render(<SignUpScreen onBack={() => undefined} />);

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByLabelText(auth.passwordLabel), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: auth.createAccountAction }));

        expect((await screen.findByRole('alert')).textContent).toContain(auth.additionalVerification);
        expect(setActive).not.toHaveBeenCalled();
    });

    it('falls back to the localized message when a failure carries no Clerk message', async () => {
        const signUp = makeSignUp({
            create: vi.fn(async () => {
                throw new Error();
            }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignUpMock.mockReturnValue({ signUp } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useClerkMock.mockReturnValue({ setActive } as any);
        render(<SignUpScreen onBack={() => undefined} />);

        fireEvent.change(screen.getByLabelText(auth.emailLabel), { target: { value: 'a@b.com' } });
        fireEvent.click(screen.getByRole('button', { name: auth.createAccountAction }));

        expect((await screen.findByRole('alert')).textContent).toContain(auth.signUpFailed);
    });
});
