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
 *
 * @pattern Adapter over the legacy `SignUpResource` the provider hook returned — its throwing `update` answered in the
 *     screen's terms (a field error, the alert, the next fields, or a started session).
 */
import { useClerk } from '@clerk/expo';
import type { SignUpResource } from '@clerk/shared/types';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { authSurfaceMessages } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import * as Sentry from '@sentry/react-native';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { signUpFailure, signUpFailureCopy, type SignUpErrorField } from '../auth/signUpFailure.js';
import {
    normalizeSignUpValue,
    SOCIAL_FINISH_FIELDS,
    signUpFieldPlan,
    type SignUpFieldName,
    type SignUpFieldSpec,
} from '../auth/signUpFields.js';
import { AuthFooter } from '../components/auth/AuthFooter.js';
import { AuthHeader } from '../components/auth/AuthHeader.js';
import { AuthScreenFrame } from '../components/auth/AuthScreenFrame.js';
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

/**
 * The finish step: the missing fields, the address the account is for, "Create account" and "Start over".
 *
 * @param props - The returned sign-up, the fields to ask for first, and the way out.
 * @returns The finish step.
 */
export function CompleteSignUpScreen({
    signUp,
    fields: initialFields,
    onStartOver,
}: CompleteSignUpScreenProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const shared = useMessages(authSurfaceMessages);
    const { colors } = useTheme();
    const { setActive } = useClerk();
    const [fields, setFields] = useState<readonly SignUpFieldSpec[]>(initialFields);
    const [values, setValues] = useState<SignUpValues>({});
    const [fieldErrors, setFieldErrors] = useState<SignUpErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [focusField, setFocusField] = useState<SignUpFieldName | null>(null);
    const [busy, setBusy] = useState(false);

    const copy = signUpFailureCopy(t, shared, t.signUpFailed);

    function changeField(field: SignUpFieldName, text: string) {
        setValues((current) => ({ ...current, [field]: text }));
        setFieldErrors((current) => ({ ...current, [field]: undefined }));
    }

    // Each message under the field it names, the rest in the alert, focus on the first field in error.
    function showFieldErrors(errors: SignUpErrors, form?: string) {
        setFieldErrors(errors);
        setError(form ?? null);
        setFocusField(fields.find((field) => errors[field.name] !== undefined)?.name ?? null);
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
        setError(t.signUpUnsupported);
    }

    async function handleSubmit() {
        // One cleaning rule for every field (`normalizeSignUpValue`), the same as the typed form's.
        const sent = fields.map((field) => ({
            field,
            value: normalizeSignUpValue(field.name, values[field.name] ?? ''),
        }));
        const empty = sent.filter(({ value }) => value === '');

        if (empty.length > 0) {
            showFieldErrors(Object.fromEntries(empty.map(({ field }) => [field.name, copy.required[field.name]])));

            return;
        }

        showFieldErrors({});
        setBusy(true);

        try {
            await signUp.update(Object.fromEntries(sent.map(({ field, value }) => [field.param, value])));
            await resolveStatus();
        } catch (failure) {
            const shown = new Set<SignUpErrorField>(fields.map((field) => field.name));
            const routed = signUpFailure(failure, shown, copy);
            showFieldErrors(routed.fields, routed.form);
        } finally {
            setBusy(false);
        }
    }

    const footer = (
        <AuthFooter error={error}>
            <Button icon="userPlus" size="lg" width="fill" busy={busy} onPress={() => void handleSubmit()}>
                {t.createAccountAction}
            </Button>
        </AuthFooter>
    );
    const wayOut = (
        <View style={styles.wayOut}>
            <Button variant="ghost" icon="rotateCcw" disabled={busy} onPress={onStartOver}>
                {t.startOverAction}
            </Button>
        </View>
    );

    return (
        <AuthScreenFrame footer={footer} trailing={wayOut}>
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
                focusField={focusField}
                onFocusHandled={() => setFocusField(null)}
                onNext={setFocusField}
                end={{ key: 'go', onSubmit: () => void handleSubmit() }}
            />
        </AuthScreenFrame>
    );
}

const styles = StyleSheet.create({
    intro: { gap: nativeTokens.spacing[1] },
    wayOut: { alignItems: 'flex-start' },
});
