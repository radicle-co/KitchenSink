/**
 * @module hooks/useSocialSignIn — the ONE command both signed-out screens issue for "Continue with Apple / Google"
 * (plan 012).
 *
 * It reads which providers this BUILD offers from `Constants.expoConfig.extra` (what `app.config.ts` wrote for its Clerk
 * instance) through `socialProvidersFor`, runs `@clerk/expo`'s native flow, and turns its answer into exactly one of:
 *
 * - a session → `setActive`, and `AuthGate` swaps to the app on its own (there is no navigation to do);
 * - a cancel → nothing at all (`@clerk/expo@4.6.0` SWALLOWS the provider's cancel; a thrown one is handled too);
 * - a sign-up stopped at missing fields → `onNeedsFields` with the sign-up the hook RETURNED, never the screen's own
 *   future-API signal, which may not reflect the legacy resource the hook acted on (plan 012 fact 4);
 * - a status it cannot finish → `auth.additionalVerification`, reported to Sentry;
 * - a failure → the words `socialAuthFailure` chooses, reported when they say it should be.
 *
 * The attempt ids are read from the Clerk client at PRESS time, because `classifySocialOutcome` tells "this press
 * created an attempt" from "nothing happened" by comparing them (clerk-js mutates its resources in place).
 *
 * Sign-out is untouched: it stays ADR-0009's `useSignOutAndVerify`. The Google SDK's own remembered account is not
 * cleared on sign-out — `@clerk/expo` does not export its sign-out — and the explicit sign-in still shows the picker.
 *
 * @pattern Command behind a headless hook — the shape of `useSignOutAndVerify`; the screens own only their own UI.
 * @pattern Adapter over `useSignInWithGoogle` / `useSignInWithApple` — two vendor hooks behind one `start(provider)`.
 */
import { useClerk } from '@clerk/expo';
import { useSignInWithApple } from '@clerk/expo/apple';
import { useSignInWithGoogle } from '@clerk/expo/google';
import type { SignUpResource } from '@clerk/shared/types';
import { useMessages } from '@commise/i18n/react';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform } from 'react-native';

import { readSocialAuthConfig, socialProvidersFor, type SocialProvider } from '../auth/socialAuthConfig.js';
import { socialAuthFailure } from '../auth/socialAuthFailure.js';
import type { SignUpFieldSpec } from '../auth/signUpFields.js';
import { classifySocialOutcome, type SocialFlowResult } from '../auth/socialSignInOutcome.js';
import { mobileMessages } from '../i18n/messages.js';

/** A sign-up a provider started, waiting on the fields it did not supply. */
export interface PendingSignUp {
    /** The resource the provider hook RETURNED; the finish step calls `update` on exactly this. */
    readonly signUp: SignUpResource;
    /** The missing fields the finish step asks for, in registry order. */
    readonly fields: readonly SignUpFieldSpec[];
}

/** What the signed-out screens read and call. */
export interface SocialSignIn {
    /** The providers this build offers on this platform, in display order. Empty: draw no provider group. */
    readonly providers: readonly SocialProvider[];
    /** The provider whose flow is in flight; every control on the screen locks while it is set. */
    readonly busyProvider: SocialProvider | null;
    /** The line to show under the provider group, or `null`. */
    readonly error: string | null;
    /**
     * Run a provider's flow.
     *
     * @sideEffect Presents the provider's native sheet and, on success, activates a Clerk session.
     */
    readonly start: (provider: SocialProvider) => void;
}

/**
 * @param onNeedsFields - Called when a provider's sign-up still needs fields; the gate shows the finish step.
 * @returns The providers, the busy provider, the current error, and `start`.
 */
export function useSocialSignIn(onNeedsFields: (pending: PendingSignUp) => void): SocialSignIn {
    const { auth: t } = useMessages(mobileMessages);
    const clerk = useClerk();
    const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
    const { startAppleAuthenticationFlow } = useSignInWithApple();
    const [busyProvider, setBusyProvider] = useState<SocialProvider | null>(null);
    const [error, setError] = useState<string | null>(null);

    const providers = socialProvidersFor(readSocialAuthConfig(Constants.expoConfig?.extra), Platform.OS);
    const copy = {
        networkError: t.networkError,
        emailRequired: t.emailRequired,
        emailInvalid: t.emailInvalid,
        fallback: t.signInFailed,
        googleUnavailable: t.googleUnavailable,
        appleUnavailable: t.appleUnavailable,
        socialFailed: t.socialFailed,
    };

    async function run(provider: SocialProvider) {
        const before = { signInId: clerk.client?.signIn.id ?? null, signUpId: clerk.client?.signUp.id ?? null };

        try {
            const result: SocialFlowResult<SignUpResource> =
                provider === 'google' ? await startGoogleAuthenticationFlow() : await startAppleAuthenticationFlow();
            const outcome = classifySocialOutcome(before, result);

            switch (outcome.kind) {
                case 'complete':
                    await clerk.setActive({ session: outcome.sessionId });

                    return;
                case 'cancelled':
                    return;
                case 'needsFields':
                    onNeedsFields({ signUp: outcome.signUp, fields: outcome.fields });

                    return;
                case 'unsupported':
                    Sentry.captureMessage('Native social sign-in reached a status it cannot finish', {
                        level: 'warning',
                        extra: {
                            provider,
                            status: outcome.status,
                            missingFields: outcome.missingFields,
                            unverifiedFields: outcome.unverifiedFields,
                        },
                    });
                    setError(t.additionalVerification);

                    return;
            }
        } catch (failure) {
            const verdict = socialAuthFailure(provider, failure, copy);

            if (verdict.kind === 'silent') {
                return;
            }

            setError(verdict.message);

            if (verdict.report) {
                Sentry.captureException(failure, { tags: { provider, platform: Platform.OS } });
            }
        }
    }

    function start(provider: SocialProvider) {
        if (busyProvider !== null) {
            return;
        }

        setBusyProvider(provider);
        setError(null);
        void run(provider).finally(() => setBusyProvider(null));
    }

    return { providers, busyProvider, error, start };
}
