/**
 * @module screens/signup — the mobile sign-up surface (U2 rebuild).
 *
 * The sibling of `LoginScreen`: a custom Clerk sign-up form on the design system
 * (`@commise/ui` {@link Button} with `busy` + tokenized {@link Input}), all copy from `mobileMessages`,
 * associated field labels, and the shared `AuthScreenFrame` shell. It asks for the four profile fields both
 * Clerk instances require — first name, last name, username, email (owner ruling 2026-10-13; the
 * `SIGN_UP_FIELDS` registry, plan 012 D8) — and a password, then runs `signUp.create` → `signUp.password`, and — when
 * the instance verifies the email — an email-code step (`verifications.sendEmailCode` → a `oneTimeCode` field →
 * `verifications.verifyEmailCode`) before `setActive`. An empty field — the password too — is refused under that field
 * without calling Clerk; EVERY error Clerk returns is shown under the field it names (a taken username, a rejected
 * password), the rest in the alert (`signUpFailure`); focus moves to the first field in error. Any requirement the
 * instance still has after that is one this form does not offer: it says so, and reports it to Sentry, rather than
 * stranding the user on a form that cannot finish.
 *
 * Above the form sits the same provider group as sign-in (plan 012): "Continue with Apple / Google" may sign the
 * person in OR create the account, and a provider sign-up that still needs fields is handed up to `AuthGate`
 * (`onNeedsFields`). While a provider's sheet is up every control here locks.
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
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Sentry from '@sentry/react-native';

import { authFailureCopy, authFailureMessage } from '../auth/authFailureMessage.js';
import { signUpFailure, signUpFailureCopy, type SignUpErrorField } from '../auth/signUpFailure.js';
import { normalizeSignUpValue, SIGN_UP_FIELDS, type SignUpFieldName } from '../auth/signUpFields.js';
import { AuthCodeActions } from '../components/auth/AuthCodeActions.js';
import { AuthCodeFields } from '../components/auth/AuthCodeFields.js';
import { AuthHeader } from '../components/auth/AuthHeader.js';
import { AuthScreenFrame } from '../components/auth/AuthScreenFrame.js';
import { AuthSwitchLink } from '../components/auth/AuthSwitchLink.js';
import { SocialSignInButtons } from '../components/auth/SocialSignInButtons.js';
import { useSocialSignIn, type PendingSignUp } from '../hooks/useSocialSignIn.js';
import { SignUpFields, type SignUpValues } from '../components/auth/SignUpFields.js';
import { mobileMessages } from '../i18n/messages.js';

/** Every field the form shows, in the order it asks — so the first in error is the one that takes focus. */
const FORM_FIELDS: readonly SignUpErrorField[] = [...SIGN_UP_FIELDS.map((field) => field.name), 'password'];
const SHOWN: ReadonlySet<SignUpErrorField> = new Set(FORM_FIELDS);
const PASSWORD_ID = 'signup-password';

export interface SignUpScreenProps {
    onBack: () => void;
    /** A provider's sign-up still needs fields: the gate shows the finish step with it. */
    onNeedsFields: (pending: PendingSignUp) => void;
}

