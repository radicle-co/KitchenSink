/**
 * The pure food-authorship policy (plan U10, D8/D9a — the fourth ADR-0023-shape policy module, and the
 * FOOD service's first).
 *
 * DESIGN PATTERN: **Specification / Policy module**, the shape `evaluateVisibility`, `evaluateProvenance`
 * and `householdPolicy`'s siblings established in recipe-service: ONE question — "may this caller take
 * this action on this food?" — answered from the inputs alone. No DB, no `Principal` object, no I/O, so
 * the whole decision is a table the suite pins.
 *
 * ## The three asymmetries that ARE the policy
 *
 *  1. **Private conceals existence.** A stranger touching a PRIVATE food gets `not-found` for EVERY
 *     action — read included. A 403 would confirm another user's private record exists, which is the
 *     information the visibility ruling (Q3c) says they must not have. The recipe service draws the same
 *     line for un-rateable recipes ("a 403 there would confirm the recipe exists").
 *  2. **Promoted is public knowledge, authored writes are not.** A promoted food reads for everyone —
 *     promotion (U12) is exactly the decision to publish it — but edit/delete stay the author's:
 *     a stranger's write answers `forbidden` (403), because existence is no longer a secret and the
 *     honest refusal names the reason.
 *  3. **Pipeline foods are editable by nobody.** A catalog row (no author) answers `not-editable` on
 *     edit/delete for EVERY caller, the author of other foods included — T150/D8's single-writer ruling:
 *     the USDA merge engine owns catalog rows, and hand edits would be clobbered by the next refresh
 *     anyway. This is a 409 at the wire, not a 403: the refusal is about the RESOURCE's nature, not the
 *     caller's identity.
 *
 * ## ⛔ Authorization FIRST, always
 *
 * `FoodsService` MUST evaluate this policy before any reference check, version write, or cross-service
 * call — the plan's own scenario: "the 409's reference list must never leak to a non-author". A policy
 * verdict other than `allowed` ends the request; nothing downstream may observe the food on the caller's
 * behalf.
 */

/** What the policy needs to know about the food — the two 0013 columns, nothing else. */
export interface AuthorshipFoodFacts {
    /** The author's app-user ULID, or `null` for a catalog (pipeline-owned) row. */
    readonly userId: string | null;
    /** The 0013 visibility state ('public' is catalog-only; the CHECK guarantees coherence). */
    readonly visibility: 'public' | 'private' | 'promoted';
}

/** The complete input to an authorship decision. */
export interface AuthorshipPolicyInput {
    /** The authenticated caller's app-user ULID. */
    readonly callerId: string;
    /** The food's authorship facts. */
    readonly food: AuthorshipFoodFacts;
    /** What the caller is trying to do. */
    readonly action: 'read' | 'edit' | 'delete';
}

/** The verdict. The service maps: not-found → 404, forbidden → 403, not-editable → 409. */
export type AuthorshipVerdict =
    | { readonly kind: 'allowed' }
    | { readonly kind: 'not-found' }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'not-editable' };

/**
 * Decide whether this caller may take this action on this food. Pure and total — see the module
 * docstring for the three asymmetries.
 *
 * @param input - Caller, food facts, and action.
 * @returns The verdict the service translates to HTTP.
 */
export function evaluateAuthorship(input: AuthorshipPolicyInput): AuthorshipVerdict {
    const { callerId, food, action } = input;

    if (food.userId === null) {
        if (action === 'read') {
            return { kind: 'allowed' };
        }

        return { kind: 'not-editable' };
    }

    if (food.userId === callerId) {
        return { kind: 'allowed' };
    }

    if (food.visibility === 'private') {
        return { kind: 'not-found' };
    }

    if (action === 'read') {
        return { kind: 'allowed' };
    }

    return { kind: 'forbidden' };
}
