/**
 * The live path's access to a root's nutrition aggregate (curated catalog plan U4, KTD-19): one header per root,
 * one citation per cited source item, one value per nutrient.
 *
 * A live food blends several USDA items, so its header cites each contributing item, and each value cites the
 * item that supplied it. An authored food's values cite nothing, because its author wrote them (ADR-0029). The seed
 * writes its own aggregates through its own applier; this gateway is the service's only writer of the aggregate.
 *
 * @pattern Table Data Gateway — the nutrition aggregate, reached only through its header
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { FoodWriter } from '../../database/unitOfWork.js';
import { foodNutrition, foodNutritionCitation, foodNutritionValue } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import type { CitationDataset } from '../seed/citationDatasets.js';

/** The basis a value is stored on. */
type NutrientBasis = (typeof foodNutritionValue.$inferSelect)['basis'];

/** A value row for insert. */
type NewFoodNutritionValueRow = typeof foodNutritionValue.$inferInsert;

/** A source item a value can cite. A live food's items always match exactly: the values are the item's own. */
export interface SourceItemCitation {
    readonly dataset: CitationDataset;
    readonly externalKey: string;
}

/** Input for {@link FoodNutritionDao.upsertValue}. */
export interface UpsertNutritionValueInput {
    readonly nutritionId: string;
    readonly nutrientId: string;
    /** Arbitrary-precision amount as a string (SC-008). */
    readonly amount: string;
    readonly basis?: NutrientBasis;
    readonly citationId: string;
}

/** One value an author states (ADR-0029): uncited, per 100 g (Q3a). */
export interface AuthoredNutritionValue {
    readonly nutrientId: string;
    /** Arbitrary-precision amount as a string (SC-008). */
    readonly amount: string;
}

/** One stored value, read back. */
export interface StoredNutritionValue {
    readonly nutrientId: string;
    readonly amount: string | null;
    readonly trace: boolean;
    readonly basis: NutrientBasis;
    readonly citationId: string | null;
}

export class FoodNutritionDao {
    public constructor(private readonly db: FoodWriter) {}

    /**
     * The root's header, created when absent. The root arm's partial unique index arbitrates a concurrent create.
     *
     * @param foodId - The root.
     * @returns The header's id.
     * @sideEffect May insert one `food_nutrition` row.
     */
    public async headerForFood(foodId: string): Promise<string> {
        await this.db
            .insert(foodNutrition)
            .values({ id: newFoodId(), foodId })
            .onConflictDoNothing({ target: foodNutrition.foodId, where: sql`${foodNutrition.foodId} IS NOT NULL` });

        const rows = await this.db
            .select({ id: foodNutrition.id })
            .from(foodNutrition)
            .where(eq(foodNutrition.foodId, foodId))
            .limit(1);
        const id = rows[0]?.id;

        if (id === undefined) {
            throw new Error(`food ${foodId} has no nutrition header after its create`);
        }

        return id;
    }

    /**
     * The header's citation of one source item, created when absent. The `(nutrition_id, dataset, external_key)`
     * partial unique index arbitrates a concurrent cite, so a racing writer reads the winner's row back.
     *
     * @param nutritionId - The header.
     * @param item - The cited dataset and key.
     * @returns The citation's id.
     * @sideEffect May insert one `food_nutrition_citation` row.
     */
    public async citeSourceItem(nutritionId: string, item: SourceItemCitation): Promise<string> {
        await this.db
            .insert(foodNutritionCitation)
            .values({
                id: newFoodId(),
                nutritionId,
                dataset: item.dataset,
                externalKey: item.externalKey,
                match: 'exact',
            })
            .onConflictDoNothing({
                target: [
                    foodNutritionCitation.nutritionId,
                    foodNutritionCitation.dataset,
                    foodNutritionCitation.externalKey,
                ],
                where: sql`${foodNutritionCitation.externalKey} IS NOT NULL`,
            });

        const id = await this.findCitation(nutritionId, item);

        if (id === undefined) {
            throw new Error(
                `header ${nutritionId} has no citation of ${item.dataset} ${item.externalKey} after its create`,
            );
        }

        return id;
    }

    /**
     * Write one value, replacing the header's value for that nutrient (the merge's golden winner).
     *
     * @param input - The header, nutrient, amount and citation.
     * @sideEffect Inserts or updates one `food_nutrition_value` row.
     */
    public async upsertValue(input: UpsertNutritionValueInput): Promise<void> {
        const basis = input.basis ?? 'per_100g';

        await this.db
            .insert(foodNutritionValue)
            .values({
                nutritionId: input.nutritionId,
                nutrientId: input.nutrientId,
                amount: input.amount,
                trace: false,
                basis,
                citationId: input.citationId,
            })
            .onConflictDoUpdate({
                target: [foodNutritionValue.nutritionId, foodNutritionValue.nutrientId],
                set: { amount: input.amount, trace: false, basis, citationId: input.citationId },
            });
    }

    /**
     * Replace an authored root's uncited values wholesale (PUT semantics). The "uncited means authored" trigger
     * refuses them under any other food, so this gateway cannot be used to write an uncited value onto a live or
     * seeded root.
     *
     * @param foodId - The authored root.
     * @param values - Its values, one per nutrient.
     * @sideEffect May insert the root's header; deletes its uncited values and inserts `values`.
     */
    public async replaceAuthoredValues(foodId: string, values: readonly AuthoredNutritionValue[]): Promise<void> {
        const nutritionId = await this.headerForFood(foodId);

        await this.db
            .delete(foodNutritionValue)
            .where(and(eq(foodNutritionValue.nutritionId, nutritionId), isNull(foodNutritionValue.citationId)));

        if (values.length === 0) {
            return;
        }

        await this.db.insert(foodNutritionValue).values(
            values.map((value): NewFoodNutritionValueRow => ({
                nutritionId,
                nutrientId: value.nutrientId,
                amount: value.amount,
                basis: 'per_100g',
                citationId: null,
            })),
        );
    }

    /**
     * Every value under the root's header, ordered by nutrient.
     *
     * @param foodId - The root.
     * @returns The values; empty when the root has no header.
     * @sideEffect Reads `food_nutrition` and `food_nutrition_value`.
     */
    public async listByFood(foodId: string): Promise<StoredNutritionValue[]> {
        return this.db
            .select({
                nutrientId: foodNutritionValue.nutrientId,
                amount: foodNutritionValue.amount,
                trace: foodNutritionValue.trace,
                basis: foodNutritionValue.basis,
                citationId: foodNutritionValue.citationId,
            })
            .from(foodNutritionValue)
            .innerJoin(foodNutrition, eq(foodNutrition.id, foodNutritionValue.nutritionId))
            .where(eq(foodNutrition.foodId, foodId))
            .orderBy(asc(foodNutritionValue.nutrientId));
    }

    /**
     * The header's citation of one source item.
     *
     * @param nutritionId - The header.
     * @param item - The dataset and key.
     * @returns The citation's id, or `undefined`.
     * @sideEffect Reads `food_nutrition_citation`.
     */
    private async findCitation(nutritionId: string, item: SourceItemCitation): Promise<string | undefined> {
        const rows = await this.db
            .select({ id: foodNutritionCitation.id })
            .from(foodNutritionCitation)
            .where(
                and(
                    eq(foodNutritionCitation.nutritionId, nutritionId),
                    eq(foodNutritionCitation.dataset, item.dataset),
                    eq(foodNutritionCitation.externalKey, item.externalKey),
                ),
            )
            .limit(1);

        return rows[0]?.id;
    }
}
