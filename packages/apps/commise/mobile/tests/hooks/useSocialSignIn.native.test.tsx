/**
 * `useSocialSignIn` — the one Command both signed-out screens issue for "Continue with Apple / Google" (plan 012 D5,
 * D5a, D10). It adapts `@clerk/expo`'s two native hooks, reads the build's providers from
 * `Constants.expoConfig.extra`, and turns what the flow returned (or threw) into exactly one of: a started session, a
 * silent cancel, the finish step, or a message — each tested here, because each has a way to go silently wrong:
 *
 * - a cancel that showed an error, or reopened an earlier abandoned sign-up's finish step;
 * - a finish step built on the wrong resource (it must be the one the hook RETURNED);
 * - a failure that told the person nothing, or told Sentry nothing.
 *
 * `@clerk/expo`, its two provider entry points and Sentry are doubles; `expo-constants` is the suite's stub.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClerk } from '@clerk/expo';
import { useSignInWithApple } from '@clerk/expo/apple';
import { useSignInWithGoogle } from '@clerk/expo/google';
import * as Sentry from '@sentry/react-native';

import { useSocialSignIn } from '../../src/hooks/useSocialSignIn.js';
import { mobileMessages } from '../../src/i18n/messages.js';
// The SAME module the app's `expo-constants` import resolves to (the suite alias), typed as the stub so `extra` is settable.
import Constants from '../stubs/expoConstants.js';

const { auth } = mobileMessages.en;

vi.mock('@clerk/expo', async () => {
    const { isClerkAPIResponseError } = await import('@clerk/shared/error');

    return { useClerk: vi.fn(), isClerkAPIResponseError };
});
vi.mock('@clerk/expo/google', () => ({ useSignInWithGoogle: vi.fn() }));
vi.mock('@clerk/expo/apple', () => ({ useSignInWithApple: vi.fn() }));
vi.mock('@sentry/react-native', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const platform = vi.hoisted(() => ({ os: 'ios' as 'android' | 'ios' | 'web' }));
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
    };
});

const partial = (members: object): never => members as never;

const SANDBOX_EXTRA = {
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: '1-web.apps.googleusercontent.com',
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: '1-ios.apps.googleusercontent.com',
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: 'com.googleusercontent.apps.1-ios',
    EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID: '1-android.apps.googleusercontent.com',
    socialAuth: { googleIos: true, googleAndroid: true, appleIos: true },
};

const setActive = vi.fn(async () => undefined);
const startGoogle = vi.fn();
const startApple = vi.fn();
const onNeedsFields = vi.fn();

/** The Clerk client as it stood before the press: an earlier, abandoned attempt of each kind. */
const client = { signIn: { id: 'sia_old' }, signUp: { id: 'sua_old' } };

function newSignUp(missingFields: string[] = ['username']) {
    return {
        id: 'sua_new',
        status: 'missing_requirements',
        missingFields,
        unverifiedFields: [],
        emailAddress: 'a@b.com',
    };
}

beforeEach(() => {
    platform.os = 'ios';
    Constants.expoConfig.extra = SANDBOX_EXTRA;
    vi.mocked(useClerk).mockReturnValue(partial({ setActive, client }));
    vi.mocked(useSignInWithGoogle).mockReturnValue(partial({ startGoogleAuthenticationFlow: startGoogle }));
    vi.mocked(useSignInWithApple).mockReturnValue(partial({ startAppleAuthenticationFlow: startApple }));
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Constants.expoConfig.extra = undefined;
});

const render = () => renderHook(() => useSocialSignIn(onNeedsFields));

/** Press a provider and wait for the command to settle. */
async function press(result: ReturnType<typeof render>['result'], provider: 'apple' | 'google') {
    act(() => result.current.start(provider));
    await waitFor(() => expect(result.current.busyProvider).toBeNull());
}

describe('useSocialSignIn — which providers this build offers', () => {
    it('offers Apple then Google on iOS', () => {
        expect(render().result.current.providers).toEqual(['apple', 'google']);
    });

    it('offers Google only on Android', () => {
        platform.os = 'android';

        expect(render().result.current.providers).toEqual(['google']);
    });

    it('⛔ offers nothing on prod Android, whose Google client is not registered (D3)', () => {
        platform.os = 'android';
        Constants.expoConfig.extra = {
            ...SANDBOX_EXTRA,
            socialAuth: { ...SANDBOX_EXTRA.socialAuth, googleAndroid: false },
        };

        expect(render().result.current.providers).toEqual([]);
    });

    it('offers nothing for a build that was given no known Clerk instance', () => {
        Constants.expoConfig.extra = undefined;

        expect(render().result.current.providers).toEqual([]);
    });
});

