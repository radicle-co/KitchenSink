import { isValid, ulid } from 'ulidx';

/**
 * Branded ULID for every canonical food-domain surrogate key (`food.id`, `food_sources.id`,
 * `nutrient.id`, `food_nutrients.id`, `food_portions.id`, `food_category.id`, `food_candidates.id`).
 *
 * A food's identity is ALWAYS this internal ULID, NEVER a source-native key (R1/FR-IDN-1). Mirrors
 * the identity service's `UserId`/`newUserId` (`packages/services/identity/src/database/ulid.ts`).
 */
export type FoodId = string & { __brand: 'FoodId' };

/**
 * Mint a fresh lexicographically-sortable ULID for a food-domain row.
 *
 * @returns A new branded {@link FoodId}.
 * @sideEffect Reads the current time and a CSPRNG via `ulidx` (non-deterministic).
 */
export const newFoodId = (): FoodId => ulid() as FoodId;

/**
 * Type guard asserting a string is a structurally valid ULID.
 *
 * @param value - The candidate identifier.
 * @returns `true` when `value` is a valid ULID (narrowed to {@link FoodId}).
 */
export const isFoodId = (value: string): value is FoodId => isValid(value);
