/**
 * The one error `FoodLookupsDal.settleFailure` raises: a settle that would move a shared failure's lines onto a food only
 * its author can see.
 *
 * A failure record is shared by every recipe that declared the same phrase, public recipes included, and a published
 * public recipe may hold no private food (ADR-0029 section 4). The settle reads the food from food's own answer to the
 * resolving cook, and the cascade binds a cook's private food only to that cook's own line, so reaching this is a defect
 * in the caller, never a state to render.
 */

/** A settle onto a private food. */
export class PrivateFoodSettleError extends Error {
    /** The binding the lines were to move to. */
    public readonly lookupId: string;

    /** @param lookupId - The private root binding the settle named. */
    public constructor(lookupId: string) {
        super(`binding ${lookupId} is a private food, so a shared failure cannot settle onto it`);
        this.name = 'PrivateFoodSettleError';
        this.lookupId = lookupId;
        Object.setPrototypeOf(this, PrivateFoodSettleError.prototype);
    }
}

/** Type guard for {@link PrivateFoodSettleError}. */
export function isPrivateFoodSettleError(value: unknown): value is PrivateFoodSettleError {
    return value instanceof PrivateFoodSettleError;
}
