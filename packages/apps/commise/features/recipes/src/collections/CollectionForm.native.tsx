/**
 * @module @commise/features-recipes — native collection form (T073 building block).
 *
 * The React Native leaf of {@link import('./CollectionForm.js').CollectionForm} — same controlled,
 * presentational create/rename contract, rendered with RN primitives. `mode` selects the title and submit
 * label; while `submitting`, the field and both actions are disabled to prevent duplicate submissions.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
        <View accessibilityLabel={title}>
            <Text accessibilityRole="header">{title}</Text>
            <TextInput
                accessibilityLabel={form.nameLabel}
                placeholder={form.namePlaceholder}
                value={name}
                editable={!submitting}
                onChangeText={onChange}
            />
            {hasError && <Text accessibilityRole="alert">{error}</Text>}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                disabled={submitting}
                onPress={onSubmit}
            >
                <Text>{submitLabel}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={form.cancel}
                disabled={submitting}
                onPress={onCancel}
            >
                <Text>{form.cancel}</Text>
            </Pressable>
        </View>
    );
};
