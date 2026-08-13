/**
 * @module @commise/ui/confirm-dialog — the native design-system {@link ConfirmDialog} (house pattern B6).
 *
 * The React Native leaf of `ConfirmDialog` — an RN `Modal` (transparent,
 * fade) hosting the same card layout/visual language as `@commise/features-recipes`'s
 * `RecipeDeleteDialog.native` (accessible `alert` role naming the dialog, cancel + confirm `Pressable`s).
 * `onRequestClose` (the Android hardware back-button / platform dismiss path) maps to `onCancel`, so there
 * is one exit path, not two, mirroring the web leaf's `onOpenChange(false) -> onCancel` mapping.
 *
 * Renders NOTHING while `open` is false — an explicit early return, not just `Modal`'s own `visible` prop:
 * `react-native-web`'s `Modal` keeps its portal content mounted in the DOM across a `visible` toggle (it
 * animates/hides rather than unmounts), so a component test that opens then closes the dialog would still
 * find the "closed" content via `queryByLabelText`. Gating the whole `<Modal>` behind `open` keeps this
 * leaf's contract identical to every other controlled dialog in this codebase (e.g.
 * `RecipeDeleteDialog.native`'s `if (!open) return null`) and genuinely testable either way.
 */
import type { FC } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '../tokens/colors.js';
import type { ConfirmDialogProps } from './props.js';

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    destructive = false,
}) => {
    if (!open) {
        return null;
    }

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
            <View style={styles.backdrop}>
                <View accessibilityRole="alert" accessibilityLabel={title} style={styles.card}>
                    <Text accessibilityRole="header" style={styles.title}>
                        {title}
                    </Text>
                    <Text style={styles.body}>{description}</Text>
                    <View style={styles.actions}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={cancelLabel}
                            onPress={onCancel}
                            style={styles.cancelButton}
                        >
                            <Text style={styles.cancelLabel}>{cancelLabel}</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={confirmLabel}
                            onPress={onConfirm}
                            style={[styles.confirmButton, destructive && styles.confirmButtonDestructive]}
                        >
                            <Text style={styles.confirmLabel}>{confirmLabel}</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(44, 62, 80, 0.4)',
        padding: 16,
    },
    card: {
        width: '100%',
        maxWidth: 420,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 20,
        gap: 12,
    },
    title: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    body: { fontSize: 15, lineHeight: 22, color: palette.slate },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    cancelButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    cancelLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    confirmButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 20 },
    confirmButtonDestructive: { backgroundColor: palette.error },
    confirmLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
