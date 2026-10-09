/**
 * @module @commise/ui/confirm-dialog — the native design-system {@link ConfirmDialog} (house pattern B6).
 *
 * The React Native leaf of `ConfirmDialog`: the body and a Keep + confirm pair on the design system's centred
 * `DialogFrame` (`docs/design/compactHeightLayout.md` §9), which owns the window, the scrim, the safe area, the keyboard,
 * the capped card that scrolls, and the title, named and first, as an interrupting `alert`. `onRequestClose` (the
 * Android Back button) maps to `onKeep`, so there is one exit path, not two, as on web.
 *
 * - The screen-reader cursor opens on Keep, through the DS `Button`'s focus request, raised once per opening.
 * - The confirm is the DS `Button` in its filled `confirm` tone, which brings the spinner and the busy guard.
 * - The buttons stack full width with the destructive one on top until the dialog measures 400 pt or wider, then sit
 *   side by side, Keep first (spec §6.5) — the frame's own width, read from layout, not the window's.
 *
 * Renders NOTHING while `open` is false (the frame returns early), so each opening mounts a fresh body.
 *
 * @pattern Adapter over the design-system `DialogFrame` — the platform expression of the web leaf's Radix adapter, with
 *     `onRequestClose` mapped to the same Keep path so the hardware back button cannot diverge from the control.
 */
import { useState, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../button/Button.native.js';
import { DialogFrame } from '../dialogFrame/DialogFrame.native.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { ConfirmDialogProps } from './props.js';

/** The dialog width from which the two buttons sit side by side (spec §1.2's component query). */
const SIDE_BY_SIDE_FROM = 400;

/** One opening of the dialog: the copy, the states, and the two actions. */
const Body: FC<Omit<ConfirmDialogProps, 'open' | 'title'>> = ({
    body,
    confirm,
    keep,
    onConfirm,
    onKeep,
    busy = false,
    busyLabel,
    error,
}) => {
    // Asked once per opening (this body mounts with the frame), and cleared when the Keep button has taken it.
    const [keepFocusAsked, setKeepFocusAsked] = useState(true);
    const [width, setWidth] = useState<number | null>(null);
    const sideBySide = width !== null && width >= SIDE_BY_SIDE_FROM;
    const { colors } = useTheme();

    return (
        <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.stack}>
            <Text style={[styles.body, { color: colors.inkMuted }]}>{body}</Text>
            {error === undefined || busy ? null : (
                <Text role="alert" style={[styles.error, { color: colors.dangerText }]}>
                    {error}
                </Text>
            )}
            {busy && busyLabel !== undefined ? (
                <LiveRegion politeness="polite" style={[styles.status, { color: colors.inkMuted }]}>
                    {busyLabel}
                </LiveRegion>
            ) : null}
            <View style={sideBySide ? styles.row : styles.stacked}>
                <Button
                    variant="secondary"
                    icon={keep.icon ?? 'x'}
                    width={sideBySide ? 'auto' : 'fill'}
                    onPress={onKeep}
                    focusRequested={keepFocusAsked}
                    onFocusRequestHandled={() => setKeepFocusAsked(false)}
                >
                    {keep.label}
                </Button>
                <Button
                    variant="destructive"
                    tone="confirm"
                    icon={confirm.icon}
                    busy={busy}
                    width={sideBySide ? 'auto' : 'fill'}
                    onPress={onConfirm}
                >
                    {confirm.label}
                </Button>
            </View>
        </View>
    );
};

export const ConfirmDialog: FC<ConfirmDialogProps> = ({ open, title, ...body }) => (
    <DialogFrame open={open} onRequestClose={body.onKeep} title={title} role="alert">
        <Body {...body} />
    </DialogFrame>
);

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[4] },
    body: nativeTokens.type.body,
    error: nativeTokens.type.body,
    status: nativeTokens.type.meta,
    stacked: { flexDirection: 'column-reverse', alignItems: 'stretch', gap: nativeTokens.spacing[3] },
    row: { flexDirection: 'row', justifyContent: 'flex-end', gap: nativeTokens.spacing[3] },
});
