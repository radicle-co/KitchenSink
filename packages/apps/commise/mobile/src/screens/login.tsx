/**
 * @module screens/login — the mobile sign-in surface (U2 rebuild).
 *
 * A custom Clerk sign-in form (the app ships its own UI, not Clerk's hosted screens) built on the design
 * system: the `@commise/ui` {@link Button} (with its real `busy` spinner) + tokenized {@link Input}, all copy
 * from `mobileMessages` (no hard-coded English), every field label associated for assistive tech, and the
 * form wrapped in a `SafeAreaView` + `KeyboardAvoidingView` so the keyboard never occludes the inputs. It
 * mirrors the web `<SignIn>` flow the custom form must otherwise reproduce: `signIn.create` →
 * `signIn.password`, and — when the instance requires new-device verification — an email-code step
 * (`sendCode` → a `oneTimeCode` field → `verifyCode`) before `setActive`.
 */
import { useClerk, useSignIn } from '@clerk/expo';
import { Button } from '@commise/ui/button';
import { Input } from '@commise/ui/input';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import { Feather } from '@expo/vector-icons';
import type { JSX } from 'react';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mobileMessages } from '../i18n/messages.js';

export interface LoginScreenProps {
    onSignUp: () => void;
}

export function LoginScreen({ onSignUp }: LoginScreenProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const { setActive } = useClerk();
    const { signIn } = useSignIn();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    // 'credentials' → email+password; 'code' → the instance requires an email-code factor to finish.
    const [step, setStep] = useState<'credentials' | 'code'>('credentials');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Complete the sign-in when Clerk reports it is done, or advance to the email-code step when the
    // instance requires new-device verification (mirrors the web <SignIn> flow, which the custom mobile
    // form must otherwise handle itself). Returns true when the sign-in is fully complete.
    async function resolveStatus(): Promise<boolean> {
        if (!signIn) {
            return false;
        }

        if (signIn.status === 'complete' && signIn.createdSessionId) {
            await setActive({ session: signIn.createdSessionId });

            return true;
        }

        if (signIn.status === 'needs_first_factor') {
            const sendResult = await signIn.emailCode.sendCode({ emailAddress: email });

            if (sendResult.error) {
                setError(sendResult.error.message ?? t.sendCodeFailed);

                return false;
            }

            setStep('code');
            setError(null);

            return false;
        }

        setError(t.additionalVerification);

        return false;
    }

    async function handleSignIn() {
        if (!signIn) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const createResult = await signIn.create({ identifier: email });

            if (createResult.error) {
                setError(
                    typeof createResult.error === 'string'
                        ? createResult.error
                        : (createResult.error.message ?? t.signInFailed),
                );

                return;
            }

            // If the first factor is already email_code (passwordless / new device), the create above
            // may land directly on needs_first_factor without a password attempt.
            if (signIn.status !== 'needs_first_factor') {
                const pwResult = await signIn.password({ password });

                if (pwResult.error) {
                    setError(
                        typeof pwResult.error === 'string'
                            ? pwResult.error
                            : (pwResult.error.message ?? t.signInFailed),
                    );

                    return;
                }
            }

            await resolveStatus();
        } catch (e) {
            setError(e instanceof Error && e.message ? e.message : t.signInFailed);
        } finally {
            setBusy(false);
        }
    }

    async function handleVerifyCode() {
        if (!signIn) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const result = await signIn.emailCode.verifyCode({ code });

            if (result.error) {
                setError(result.error.message ?? t.verifyFailed);

                return;
            }

            await resolveStatus();
        } catch (e) {
            setError(e instanceof Error && e.message ? e.message : t.verifyFailed);
        } finally {
            setBusy(false);
        }
    }

    const onCredentials = step === 'credentials';

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    <Text style={styles.brand}>{t.brand}</Text>

                    {onCredentials ? (
                        <View style={styles.fields}>
                            <Input
                                label={t.emailLabel}
                                placeholder={t.emailPlaceholder}
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoComplete="email"
                                textContentType="emailAddress"
                                returnKeyType="next"
                            />
                            <Input
                                label={t.passwordLabel}
                                placeholder={t.passwordPlaceholder}
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                                autoComplete="password"
                                textContentType="password"
                                returnKeyType="go"
                                onSubmitEditing={() => void handleSignIn()}
                            />
                        </View>
                    ) : (
                        <View style={styles.fields}>
                            <Text style={styles.prompt}>{t.codePrompt}</Text>
                            <Input
                                label={t.codeLabel}
                                placeholder={t.codePlaceholder}
                                value={code}
                                onChangeText={setCode}
                                keyboardType="number-pad"
                                autoComplete="one-time-code"
                                textContentType="oneTimeCode"
                                returnKeyType="done"
                                onSubmitEditing={() => void handleVerifyCode()}
                            />
                        </View>
                    )}

                    {error ? (
                        <Text role="alert" style={styles.error}>
                            {error}
                        </Text>
                    ) : null}

                    <Button
                        icon={<Feather name={onCredentials ? 'log-in' : 'check'} size={16} color={palette.white} />}
                        busy={busy}
                        disabled={!signIn}
                        onPress={() => void (onCredentials ? handleSignIn() : handleVerifyCode())}
                    >
                        {onCredentials ? t.signInAction : t.verifyAction}
                    </Button>

                    <View style={styles.toggle}>
                        <Text style={styles.togglePrompt}>{t.noAccountPrompt}</Text>
                        <Button
                            variant="secondary"
                            icon={<Feather name="user-plus" size={16} color={palette.charcoal} />}
                            onPress={onSignUp}
                        >
                            {t.signUpLink}
                        </Button>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    container: {
        flexGrow: 1,
        justifyContent: 'center',
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[6],
    },
    brand: {
        fontSize: nativeTokens.fontSize.displayLg,
        fontWeight: '700',
        color: palette.charcoal,
        textAlign: 'center',
        marginBottom: nativeTokens.spacing[3],
    },
    fields: { gap: nativeTokens.spacing[3] },
    prompt: {
        fontSize: nativeTokens.fontSize.bodySm,
        color: palette.slate,
        textAlign: 'center',
    },
    error: {
        fontSize: nativeTokens.fontSize.bodySm,
        color: palette['error-dark'],
        textAlign: 'center',
    },
    toggle: { alignItems: 'center', gap: nativeTokens.spacing[2] },
    togglePrompt: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
