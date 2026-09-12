/**
 * Reads of a root's variants (curated catalog plan U8, R17; ADR-0050 §1, §4).
 *
 * A variant is a row of `food_variant` under one root, with its label in `food_variant_part` and its own nutrition
 * header (KTD-19). A retired variant (`retired_at` set) has been forwarded; it is never listed as live.
 *
 * @pattern Table Data Gateway — `food_variant` and `food_variant_part`, plus the variant arm of `food_nutrient_view`
 * @module
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { FoodWriter } from '../../database/unitOfWork.js';
import { food, foodNutrientView, foodPortions, foodVariant, foodVariantPart } from '../../db/schema/index.js';
import type { VariantAttribute } from '../domain/variantAttribute.js';
import type { StoredNutrientAmount, StoredPortionWeight } from './food.dao.js';

/** One part of a variant's label. */
export interface VariantPartFact {
    readonly attribute: VariantAttribute;
    readonly ordinal: number;
    readonly text: string;
}

/** A live variant of a root. */
export interface LiveVariant {
    readonly id: string;
    /** The root it belongs to. */
    readonly rootId: string;
    /** The source item it owns. */
    readonly itemId: string;
    /** Its label, ordered by attribute in contract order, then by ordinal. */
    readonly parts: readonly VariantPartFact[];
    /** Its own stored nutrient values; empty unless read `withNutrition`. */
    readonly nutrients: readonly StoredNutrientAmount[];
}

/** What a reader may need of any variant, retired or live (curated plan U8 S4, S5). */
export interface VariantFacts {
    readonly id: string;
    readonly rootId: string;
    /** Whether the variant is retired: it has been forwarded, or the seed removed it. */
    readonly retired: boolean;
    /** Its label, in contract order then ordinal. */
    readonly parts: readonly VariantPartFact[];
}

/** A variant's own nutrition and its own item's portions (R9, KTD-19), for the nutrition batch (curated U8 S6). */
export interface VariantNutrition {
    readonly id: string;
    readonly nutrients: readonly StoredNutrientAmount[];
    /** In insertion order. */
    readonly portions: readonly StoredPortionWeight[];
}

/** Options for {@link FoodVariantDao.listLive}. */
export interface ListLiveOptions {
    /** Read each variant's own nutrient values as well. */
    readonly withNutrition: boolean;
}

export class FoodVariantDao {
    public constructor(private readonly db: FoodWriter) {}

    /**
     * The live variants of the given roots, in id order (ULIDs, so creation order).
     *
     * Parts sort by `attribute`, an enum, which Postgres orders by declaration: the contract order of
     * `VARIANT_ATTRIBUTES` (`foods.schema.ts`), which the enum-order parity test holds to the migration.
     *
     * @param rootIds - The roots.
     * @param options - Whether to read each variant's nutrition too.
     * @returns One entry per live variant; none for a root with no live variant.
     * @sideEffect Reads `food_variant`, `food_variant_part` and, with nutrition, `food_nutrient_view`.
     */
    public async listLive(rootIds: readonly string[], options: ListLiveOptions): Promise<LiveVariant[]> {
        if (rootIds.length === 0) {
            return [];
        }

        const rows = await this.db
            .select({
                id: foodVariant.id,
                rootId: foodVariant.foodId,
                itemId: foodVariant.itemId,
                attribute: foodVariantPart.attribute,
                ordinal: foodVariantPart.ordinal,
                text: foodVariantPart.text,
            })
            .from(foodVariant)
            .leftJoin(foodVariantPart, eq(foodVariantPart.variantId, foodVariant.id))
            .where(sql`${foodVariant.foodId} = ANY(${sql.param([...rootIds])}) AND ${foodVariant.retiredAt} IS NULL`)
            .orderBy(asc(foodVariant.id), asc(foodVariantPart.attribute), asc(foodVariantPart.ordinal));

        const variants = new Map<string, { id: string; rootId: string; itemId: string; parts: VariantPartFact[] }>();

        for (const row of rows) {
            const variant = variants.get(row.id) ?? { id: row.id, rootId: row.rootId, itemId: row.itemId, parts: [] };

            variants.set(row.id, variant);

            // A LEFT JOIN row with no part carries NULLs: a variant with no part is still listed.
            if (row.attribute !== null && row.ordinal !== null && row.text !== null) {
                variant.parts.push({ attribute: row.attribute, ordinal: row.ordinal, text: row.text });
            }
        }

        const nutrients = options.withNutrition ? await this.nutrientsOf([...variants.keys()]) : new Map();

        return [...variants.values()].map((variant) => ({ ...variant, nutrients: nutrients.get(variant.id) ?? [] }));
    }

