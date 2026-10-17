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
 *
 * ADR-0040 — TEST-PRINCIPAL CONTAINMENT is composed in FRONT of the matrix: a contained test principal (a signed
 * test-pool member on an enforcing stage) is denied every `public` request before C-004 is consulted, and its
 * `private` requests fall through to the matrix unchanged. The containment question itself is answered by
 * `evaluateContainment`, never re-derived here. `principalKind` and `containment` are REQUIRED inputs so every call
 * site had to decide what a test principal means to it.
 */
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

import { evaluateContainment, isContained, type ContainmentSubject } from '../../common/containmentPolicy.js';

/** The complete input to a C-004 visibility decision. */
export interface VisibilityPolicyInput extends ContainmentSubject {
    /** The recipe's provenance classification. */
    readonly sourceType: RecipeSourceType;
    /** Whether the acting principal currently holds the premium entitlement. */
    readonly isPremium: boolean;
    /** Whether the recipe carries a substantive (ingredients/steps) edit since import. */
    readonly hasSubstantiveEdit: boolean;
    /** The visibility the caller is requesting the recipe transition to. */
    readonly requested: RecipeVisibility;
}

/**
 * The outcome of a visibility decision: allowed, or denied for one of two reasons a caller must answer differently.
 *
 * - `policy` — C-004 refuses the transition (→ `400 INVALID_VISIBILITY`);
 * - `contained` — ADR-0040 refuses a contained test principal's publish (→ `403 TEST_PRINCIPAL_CONTAINED`).
 *
 * Both carry a human-readable reason, surfaced as the error message.
 */
export type VisibilityDecision =
    | { readonly allowed: true; readonly reason: string }
    | { readonly allowed: false; readonly denial: 'policy' | 'contained'; readonly reason: string };

/** Build an allow decision. Pure. */
function allow(reason: string): VisibilityDecision {
    return { allowed: true, reason };
}

/** Build a C-004 deny decision. Pure. */
function deny(reason: string): VisibilityDecision {
    return { allowed: false, denial: 'policy', reason };
}

/**
 * Evaluate the C-004 visibility policy for a requested transition. Pure — inputs only.
 */
export function evaluateVisibility(input: VisibilityPolicyInput): VisibilityDecision {
    const { sourceType, isPremium, hasSubstantiveEdit, requested } = input;

    if (requested === RecipeVisibility.PUBLIC) {
        const containment = evaluateContainment({
            principalKind: input.principalKind,
            containment: input.containment,
            action: 'publish',
        });

        if (!containment.allowed) {
            return { allowed: false, denial: 'contained', reason: containment.reason };
        }

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
 * public); everything else defaults to `public` — EXCEPT for a contained test principal (ADR-0040), whose clone
 * always defaults to `private`, because a default is a publish nobody asked for. Pure.
 */
export function defaultCloneVisibility(sourceType: RecipeSourceType, cloner: ContainmentSubject): RecipeVisibility {
    if (isContained(cloner)) {
        return RecipeVisibility.PRIVATE;
    }

    return sourceType === RecipeSourceType.IMPORTED_PHYSICAL || sourceType === RecipeSourceType.IMPORTED_PAID
        ? RecipeVisibility.PRIVATE
        : RecipeVisibility.PUBLIC;
}
