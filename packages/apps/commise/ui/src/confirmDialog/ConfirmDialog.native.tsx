/**
 * @module @commise/ui/confirm-dialog — the native design-system {@link ConfirmDialog} (house pattern B6).
 *
 * The React Native leaf of `ConfirmDialog`: the description and a cancel + confirm pair on the design system's
 * centred `DialogFrame` (`docs/design/compactHeightLayout.md` §9), which owns the window, the scrim, the safe area, the
 * keyboard, the capped card that scrolls, and the title, named and first, as an interrupting `alert`.
 * `onRequestClose` (the Android hardware back-button / platform dismiss path) maps to `onCancel`, so there is one exit
 * path, not two, mirroring the web leaf's `onOpenChange(false) -> onCancel` mapping.
 *
 * Renders NOTHING while `open` is false: the frame returns early rather than toggling `Modal`'s `visible`, because
 * `react-native-web`'s `Modal` keeps its portal content mounted across a `visible` toggle, so a component test that
 * opens then closes the dialog would still find the "closed" content.
 *
 * @pattern Adapter over the design-system `DialogFrame` — the platform expression of the web leaf's Radix adapter, with
 *     `onRequestClose` mapped to the same cancel path so the hardware back button cannot diverge from the control.
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DialogFrame } from '../dialogFrame/DialogFrame.native.js';
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
    return (
        <DialogFrame open={open} onRequestClose={onCancel} title={title} role="alert">
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
        </DialogFrame>
    );
};

const styles = StyleSheet.create({
    body: { fontSize: 15, lineHeight: 22, color: palette.slate },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    cancelButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    cancelLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    confirmButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 20 },
    confirmButtonDestructive: { backgroundColor: palette.error },
    confirmLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
