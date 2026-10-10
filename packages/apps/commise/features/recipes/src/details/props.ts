/**
 * @module details/props — the platform-neutral prop contract of the details dialog leaves (curated U14). The web leaf
 * (`VariantDetailsDialog.tsx`, on the `Sheet`'s Radix dialog) and the native leaf (`VariantDetailsDialog.native.tsx`,
 * on its bottom sheet) both implement it.
 */
import type { VariantDetailsDialogModel } from './useVariantDetailsDialog.js';

/** Props of the details dialog leaves. The host owns `useVariantDetailsDialog` and passes its model down. */
export interface VariantDetailsDialogProps {
    readonly open: boolean;
    /** The root's name, from the line, so the dialog names the food before its read lands (R24). */
    readonly foodName: string;
    readonly details: VariantDetailsDialogModel;
    /**
     * The dialog is off screen after a close by any route (`@commise/ui/sheet`): the host's moment to return the
     * reading cursor to the row's `⋮` on native (§S8.8), once nothing else is on screen.
     */
    readonly onDismissed?: () => void;
}
