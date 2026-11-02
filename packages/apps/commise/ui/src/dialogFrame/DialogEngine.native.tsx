/**
 * @module @commise/ui/dialog-frame — the centred dialog's card: Tamagui's own `Dialog`, kept inside the window the host
 * opens. It holds the card's look and nothing React Native styles, so the file that opens the window keeps the scrim and
 * the safe area and this one stays all Tamagui.
 *
 * - `modal={false}`: no portal and no window of its own; `OverlayHost` is the window, and Back, Close and the
 *   screen-reader escape all reach the host through it. On a device Tamagui's content is then a plain frame in place,
 *   with the dialog role and `aria-modal`; the outside-press and focus-trap layers are web-only.
 * - Controlled `open`, no state of its own: the engine's own close (`onOpenChange(false)`) asks the host once, and the host
 *   answers by changing `open` or not. A dialog that vetoes (a form that is submitting) simply stays.
 * - The scrim is not a dismiss route, so the frame hands the engine no overlay.
 * - The card paints the tone the frame states around it (`ToneScope` `paperOverlay`): its fill is the theme's `background`.
 * - It has no motion of its own, so it takes no motion props: the window's fade is React Native's.
 *
 * It uses the behaviour package (`@tamagui/dialog`), not `tamagui`'s Dialog: that one is skinned, and its defaults (a
 * `border-color` key, a `borderRadius` of `'4'`, `elevate`) log warnings on a device that this card's own styling overrides
 * too late to prevent.
 *
 * A presentational component: controlled by `open`, it holds no state and fetches nothing.
 *
 * @pattern Adapter over Tamagui's `Dialog` — its engine props and close, in this design system's terms
 */
import type { FC, ReactNode } from 'react';
import { Dialog } from '@tamagui/dialog';
import { ScrollView, YStack } from 'tamagui';

import { DIALOG_CARD_MAX_WIDTH_DP } from './dialogFrameLayout.js';

/** Props for {@link DialogEngine}. */
export interface DialogEngineProps {
    /** `alert` for a confirmation that interrupts; `dialog` otherwise. Only the role changes. */
    readonly role: 'alert' | 'dialog';
    /**
     * The heading, first in the card. The frame draws it, because the screen-reader cursor moves onto it by a React Native
     * node, which the frame owns.
     */
    readonly heading: ReactNode;
    /** The engine closed itself. */
    readonly onEngineClose: () => void;
    readonly children: ReactNode;
}

export const DialogEngine: FC<DialogEngineProps> = ({ role, heading, onEngineClose, children }) => (
    <Dialog
        modal={false}
        open
        onOpenChange={(next: boolean) => {
            if (!next) {
                onEngineClose();
            }
        }}
    >
        <Dialog.Content
            role={role}
            aria-modal
            width="100%"
            maxWidth={DIALOG_CARD_MAX_WIDTH_DP}
            maxHeight="100%"
            borderRadius="$xl"
            borderWidth={1}
            borderColor="$lineDivider"
            backgroundColor="$background"
            overflow="hidden"
        >
            {/* `flexGrow` 0: the card is as tall as its content until the avoided box caps it, and then the content scrolls. */}
            <ScrollView keyboardShouldPersistTaps="handled" flexGrow={0}>
                <YStack padding="$5" gap="$3">
                    {heading}
                    {children}
                </YStack>
            </ScrollView>
        </Dialog.Content>
    </Dialog>
);