    /**
     * The facts of the given variants, retired ones included, in one statement.
     *
     * @param ids - Variant ids.
     * @returns One entry per id that names a variant; an unknown id is absent.
     * @sideEffect Reads `food_variant` and `food_variant_part`.
     */
    public async readFacts(ids: readonly string[]): Promise<VariantFacts[]> {
        if (ids.length === 0) {
            return [];
        }

        const rows = await this.db
            .select({
                id: foodVariant.id,
                rootId: foodVariant.foodId,
                retiredAt: foodVariant.retiredAt,
                attribute: foodVariantPart.attribute,
                ordinal: foodVariantPart.ordinal,
                text: foodVariantPart.text,
            })
            .from(foodVariant)
            .leftJoin(foodVariantPart, eq(foodVariantPart.variantId, foodVariant.id))
            .where(sql`${foodVariant.id} = ANY(${sql.param([...ids])})`)
            .orderBy(asc(foodVariant.id), asc(foodVariantPart.attribute), asc(foodVariantPart.ordinal));

        const facts = new Map<string, { id: string; rootId: string; retired: boolean; parts: VariantPartFact[] }>();

        for (const row of rows) {
            const fact = facts.get(row.id) ?? {
                id: row.id,
                rootId: row.rootId,
                retired: row.retiredAt !== null,
                parts: [],
            };

            facts.set(row.id, fact);

            if (row.attribute !== null && row.ordinal !== null && row.text !== null) {
                fact.parts.push({ attribute: row.attribute, ordinal: row.ordinal, text: row.text });
            }
        }

        return [...facts.values()];
    }

    /**
     * Each variant's own nutrition values and its own item's portions, in two statements.
     *
     * Both read only a variant whose root is unauthored (R40). Migration 0018's `food_variant_seed_only` already makes
     * any other variant unrepresentable; this is the second line, so a variant that slipped past it reads empty.
     *
     * @param ids - Variant ids the caller already knows exist (the owner reader read them).
     * @returns One entry per distinct id; a variant with no header or no portion reads empty, never zero.
     * @sideEffect Reads `food_nutrient_view`, `food_variant`, `food` and `food_portions`.
     */
    public async readNutrition(ids: readonly string[]): Promise<VariantNutrition[]> {
        if (ids.length === 0) {
            return [];
        }

        const [nutrients, portions] = await Promise.all([
            this.nutrientsOf(ids),
            this.db
                .select({ variantId: foodVariant.id, label: foodPortions.label, gramWeight: foodPortions.gramWeight })
                .from(foodPortions)
                .innerJoin(foodVariant, eq(foodVariant.itemId, foodPortions.itemId))
                .innerJoin(food, and(eq(food.id, foodVariant.foodId), isNull(food.userId)))
                .where(sql`${foodVariant.id} = ANY(${sql.param([...ids])})`)
                .orderBy(foodPortions.id),
        ]);
        const portionsByVariant = new Map<string, StoredPortionWeight[]>();

        for (const { variantId, ...portion } of portions) {
            const bucket = portionsByVariant.get(variantId) ?? [];

            bucket.push(portion);
            portionsByVariant.set(variantId, bucket);
        }

        return [...new Set(ids)].map((id) => ({
            id,
            nutrients: nutrients.get(id) ?? [],
            portions: portionsByVariant.get(id) ?? [],
        }));
    }

    /**
     * Which of the given roots have at least one live variant.
     *
     * @param rootIds - Root ids.
     * @returns The roots that do.
     * @sideEffect Reads `food_variant`.
     */
    public async liveVariantRoots(rootIds: readonly string[]): Promise<Set<string>> {
        if (rootIds.length === 0) {
            return new Set();
        }

        const rows = await this.db
            .select({ rootId: foodVariant.foodId })
            .from(foodVariant)
            .where(sql`${foodVariant.foodId} = ANY(${sql.param([...rootIds])}) AND ${foodVariant.retiredAt} IS NULL`);

        return new Set(rows.map((row) => row.rootId));
    }

    /**
     * The stored values of the given variants, trace marks included, through the view's variant arm, for a variant
     * whose root is unauthored only (R40).
     *
     * @param variantIds - The variants.
     * @returns Their values, by variant id.
     * @sideEffect Reads `food_nutrient_view`, `food_variant` and `food`.
     */
    private async nutrientsOf(variantIds: readonly string[]): Promise<Map<string, StoredNutrientAmount[]>> {
        const byVariant = new Map<string, StoredNutrientAmount[]>();

        if (variantIds.length === 0) {
            return byVariant;
        }

        const rows = await this.db
            .select({
                variantId: foodNutrientView.foodVariantId,
                nutrient: foodNutrientView.nutrient,
                infoodsTag: foodNutrientView.infoodsTag,
                unit: foodNutrientView.unit,
                basis: foodNutrientView.basis,
                amount: foodNutrientView.amount,
                trace: foodNutrientView.trace,
            })
            .from(foodNutrientView)
            .innerJoin(foodVariant, eq(foodVariant.id, foodNutrientView.foodVariantId))
            .innerJoin(food, and(eq(food.id, foodVariant.foodId), isNull(food.userId)))
            .where(sql`${foodNutrientView.foodVariantId} = ANY(${sql.param([...variantIds])})`);

        for (const { variantId, ...value } of rows) {
            if (variantId === null) {
                continue;
            }

            const bucket = byVariant.get(variantId) ?? [];

            bucket.push(value);
            byVariant.set(variantId, bucket);
        }

        return byVariant;
    }
}
