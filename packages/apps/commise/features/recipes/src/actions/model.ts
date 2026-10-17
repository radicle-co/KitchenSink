/**
 * @module @commise/features-recipes — recipe-action model layer.
 *
 * Pure, platform-agnostic prop contracts shared by the web (`*.tsx`) and native (`*.native.tsx`) leaves of
 * the recipe-action building blocks (the T068 delete dialog), so the two platform renders can never drift on
 * shape. No React, no platform APIs — just the controlled,
 * presentational prop types. Each component fetches nothing and derives no remote state; the composing app
 * owns the mutations and feeds these props.
 */
import type { MakePublicConsequence } from './privateGate.js';

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
    /** Why Delete cannot be used now ("Saving…"): the confirm is disabled and the reason is said (owner ruling 2026-10-17). */
    readonly unavailable?: string;
    /** Invoked when the user confirms the deletion. */
    readonly onConfirm: () => void;
    /** Invoked when the user dismisses the dialog without deleting. */
    readonly onCancel: () => void;
}

/**
 * Props for the make-public confirm (UX SPECIFY 2026-10-15) — controlled and presentational. The editor applies Public
 * to the draft and closes it at once; the recipe page keeps it up, busy, while its change is in flight, and shows a
 * failure inside it.
 */
export interface RecipeMakePublicDialogProps {
    /** Whether the dialog is shown. When `false` the component renders nothing. */
    readonly open: boolean;
    /** Why going public costs the cook something: the body's words (`makePublicConsequence`, never `none` here). */
    readonly consequence: Exclude<MakePublicConsequence, 'none'>;
    /** The change is in flight: the confirm spins and cannot fire again. */
    readonly busy?: boolean;
    /** When true, the last change failed: a localized alert inside the dialog. */
    readonly error?: boolean;
    /** Make public: the cook accepted the cost. */
    readonly onConfirm: () => void;
    /** Keep private, Escape, and the Android Back button. */
    readonly onKeep: () => void;
}

/**
 * Props for the Premium sheet a free-tier cook gets for "Private" in the recipe editor (build spec §6.4, §7.7 item 2):
 * controlled and presentational, like the collection twin (`CollectionUpsellSheetProps`).
 */
export interface RecipeUpsellSheetProps {
    readonly open: boolean;
    /** Every close route calls this with `false`. */
    readonly onOpenChange: (open: boolean) => void;
    /** "See Premium". The subscription surface is not built yet (010), so the host closes the sheet. */
    readonly onSeePremium: () => void;
}
