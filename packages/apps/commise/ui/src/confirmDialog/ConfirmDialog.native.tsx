/**
 * @module @commise/ui/confirm-dialog — the native design-system {@link ConfirmDialog} (house pattern B6).
 *
 * The React Native leaf of `ConfirmDialog`: the body and a Keep + confirm pair on the design system's centred
 * `DialogFrame` (`docs/design/compactHeightLayout.md` §9), which owns the window, the scrim, the safe area, the keyboard,
 * the capped card whose body scrolls, and the title, named and first, as an interrupting `alert`. `onRequestClose` (the
 * Android Back button) maps to `onKeep`, so there is one exit path, not two, as on web.
 *
 * - The screen-reader cursor opens on Keep, through the DS `Button`'s focus request, raised once per opening.
 * - The confirm is the DS `Button` in its filled `confirm` tone, which brings the spinner and the busy guard.
 * - The body scrolls and the two buttons stay pinned under it, in view at any text size (designer ruling 2026-11-11):
 *   at iOS's largest sizes a body that scrolled WITH its buttons pushed them below the fold.
 * - The copy is never drawn larger than the title: it grows with the system text size only to the title's ceiling
 *   (`DISPLAY_FONT_SCALE_CAP`), through the scale every design-system Text reads (`TextScaleContext`).
 * - The buttons stack full width with the destructive one on top until the dialog measures 400 pt or wider, then sit
 *   side by side, Keep first (spec §6.5) — `DialogActions` reads the frame's own width from layout, not the window's.
 *
 * Renders NOTHING while `open` is false (the frame returns early), so each opening mounts a fresh body.
 *
 * @pattern Adapter over the design-system `DialogFrame` — the platform expression of the web leaf's Radix adapter, with
 *     `onRequestClose` mapped to the same Keep path so the hardware back button cannot diverge from the control.
 */
import { useState, type FC } from 'react';
import { YStack } from 'tamagui';

import { Button } from '../button/Button.native.js';
import { DialogActions } from '../dialogActions/DialogActions.native.js';
import { DialogFrame } from '../dialogFrame/DialogFrame.native.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { Text } from '../text/Text.native.js';
import { DISPLAY_FONT_SCALE_CAP } from '../text/scaledType.js';
import { TextScaleContext } from '../text/textScaleContext.native.js';
import type { ConfirmDialogProps } from './props.js';

/** The dialog width from which the two buttons sit side by side (spec §1.2's component query). */
const SIDE_BY_SIDE_FROM = 400;

/** The copy of one opening: the body and the states, drawn no larger than the title. */
const Copy: FC<Pick<ConfirmDialogProps, 'body' | 'busy' | 'busyLabel' | 'error' | 'unavailable'>> = ({
    body,
    busy = false,
    busyLabel,
    error,
    unavailable,
}) => {
    const { textScale } = TextScaleContext.useStyledContext();

    return (
        <TextScaleContext.Provider textScale={Math.min(textScale, DISPLAY_FONT_SCALE_CAP)}>
            <YStack gap="$4">
                <Text typeRole="body" color="$inkMuted">
                    {body}
                </Text>
                {error === undefined || busy ? null : (
                    <Text role="alert" typeRole="body" color="$dangerText">
                        {error}
                    </Text>
                )}
                {busy && busyLabel !== undefined ? (
                    <LiveRegion politeness="polite" typeRole="meta" tone="inkMuted">
                        {busyLabel}
                    </LiveRegion>
                ) : null}
                {unavailable !== undefined && !busy ? (
                    <LiveRegion politeness="polite" typeRole="meta" tone="inkMuted">
                        {unavailable}
                    </LiveRegion>
                ) : null}
            </YStack>
        </TextScaleContext.Provider>
    );
};

/** The two actions of one opening, pinned under the body. */
const Actions: FC<Pick<ConfirmDialogProps, 'confirm' | 'keep' | 'onConfirm' | 'onKeep' | 'busy' | 'unavailable'>> = ({
    confirm,
    keep,
    onConfirm,
    onKeep,
    busy = false,
    unavailable,
}) => {
    // Asked once per opening (the actions mount with the frame), and cleared when the Keep button has taken it.
    const [keepFocusAsked, setKeepFocusAsked] = useState(true);

    return (
        <DialogActions sideBySideFrom={SIDE_BY_SIDE_FROM}>
            <Button
                variant="secondary"
                {...(keep.icon === undefined ? {} : { icon: keep.icon })}
                width="fill"
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
                disabled={unavailable !== undefined}
                width="fill"
                onPress={onConfirm}
            >
                {confirm.label}
            </Button>
        </DialogActions>
    );
};

export const ConfirmDialog: FC<ConfirmDialogProps> = ({ open, title, ...props }) => (
    <DialogFrame open={open} onRequestClose={props.onKeep} title={title} role="alert" actions={<Actions {...props} />}>
        <Copy {...props} />
    </DialogFrame>
);
