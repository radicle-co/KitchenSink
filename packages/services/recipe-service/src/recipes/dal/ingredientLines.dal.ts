/**
 * The recipe LINE's data-access layer: every SQL touch of `ingredients` (migration 0051), the table that
 * replaced `recipe_ingredients`.
 *
 * It is driven BY `RecipesDal`: the aggregate root calls {@link IngredientLinesDal.replaceForRecipe} inside its
 * create/update transaction, so the recipe, its steps and its lines commit atomically. It persists lines whose
 * binding (`food_lookup_id`) was chosen upstream, and it knows nothing about arms, names or food-service: a line
 * carries no name, because the name is derived by following its binding (ADR-0045).
 *
 * @pattern Table Data Gateway, subordinate to the `RecipesDal` aggregate root through its Unit of Work
 * @sideEffect Every method reads and/or writes Postgres via the passed writer/reader handle.
 */
import { asc, eq, inArray } from 'drizzle-orm';

import type { IngredientQuantity, StatedMeasure } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../database/client.js';
import { foodLookups, ingredients, unresolvedFoods, type IngredientRow } from '../../database/schema/index.js';
import { type Writer } from '../../database/unitOfWork.js';
import { unknownIngredient } from '../recipe.error.js';
import { quantityColumns, statedMeasureColumns } from './quantityColumns.js';
import { userNutritionColumns } from './userNutritionColumns.js';

/**
 * A recipe line ready to persist. `quantity` is the domain VALUE OBJECT (the gateway spreads it across the two
 * `numeric` columns).
 */
export interface IngredientLineInput {
    /** The line's binding — a `food_lookups` row id the planner already resolved. */
    foodLookupId: string;
    /** What the source stated — one value, two bounds, or nothing (U8/KTD-6). */
    quantity: IngredientQuantity;
    unit: string;
    displayText?: string;
    /**
     * How THIS recipe prepares the food — `finely chopped`, `at room temperature` (plan U26, migration 0030).
     * Distinct from {@link displayText}, and never part of the line's name.
     */
    preparation?: string;
    /** The section this line belongs to — `For the marinade` (plan U27). Absent means ungrouped. */
    groupLabel?: string;
    /**
     * The raw line the cook's SOURCE stated (U11/U14), when this line was transcribed rather than authored.
     * Absent for an authored line, and that absence is a statement the verification gate reads.
     */
    sourceLine?: string;
    /** The ingredient PHRASE the parse lifted out of {@link sourceLine} — the memo tier's key grain (0041). */
    sourcePhrase?: string;
    /** What the SOURCE printed, when {@link quantity}/{@link unit} are a RESTATEMENT of it (migration 0027). */
    statedMeasure?: StatedMeasure;
    sortOrder: number;
    /** Per-line user-entered nutrition override (FR-007a) — absolute for this line's quantity. */
    userCalories?: number;
    userProteinG?: number;
    userCarbsG?: number;
    userFatG?: number;
}

/** A read-only surface satisfied by both the Drizzle client and a transaction handle. */
type Reader = Pick<RecipeDrizzle, 'select'>;

/**
 * Hold every binding a save names, refusing one that does not exist. Read `FOR KEY SHARE`, the lock the line's
 * foreign key takes, so a binding found here cannot be deleted before the save commits: a rebind's orphan delete
 * waits, then finds the line and keeps the binding.
 *
 * @param writer - The save's transaction.
 * @param lookupIds - The bindings the lines name, in line order.
 * @throws {RecipeDomainError} `UNKNOWN_INGREDIENT` naming the first binding, in line order, that does not exist.
 * @sideEffect One locking read of `food_lookups`.
 */
async function holdBindings(writer: Writer, lookupIds: readonly string[]): Promise<void> {
    const rows = await writer
        .select({ id: foodLookups.id })
        .from(foodLookups)
        .where(inArray(foodLookups.id, [...new Set(lookupIds)]))
        .for('key share');
    const found = new Set(rows.map((row) => row.id));
    const missing = lookupIds.find((id) => !found.has(id));

    if (missing !== undefined) {
        throw unknownIngredient(missing);
    }
}

