/**
 * The ONE reader and writer of the two-column food arc on the resolution memory (curated plan U9; migration 0052):
 * `ingredient_resolution_mappings`, `ingredient_resolution_memos` and `recipe_ingredient_verifications` each name a
 * root (`food_id`) or a variant (`food_variant_id`), exactly one.
 *
 * The arc carries no `kind` column: its kind is READ OFF which column is set, as `food_lookups`' arm is
 * (`foodLookupArm.ts`). That only pays for itself if the reading lives in exactly one place, so every statement that
 * selects the arc parses it here, and every statement that writes one asks {@link arcColumnsOf} for its two values.
 * A `food_id ?? food_variant_id` anywhere else is the drift this module exists to prevent.
 *
 * @pattern Data Mapper — the arc's columns to a `FoodRef` and back, pure
 */
import { FoodRefArcCorruptError } from './foodRefArc.errors.js';
import type { FoodRef } from './foodLookupArm.js';

/** The arc's two columns, as a row carries them. */
export interface FoodRefArcColumns {
    readonly foodId: string | null;
    readonly foodVariantId: string | null;
}

/**
 * Read a row's arc as the one food it names.
 *
 * @param columns - The row's `food_id` and `food_variant_id`.
 * @param row - Which row, for the error: e.g. `mapping 7d3…`.
 * @returns The root or variant ref.
 * @throws {FoodRefArcCorruptError} when the row names neither or both — which no migrated database produces. Pure.
 */
export function foodRefOfArc(columns: FoodRefArcColumns, row: string): FoodRef {
    const { foodId, foodVariantId } = columns;

    if (foodId !== null && foodVariantId === null) {
        return { kind: 'root', id: foodId };
    }

    if (foodId === null && foodVariantId !== null) {
        return { kind: 'variant', id: foodVariantId };
    }

    throw new FoodRefArcCorruptError(row, foodId === null ? 'it names no food' : 'it names a root and a variant');
}

/**
 * The arc's two column values for a ref — the inverse of {@link foodRefOfArc}.
 *
 * @param ref - The food a row names.
 * @returns The value of each column: the ref's id in its own arm, `null` in the other. Pure.
 */
export function arcColumnsOf(ref: FoodRef): FoodRefArcColumns {
    return ref.kind === 'root' ? { foodId: ref.id, foodVariantId: null } : { foodId: null, foodVariantId: ref.id };
}
