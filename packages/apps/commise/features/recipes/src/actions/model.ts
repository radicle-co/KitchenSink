/**
 * @module @commise/features-recipes — recipe-action model layer.
 *
 * Pure, platform-agnostic prop contracts shared by the web (`*.tsx`) and native (`*.native.tsx`) leaves of
 * the recipe-action building blocks (the T068 delete dialog), so the two platform renders can never drift on
 * shape. No React, no platform APIs — just the controlled,
 * presentational prop types. Each component fetches nothing and derives no remote state; the composing app
 * owns the mutations and feeds these props.
 */

/**
 * Props for the delete-confirmation dialog (T068) — a controlled, presentational modal. Visibility is owned
 * by the parent via `open`; the component renders nothing while closed. `deleting` reflects the in-flight
 * delete mutation and disables the confirm action so it cannot be double-submitted.
 */
export interface RecipeDeleteDialogProps {
    /** Title of the recipe being deleted — named in the confirmation copy. */
    readonly recipeTitle: string;
    /** Whether the dialog is shown. When `false` the component renders nothing. */
    readonly open: boolean;
    /** Whether the delete mutation is in flight — disables and marks the confirm action busy. */
    readonly deleting?: boolean;
    /** When true, a localized "couldn't delete" alert is shown in the dialog — the last delete failed (B17). */
    readonly error?: boolean;
    /** Invoked when the user confirms the deletion. */
    readonly onConfirm: () => void;
    /** Invoked when the user dismisses the dialog without deleting. */
    readonly onCancel: () => void;
}