/**
 * The settle target of each named binding that is a SETTLED failure, read under `FOR SHARE` of the failure record
 * so a settle running now finishes first (plan 002 R13; the other half is `FoodLookupsDal.settleFailure`, which
 * locks the same row `FOR UPDATE`). A binding that is not a failure, or a failure not yet settled, is absent.
 *
 * @param writer - The save's transaction.
 * @param lookupIds - The bindings the lines name.
 * @returns Binding id to settle target.
 * @sideEffect One locking read of `food_lookups` joined to `unresolved_foods`.
 */
async function settledTargetsOf(writer: Writer, lookupIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const rows = await writer
        .select({ lookupId: foodLookups.id, settledLookupId: unresolvedFoods.settledLookupId })
        .from(foodLookups)
        .innerJoin(unresolvedFoods, eq(unresolvedFoods.id, foodLookups.unresolvedFoodId))
        .where(inArray(foodLookups.id, [...new Set(lookupIds)]))
        .for('share', { of: unresolvedFoods });

    return new Map(
        rows.flatMap((row): [string, string][] =>
            row.settledLookupId === null ? [] : [[row.lookupId, row.settledLookupId]],
        ),
    );
}

export class IngredientLinesDal {
    /**
     * Replace a recipe's entire line set: delete every existing line, then insert the new set. Called inside the
     * recipe create/update transaction, so the swap is atomic with the recipe row.
     *
     * @returns The inserted rows.
     * @throws {RecipeDomainError} `UNKNOWN_INGREDIENT` when a line names a binding that does not exist — a save
     *   that raced the binding's delete. Any database error propagates unchanged.
     * @sideEffect Two locking reads, then deletes and inserts `ingredients` rows for `recipeId`.
     */
    public async replaceForRecipe(
        writer: Writer,
        recipeId: string,
        lines: readonly IngredientLineInput[],
    ): Promise<IngredientRow[]> {
        if (lines.length === 0) {
            await writer.delete(ingredients).where(eq(ingredients.recipeId, recipeId));

            return [];
        }

        const lookupIds = lines.map((line) => line.foodLookupId);

        // ⛔ Both locking reads come BEFORE the delete. A settle locks the failure and then moves every line on it,
        // this recipe's included; a delete that ran first would hold those lines while the forwarding read waits on
        // the failure, and each transaction would wait on the other (40P01).
        await holdBindings(writer, lookupIds);

        const forwardTo = await settledTargetsOf(writer, lookupIds);

        await writer.delete(ingredients).where(eq(ingredients.recipeId, recipeId));

        return writer
            .insert(ingredients)
            .values(
                lines.map((line) => ({
                    recipeId,
                    // ⛔ A line naming a failure a settle has answered is stored on the settle's target (plan
                    // 002 R13). The planner forwarded before the transaction; this read is the one that holds,
                    // because it locks the failure against a settle running now.
                    foodLookupId: forwardTo.get(line.foodLookupId) ?? line.foodLookupId,
                    // Both quantity columns come from the ONE adapter (`quantityColumns.ts`).
                    ...quantityColumns(line.quantity),
                    unit: line.unit,
                    displayText: line.displayText ?? null,
                    // `?? null`, never `?? ''`: the columns' CHECKs refuse a blank, and NULL is the ONE
                    // spelling of absent.
                    preparation: line.preparation ?? null,
                    groupLabel: line.groupLabel ?? null,
                    sourceLine: line.sourceLine ?? null,
                    sourcePhrase: line.sourcePhrase ?? null,
                    // All THREE stated columns on every line, `null` included, through the ONE adapter.
                    ...statedMeasureColumns(line.statedMeasure),
                    sortOrder: line.sortOrder,
                    ...userNutritionColumns(line),
                })),
            )
            .returning();
    }

    /**
     * Load the lines for one or more recipes, ordered by recipe then `sortOrder`, so the composed response keeps
     * the author's order.
     *
     * @sideEffect Reads `ingredients`.
     */
    public async loadByRecipeIds(reader: Reader, recipeIds: readonly string[]): Promise<IngredientRow[]> {
        if (recipeIds.length === 0) {
            return [];
        }

        return reader
            .select()
            .from(ingredients)
            .where(inArray(ingredients.recipeId, [...recipeIds]))
            .orderBy(asc(ingredients.recipeId), asc(ingredients.sortOrder));
    }
}
