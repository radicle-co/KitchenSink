/**
 * @module screens/signup — the mobile sign-up surface (U2 rebuild).
 *
 * The sibling of {@link import('./login.js').LoginScreen}: a custom Clerk sign-up form on the design system
 * (`@commise/ui` {@link Button} with `busy` + tokenized {@link Input}), all copy from `mobileMessages`,
 * associated field labels, and a `SafeAreaView` + `KeyboardAvoidingView` shell. It runs `signUp.create` →
 * `signUp.password` → `setActive` on completion; anything short of `complete` surfaces the localized
 * additional-verification notice.
 *
 * `onBack` returns to the sign-in form, which is where this screen is always reached FROM: the signed-out gate
 * opens on login, and login's own "Create account" control is the only route here (owner decision 2026-07-28
 * deleted the welcome hero that used to provide a "Get started" entry). So the existing back affordance — the
 * secondary "Sign in" button under `haveAccountPrompt` — still lands exactly where the user came from, and it
 * is now the ONLY exit, which is why `AuthGate` keeps rendering it rather than a bare form.
 */
import { useClerk, useSignUp } from '@clerk/expo';
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

export interface SignUpScreenProps {
    onBack: () => void;
}

export function SignUpScreen({ onBack }: SignUpScreenProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const { setActive } = useClerk();
    const { signUp } = useSignUp();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function handleSignUp() {
        if (!signUp) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const createResult = await signUp.create({ emailAddress: email });

            if (createResult.error) {
                setError(
                    typeof createResult.error === 'string'
                        ? createResult.error
                        : (createResult.error.message ?? t.signUpFailed),
                );

                return;
            }

            const pwResult = await signUp.password({ password });

            if (pwResult.error) {
                setError(
                    typeof pwResult.error === 'string' ? pwResult.error : (pwResult.error.message ?? t.signUpFailed),
                );

                return;
            }

            if (signUp.status === 'complete' && signUp.createdSessionId) {
                await setActive({ session: signUp.createdSessionId });
            } else {
                setError(t.additionalVerification);
            }
        } catch (e) {
            setError(e instanceof Error && e.message ? e.message : t.signUpFailed);
        } finally {
            setBusy(false);
        }
    }

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    <Text style={styles.brand}>{t.brand}</Text>
                    <Text style={styles.heading}>{t.createHeading}</Text>

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
                            autoComplete="new-password"
                            textContentType="newPassword"
                            returnKeyType="go"
                            onSubmitEditing={() => void handleSignUp()}
                        />
                    </View>

                    {error ? (
                        <Text role="alert" style={styles.error}>
                            {error}
                        </Text>
                    ) : null}

                    <Button
                        icon={<Feather name="user-plus" size={16} color={palette.white} />}
                        busy={busy}
                        disabled={!signUp}
                        onPress={() => void handleSignUp()}
                    >
                        {t.createAccountAction}
                    </Button>

                    <View style={styles.toggle}>
                        <Text style={styles.togglePrompt}>{t.haveAccountPrompt}</Text>
                        <Button
                            variant="secondary"
                            icon={<Feather name="log-in" size={16} color={palette.charcoal} />}
                            onPress={onBack}
                        >
                            {t.signInLink}
                        </Button>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: palette.sand },
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
    },
    heading: {
        fontSize: nativeTokens.fontSize.bodyMd,
        color: palette.slate,
        textAlign: 'center',
        marginBottom: nativeTokens.spacing[2],
    },
    fields: { gap: nativeTokens.spacing[3] },
    error: {
        fontSize: nativeTokens.fontSize.bodySm,
        color: palette['error-dark'],
        textAlign: 'center',
    },
    toggle: { alignItems: 'center', gap: nativeTokens.spacing[2] },
    togglePrompt: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