describe('useSocialSignIn — what a press amounts to', () => {
    it('starts the session Clerk created, and shows nothing', async () => {
        startGoogle.mockResolvedValue({ createdSessionId: 'sess_1', signIn: client.signIn, signUp: client.signUp });
        const { result } = render();

        await press(result, 'google');

        expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' });
        expect(result.current.error).toBeNull();
    });

    it('reports busy with the pressed provider while its sheet is up', async () => {
        let finish: (value: unknown) => void = () => undefined;
        startApple.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const { result } = render();

        act(() => result.current.start('apple'));

        await waitFor(() => expect(result.current.busyProvider).toBe('apple'));
        act(() => finish({ createdSessionId: null, signIn: client.signIn, signUp: client.signUp }));
        await waitFor(() => expect(result.current.busyProvider).toBeNull());
    });

    it('is SILENT when the person closes the sheet (4.6.0 returns a null session, ids unchanged)', async () => {
        startGoogle.mockResolvedValue({ createdSessionId: null, signIn: client.signIn, signUp: client.signUp });
        const { result } = render();

        await press(result, 'google');

        expect(result.current.error).toBeNull();
        expect(onNeedsFields).not.toHaveBeenCalled();
        expect(setActive).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('is SILENT for a THROWN cancel too, should a later SDK throw as its docs say', async () => {
        startApple.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED', message: 'The operation was canceled.' });
        const { result } = render();

        await press(result, 'apple');

        expect(result.current.error).toBeNull();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('⛔ does not reopen an earlier abandoned sign-up when the sheet is cancelled', async () => {
        const abandoned = { ...newSignUp(), id: 'sua_old' };
        startGoogle.mockResolvedValue({ createdSessionId: null, signIn: client.signIn, signUp: abandoned });
        const { result } = render();

        await press(result, 'google');

        expect(onNeedsFields).not.toHaveBeenCalled();
    });

    it('hands the RETURNED sign-up to the finish step when it stopped at missing fields', async () => {
        const created = newSignUp(['username', 'first_name']);
        startApple.mockResolvedValue({ createdSessionId: null, signIn: client.signIn, signUp: created });
        const { result } = render();

        await press(result, 'apple');

        expect(onNeedsFields).toHaveBeenCalledWith({
            signUp: created,
            fields: [expect.objectContaining({ name: 'first_name' }), expect.objectContaining({ name: 'username' })],
        });
        expect(setActive).not.toHaveBeenCalled();
    });

    it('says more is needed, and reports it, for a status it cannot finish (a second factor)', async () => {
        startGoogle.mockResolvedValue({
            createdSessionId: null,
            signIn: { id: 'sia_new', status: 'needs_second_factor' },
            signUp: client.signUp,
        });
        const { result } = render();

        await press(result, 'google');

        expect(result.current.error).toBe(auth.additionalVerification);
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
            'Native social sign-in reached a status it cannot finish',
            expect.objectContaining({
                extra: expect.objectContaining({ provider: 'google', status: 'needs_second_factor' }),
            }),
        );
    });
});

describe('useSocialSignIn — failures', () => {
    it('says Google cannot run here for a Play services failure, and reports it with the provider and platform', async () => {
        platform.os = 'android';
        const failure = Object.assign(new Error('[28444] Developer console is not set up correctly.'), {
            code: 'GOOGLE_SIGN_IN_ERROR',
        });
        startGoogle.mockRejectedValue(failure);
        const { result } = render();

        await press(result, 'google');

        expect(result.current.error).toBe(auth.googleUnavailable);
        expect(Sentry.captureException).toHaveBeenCalledWith(
            failure,
            expect.objectContaining({ tags: { provider: 'google', platform: 'android' } }),
        );
    });

    it('says Sign in with Apple is not set up when the device cannot run it', async () => {
        startApple.mockRejectedValue({ code: 'ERR_REQUEST_UNKNOWN', message: 'The operation couldn’t be completed.' });
        const { result } = render();

        await press(result, 'apple');

        expect(result.current.error).toBe(auth.appleUnavailable);
    });

    it('names an unreachable service on a network failure, and does not report it', async () => {
        startGoogle.mockRejectedValue(new TypeError('Network request failed'));
        const { result } = render();

        await press(result, 'google');

        expect(result.current.error).toBe(auth.networkError);
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('falls back to the sentence naming the provider, and reports it', async () => {
        startGoogle.mockRejectedValue(new Error('ClerkGoogleSignIn native module is not available.'));
        const { result } = render();

        await press(result, 'google');

        expect(result.current.error).toBe(auth.socialFailed.replace('{provider}', 'Google'));
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('clears the previous error when the person tries again', async () => {
        startGoogle.mockRejectedValueOnce(new TypeError('Network request failed'));
        startGoogle.mockResolvedValueOnce({ createdSessionId: null, signIn: client.signIn, signUp: client.signUp });
        const { result } = render();

        await press(result, 'google');
        expect(result.current.error).toBe(auth.networkError);

        await press(result, 'google');
        expect(result.current.error).toBeNull();
    });
});
