/**
 * T043b — the `recipe_ingredients` junction data-access layer.
 *
 * Owns every SQL touch of the `recipe_ingredients` link table (defined in
 * `database/schema/ingredients.ts`). It is deliberately separate from `RecipesDal` (which owns the
 * golden `recipes` row + `recipe_steps`) but is driven BY it: `RecipesDal` calls `replaceForRecipe`
 * inside its create/update transaction so the recipe, its steps, and its ingredient links commit
 * atomically. Resolution of a line to a catalog ingredient (food-backed or freeform) happens upstream in
 * `RecipesService` via the ingredients vertical; this DAL persists already-resolved link rows.
 *
 * @sideEffect Every method reads and/or writes Postgres via the passed writer/reader handle.
 */
import { asc, eq, inArray } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipeIngredients, type RecipeIngredientRow } from '../../database/schema/index.js';
import { type Writer } from '../../database/unitOfWork.js';

/**
 * A recipe ingredient line resolved to a catalog ingredient, ready to persist. `quantity` is a real
 * number here (the DAL serializes it to the `numeric` column); `ingredientName`/`isUserEntered` are the
 * denormalized catalog identity so reads need no JOIN.
 */
export interface ResolvedIngredientLine {
    ingredientId: string;
    ingredientName: string;
    quantity: number;
    unit: string;
    displayText?: string;
    sortOrder: number;
    isUserEntered: boolean;
    /** Per-line user-entered nutrition override (FR-007a) — absolute for this line's quantity. */
    userCalories?: number;
    userProteinG?: number;
    userCarbsG?: number;
    userFatG?: number;
}

/** A read-only surface satisfied by both the Drizzle client and a transaction handle. */
type Reader = Pick<RecipeDrizzle, 'select'>;

export class RecipeIngredientsDal {
    /**
     * Replace a recipe's entire ingredient link set: delete every existing row, then insert the new set
     * (assigning nothing — the caller has already set `sortOrder`). Called inside the recipe
     * create/update transaction so the swap is atomic with the recipe row.
     *
     * @returns The inserted rows, ordered by `sortOrder`.
     * @sideEffect Deletes then inserts `recipe_ingredients` rows for `recipeId`.
     */
    public async replaceForRecipe(
        writer: Writer,
        recipeId: string,
        lines: ResolvedIngredientLine[],
    ): Promise<RecipeIngredientRow[]> {
        await writer.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));

        if (lines.length === 0) {
            return [];
        }

        return writer
            .insert(recipeIngredients)
            .values(
                lines.map((line) => ({
                    recipeId,
                    ingredientId: line.ingredientId,
                    ingredientName: line.ingredientName,
                    quantity: line.quantity.toString(),
                    unit: line.unit,
                    displayText: line.displayText ?? null,
                    sortOrder: line.sortOrder,
                    isUserEntered: line.isUserEntered,
                    // Numeric columns take a string; null when the client supplied no per-line override.
                    userCalories: line.userCalories !== undefined ? line.userCalories.toString() : null,
                    userProteinG: line.userProteinG !== undefined ? line.userProteinG.toString() : null,
                    userCarbsG: line.userCarbsG !== undefined ? line.userCarbsG.toString() : null,
                    userFatG: line.userFatG !== undefined ? line.userFatG.toString() : null,
                })),
            )
            .returning();
    }

    /**
     * Load the ingredient link rows for one or more recipes, ordered by recipe then `sortOrder` so the
     * composed response preserves the author's ordering.
     *
     * @sideEffect Reads `recipe_ingredients`.
     */
    public async loadByRecipeIds(reader: Reader, recipeIds: string[]): Promise<RecipeIngredientRow[]> {
        if (recipeIds.length === 0) {
            return [];
        }

        return reader
            .select()
            .from(recipeIngredients)
            .where(inArray(recipeIngredients.recipeId, recipeIds))
            .orderBy(asc(recipeIngredients.recipeId), asc(recipeIngredients.sortOrder));
    }
}
