/**
 * @module screens/login — the mobile sign-in surface (U2 rebuild).
 *
 * A custom Clerk sign-in form (the app ships its own UI, not Clerk's hosted screens) built on the design
 * system: the `@commise/ui` {@link Button} (with its real `busy` spinner) + tokenized {@link Input}, all copy
 * from `mobileMessages` (no hard-coded English), every field label associated for assistive tech, and the
 * form inside the shared `AuthScreenFrame`, so the keyboard never occludes the inputs.
 *
 * The password is the FIRST factor and is always sent: ONE `signIn.password({ identifier, password })` call. A wrong
 * password fails there with Clerk's own message and no code is sent. Only after a correct password does Clerk
 * answer `needs_client_trust` (a new device) or `needs_second_factor`; the email code that follows is the SECOND
 * factor (`signIn.mfa.sendEmailCode` → a `oneTimeCode` field → `signIn.mfa.verifyEmailCode`) before `setActive`.
 * The passwordless first-factor strategy (`signIn.emailCode.*`) is deliberately never used: it signs a user in
 * with the mailbox alone (A-001).
 *
 * Above the email form sits the provider group (plan 012): "Continue with Apple / Google", the `useSocialSignIn`
 * command. While a provider's sheet is up every control here locks; a provider sign-up that still needs fields is
 * handed up to `AuthGate` (`onNeedsFields`), which shows the finish step.
 */
import { useClerk, useSignIn } from '@clerk/expo';
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { authSurfaceMessages } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Sentry from '@sentry/react-native';

import { authFailureCopy, authFailureMessage } from '../auth/authFailureMessage.js';
import { AuthCodeActions } from '../components/auth/AuthCodeActions.js';
import { AuthCodeFields } from '../components/auth/AuthCodeFields.js';
import { AuthFooter } from '../components/auth/AuthFooter.js';
import { AuthHeader } from '../components/auth/AuthHeader.js';
import { AuthScreenFrame } from '../components/auth/AuthScreenFrame.js';
import { AuthSwitchLink } from '../components/auth/AuthSwitchLink.js';
import { SocialSignInButtons } from '../components/auth/SocialSignInButtons.js';
import { useSocialSignIn, type PendingSignUp } from '../hooks/useSocialSignIn.js';
import { mobileMessages } from '../i18n/messages.js';

export interface LoginScreenProps {
    onSignUp: () => void;
    /** A provider's sign-up still needs fields: the gate shows the finish step with it. */
    onNeedsFields: (pending: PendingSignUp) => void;
}

