/**
 * THE ONE MAPPING between a line's user-entered nutrition (FR-007a) and the four `numeric` columns that store it.
 *
 * DESIGN PATTERN: Adapter — a pure, two-way translation across the persistence boundary, the sibling of
 * `quantityColumns.ts`. `pg` hands a `numeric` back as a string, so every reader converts; and a figure the line
 * does not state stays absent in both directions, because `Number(null)` is `0` and a line would claim zero calories.
 */

/** The four user-nutrition columns of an `ingredients` (recipe line) row, as drizzle spells them. */
export interface UserNutritionColumns {
    readonly userCalories: string | null;
    readonly userProteinG: string | null;
    readonly userCarbsG: string | null;
    readonly userFatG: string | null;
}

/** The user-entered nutrition a line states, absolute for its quantity. A figure it does not state is absent. */
export interface UserNutrition {
    readonly userCalories?: number;
    readonly userProteinG?: number;
    readonly userCarbsG?: number;
    readonly userFatG?: number;
}

/**
 * Read a row's user-nutrition columns. Pure.
 *
 * @param columns - The row's four values as `pg` surfaces them (strings or `null`).
 * @returns Each stated figure as a number, with an unstated one omitted.
 */
export function userNutritionFromColumns(columns: UserNutritionColumns): UserNutrition {
    return {
        ...(columns.userCalories !== null ? { userCalories: Number(columns.userCalories) } : {}),
        ...(columns.userProteinG !== null ? { userProteinG: Number(columns.userProteinG) } : {}),
        ...(columns.userCarbsG !== null ? { userCarbsG: Number(columns.userCarbsG) } : {}),
        ...(columns.userFatG !== null ? { userFatG: Number(columns.userFatG) } : {}),
    };
}

/**
 * Spread a line's user-entered nutrition across its four columns. Pure.
 *
 * @param nutrition - The figures the line states.
 * @returns The column values to write, `null` for each figure the line does not state.
 */
export function userNutritionColumns(nutrition: UserNutrition): UserNutritionColumns {
    return {
        userCalories: nutrition.userCalories?.toString() ?? null,
        userProteinG: nutrition.userProteinG?.toString() ?? null,
        userCarbsG: nutrition.userCarbsG?.toString() ?? null,
        userFatG: nutrition.userFatG?.toString() ?? null,
    };
}
