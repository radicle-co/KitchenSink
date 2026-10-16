/**
 * @module components/auth/AuthCodeFields — the email-code step both signed-out screens show: the prompt, then the
 * labelled one-time-code field. Sign-in (the second-factor code) and sign-up (the email-verification code) ask for
 * the same thing in the same words, so the field's hints (numeric keypad, the OS one-time-code autofill) live here
 * once.
 *
 * Presentational: props → JSX.
 */
import { FieldLabel, Input } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';

/** Props for {@link AuthCodeFields}. */
export interface AuthCodeFieldsProps {
    /** The field's id, which its label points at; unique on the screen. */
    readonly id: string;
    /** The code typed so far. */
    readonly value: string;
    /** Called with the new text on every change. */
    readonly onChangeText: (text: string) => void;
    /** Locks the field while a request is in flight. */
    readonly busy: boolean;
    /** Called when the keyboard's "done" key is pressed. */
    readonly onSubmit: () => void;
}

/**
 * @param props - The field's id, value, handlers and busy state.
 * @returns The prompt and the labelled code field.
 */
export function AuthCodeFields({ id, value, onChangeText, busy, onSubmit }: AuthCodeFieldsProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.fields}>
            <Text style={[nativeTokens.type.body, { color: colors.inkMuted }]}>{t.codePrompt}</Text>
            <View style={styles.field}>
                <FieldLabel forId={id} label={t.codeLabel} />
                <Input
                    id={id}
                    label={t.codeLabel}
                    placeholder={t.codePlaceholder}
                    value={value}
                    onChangeText={onChangeText}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    enterKeyHint="done"
                    disabled={busy}
                    onSubmit={onSubmit}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    // A label and its field are one group: closer to each other than to the next field (spec §1.6).
    field: { gap: nativeTokens.spacing[1] },
    fields: { gap: nativeTokens.spacing[3] },
});
