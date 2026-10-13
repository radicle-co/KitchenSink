/**
 * @module screens/signup — the mobile sign-up surface (U2 rebuild).
 *
 * The sibling of `LoginScreen`: a custom Clerk sign-up form on the design system
 * (`@commise/ui` {@link Button} with `busy` + tokenized {@link Input}), all copy from `mobileMessages`,
 * associated field labels, and a `SafeAreaView` + `KeyboardAvoider` shell. It runs `signUp.create` →
 * `signUp.password`, and — when the instance verifies the email — an email-code step
 * (`verifications.sendEmailCode` → a `oneTimeCode` field → `verifications.verifyEmailCode`) before `setActive`.
 * Any other requirement the instance still has (a username, a name) is a field this form does not offer: it says so,
 * and reports it to Sentry, rather than stranding the user on a form that cannot finish.
 *
 * `onBack` returns to the sign-in form, which is where this screen is always reached FROM: the signed-out gate
 * opens on login, and login's own "Create account" control is the only route here (owner decision 2026-07-28
 * deleted the welcome hero that used to provide a "Get started" entry). So the existing back affordance — the
 * inline "Sign in" link under `haveAccountPrompt` — still lands exactly where the user came from, and it
 * is now the ONLY exit, which is why `AuthGate` keeps rendering it rather than a bare form.
 */
import { useClerk, useSignUp } from '@clerk/expo';
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';

import { authFailureMessage } from '../auth/authFailureMessage.js';
import { AuthCodeActions } from '../components/auth/AuthCodeActions.js';
import { AuthCodeFields } from '../components/auth/AuthCodeFields.js';
import { AuthHeader } from '../components/auth/AuthHeader.js';
import { AuthSwitchLink } from '../components/auth/AuthSwitchLink.js';
import { mobileMessages } from '../i18n/messages.js';

export interface SignUpScreenProps {
    onBack: () => void;
}

