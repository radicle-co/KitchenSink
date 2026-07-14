/**
 * Component tests for the mobile LoginScreen (rendered via react-native-web under jsdom). Covers the
 * password sign-in happy path AND the new-device email-code verification branch — the Clerk future-API
 * flow (`signIn.create` → `signIn.password` → when `needs_first_factor`, `signIn.emailCode.sendCode` →
 * code UI → `signIn.emailCode.verifyCode` → `complete` → `setActive`). `@clerk/expo` is mocked so no real
 * Clerk instance is needed; queries are by role/label/text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TamaguiProvider } from 'tamagui';

import { useClerk, useSignIn } from '@clerk/expo';

import tamaguiConfig from '../../tamagui.config';
import { LoginScreen } from '../../src/screens/login.js';

vi.mock('@clerk/expo', () => ({
    useSignIn: vi.fn(),
    useClerk: vi.fn(),
}));

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
    render(
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
            <LoginScreen onSignUp={() => undefined} />
        </TamaguiProvider>,
    );
}

beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useClerkMock.mockReturnValue({ setActive } as any);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('LoginScreen', () => {
    it('signs in directly when the password attempt completes', async () => {
        const signIn = makeSignIn({ status: 'complete' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByText('Sign in'));

        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
        expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
    });

    it('advances to the email-code step and completes verification for a new device', async () => {
        // After password the instance requires an email code; after verifyCode it is complete.
        const signIn = makeSignIn({ status: 'needs_first_factor' });
        signIn.emailCode.verifyCode = vi.fn(async () => {
            signIn.status = 'complete';

            return { error: null };
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByText('Sign in'));

        // The code-entry UI appears and a code was sent.
        await waitFor(() => expect(screen.getByPlaceholderText('Verification code')).toBeTruthy());
        expect(signIn.emailCode.sendCode).toHaveBeenCalled();

        fireEvent.change(screen.getByPlaceholderText('Verification code'), { target: { value: '424242' } });
        fireEvent.click(screen.getByText('Verify'));

        await waitFor(() => expect(signIn.emailCode.verifyCode).toHaveBeenCalledWith({ code: '424242' }));
        await waitFor(() => expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' }));
    });

    it('surfaces an error when the password is rejected', async () => {
        // Default status is not 'needs_first_factor', so the password attempt runs (and is rejected here).
        const signIn = makeSignIn();
        signIn.password = vi.fn(async () => ({ error: { message: 'Incorrect password' } }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSignInMock.mockReturnValue({ signIn } as any);
        renderLogin();

        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByText('Sign in'));

        await waitFor(() => expect(screen.getByText('Incorrect password')).toBeTruthy());
        expect(setActive).not.toHaveBeenCalled();
    });
});
