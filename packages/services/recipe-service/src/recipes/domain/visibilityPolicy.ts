/**
 * T048 — the pure C-004 visibility-policy evaluator.
 *
 * The single source of truth for "may this recipe hold this visibility?", driven ONLY by its inputs
 * (`sourceType`, `isPremium`, `hasSubstantiveEdit`, `hasAvailablePrivateSlot`, `requested`) — no DB, no principal,
 * no I/O — so it is trivially testable and reused unchanged by create, update, clone-default, and the set-visibility
 * endpoint.
 *
 * C-004 matrix (amended 2026-10-26 by ADR-0073):
 * - requested `public`:  ALLOW for `user_created` + `imported_public`; DENY for `imported_physical` +
 *   `imported_paid` (both are private-only; `imported_paid` may NEVER be public).
 * - requested `private`:
 *     - `user_created`     → ALLOW iff `isPremium` OR `hasAvailablePrivateSlot`
 *     - `imported_public`  → ALLOW iff (`isPremium` AND `hasSubstantiveEdit`); else DENY. Slots never apply.
 *     - `imported_physical`→ ALLOW iff `isPremium` OR `hasAvailablePrivateSlot`
 *     - `imported_paid`    → ALLOW iff `isPremium` OR `hasAvailablePrivateSlot`
 *
 * `hasAvailablePrivateSlot` is REQUIRED so that every call site is a compile error until it decides what the fact is
 * (with a default, a site could keep the old behaviour and nobody would notice). The fact is only trustworthy when
 * the CALLER resolved it under the per-user lock, in the same transaction as the write (`privateSlots.dal.ts`); this
 * module cannot tell, which is why it is documented here and enforced by the service. A caller for which no slot can
 * matter (a public request, Premium, `imported_public`) passes `true`: no slot is needed, so none is lacking.
 *
 * Premium lapse: this gates the *transition to* private, never existing state — a currently-private
 * recipe is never force-flipped; a lapsed (free) user simply cannot set NEW recipes to private until they are
 * back under the limit (ADR-0073 section 4).
 *
 * ADR-0040 — TEST-PRINCIPAL CONTAINMENT is composed in FRONT of the matrix: a contained test principal (a signed
 * test-pool member on an enforcing stage) is denied every `public` request before C-004 is consulted, and its
 * `private` requests fall through to the matrix unchanged. The containment question itself is answered by
 * `evaluateContainment`, never re-derived here. `principalKind` and `containment` are REQUIRED inputs so every call
 * site had to decide what a test principal means to it.
 */
import { RecipeSourceType, RecipeVisibility, privateRuleOf } from '@kitchensink/recipe-core';

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
    /**
     * Whether the cook may hold one more private recipe: their live private count, read under the per-user lock in the
     * write's own transaction, is below their limit (ADR-0073). REQUIRED, never defaulted. Consulted only where a slot
     * can matter (a free cook's `user_created`/`imported_physical`/`imported_paid` request for private); `true` where
     * none is needed.
     */
    readonly hasAvailablePrivateSlot: boolean;
}

/**
 * The outcome of a visibility decision: allowed, or denied for one of three reasons a caller must answer differently.
 *
 * - `policy` — C-004 refuses the transition (→ `400 INVALID_VISIBILITY`);
 * - `contained` — ADR-0040 refuses a contained test principal's publish (→ `403 TEST_PRINCIPAL_CONTAINED`);
 * - `privateSlots` — ADR-0073: a free cook has no private slot left (→ `403 PRIVATE_SLOTS_FULL`, with `used` and
 *   `limit`, which the caller holds and this pure module does not).
 *
 * All carry a human-readable reason, surfaced as the error message.
 */
export type VisibilityDecision =
    | { readonly allowed: true; readonly reason: string }
    | { readonly allowed: false; readonly denial: 'policy' | 'contained' | 'privateSlots'; readonly reason: string };

/** Build an allow decision. Pure. */
function allow(reason: string): VisibilityDecision {
    return { allowed: true, reason };
}

/** Build a C-004 deny decision. Pure. */
function deny(reason: string): VisibilityDecision {
    return { allowed: false, denial: 'policy', reason };
}

/** Build a slot-exhaustion deny decision (ADR-0073). Pure. */
function denyNoSlot(reason: string): VisibilityDecision {
    return { allowed: false, denial: 'privateSlots', reason };
}

/**
 * Evaluate the C-004 visibility policy for a requested transition. Pure — inputs only.
 */
export function evaluateVisibility(input: VisibilityPolicyInput): VisibilityDecision {
    const { sourceType, isPremium, hasSubstantiveEdit, hasAvailablePrivateSlot, requested } = input;

    if (requested === RecipeVisibility.PUBLIC) {
        const containment = evaluateContainment({
            principalKind: input.principalKind,
            containment: input.containment,
            action: 'publish',
        });

        if (!containment.allowed) {
            return { allowed: false, denial: 'contained', reason: containment.reason };
        }

        if (privateRuleOf(sourceType) !== 'privateOnly') {
            return allow('User-created and imported-public recipes may be public.');
        }

        return deny(
            sourceType === RecipeSourceType.IMPORTED_PAID
                ? 'An imported paid recipe is private-only and may never be made public.'
                : 'An imported physical-book recipe is private-only and may not be made public.',
        );
    }

    // requested === RecipeVisibility.PRIVATE
    switch (privateRuleOf(sourceType)) {
        case 'slots':
            if (isPremium) {
                return allow('Premium users may make their own recipes private.');
            }

            return hasAvailablePrivateSlot
                ? allow('A free-tier user may keep their own recipe private in a free private slot.')
                : denyNoSlot('All of your private slots are in use.');
        case 'premium':
            if (!isPremium) {
                return deny('Premium is required to make an imported public recipe private.');
            }

            if (!hasSubstantiveEdit) {
                return deny('An imported public recipe needs a substantive edit before it can be made private.');
            }

            return allow('A substantively-edited imported public recipe may be made private by a premium user.');
        case 'privateOnly':
            // Private-only labels (they can never be public), and since ADR-0073 they use a slot like any other
            // private recipe: Premium is no longer needed, and a free cook with no slot cannot keep a new one.
            if (isPremium) {
                return allow('Premium users may keep imported physical-book and paid recipes private.');
            }

            return hasAvailablePrivateSlot
                ? allow('A free-tier user may keep an imported physical-book or paid recipe private in a free slot.')
                : denyNoSlot('All of your private slots are in use.');
    }
}

/**
 * The policy-allowed default visibility for a freshly-cloned recipe, derived from the source's
 * `sourceType` and visibility: a clone of a PRIVATE source is `private` (FR-005c: only its owner can clone it, and the
 * copy stays as private as the original); `imported_physical`/`imported_paid` clones default to `private` (they may
 * not be public); everything else defaults to `public` — EXCEPT for a contained test principal (ADR-0040), whose clone
 * always defaults to `private`, because a default is a publish nobody asked for. Pure.
 *
 * ⛔ A clone that lands `private` is a move to private like any other (ADR-0073 section 3): the caller takes the
 * per-user lock and the slot check before writing it. This function only says what the default IS.
 */
export function defaultCloneVisibility(
    sourceType: RecipeSourceType,
    cloner: ContainmentSubject,
    sourceVisibility: RecipeVisibility,
): RecipeVisibility {
    if (isContained(cloner) || sourceVisibility === RecipeVisibility.PRIVATE) {
        return RecipeVisibility.PRIVATE;
    }

    return privateRuleOf(sourceType) === 'privateOnly' ? RecipeVisibility.PRIVATE : RecipeVisibility.PUBLIC;
}