export function SignUpScreen({ onBack }: SignUpScreenProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const { colors } = useTheme();
    const { setActive } = useClerk();
    const { signUp } = useSignUp();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    // 'credentials' → email+password; 'code' → the instance verifies the email, and the emailed code finishes it.
    const [step, setStep] = useState<'credentials' | 'code'>('credentials');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const copyFor = (fallback: string) => ({
        networkError: t.networkError,
        emailRequired: t.emailRequired,
        emailInvalid: t.emailInvalid,
        fallback,
    });
    const failureCopy = copyFor(t.signUpFailed);

    // Send the verification code to the email. Returns true when a code is on its way.
    async function sendVerificationCode(): Promise<boolean> {
        if (!signUp) {
            return false;
        }

        const sendResult = await signUp.verifications.sendEmailCode();

        if (sendResult.error) {
            setError(authFailureMessage(sendResult.error, copyFor(t.sendCodeFailed)));

            return false;
        }

        return true;
    }

    // Start the session once Clerk reports the sign-up complete; otherwise the instance wants something this form
    // has no field for. Say so, and tell Sentry so a new requirement is noticed rather than only lived through.
    async function finishSignUp() {
        if (!signUp) {
            return;
        }

        if (signUp.status === 'complete' && signUp.createdSessionId) {
            await setActive({ session: signUp.createdSessionId });

            return;
        }

        Sentry.captureMessage('Native sign-up reached a status it cannot finish', {
            level: 'warning',
            extra: {
                status: signUp.status,
                missingFields: signUp.missingFields,
                unverifiedFields: signUp.unverifiedFields,
            },
        });
        setError(t.additionalVerification);
    }

    // After the password: finish a complete sign-up, or — when ONLY the email is still unverified — send the code and
    // show the code step.
    async function resolveStatus() {
        if (!signUp) {
            return;
        }

        const onlyEmailUnverified =
            signUp.status === 'missing_requirements' &&
            signUp.missingFields.length === 0 &&
            signUp.unverifiedFields.includes('email_address');

        if (onlyEmailUnverified) {
            if (await sendVerificationCode()) {
                setStep('code');
                setError(null);
            }

            return;
        }

        await finishSignUp();
    }

    async function handleSignUp() {
        if (!signUp) {
            return;
        }

        // Trimmed: an Android keyboard appends a space after autocomplete, and Clerk reads that as a different address.
        const emailAddress = email.trim();

        if (emailAddress === '') {
            setError(t.emailRequired);

            return;
        }

        setBusy(true);
        setError(null);

        try {
            const createResult = await signUp.create({ emailAddress });

            if (createResult.error) {
                setError(authFailureMessage(createResult.error, failureCopy));

                return;
            }

            const pwResult = await signUp.password({ password });

            if (pwResult.error) {
                setError(authFailureMessage(pwResult.error, failureCopy));

                return;
            }

            await resolveStatus();
        } catch (e) {
            setError(authFailureMessage(e, failureCopy));
        } finally {
            setBusy(false);
        }
    }

    async function handleVerifyCode() {
        if (!signUp) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const result = await signUp.verifications.verifyEmailCode({ code });

            if (result.error) {
                setError(authFailureMessage(result.error, copyFor(t.verifyFailed)));

                return;
            }

            await finishSignUp();
        } catch (e) {
            setError(authFailureMessage(e, copyFor(t.verifyFailed)));
        } finally {
            setBusy(false);
        }
    }

    async function handleResend() {
        setBusy(true);
        setError(null);

        try {
            await sendVerificationCode();
        } catch (e) {
            setError(authFailureMessage(e, copyFor(t.sendCodeFailed)));
        } finally {
            setBusy(false);
        }
    }

    // `reset` only clears Clerk's local sign-up state (no network call), so it needs no busy state.
    async function handleStartOver() {
        await signUp?.reset();
        setStep('credentials');
        setCode('');
        setPassword('');
        setError(null);
    }

    const onCredentials = step === 'credentials';

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoider style={styles.flex}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    <AuthHeader title={t.createHeading} />

                    {onCredentials ? (
                        <View style={styles.fields}>
                            <View style={styles.field}>
                                <FieldLabel forId="signup-email" label={t.emailLabel} />
                                <Input
                                    id="signup-email"
                                    placeholder={t.emailPlaceholder}
                                    value={email}
                                    onChangeText={setEmail}
                                    inputMode="email"
                                    autoCapitalize="none"
                                    autoComplete="email"
                                    enterKeyHint="next"
                                    disabled={busy}
                                />
                            </View>
                            <View style={styles.field}>
                                <FieldLabel forId="signup-password" label={t.passwordLabel} />
                                <Input
                                    id="signup-password"
                                    placeholder={t.passwordPlaceholder}
                                    value={password}
                                    onChangeText={setPassword}
                                    secret
                                    autoComplete="new-password"
                                    enterKeyHint="go"
                                    disabled={busy}
                                    onSubmit={() => void handleSignUp()}
                                />
                            </View>
                        </View>
                    ) : (
                        <AuthCodeFields
                            id="signup-code"
                            value={code}
                            onChangeText={setCode}
                            busy={busy}
                            onSubmit={() => void handleVerifyCode()}
                        />
                    )}

                    {error ? (
                        <Text role="alert" style={[styles.error, { color: colors.dangerText }]}>
                            {error}
                        </Text>
                    ) : null}

                    <Button
                        icon={onCredentials ? 'userPlus' : 'check'}
                        busy={busy}
                        disabled={!signUp}
                        onPress={() => void (onCredentials ? handleSignUp() : handleVerifyCode())}
                    >
                        {onCredentials ? t.createAccountAction : t.verifyAction}
                    </Button>

                    {onCredentials ? (
                        <AuthSwitchLink prompt={t.haveAccountPrompt} label={t.signInLink} onPress={onBack} />
                    ) : (
                        <AuthCodeActions
                            busy={busy}
                            onResend={() => void handleResend()}
                            onStartOver={() => void handleStartOver()}
                        />
                    )}
                </ScrollView>
            </KeyboardAvoider>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    // A label and its field are one group: closer to each other than to the next field (spec §1.6).
    field: { gap: nativeTokens.spacing[1] },
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    container: {
        flexGrow: 1,
        gap: nativeTokens.spacing[5],
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[6],
    },
    fields: { gap: nativeTokens.spacing[3] },
    error: { ...nativeTokens.type.meta },
});
