/**
 * `FoodCategoryDao` (T-108, MOD-016) — the classification dictionary plus the many-to-many
 * food↔category assignment. `upsertCategory` dedups on `UNIQUE(name)`; `assign` is idempotent on
 * `(food_id, category_id)` and carries optional source provenance (the composite same-food FK uses
 * MATCH SIMPLE, so it is skipped when `source_id` is NULL, D-PROVENANCE-FK).
 *
 * @implements FR-028 FR-029 R7
 */
import { and, eq } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { food, foodCategory, foodCategoryAssignment, type FoodCategoryRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import { itemIdOfFood } from './foodItem.dao.js';

/** Input for {@link FoodCategoryDao.assign}. */
export interface AssignCategoryInput {
    /** Internal food id. */
    foodId: string;
    /** Internal category id. */
    categoryId: string;
    /** Optional crosswalk row id supplying the classification. */
    sourceId?: string | null;
}

export class FoodCategoryDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Upsert a category by name (dedups on `UNIQUE(name)`), returning the canonical row.
     *
     * @param name - The category name.
     * @returns The existing or newly created category row.
     * @sideEffect Inserts or updates `food_category`.
     */
    public async upsertCategory(name: string): Promise<FoodCategoryRow> {
        // A shared dictionary (KTD-14): the service inserts a missing entry and holds no UPDATE, so a conflict reads
        // the existing row rather than touching it.
        await this.db
            .insert(foodCategory)
            .values({ id: newFoodId(), name })
            .onConflictDoNothing({ target: foodCategory.name });

        const rows = await this.db.select().from(foodCategory).where(eq(foodCategory.name, name)).limit(1);
        const row = rows[0];

        if (!row) {
            throw new Error('upsertCategory produced no row');
        }

        return row;
    }

    /**
     * Assign a category to a food (idempotent on `(food_id, category_id)`), with optional source
     * provenance.
     *
     * @param input - The assignment attributes.
     * @sideEffect Inserts into `food_category_assignment` (no-op on duplicate).
     */
    public async assign(input: AssignCategoryInput): Promise<void> {
        await this.db
            .insert(foodCategoryAssignment)
            .values({
                itemId: itemIdOfFood(input.foodId),
                categoryId: input.categoryId,
                sourceId: input.sourceId ?? null,
            })
            .onConflictDoNothing({ target: [foodCategoryAssignment.itemId, foodCategoryAssignment.categoryId] });
    }

    /**
     * List the categories assigned to a food.
     *
     * @param foodId - Internal food id.
     * @returns The category rows assigned to the food.
     * @sideEffect Reads `food_category_assignment` joined to `food_category`.
     */
    public async listByFood(foodId: string): Promise<FoodCategoryRow[]> {
        return this.db
            .select({ id: foodCategory.id, name: foodCategory.name })
            .from(foodCategoryAssignment)
            .innerJoin(foodCategory, eq(foodCategoryAssignment.categoryId, foodCategory.id))
            .innerJoin(food, and(eq(food.itemId, foodCategoryAssignment.itemId), eq(food.id, foodId)));
    }
}
