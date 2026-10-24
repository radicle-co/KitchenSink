/**
 * The one error `foodLookupArmOf` raises: a `food_lookups` row, as handed to the reader, does not name
 * exactly one arm, or names a vocabulary member the schema refuses.
 *
 * A migrated database cannot produce such a row (`food_lookups_one_arm`, the generated `status`, the tier
 * CHECK), so this error means a wrong join or a wrong column list in the code that built the row. It is a
 * defect to surface, never a state to render.
 */

/** A `food_lookups` row that cannot be read as exactly one arm. */
export class FoodLookupArmCorruptError extends Error {
    /** The lookup row's id, so an operator can find it. */
    public readonly lookupId: string;

    /**
     * @param lookupId - The lookup row's id.
     * @param problem - What is wrong with it, in words an operator can act on.
     */
    public constructor(lookupId: string, problem: string) {
        super(`food_lookups row ${lookupId} cannot be read: ${problem}`);
        this.name = 'FoodLookupArmCorruptError';
        this.lookupId = lookupId;
        Object.setPrototypeOf(this, FoodLookupArmCorruptError.prototype);
    }
}

/** Type guard for {@link FoodLookupArmCorruptError}. */
export function isFoodLookupArmCorruptError(value: unknown): value is FoodLookupArmCorruptError {
    return value instanceof FoodLookupArmCorruptError;
}
