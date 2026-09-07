/**
 * `FoodNutrientsDao` (T-107, MOD-016) — normalized golden nutrient values with per-value provenance.
 * `upsertValue` keeps one golden value per `UNIQUE(food_id, nutrient_id)` (a higher-priority source
 * overwrites the winner and updates `source_id`). Per-value provenance flows through the composite
 * `(food_id, source_id)` same-food FK, so a `source_id` from another food is rejected
 * (D-PROVENANCE-FK); `CHECK (amount >= 0)` (DB-6) rejects a sign/parse error. Amounts are
 * arbitrary-precision `numeric` carried as strings (no float drift, SC-008); default basis per-100g.
 *
 * @implements FR-028 FR-MRG-3 SC-008
 */
import { eq } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { foodNutrients, type FoodNutrientRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';

/** Amount basis (lives on the value row, FR-MRG-3). */
export type NutrientBasis = FoodNutrientRow['basis'];

/** Input for {@link FoodNutrientsDao.upsertValue}. */
export interface UpsertNutrientValueInput {
    /** Internal food id. */
    foodId: string;
    /** Resolved dictionary nutrient id. */
    nutrientId: string;
    /** Arbitrary-precision amount as a string (numeric; `CHECK (amount >= 0)`). */
    amount: string;
    /** Amount basis; defaults to `per_100g`. */
    basis?: NutrientBasis;
    /** Crosswalk row id supplying this value (must belong to the SAME food). */
    sourceId: string;
}

export class FoodNutrientsDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Upsert the golden nutrient value for a `(food_id, nutrient_id)` (FR-MRG-3). A second value
     * overwrites the amount/basis and records the new winning `source_id`. The composite same-food FK
     * and `CHECK (amount >= 0)` are enforced by the database (D-PROVENANCE-FK / DB-6) — a cross-food
     * `source_id` or a negative amount rejects.
     *
     * @param input - The value attributes.
     * @returns The upserted value row.
     * @sideEffect Inserts or updates `food_nutrients`.
     */
    public async upsertValue(input: UpsertNutrientValueInput): Promise<FoodNutrientRow> {
        const rows = await this.db
            .insert(foodNutrients)
            .values({
                id: newFoodId(),
                foodId: input.foodId,
                nutrientId: input.nutrientId,
                amount: input.amount,
                basis: input.basis ?? 'per_100g',
                sourceId: input.sourceId,
            })
            .onConflictDoUpdate({
                target: [foodNutrients.foodId, foodNutrients.nutrientId],
                set: { amount: input.amount, basis: input.basis ?? 'per_100g', sourceId: input.sourceId },
            })
            .returning();

        const row = rows[0];

        if (!row) {
            throw new Error('upsertValue produced no row');
        }

        return row;
    }

    /**
     * List the golden nutrient values for a food.
     *
     * @param foodId - Internal food id.
     * @returns The value rows (one per nutrient).
     * @sideEffect Reads `food_nutrients`.
     */
    public async listByFood(foodId: string): Promise<FoodNutrientRow[]> {
        return this.db.select().from(foodNutrients).where(eq(foodNutrients.foodId, foodId));
    }
}
