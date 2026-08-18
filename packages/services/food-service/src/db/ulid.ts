import { isValid, monotonicFactory } from 'ulidx';

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
/**
 * ⛔ MONOTONIC, not the bare `ulid()`. A ULID orders by time to MILLISECOND precision only; within the same
 * millisecond the 80-bit random component is random, so ids minted together sort arbitrarily.
 *
 * That is not cosmetic here. `food_portions` is read `ORDER BY id` to recover INSERTION order, and
 * `normalizePortions` de-duplicates by unit FIRST-WINS — so for portions written in one batch (which is how
 * the USDA pipeline writes them) the arbitrary order decides what a `cup` of that food WEIGHS. Two runs of
 * the same import could disagree, identically for every caller, and the answer is cached at the edge
 * (ADR-0020). It surfaced as a CI failure in `foodNutritionBatch.integration.test.ts`, which passed locally
 * only because the inserts happened to straddle a millisecond boundary.
 *
 * `monotonicFactory` guarantees each id within a millisecond is strictly greater than the last, so
 * `ORDER BY id` IS insertion order.
 */
const nextUlid = monotonicFactory();

export const newFoodId = (): FoodId => nextUlid() as FoodId;

/**
 * Type guard asserting a string is a structurally valid ULID.
 *
 * @param value - The candidate identifier.
 * @returns `true` when `value` is a valid ULID (narrowed to {@link FoodId}).
 */
export const isFoodId = (value: string): value is FoodId => isValid(value);
