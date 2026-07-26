/**
 * @module @commise/features-account/danger/model — platform-neutral prop contracts for the account
 * danger-zone building blocks (CR-002 / U4b). The web (`AccountEraseDialog.tsx`, Radix `Dialog`) and native
 * (`AccountEraseDialog.native.tsx`, RN primitives) leaves implement the SAME {@link AccountEraseDialogProps}
 * surface, so the two platform renders can never drift on shape or on the phrase/election gate they enforce.
 *
 * Every component here is CONTROLLED and PRESENTATIONAL: it owns no remote state and performs no mutation.
 * The composing app container owns the recipe fetch, the erasure mutation ("Command"), and the ephemeral
 * form state (open flag, typed phrase, the selected-id set), and passes them in as data + callbacks. Account
 * CLOSURE (recoverable) is intentionally NOT a component here — it is a plain confirmation the app renders
 * through `@commise/ui`'s `ConfirmDialog`; only ERASURE needs a bespoke phrase-gated, election-bearing surface.
 */

/** A recipe the donate election may offer — the minimum an owner needs to identify one to keep public. */
export interface DonatableRecipe {
    /** The recipe id sent back in `publishRecipeIds` when elected. */
    readonly id: string;
    /** The recipe's display title (the checkbox's accessible name). */
    readonly title: string;
}

/**
 * Controlled prop contract for the account-ERASURE dialog: an irreversibility warning, the optional
 * per-recipe donate election (owner-only recipes the caller may elect to publish instead of delete), and the
 * confirmation-phrase gate. The confirm action is enabled ONLY when the typed phrase confirms the erasure
 * (the leaf computes this via `confirmsErasurePhrase`, so both platforms gate identically) and no submit is
 * in flight.
 */
export interface AccountEraseDialogProps {
    /** Whether the dialog is shown. When `false` the component renders nothing. */
    readonly open: boolean;
    /** The owner-only recipes offered for donation (already filtered to eligible; may be empty). */
    readonly donatableRecipes: readonly DonatableRecipe[];
    /** Whether the owner's recipes are still loading (show a status, not the election yet). */
    readonly recipesLoading?: boolean;
    /**
     * Whether loading the owner's recipes FAILED. Erasure must still proceed (the election is optional) — the
     * dialog surfaces that nothing will be published rather than blocking the destructive action (B17).
     */
    readonly recipesError?: boolean;
    /** The ids currently elected for donation (a controlled selection the container owns). */
    readonly selectedRecipeIds: readonly string[];
    /** Toggle a recipe's donation election. */
    readonly onToggleRecipe: (recipeId: string) => void;
    /** The confirmation phrase the user has typed so far (controlled). */
    readonly phrase: string;
    /** Report a change to the typed confirmation phrase. */
    readonly onPhraseChange: (value: string) => void;
    /** Whether the erasure request is in flight (disables + marks the confirm action busy). */
    readonly submitting?: boolean;
    /** Whether the last erasure attempt failed, so the dialog never silently stops (B17). */
    readonly submitError?: boolean;
    /** Invoked when the user confirms (only reachable while the phrase gate is satisfied). */
    readonly onConfirm: () => void;
    /** Invoked when the user cancels (including Escape / backdrop dismiss on web). */
    readonly onCancel: () => void;
}
