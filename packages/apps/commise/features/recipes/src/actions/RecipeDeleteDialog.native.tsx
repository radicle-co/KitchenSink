/**
 * @module @commise/features-recipes — native recipe delete-confirmation dialog (T068 building block).
 *
 * The React Native leaf of {@link import('./RecipeDeleteDialog.js').RecipeDeleteDialog} — same controlled,
 * presentational contract: renders nothing while closed; when open it is an `alert`-role surface that names
 * the recipe and offers cancel/confirm, with the confirm action disabled and marked busy while `deleting`.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { RecipeDeleteDialogProps } from './model.js';

export const RecipeDeleteDialog: FC<RecipeDeleteDialogProps> = ({
    recipeTitle,
    open,
    deleting = false,
    error = false,
    onConfirm,
    onCancel,
}) => {
    const { deleteDialog } = useMessages(recipeActionMessages);

    if (!open) {
        return null;
    }

    return (
        <View accessibilityRole="alert" accessibilityLabel={deleteDialog.title} style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
                {deleteDialog.title}
            </Text>
            <Text style={styles.body}>{fillTemplate(deleteDialog.body, { title: recipeTitle })}</Text>
            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={deleteDialog.cancel}
                    onPress={onCancel}
                    style={styles.cancelButton}
                >
                    <Text style={styles.cancelLabel}>{deleteDialog.cancel}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={deleteDialog.confirm}
                    aria-busy={deleting || undefined}
                    disabled={deleting}
                    onPress={onConfirm}
                    style={[styles.confirmButton, deleting && styles.confirmButtonBusy]}
                >
                    <Text style={styles.confirmLabel}>{deleteDialog.confirm}</Text>
                </Pressable>
            </View>
            {deleting && <Text style={styles.body}>{deleteDialog.deletingLabel}</Text>}
            {error && !deleting && <Text style={styles.error}>{deleteDialog.error}</Text>}
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
        gap: 12,
    },
    title: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    body: { fontSize: 15, lineHeight: 22, color: palette.slate },
    actions: { flexDirection: 'row', gap: 12 },
    cancelButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    cancelLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    confirmButton: { backgroundColor: palette.error, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 20 },
    confirmButtonBusy: { opacity: 0.6 },
    confirmLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    error: { fontSize: 13, color: palette.error },
});
