/**
 * @module @commise/ui/confirm-dialog — shared, platform-neutral prop contract for the design-system
 * {@link import('./ConfirmDialog.js').ConfirmDialog} (house pattern B6). The web (`ConfirmDialog.tsx`,
 * Radix `AlertDialog`) and native (`ConfirmDialog.native.tsx`, RN `Modal`) leaves both implement this exact
 * surface, so the two platform renders can never drift on shape.
 *
 * A controlled, presentational confirmation modal for any "are you sure" moment (discard-unsaved-edits,
 * destructive delete, etc.) — it owns NO state and performs NO side effect beyond the two callbacks; the
 * composing app decides what `open` means and what `onConfirm`/`onCancel` do. Every string is a caller-
 * supplied prop (no i18n import here) — mirrors the design-system {@link import('../button/props.js').ButtonProps}
 * idiom of accepting the visible/accessible copy as data rather than owning locale concerns itself.
 */
export interface ConfirmDialogProps {
    /** Whether the dialog is shown. When `false` the component renders nothing. */
    readonly open: boolean;
    /** The dialog's accessible title (also the visible heading). */
    readonly title: string;
    /** The dialog's body copy, explaining the consequence of confirming. */
    readonly description: string;
    /** Label for the confirm action. */
    readonly confirmLabel: string;
    /** Label for the cancel ("keep going") action. */
    readonly cancelLabel: string;
    /** Invoked when the user confirms. */
    readonly onConfirm: () => void;
    /** Invoked when the user cancels (including a backdrop dismiss / Escape on web). */
    readonly onCancel: () => void;
    /** Styles the confirm action as a destructive (error-toned) action. Defaults to `false`. */
    readonly destructive?: boolean;
}
