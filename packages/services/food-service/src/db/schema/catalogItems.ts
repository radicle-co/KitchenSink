/**
 * Drizzle mirror of the item-keyed catalog tables of `../migrations/0018_food_catalog_items_roots_variants.sql`
 * (curated catalog plan U4, KTD-6, KTD-7, KTD-8), which stays the source of truth.
 *
 * `food_item` is the unit sources, portions, scalar provenance, categories and popularity attach to. A root (`food`)
 * and a variant each own exactly one item, matched through the `(id, owner_kind)` composite key, so an item can never
 * have two owners. `food_forward` records where a removed or retired owner's id now resolves.
 *
 * The SQL also carries what Drizzle cannot express: the ownership trigger (KTD-12), the immutability and
 * "uncited means authored" triggers, and the regex CHECKs on the natural key.
 *
 * @pattern Subtype discriminator via composite foreign key — an item's `owner_kind` and its owner's `item_owner_kind`
 * @pattern Exclusive Arc — a forward's target, and a portion's provenance (a source row, a citation, or neither)
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    boolean,
    check,
    foreignKey,
    index,
    numeric,
    pgEnum,
    pgTable,
    primaryKey,
    smallint,
    text,
    timestamp,
    unique,
    uniqueIndex,
} from 'drizzle-orm/pg-core';

import { VARIANT_ATTRIBUTES } from '../../foods/domain/variantAttribute.js';
import { food, foodCategory, foodFieldEnum, foodItemOwnerKindEnum, foodSourceEnum } from './food.js';

/** The variant attributes, in contract order (KTD-7). A new one is added before `origin` in its own migration. */
export const foodVariantAttributeEnum = pgEnum('food_variant_attribute', VARIANT_ATTRIBUTES);

/** The unit every per-item row attaches to. `seed_owned` is fixed at insert: only the seed mints a natural key. */
export const foodItem = pgTable(
    'food_item',
    {
        id: text('id').primaryKey(),
        /** `fdc:<id>`, or the root's `curated:` seed key when the item has no source row (KTD-8). NULL when live. */
        naturalKey: text('natural_key'),
        seedOwned: boolean('seed_owned')
            .notNull()
            .generatedAlwaysAs(sql`natural_key IS NOT NULL`),
        ownerKind: foodItemOwnerKindEnum('owner_kind').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        unique('food_item_natural_key_unique').on(table.naturalKey),
        unique('food_item_id_owner_kind_unique').on(table.id, table.ownerKind),
    ],
);

/** A `food_item` row as selected. */
export type FoodItemRow = InferSelectModel<typeof foodItem>;

