/**
 * `FoodPortionsDao` (T-108, MOD-016) — household measures / serving sizes with per-value provenance.
 * `gram_weight` is arbitrary-precision `numeric` carried as a string; `CHECK (gram_weight > 0)`
 * (DB-6) keeps a portion weight strictly positive, and the composite `(food_id, source_id)` same-food
 * FK rejects a cross-food `source_id` (D-PROVENANCE-FK).
 *
 * @implements FR-028 FR-029 R7
 */
import { eq } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { foodPortions, type FoodPortionRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';

/** Input for {@link FoodPortionsDao.insertPortion}. */
export interface InsertPortionInput {
    /** Internal food id. */
    foodId: string;
    /** Human label (e.g. `1 cup`). */
    label: string;
    /** Gram weight as a string (numeric; `CHECK (gram_weight > 0)`). */
    gramWeight: string;
    /** Crosswalk row id supplying this portion (must belong to the SAME food). */
    sourceId: string;
}

export class FoodPortionsDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Insert a household-measure portion. The DB enforces `CHECK (gram_weight > 0)` (DB-6) and the
     * composite same-food provenance FK — a non-positive weight or cross-food `source_id` rejects.
     *
     * @param input - The portion attributes.
     * @returns The inserted portion row.
     * @sideEffect Inserts into `food_portions`.
     */
    public async insertPortion(input: InsertPortionInput): Promise<FoodPortionRow> {
        const rows = await this.db
            .insert(foodPortions)
            .values({
                id: newFoodId(),
                foodId: input.foodId,
                label: input.label,
                gramWeight: input.gramWeight,
                sourceId: input.sourceId,
            })
            .returning();

        const row = rows[0];

        if (!row) {
            throw new Error('insertPortion produced no row');
        }

        return row;
    }

    /**
     * List the portions for a food.
     *
     * @param foodId - Internal food id.
     * @returns The portion rows.
     * @sideEffect Reads `food_portions`.
     */
    public async listByFood(foodId: string): Promise<FoodPortionRow[]> {
        return this.db.select().from(foodPortions).where(eq(foodPortions.foodId, foodId));
    }
}
