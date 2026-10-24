/**
 * Drizzle mirror of the nutrition aggregate of `../migrations/0018_food_catalog_items_roots_variants.sql`
 * (curated catalog plan KTD-19, R49, R50, R53, R54), which stays the source of truth.
 *
 * `food_nutrition` is the header: exactly one of a root (`food_id`) or a variant (`food_variant_id`) owns it, each a
 * real foreign key with ON DELETE CASCADE and its own partial unique index. Values and citations key on the header
 * alone, and a value cites its own header's citation through a composite key. A NULL citation means the food's author
 * wrote the value (ADR-0029), which an assertion trigger in the SQL admits only under an authored food.
 *
 * @pattern Exclusive Arc — the header's owner
 * @pattern Aggregate — the header is the root; values and citations are reached only through it
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    boolean,
    check,
    date,
    foreignKey,
    index,
    numeric,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    unique,
    uniqueIndex,
} from 'drizzle-orm/pg-core';

import { CITATION_MATCHES } from '../../foods/seed/catalog/citationPrecedence.js';
import { CITATION_DATASETS } from '../../foods/seed/citationDatasets.js';
import { foodVariant } from './catalogItems.js';
import { food, nutrient, nutrientBasisEnum } from './food.js';

/** The dataset a citation names (KTD-22). Its source comes from `DATASET_SOURCE`, never from a column. */
export const citationDatasetEnum = pgEnum('citation_dataset', CITATION_DATASETS);

/** How well a cited entry matches the food it describes (KTD-22). */
export const citationMatchEnum = pgEnum('citation_match', CITATION_MATCHES);

/** The nutrition header: one per variant, at most one per root, never both arms. */
export const foodNutrition = pgTable(
    'food_nutrition',
    {
        id: text('id').primaryKey(),
        foodId: text('food_id').references(() => food.id, { onDelete: 'cascade' }),
        foodVariantId: text('food_variant_id').references(() => foodVariant.id, { onDelete: 'cascade' }),
    },
    (table) => [
        check('food_nutrition_one_owner', sql`num_nonnulls(${table.foodId}, ${table.foodVariantId}) = 1`),
        uniqueIndex('food_nutrition_food_id_unique')
            .on(table.foodId)
            .where(sql`${table.foodId} IS NOT NULL`),
        uniqueIndex('food_nutrition_food_variant_id_unique')
            .on(table.foodVariantId)
            .where(sql`${table.foodVariantId} IS NOT NULL`),
    ],
);

/** A source-item citation (dataset, key, match) or a manufacturer label (the five label columns). */
export const foodNutritionCitation = pgTable(
    'food_nutrition_citation',
    {
        id: text('id').primaryKey(),
        nutritionId: text('nutrition_id')
            .notNull()
            .references(() => foodNutrition.id, { onDelete: 'cascade' }),
        dataset: citationDatasetEnum('dataset').notNull(),
        externalKey: text('external_key'),
        match: citationMatchEnum('match'),
        /** The density R54's per-100-mL conversion used, cited from the same source. */
        densityGPerMl: numeric('density_g_per_ml'),
        /** Whether energy was converted from kJ at 4.184 (R54). */
        kcalFromKj: boolean('kcal_from_kj').notNull().default(false),
        url: text('url'),
        retrievedOn: date('retrieved_on'),
        manufacturer: text('manufacturer'),
        servingLabel: text('serving_label'),
        servingGrams: numeric('serving_grams'),
    },
    (table) => [
        unique('food_nutrition_citation_nutrition_id_id_unique').on(table.nutritionId, table.id),
        index('food_nutrition_citation_dataset_key_idx')
            .on(table.dataset, table.externalKey)
            .where(sql`${table.externalKey} IS NOT NULL`),
        uniqueIndex('food_nutrition_citation_source_item_unique')
            .on(table.nutritionId, table.dataset, table.externalKey)
            .where(sql`${table.externalKey} IS NOT NULL`),
    ],
);

/** A `food_nutrition_citation` row for insert. */
export type NewFoodNutritionCitationRow = InferInsertModel<typeof foodNutritionCitation>;

/** One value under a header, under its own definition (R53). A trace mark has no amount. */
export const foodNutritionValue = pgTable(
    'food_nutrition_value',
    {
        nutritionId: text('nutrition_id')
            .notNull()
            .references(() => foodNutrition.id, { onDelete: 'cascade' }),
        nutrientId: text('nutrient_id')
            .notNull()
            .references(() => nutrient.id),
        /** Arbitrary-precision `numeric` (SC-008); node-postgres returns it as a string. NULL exactly when `trace`. */
        amount: numeric('amount'),
        trace: boolean('trace').notNull().default(false),
        basis: nutrientBasisEnum('basis').notNull().default('per_100g'),
        citationId: text('citation_id'),
    },
    (table) => [
        primaryKey({ name: 'food_nutrition_value_pk', columns: [table.nutritionId, table.nutrientId] }),
        check('food_nutrition_value_amount_nonneg', sql`${table.amount} >= 0`),
        check('food_nutrition_value_trace_or_amount', sql`(${table.amount} IS NULL) = ${table.trace}`),
        foreignKey({
            columns: [table.nutritionId, table.citationId],
            foreignColumns: [foodNutritionCitation.nutritionId, foodNutritionCitation.id],
            name: 'food_nutrition_value_same_header_citation_fk',
        }),
    ],
);

/** A `food_nutrition_value` row as selected. */
export type FoodNutritionValueRow = InferSelectModel<typeof foodNutritionValue>;
