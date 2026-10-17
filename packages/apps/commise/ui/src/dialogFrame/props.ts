/**
 * @module @commise/ui/dialog-frame — the prop contract of the design-system centred dialog frame
 * (`docs/design/compactHeightLayout.md` §9.2). Native only, the `@commise/ui/input` precedent: the web dialogs are
 * Radix's.
 *
 * Controlled and stateless; every string is a caller-supplied, already-localised prop.
 */
import type { ReactNode } from 'react';

/** Props for the centred dialog frame. */
export interface DialogFrameProps {
    /** When `false`, renders nothing. */
    readonly open: boolean;
    /** Android back (`Modal.onRequestClose`). The scrim is not a dismiss route. */
    readonly onRequestClose: () => void;
    /** The visible heading (header role), first in the card, and the dialog's name. */
    readonly title: string;
    /** `alert` for a confirmation that interrupts; `dialog` otherwise. Only the role changes. */
    readonly role: 'alert' | 'dialog';
    /** The body and the actions, in reading order. They scroll inside the card. */
    readonly children: ReactNode;
}