export function SignUpScreen({ onBack, onNeedsFields }: SignUpScreenProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const { colors } = useTheme();
    const { setActive } = useClerk();
    const { signUp } = useSignUp();
    const [values, setValues] = useState<SignUpValues>({});
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignUpErrorField, string>>>({});
    const [focusField, setFocusField] = useState<SignUpErrorField | null>(null);
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    // 'credentials' → the profile fields + password; 'code' → the instance verifies the email, and the emailed code finishes it.
    const [step, setStep] = useState<'credentials' | 'code'>('credentials');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const social = useSocialSignIn(onNeedsFields);
    // One lock for the whole screen: the form, the provider group and the switch link (plan 012 D10).
    const locked = busy || social.busyProvider !== null;

    const failureCopy = signUpFailureCopy(t, t.signUpFailed);
    const sendCodeCopy = authFailureCopy(t, t.sendCodeFailed);
    const verifyCopy = authFailureCopy(t, t.verifyFailed);

    function changeField(field: SignUpErrorField, text: string) {
        if (field === 'password') {
            setPassword(text);
        } else {
            setValues((current) => ({ ...current, [field]: text }));
        }

        setFieldErrors((current) => ({ ...current, [field]: undefined }));
    }

    // Each message under the field it names, the rest in the alert (`signUpFailure`), focus on the first in error.
    function showFieldErrors(errors: Partial<Record<SignUpErrorField, string>>, form?: string) {
        setFieldErrors(errors);
        setError(form ?? null);
        setFocusField(FORM_FIELDS.find((field) => errors[field] !== undefined) ?? null);
    }

    function showFailure(failure: unknown) {
        const routed = signUpFailure(failure, SHOWN, failureCopy);
        showFieldErrors(routed.fields, routed.form);
    }

    // Send the verification code to the email. Returns true when a code is on its way.
    async function sendVerificationCode(): Promise<boolean> {
        if (!signUp) {
            return false;
        }

        const sendResult = await signUp.verifications.sendEmailCode();

        if (sendResult.error) {
            setError(authFailureMessage(sendResult.error, sendCodeCopy));

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
        setError(t.signUpUnsupported);
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

        // One cleaning rule for every profile field (`normalizeSignUpValue`); the password is sent exactly as typed.
        const sent = (field: SignUpFieldName): string => normalizeSignUpValue(field, values[field] ?? '');
        const empty = FORM_FIELDS.filter((field) => (field === 'password' ? password : sent(field)) === '');

        if (empty.length > 0) {
            showFieldErrors(Object.fromEntries(empty.map((field) => [field, failureCopy.required[field]])));

            return;
        }

        showFieldErrors({});
        setBusy(true);

        try {
            const createResult = await signUp.create({
                firstName: sent('first_name'),
                lastName: sent('last_name'),
                username: sent('username'),
                emailAddress: sent('email_address'),
            });

            if (createResult.error) {
                showFailure(createResult.error);

                return;
            }

            const pwResult = await signUp.password({ password });

            if (pwResult.error) {
                showFailure(pwResult.error);

                return;
            }

            await resolveStatus();
        } catch (e) {
            showFailure(e);
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
                setError(authFailureMessage(result.error, verifyCopy));

                return;
            }

            await finishSignUp();
        } catch (e) {
            setError(authFailureMessage(e, verifyCopy));
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
            setError(authFailureMessage(e, sendCodeCopy));
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
        <AuthScreenFrame>
            <AuthHeader title={t.createHeading} />

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
                    <SignUpFields
                        fields={SIGN_UP_FIELDS}
                        idPrefix="signup"
                        values={values}
                        errors={fieldErrors}
                        onChange={changeField}
                        busy={locked}
                        focusField={focusField === 'password' ? null : focusField}
                        onFocusHandled={() => setFocusField(null)}
                    />
                    <View style={styles.field}>
                        <FieldLabel forId={PASSWORD_ID} label={t.passwordLabel} />
                        <Input
                            id={PASSWORD_ID}
                            placeholder={t.passwordPlaceholder}
                            value={password}
                            onChangeText={(text) => changeField('password', text)}
                            secret
                            autoComplete="new-password"
                            enterKeyHint="go"
                            label={t.passwordLabel}
                            {...(fieldErrors.password === undefined ? {} : { error: fieldErrors.password })}
                            disabled={locked}
                            focusRequested={focusField === 'password'}
                            onFocusRequestHandled={() => setFocusField(null)}
                            onSubmit={() => void handleSignUp()}
                        />
                        {fieldErrors.password === undefined ? null : (
                            <Text style={[styles.error, { color: colors.dangerText }]}>{fieldErrors.password}</Text>
                        )}
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
                size="lg"
                width="fill"
                busy={busy}
                disabled={!signUp || social.busyProvider !== null}
                onPress={() => void (onCredentials ? handleSignUp() : handleVerifyCode())}
            >
                {onCredentials ? t.createAccountAction : t.verifyAction}
            </Button>

            {onCredentials ? (
                <AuthSwitchLink prompt={t.haveAccountPrompt} label={t.signInLink} disabled={locked} onPress={onBack} />
            ) : (
                <AuthCodeActions
                    busy={busy}
                    onResend={() => void handleResend()}
                    onStartOver={() => void handleStartOver()}
                />
            )}
        </AuthScreenFrame>
    );
}

const styles = StyleSheet.create({
    // A label and its field are one group: closer to each other than to the next field (spec §1.6).
    field: { gap: nativeTokens.spacing[1] },
    fields: { gap: nativeTokens.spacing[3] },
    error: { ...nativeTokens.type.meta },
});
