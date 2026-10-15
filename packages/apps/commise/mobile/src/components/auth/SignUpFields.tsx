/**
 * @module components/auth/SignUpFields — the labelled profile fields a sign-up asks for (plan 012 D8): the typed
 * sign-up form shows all of {@link SIGN_UP_FIELDS}; the finish step after a Google / Apple sign-up shows only those
 * Clerk still lists as missing. Each field carries its registry autofill and keyboard hints, and its error (ours for an
 * empty field, Clerk's for a rejected one) sits UNDER it, named by the field's `describedBy` (WCAG 2.2 SC 3.3.1).
 *
 * Presentational: props → JSX.
 */
import { fieldHintId, FieldLabel, Input } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SignUpFieldName, SignUpFieldSpec } from '../../auth/signUpFields.js';
import { mobileMessages } from '../../i18n/messages.js';

/** Each field's value, by Clerk field name. */
export type SignUpValues = Readonly<Partial<Record<SignUpFieldName, string>>>;

/** Each field's error, by Clerk field name. */
export type SignUpErrors = Readonly<Partial<Record<SignUpFieldName, string>>>;

/** Props for {@link SignUpFields}. */
export interface SignUpFieldsProps {
    /** The fields to show, in order. */
    readonly fields: readonly SignUpFieldSpec[];
    /** Prefixes each field id, so two forms on one screen cannot collide. */
    readonly idPrefix: string;
    readonly values: SignUpValues;
    readonly errors: SignUpErrors;
    /** Called with the field and its new text on every change. */
    readonly onChange: (field: SignUpFieldName, text: string) => void;
    /** Locks every field while a request is in flight. */
    readonly busy: boolean;
}

/** The id of the error line under a field. Pure. */
export function signUpFieldErrorId(fieldId: string): string {
    return `${fieldId}-error`;
}

/**
 * @param props - The fields, their values and errors, and the change handler.
 * @returns The labelled fields, each with its error under it.
 */
export function SignUpFields({ fields, idPrefix, values, errors, onChange, busy }: SignUpFieldsProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const { colors } = useTheme();
    const labels: Readonly<Record<SignUpFieldName, string>> = {
        first_name: t.firstNameLabel,
        last_name: t.lastNameLabel,
        username: t.usernameLabel,
        email_address: t.emailLabel,
    };
    const hints: Readonly<Partial<Record<SignUpFieldName, string>>> = { username: t.usernameHint };

    return (
        <View style={styles.fields}>
            {fields.map((field) => {
                const id = `${idPrefix}-${field.name}`;
                const hint = hints[field.name];
                const error = errors[field.name];
                const describedBy = [
                    hint === undefined ? undefined : fieldHintId(id),
                    error === undefined ? undefined : signUpFieldErrorId(id),
                ]
                    .filter((part): part is string => part !== undefined)
                    .join(' ');

                return (
                    <View key={field.name} style={styles.field}>
                        <FieldLabel forId={id} label={labels[field.name]} {...(hint === undefined ? {} : { hint })} />
                        <Input
                            id={id}
                            value={values[field.name] ?? ''}
                            onChangeText={(text) => onChange(field.name, text)}
                            inputMode={field.inputMode}
                            autoComplete={field.autoComplete}
                            autoCapitalize={field.autoCapitalize}
                            autoCorrect={field.autoCorrect}
                            enterKeyHint="next"
                            invalid={error !== undefined}
                            {...(describedBy === '' ? {} : { describedBy })}
                            {...(field.name === 'email_address' ? { placeholder: t.emailPlaceholder } : {})}
                            disabled={busy}
                        />
                        {error === undefined ? null : (
                            <Text
                                nativeID={signUpFieldErrorId(id)}
                                style={[styles.error, { color: colors.dangerText }]}
                            >
                                {error}
                            </Text>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    // A label and its field are one group: closer to each other than to the next field (spec §1.6).
    field: { gap: nativeTokens.spacing[1] },
    fields: { gap: nativeTokens.spacing[3] },
    error: { ...nativeTokens.type.meta },
});