export function LoginScreen({ onSignUp, onNeedsFields }: LoginScreenProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const shared = useMessages(authSurfaceMessages);
    const { setActive } = useClerk();
    const { signIn } = useSignIn();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    // 'credentials' → email+password; 'code' → a correct password, and the email-code SECOND factor finishes it.
    const [step, setStep] = useState<'credentials' | 'code'>('credentials');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // The Next key on the email field asks the password field for focus; the field acknowledges once it has taken it.
    const [passwordFocusRequested, setPasswordFocusRequested] = useState(false);
    const social = useSocialSignIn(onNeedsFields);
    // One lock for the whole screen: the email form, the provider group and the switch link (plan 012 D10).
    const locked = busy || social.busyProvider !== null;

    const signInCopy = authFailureCopy(t, shared, t.signInFailed);
    const codeCopy = authFailureCopy(t, shared, t.sendCodeFailed);
    const verifyCopy = authFailureCopy(t, shared, t.verifyFailed);

    // Send the second-factor email code. Returns true when a code is on its way.
    async function sendSecondFactorCode(): Promise<boolean> {
        if (!signIn) {
            return false;
        }

        const sendResult = await signIn.mfa.sendEmailCode();

        if (sendResult.error) {
            setError(authFailureMessage(sendResult.error, codeCopy));

            return false;
        }

        return true;
    }

    // The status is one this form cannot finish (a factor it does not implement): say so, and tell Sentry so a new
    // requirement is noticed rather than only lived through by the user.
    function reportUnsupportedStatus() {
        if (!signIn) {
            return;
        }

        Sentry.captureMessage('Native sign-in reached a status it cannot finish', {
            level: 'warning',
            extra: { status: signIn.status, secondFactors: signIn.supportedSecondFactors.map((f) => f.strategy) },
        });
        setError(t.additionalVerification);
    }

    // Start the session once Clerk reports the sign-in complete; otherwise it is a status this form cannot finish.
    async function finishSignIn() {
        if (signIn?.status === 'complete' && signIn.createdSessionId) {
            await setActive({ session: signIn.createdSessionId });

            return;
        }

        reportUnsupportedStatus();
    }

    // After a correct password: finish a complete sign-in, or — for Client Trust (a new device) or a second factor
    // — send the email code and show the code step.
    async function resolveStatus() {
        if (!signIn) {
            return;
        }

        const needsSecondFactor = signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor';
        const offersEmailCode = signIn.supportedSecondFactors.some((factor) => factor.strategy === 'email_code');

        if (needsSecondFactor && offersEmailCode) {
            if (await sendSecondFactorCode()) {
                setStep('code');
                setError(null);
            }

            return;
        }

        await finishSignIn();
    }

    async function handleSignIn() {
        if (!signIn) {
            return;
        }

        // Trimmed: an Android keyboard appends a space after autocomplete, and Clerk reads that as a different address.
        const identifier = email.trim();

        if (identifier === '') {
            setError(shared.emailRequired);

            return;
        }

        setBusy(true);
        setError(null);

        try {
            const pwResult = await signIn.password({ identifier, password });

            if (pwResult.error) {
                setError(authFailureMessage(pwResult.error, signInCopy));

                return;
            }

            await resolveStatus();
        } catch (e) {
            setError(authFailureMessage(e, signInCopy));
        } finally {
            setBusy(false);
        }
    }

    async function handleResend() {
        setBusy(true);
        setError(null);

        try {
            await sendSecondFactorCode();
        } catch (e) {
            setError(authFailureMessage(e, codeCopy));
        } finally {
            setBusy(false);
        }
    }

    // `reset` only clears Clerk's local sign-in state (no network call), so it needs no busy state.
    async function handleStartOver() {
        await signIn?.reset();
        setStep('credentials');
        setCode('');
        setPassword('');
        setError(null);
    }

    async function handleVerifyCode() {
        if (!signIn) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const result = await signIn.mfa.verifyEmailCode({ code });

            if (result.error) {
                setError(authFailureMessage(result.error, verifyCopy));

                return;
            }

            await finishSignIn();
        } catch (e) {
            setError(authFailureMessage(e, verifyCopy));
        } finally {
            setBusy(false);
        }
    }

    const onCredentials = step === 'credentials';

    const footer = (
        <AuthFooter error={error}>
            <Button
                icon={onCredentials ? 'logIn' : 'check'}
                size="lg"
                width="fill"
                busy={busy}
                disabled={!signIn || social.busyProvider !== null}
                onPress={() => void (onCredentials ? handleSignIn() : handleVerifyCode())}
            >
                {onCredentials ? t.signInAction : t.verifyAction}
            </Button>
        </AuthFooter>
    );
    const trailing = onCredentials ? (
        <AuthSwitchLink
            prompt={shared.noAccountPrompt}
            label={shared.signUpLink}
            disabled={locked}
            onPress={onSignUp}
        />
    ) : (
        <AuthCodeActions busy={busy} onResend={() => void handleResend()} onStartOver={() => void handleStartOver()} />
    );

    return (
        <AuthScreenFrame footer={footer} trailing={trailing}>
            <AuthHeader title={t.signInTitle} />

            {onCredentials ? (
                <SocialSignInButtons
                    providers={social.providers}
                    busyProvider={social.busyProvider}
                    error={social.error}
                    locked={locked}
                    onPress={social.start}
                />
            ) : null}

            {onCredentials ? (
                <View style={styles.fields}>
                    <View style={styles.field}>
                        <FieldLabel forId="signin-email" label={t.emailLabel} />
                        <Input
                            id="signin-email"
                            label={t.emailLabel}
                            placeholder={t.emailPlaceholder}
                            value={email}
                            onChangeText={setEmail}
                            inputMode="email"
                            autoCapitalize="none"
                            autoComplete="email"
                            enterKeyHint="next"
                            disabled={locked}
                            onSubmit={() => setPasswordFocusRequested(true)}
                        />
                    </View>
                    <View style={styles.field}>
                        <FieldLabel forId="signin-password" label={t.passwordLabel} />
                        <Input
                            id="signin-password"
                            label={t.passwordLabel}
                            placeholder={t.passwordPlaceholder}
                            value={password}
                            onChangeText={setPassword}
                            secret
                            autoComplete="current-password"
                            enterKeyHint="go"
                            disabled={locked}
                            focusRequested={passwordFocusRequested}
                            onFocusRequestHandled={() => setPasswordFocusRequested(false)}
                            onSubmit={() => void handleSignIn()}
                        />
                    </View>
                </View>
            ) : (
                <AuthCodeFields
                    id="signin-code"
                    value={code}
                    onChangeText={setCode}
                    busy={busy}
                    onSubmit={() => void handleVerifyCode()}
                />
            )}
        </AuthScreenFrame>
    );
}

const styles = StyleSheet.create({
    // A label and its field are one group: closer to each other than to the next field (spec §1.6).
    field: { gap: nativeTokens.spacing[1] },
    fields: { gap: nativeTokens.spacing[3] },
});
