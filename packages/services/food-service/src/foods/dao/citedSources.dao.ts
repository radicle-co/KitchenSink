/**
 * `CitedSourcesDao` — which datasets a stored nutrition value cites, for the Data sources page (plan R55).
 *
 * A dataset counts only through a citation that some `food_nutrition_value` row actually cites, because the owner's
 * rule is "the sources a stored value cites" (2026-10-01): a citation no value uses credits nothing. The conversion
 * flag follows the same rule, so an R54 conversion recorded on an unused citation does not mark its source converted.
 * Mapping a dataset to its source is the domain's job (`../domain/citedSources.ts`), not this query's.
 *
 * The read is caller-independent: an authored food's values cite nothing (ADR-0029), so no row here belongs to a
 * caller. It scans the citation table once and probes the value table by its primary key's leading column; the
 * catalog holds a few thousand citations, and the result has at most one row per dataset.
 *
 * @pattern Repository — the read side of `food_nutrition_citation`, grouped by dataset
 */
import { and, eq, exists, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { foodNutritionCitation, foodNutritionValue } from '../../db/schema/foodNutrition.js';
import type { CitedDataset } from '../domain/citedSources.js';

export class CitedSourcesDao {
    /** @param db - The food-schema Drizzle client. */
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Each dataset a stored value cites, once, with whether any citation of it that a value cites recorded an R54
     * conversion (a density, or energy from kJ). Unordered.
     *
     * @returns One row per cited dataset; empty when nothing is cited.
     * @sideEffect Reads `food_nutrition_citation` and `food_nutrition_value`.
     */
    public async listCitedDatasets(): Promise<CitedDataset[]> {
        const citedByAValue = this.db
            .select({ one: sql`1` })
            .from(foodNutritionValue)
            .where(
                and(
                    eq(foodNutritionValue.nutritionId, foodNutritionCitation.nutritionId),
                    eq(foodNutritionValue.citationId, foodNutritionCitation.id),
                ),
            );

        return this.db
            .select({
                dataset: foodNutritionCitation.dataset,
                converted: sql<boolean>`bool_or(${foodNutritionCitation.densityGPerMl} IS NOT NULL OR ${foodNutritionCitation.kcalFromKj})`,
            })
            .from(foodNutritionCitation)
            .where(exists(citedByAValue))
            .groupBy(foodNutritionCitation.dataset);
    }
}
