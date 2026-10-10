/**
 * The one error `foodRefOfArc` raises: a resolution-memory row, as handed to the reader, names no food or two.
 *
 * Migration 0052's `num_nonnulls(food_id, food_variant_id) = 1` makes such a row unrepresentable in a migrated
 * database, so this error means a wrong column list in the code that built the row. It is a defect to surface,
 * never a state to render or to resolve around.
 */

/** A row whose two-column food arc does not name exactly one food. */
export class FoodRefArcCorruptError extends Error {
    /** Which row, in words an operator can find it by. */
    public readonly row: string;

    /**
     * @param row - Which row, e.g. `mapping 7d3…` or `memo "tomato paste"`.
     * @param problem - What is wrong with it.
     */
    public constructor(row: string, problem: string) {
        super(`${row} cannot be read as one food: ${problem}`);
        this.name = 'FoodRefArcCorruptError';
        this.row = row;
        Object.setPrototypeOf(this, FoodRefArcCorruptError.prototype);
    }
}

/** Type guard for {@link FoodRefArcCorruptError}. */
export function isFoodRefArcCorruptError(value: unknown): value is FoodRefArcCorruptError {
    return value instanceof FoodRefArcCorruptError;
}
