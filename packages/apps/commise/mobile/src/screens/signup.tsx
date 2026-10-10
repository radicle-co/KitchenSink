/**
 * @module screens/signup — the mobile sign-up surface (U2 rebuild).
 *
 * The sibling of `LoginScreen`: a custom Clerk sign-up form on the design system
 * (`@commise/ui` {@link Button} with `busy` + tokenized {@link Input}), all copy from `mobileMessages`,
 * associated field labels, and a `SafeAreaView` + `KeyboardAvoider` shell. It runs `signUp.create` →
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
import { FieldLabel, Input } from '@commise/ui/input';
import { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authFailureMessage } from '../auth/authFailureMessage.js';
import { AuthHeader } from '../components/auth/AuthHeader.js';
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
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const failureCopy = { networkError: t.networkError, fallback: t.signUpFailed };

    async function handleSignUp() {
        if (!signUp) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const createResult = await signUp.create({ emailAddress: email });

            if (createResult.error) {
                setError(authFailureMessage(createResult.error, failureCopy));

                return;
            }

            const pwResult = await signUp.password({ password });

            if (pwResult.error) {
                setError(authFailureMessage(pwResult.error, failureCopy));

                return;
            }

            if (signUp.status === 'complete' && signUp.createdSessionId) {
                await setActive({ session: signUp.createdSessionId });
            } else {
                setError(t.additionalVerification);
            }
        } catch (e) {
            setError(authFailureMessage(e, failureCopy));
        } finally {
            setBusy(false);
        }
    }

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoider style={styles.flex}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    <AuthHeader title={t.createHeading} />

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

                    {error ? (
                        <Text role="alert" style={[styles.error, { color: colors.dangerText }]}>
                            {error}
                        </Text>
                    ) : null}

                    <Button icon="userPlus" busy={busy} disabled={!signUp} onPress={() => void handleSignUp()}>
                        {t.createAccountAction}
                    </Button>

                    <View style={styles.toggle}>
                        <Text style={[nativeTokens.type.meta, { color: colors.inkMuted }]}>{t.haveAccountPrompt}</Text>
                        <Button variant="secondary" icon="logIn" onPress={onBack}>
                            {t.signInLink}
                        </Button>
                    </View>
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
    toggle: { alignItems: 'flex-start', gap: nativeTokens.spacing[2] },
});