/** A variant of a root, with its own item and its own nutrition (R9). */
export const foodVariant = pgTable(
    'food_variant',
    {
        id: text('id').primaryKey(),
        foodId: text('food_id')
            .notNull()
            .references(() => food.id),
        itemId: text('item_id').notNull(),
        itemOwnerKind: foodItemOwnerKindEnum('item_owner_kind').notNull().default('variant'),
        retiredAt: timestamp('retired_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        unique('food_variant_item_id_unique').on(table.itemId),
        check('food_variant_item_owner_kind_variant', sql`${table.itemOwnerKind} = 'variant'`),
        foreignKey({
            columns: [table.itemId, table.itemOwnerKind],
            foreignColumns: [foodItem.id, foodItem.ownerKind],
            name: 'food_variant_item_fk',
        }),
        index('food_variant_food_id_idx').on(table.foodId),
    ],
);

/** A `food_variant` row as selected. */
export type FoodVariantRow = InferSelectModel<typeof foodVariant>;

/** One part of a variant's label, keyed `(variant_id, attribute, ordinal)` (KTD-7). */
export const foodVariantPart = pgTable(
    'food_variant_part',
    {
        variantId: text('variant_id')
            .notNull()
            .references(() => foodVariant.id, { onDelete: 'cascade' }),
        attribute: foodVariantAttributeEnum('attribute').notNull(),
        ordinal: smallint('ordinal').notNull(),
        text: text('text').notNull(),
    },
    (table) => [
        primaryKey({ name: 'food_variant_part_pk', columns: [table.variantId, table.attribute, table.ordinal] }),
        check('food_variant_part_ordinal_nonneg', sql`${table.ordinal} >= 0`),
    ],
);

/** The crosswalk from an item to each source item it stands for (no raw payload). */
export const foodSources = pgTable(
    'food_sources',
    {
        id: text('id').primaryKey(),
        itemId: text('item_id')
            .notNull()
            .references(() => foodItem.id, { onDelete: 'cascade' }),
        source: foodSourceEnum('source').notNull(),
        externalKey: text('external_key').notNull(),
        fetchState: text('fetch_state').notNull().default('fetched'),
        itemVersion: text('item_version'),
        fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        unique('food_sources_source_key_unique').on(table.source, table.externalKey),
        unique('food_sources_item_id_id_unique').on(table.itemId, table.id),
        check('food_sources_fetch_state_check', sql`${table.fetchState} IN ('fetched', 'error')`),
        index('food_sources_item_id_idx').on(table.itemId),
    ],
);

/** A `food_sources` row as selected. */
export type FoodSourceRow = InferSelectModel<typeof foodSources>;
/** A `food_sources` row for insert. */
export type NewFoodSourceRow = InferInsertModel<typeof foodSources>;

/** Which source row supplied each scalar field of an item's owner (R5), same-item by foreign key. */
export const foodFieldProvenance = pgTable(
    'food_field_provenance',
    {
        itemId: text('item_id')
            .notNull()
            .references(() => foodItem.id, { onDelete: 'cascade' }),
        field: foodFieldEnum('field').notNull(),
        sourceId: text('source_id').notNull(),
    },
    (table) => [
        primaryKey({ name: 'food_field_provenance_pk', columns: [table.itemId, table.field] }),
        foreignKey({
            columns: [table.itemId, table.sourceId],
            foreignColumns: [foodSources.itemId, foodSources.id],
            name: 'food_field_provenance_same_item_fk',
        }),
    ],
);

/** An item's classification. The category key is NO ACTION, so no category delete reaches a catalog row. */
export const foodCategoryAssignment = pgTable(
    'food_category_assignment',
    {
        itemId: text('item_id')
            .notNull()
            .references(() => foodItem.id, { onDelete: 'cascade' }),
        categoryId: text('category_id')
            .notNull()
            .references(() => foodCategory.id),
        sourceId: text('source_id'),
    },
    (table) => [
        primaryKey({ name: 'food_category_assignment_pk', columns: [table.itemId, table.categoryId] }),
        foreignKey({
            columns: [table.itemId, table.sourceId],
            foreignColumns: [foodSources.itemId, foodSources.id],
            name: 'food_category_assignment_same_item_fk',
        }),
    ],
);

/** The FNDDS/WWEIA consumption prior of an item (plan U5 of the search plan, R45). */
export const foodPopularity = pgTable('food_popularity', {
    itemId: text('item_id')
        .primaryKey()
        .references(() => foodItem.id, { onDelete: 'cascade' }),
    consumptionWeight: numeric('consumption_weight').notNull(),
    priorFraction: numeric('prior_fraction').notNull(),
    source: text('source').notNull(),
    seededAt: timestamp('seeded_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An item's household measures. A portion comes from a source row of its item, from a citation (a label or Branded
 * serving), or from the food's author when it names neither. The citation's foreign key (ON DELETE CASCADE) is in
 * 0018 only: declaring it here would make this module and `foodNutrition.ts` import each other.
 */
export const foodPortions = pgTable(
    'food_portions',
    {
        id: text('id').primaryKey(),
        itemId: text('item_id')
            .notNull()
            .references(() => foodItem.id, { onDelete: 'cascade' }),
        label: text('label').notNull(),
        gramWeight: numeric('gram_weight').notNull(),
        sourceId: text('source_id'),
        citationId: text('citation_id'),
    },
    (table) => [
        check('food_portions_gram_weight_pos', sql`${table.gramWeight} > 0`),
        check('food_portions_one_provenance', sql`num_nonnulls(${table.sourceId}, ${table.citationId}) <= 1`),
        foreignKey({
            columns: [table.itemId, table.sourceId],
            foreignColumns: [foodSources.itemId, foodSources.id],
            name: 'food_portions_same_item_fk',
        }),
        index('food_portions_item_id_idx').on(table.itemId),
    ],
);

/** A `food_portions` row as selected. */
export type FoodPortionRow = InferSelectModel<typeof foodPortions>;
/** A `food_portions` row for insert. */
export type NewFoodPortionRow = InferInsertModel<typeof foodPortions>;

/** Where a removed or retired root's or variant's id now resolves: a live root or a live variant (KTD-8). */
export const foodForward = pgTable(
    'food_forward',
    {
        sourceId: text('source_id').primaryKey(),
        sourceKind: foodItemOwnerKindEnum('source_kind').notNull(),
        sourceKey: text('source_key'),
        targetFoodId: text('target_food_id').references(() => food.id),
        targetVariantId: text('target_variant_id').references(() => foodVariant.id),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('food_forward_one_target', sql`num_nonnulls(${table.targetFoodId}, ${table.targetVariantId}) = 1`),
        uniqueIndex('food_forward_source_key_unique')
            .on(table.sourceKind, table.sourceKey)
            .where(sql`${table.sourceKey} IS NOT NULL`),
    ],
);
