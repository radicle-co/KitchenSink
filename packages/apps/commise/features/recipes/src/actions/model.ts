/**
 * @module @commise/features-recipes — recipe-action model layer.
 *
 * Pure, platform-agnostic prop contracts shared by the web (`*.tsx`) and native (`*.native.tsx`) leaves of
 * the recipe-action building blocks (T068 delete dialog, T074 visibility toggle, T075 clone action), so the
 * two platform renders can never drift on shape. No React, no platform APIs — just the controlled,
 * presentational prop types. Each component fetches nothing and derives no remote state; the composing app
 * owns the mutations and feeds these props.
 */
import type { RecipeVisibility } from '@kitchensink/recipe-core';

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
    /** Invoked when the user confirms the deletion. */
    readonly onConfirm: () => void;
    /** Invoked when the user dismisses the dialog without deleting. */
    readonly onCancel: () => void;
}

/**
 * Props for the public/private visibility toggle (T074). Tier-gated per C-004: free-tier recipes are
 * public-only, so when `canGoPrivate` is false the private option is disabled and `disabledReason` (already
 * localized by the composing app) explains why. State is conveyed by the option's checked/disabled
 * semantics and text — never by colour alone.
 */
export interface RecipeVisibilityToggleProps {
    /** The recipe's current visibility — the checked option. */
    readonly visibility: RecipeVisibility;
    /** Whether the viewer's tier permits a private recipe (C-004). */
    readonly canGoPrivate: boolean;
    /** Localized explanation shown when the private option is gated off (rendered only when `!canGoPrivate`). */
    readonly disabledReason?: string;
    /** Invoked with the requested next visibility when the user selects an enabled option. */
    readonly onChange: (next: RecipeVisibility) => void;
}

/**
 * Props for the clone action (T075) — a clone button plus optional source attribution. `canClone` gates the
 * action off (e.g. the viewer cannot clone this recipe) and `cloning` reflects the in-flight clone mutation;
 * either disables the button. The attribution line renders only when `sourceAttribution` is present.
 */
export interface RecipeCloneActionProps {
    /** Whether the viewer may clone this recipe — gates the action off when false. */
    readonly canClone: boolean;
    /** Source attribution for a cloned/imported recipe — its line renders only when present. */
    readonly sourceAttribution?: string;
    /** Whether the clone mutation is in flight — disables and marks the action busy. */
    readonly cloning?: boolean;
    /** Invoked when the user requests a clone. */
    readonly onClone: () => void;
}
