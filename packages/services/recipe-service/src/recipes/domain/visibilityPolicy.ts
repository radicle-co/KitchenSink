/**
 * T048 — the pure C-004 visibility-policy evaluator.
 *
 * The single source of truth for "may this recipe hold this visibility?", driven ONLY by its inputs
 * (`sourceType`, `isPremium`, `hasSubstantiveEdit`, `requested`) — no DB, no principal, no I/O — so it
 * is trivially testable and reused unchanged by create, update, clone-default, and the set-visibility
 * endpoint.
 *
 * C-004 matrix:
 * - requested `public`:  ALLOW for `user_created` + `imported_public`; DENY for `imported_physical` +
 *   `imported_paid` (both are private-only; `imported_paid` may NEVER be public).
 * - requested `private`:
 *     - `user_created`     → ALLOW iff `isPremium` (free-tier user_created is public-only)
 *     - `imported_public`  → ALLOW iff (`isPremium` AND `hasSubstantiveEdit`); else DENY
 *     - `imported_physical`→ ALLOW (private-only anyway)
 *     - `imported_paid`    → ALLOW (private-only, permanent)
 *
 * Premium lapse: this gates the *transition to* private, never existing state — a currently-private
 * recipe is never force-flipped; a lapsed (free) user simply cannot set NEW recipes to private.
 */
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

/** The complete input to a C-004 visibility decision. */
export interface VisibilityPolicyInput {
    /** The recipe's provenance classification. */
    readonly sourceType: RecipeSourceType;
    /** Whether the acting principal currently holds the premium entitlement. */
    readonly isPremium: boolean;
    /** Whether the recipe carries a substantive (ingredients/steps) edit since import. */
    readonly hasSubstantiveEdit: boolean;
    /** The visibility the caller is requesting the recipe transition to. */
    readonly requested: RecipeVisibility;
}

/** The outcome of a C-004 visibility decision: allowed, with a human-readable reason either way. */
export interface VisibilityDecision {
    readonly allowed: boolean;
    /** Allow- or deny-reason (surfaced as the domain error message on denial). */
    readonly reason: string;
}

/** Build an allow decision. Pure. */
function allow(reason: string): VisibilityDecision {
    return { allowed: true, reason };
}

/** Build a deny decision. Pure. */
function deny(reason: string): VisibilityDecision {
    return { allowed: false, reason };
}

/**
 * Evaluate the C-004 visibility policy for a requested transition. Pure — inputs only.
 */
export function evaluateVisibility(input: VisibilityPolicyInput): VisibilityDecision {
    const { sourceType, isPremium, hasSubstantiveEdit, requested } = input;

    if (requested === RecipeVisibility.PUBLIC) {
        switch (sourceType) {
            case RecipeSourceType.USER_CREATED:
            case RecipeSourceType.IMPORTED_PUBLIC:
                return allow('User-created and imported-public recipes may be public.');
            case RecipeSourceType.IMPORTED_PHYSICAL:
                return deny('An imported physical-book recipe is private-only and may not be made public.');
            case RecipeSourceType.IMPORTED_PAID:
                return deny('An imported paid recipe is private-only and may never be made public.');
        }
    }

    // requested === RecipeVisibility.PRIVATE
    switch (sourceType) {
        case RecipeSourceType.USER_CREATED:
            return isPremium
                ? allow('Premium users may make their own recipes private.')
                : deny('Free-tier user-created recipes are public-only; upgrade to premium to make them private.');
        case RecipeSourceType.IMPORTED_PUBLIC:
            if (!isPremium) {
                return deny('Premium is required to make an imported public recipe private.');
            }

            if (!hasSubstantiveEdit) {
                return deny('An imported public recipe needs a substantive edit before it can be made private.');
            }

            return allow('A substantively-edited imported public recipe may be made private by a premium user.');
        case RecipeSourceType.IMPORTED_PHYSICAL:
        case RecipeSourceType.IMPORTED_PAID:
            return allow('Imported physical-book and paid recipes are private-only.');
    }
}

/**
 * The policy-allowed default visibility for a freshly-cloned recipe, derived from the source's
 * `sourceType`: `imported_physical`/`imported_paid` clones default to `private` (they may not be
 * public); everything else defaults to `public`. Pure.
 */
export function defaultCloneVisibility(sourceType: RecipeSourceType): RecipeVisibility {
    return sourceType === RecipeSourceType.IMPORTED_PHYSICAL || sourceType === RecipeSourceType.IMPORTED_PAID
        ? RecipeVisibility.PRIVATE
        : RecipeVisibility.PUBLIC;
}
