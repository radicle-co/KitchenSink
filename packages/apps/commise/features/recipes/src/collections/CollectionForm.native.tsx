/**
 * @module @commise/features-recipes — native collection form (T073 building block).
 *
 * The React Native leaf of {@link import('./CollectionForm.js').CollectionForm} — same controlled,
 * presentational create/rename contract, rendered with RN primitives. `mode` selects the title and submit
 * label; while `submitting`, the field and both actions are disabled to prevent duplicate submissions.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { collectionMessages } from './messages.js';
import type { CollectionFormProps } from './model.js';

export const CollectionForm: FC<CollectionFormProps> = ({
    mode,
    name,
    submitting = false,
    error,
    onChange,
    onSubmit,
    onCancel,
}) => {
    const { form } = useMessages(collectionMessages);
    const title = mode === 'create' ? form.createTitle : form.renameTitle;
    const submitLabel = mode === 'create' ? form.createSubmit : form.renameSubmit;
    const hasError = error !== undefined && error.length > 0;

    return (
        <View accessibilityLabel={title} style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
                {title}
            </Text>
            <Text style={styles.fieldLabel}>{form.nameLabel}</Text>
            <TextInput
                accessibilityLabel={form.nameLabel}
                placeholder={form.namePlaceholder}
                placeholderTextColor={palette.mist}
                value={name}
                editable={!submitting}
                onChangeText={onChange}
                style={styles.input}
            />
            {hasError && (
                <Text accessibilityRole="alert" style={styles.error}>
                    {error}
                </Text>
            )}
            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={submitLabel}
                    disabled={submitting}
                    onPress={onSubmit}
                    style={[styles.primaryButton, submitting && styles.disabled]}
                >
                    <Text style={styles.primaryLabel}>{submitLabel}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={form.cancel}
                    disabled={submitting}
                    onPress={onCancel}
                    style={styles.ghostButton}
                >
                    <Text style={styles.ghostLabel}>{form.cancel}</Text>
                </Pressable>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        padding: 20,
        margin: 16,
        gap: 10,
    },
    title: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    fieldLabel: { fontSize: 13, fontWeight: '500', color: palette.slate },
    input: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 16,
        color: palette.charcoal,
    },
    error: { color: palette.error, fontSize: 13 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    primaryButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 24 },
    disabled: { opacity: 0.6 },
    primaryLabel: { color: palette.white, fontWeight: '600', fontSize: 15 },
    ghostButton: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
    ghostLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
});
