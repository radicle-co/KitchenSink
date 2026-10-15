/**
 * @module screens/CompleteSignUpScreen — the step after a Google / Apple sign-up that asks ONLY for what the provider
 * did not supply (owner ruling 2026-10-13; plan 012 D6, D11).
 *
 * Google supplies the names and the email; Apple supplies the name only on the first authorization and may supply a
 * private-relay address; neither supplies the username both Clerk instances require. So Clerk stops the sign-up at
 * `missing_requirements` and `AuthGate` shows this step with the missing fields `classifySocialOutcome` planned. It
 * never asks for a password or an email (D11), and never derives the username from the name — an Apple user who hid
 * their address would otherwise get a public byline made of their real name.
 *
 * It acts on the sign-up the provider hook RETURNED — the legacy resource, whose `update` throws on failure — and,
 * once Clerk reports it complete, starts the session (`AuthGate` then shows the app). Should Clerk still list fields,
 * it asks for the next ones; a status or field it cannot finish is said and reported, never a dead end. "Start over"
 * makes no call: the abandoned attempt simply expires at Clerk (and a retry with Apple asks for the names again,
 * because Apple sends them once).
 *
 * Orchestration: owns the step's form state and issues `signUp.update` / `setActive`; renders through `SignUpFields`.
 */
import { useClerk } from '@clerk/expo';
import type { SignUpResource } from '@clerk/shared/types';
import { Button } from '@commise/ui/button';
import { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useMessages } from '@commise/i18n/react';
import * as Sentry from '@sentry/react-native';
import type { JSX } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authFailureMessage } from '../auth/authFailureMessage.js';
import {
    fieldOfClerkError,
    SOCIAL_FINISH_FIELDS,
    signUpFieldPlan,
    type SignUpFieldName,
    type SignUpFieldSpec,
} from '../auth/signUpFields.js';
import { AuthHeader } from '../components/auth/AuthHeader.js';
import { SignUpFields, type SignUpErrors, type SignUpValues } from '../components/auth/SignUpFields.js';
import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link CompleteSignUpScreen}. */
export interface CompleteSignUpScreenProps {
    /** The sign-up the provider hook returned. */
    readonly signUp: SignUpResource;
    /** The missing fields to ask for first, in registry order. */
    readonly fields: readonly SignUpFieldSpec[];
    /** Leaves the step for the sign-in form, abandoning the attempt. */
    readonly onStartOver: () => void;
}

export function CompleteSignUpScreen({
    signUp,
    fields: initialFields,
    onStartOver,
}: CompleteSignUpScreenProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const { colors } = useTheme();
    const { setActive } = useClerk();
    const [fields, setFields] = useState<readonly SignUpFieldSpec[]>(initialFields);
    const [values, setValues] = useState<SignUpValues>({});
    const [fieldErrors, setFieldErrors] = useState<SignUpErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const copy = {
        networkError: t.networkError,
        emailRequired: t.emailRequired,
        emailInvalid: t.emailInvalid,
        fallback: t.signUpFailed,
    };
    const requiredCopy: Readonly<Record<SignUpFieldName, string>> = {
        first_name: t.firstNameRequired,
        last_name: t.lastNameRequired,
        username: t.usernameRequired,
        email_address: t.emailRequired,
    };

    function changeField(field: SignUpFieldName, text: string) {
        setValues((current) => ({ ...current, [field]: text }));
        setFieldErrors((current) => ({ ...current, [field]: undefined }));
    }

    // After the update: a complete sign-up starts the session; one that still needs fields this step can ask for asks
    // for them next; anything else is a status this app cannot finish — say so, and tell Sentry.
    async function resolveStatus() {
        if (signUp.status === 'complete' && signUp.createdSessionId) {
            await setActive({ session: signUp.createdSessionId });

            return;
        }

        const plan = signUpFieldPlan(signUp.missingFields, SOCIAL_FINISH_FIELDS);
        const canAskNext =
            signUp.status === 'missing_requirements' &&
            signUp.unverifiedFields.length === 0 &&
            plan.unknown.length === 0 &&
            plan.fields.length > 0;

        if (canAskNext) {
            setFields(plan.fields);

            return;
        }

        Sentry.captureMessage('Native social sign-up reached a status it cannot finish', {
            level: 'warning',
            extra: {
                status: signUp.status,
                missingFields: signUp.missingFields,
                unverifiedFields: signUp.unverifiedFields,
            },
        });
        setError(t.additionalVerification);
    }

    async function handleSubmit() {
        // Trimmed: an Android keyboard appends a space after autocomplete.
        const trimmed = fields.map((field) => ({ field, value: (values[field.name] ?? '').trim() }));
        const empty = trimmed.filter(({ value }) => value === '');

        setError(null);

        if (empty.length > 0) {
            setFieldErrors(Object.fromEntries(empty.map(({ field }) => [field.name, requiredCopy[field.name]])));

            return;
        }

        setFieldErrors({});
        setBusy(true);

        try {
            await signUp.update(Object.fromEntries(trimmed.map(({ field, value }) => [field.param, value])));
            await resolveStatus();
        } catch (failure) {
            const onField = fieldOfClerkError(failure);

            if (onField === undefined) {
                setError(authFailureMessage(failure, copy));
            } else {
                setFieldErrors((current) => ({ ...current, [onField.field]: onField.message }));
            }
        } finally {
            setBusy(false);
        }
    }

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoider style={styles.flex}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    <AuthHeader title={t.finishTitle} />
                    <View style={styles.intro}>
                        <Text style={[nativeTokens.type.body, { color: colors.inkMuted }]}>{t.finishPrompt}</Text>
                        {signUp.emailAddress ? (
                            <Text style={[nativeTokens.type.meta, { color: colors.inkMuted }]}>
                                {t.finishSigningUpAs.replace('{email}', signUp.emailAddress)}
                            </Text>
                        ) : null}
                    </View>

                    <SignUpFields
                        fields={fields}
                        idPrefix="complete-signup"
                        values={values}
                        errors={fieldErrors}
                        onChange={changeField}
                        busy={busy}
                    />

                    {error ? (
                        <Text role="alert" style={[styles.error, { color: colors.dangerText }]}>
                            {error}
                        </Text>
                    ) : null}

                    <Button icon="userPlus" size="lg" width="fill" busy={busy} onPress={() => void handleSubmit()}>
                        {t.createAccountAction}
                    </Button>
                    <View style={styles.wayOut}>
                        <Button variant="ghost" icon="rotateCcw" disabled={busy} onPress={onStartOver}>
                            {t.startOverAction}
                        </Button>
                    </View>
                </ScrollView>
            </KeyboardAvoider>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145), as on the other auth screens.
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    container: {
        flexGrow: 1,
        gap: nativeTokens.spacing[5],
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[6],
    },
    intro: { gap: nativeTokens.spacing[1] },
    wayOut: { alignItems: 'flex-start' },
    error: { ...nativeTokens.type.meta },
});
