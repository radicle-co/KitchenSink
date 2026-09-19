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

import type { IngredientQuantity, StatedMeasure } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipeIngredients, type RecipeIngredientRow } from '../../database/schema/index.js';
import { type Writer } from '../../database/unitOfWork.js';
import { quantityColumns, statedMeasureColumns } from './quantityColumns.js';

/**
 * A recipe ingredient line resolved to a catalog ingredient, ready to persist. `quantity` is the domain
 * VALUE OBJECT here (the DAL spreads it across the two `numeric` columns); `ingredientName`/`isUserEntered`
 * are the denormalized catalog identity so reads need no JOIN.
 */
export interface ResolvedIngredientLine {
    ingredientId: string;
    ingredientName: string;
    /** What the source stated — one value, two bounds, or nothing (U8/KTD-6). */
    quantity: IngredientQuantity;
    unit: string;
    displayText?: string;
    /**
     * How THIS recipe prepares the food — `finely chopped`, `at room temperature` (plan U26, migration 0030).
     *
     * ⛔ Distinct from {@link displayText}, which is a display OVERRIDE whose one producer (the cookbook
     * importer) fills it with the source's whole clause, and never part of {@link ingredientName}, which is
     * what a `food_id` resolves to in the catalog.
     */
    preparation?: string;
    /**
     * The section this line belongs to — `For the marinade`, `Dry` (plan U27, migration 0030).
     *
     * Absent means ungrouped, which is most lines. Free text by owner ruling (2026-08-24), never an enum.
     */
    groupLabel?: string;
    /**
     * The raw line the cook's SOURCE stated (U11/U14), when this line was transcribed rather than authored.
     *
     * Absent for an authored line, and that absence is a STATEMENT — `decideVerification` reads it as
     * `skip: 'no-source-text'`, not as missing data.
     */
    sourceLine?: string;
    /**
     * The ingredient PHRASE the parse lifted out of {@link sourceLine} — the memo tier's key grain
     * (migration 0041, owner ruling 2026-08-31). Absent for an authored line and for every line created
     * before the field existed.
     */
    sourcePhrase?: string;
    /**
     * What the SOURCE printed, when {@link quantity}/{@link unit} are a RESTATEMENT of it (migration 0027).
     *
     * Absent for the ordinary line, whose quantity and unit ARE what the source said. Its PRESENCE is the
     * disclosure that a historical measure was converted — `one gill` persisted as `0.5 cup` — and it is what
     * U11's gate asks the model about, since the restated number is one the source never printed.
     */
    statedMeasure?: StatedMeasure;
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
                    // Both quantity columns come from the ONE adapter — see `quantityColumns.ts` for why
                    // this is not `line.quantity.toString()` spelled inline.
                    ...quantityColumns(line.quantity),
                    unit: line.unit,
                    displayText: line.displayText ?? null,
                    // U26/U27 — `?? null` and never `?? ''`: the column's CHECK refuses a blank, so a bare
                    // fallback to the empty string would fail the INSERT for every line stating neither —
                    // which is most of them — and `NULL` is the ONE spelling of absent.
                    preparation: line.preparation ?? null,
                    groupLabel: line.groupLabel ?? null,
                    sourceLine: line.sourceLine ?? null,
                    sourcePhrase: line.sourcePhrase ?? null,
                    // U7/U11 — all THREE stated columns on every line, `null` included. A partial write would
                    // leave a previous line's `stated_unit` attached to an amount nobody restated; the ONE
                    // adapter is what makes that unspellable here (see `quantityColumns.ts`).
                    ...statedMeasureColumns(line.statedMeasure),
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
