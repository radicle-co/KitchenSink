/**
 * Drizzle mirror of `food_lookups` — THE BINDING, and the only place a line's arm is stated.
 *
 * ⚠️ `0051_ingredient_grain.sql` is AUTHORITATIVE. This declaration exists so drizzle knows the columns;
 * where the two disagree the SQL wins, and `schemaModelConformance.integration.test.ts` is what makes a
 * disagreement fail rather than drift.
 *
 * ⛔ THERE IS NO `kind` COLUMN, AND ADDING ONE WOULD BE THE DEFECT. The arm is READ OFF the three nullable
 * reference columns under `food_lookups_one_arm`, so it cannot disagree with them. A discriminator would be a
 * second statement of the same fact, and a second statement can be wrong — which is how `food_id IS NULL`
 * beside `food_resolution_status = 'RESOLVED'` became representable before 0051.
 *
 * ⛔ AND NO `name`. The display name is DERIVED by following whichever arm is populated: to the food
 * service's catalog through {@link foodLookups.foodId} or {@link foodLookups.foodVariantId}, or to
 * `unresolved_foods.name`. Every ranking
 * artefact the departed name column carried (`search_vector`, `rank_folded`, `rank_tokens`, `rank_head`,
 * and 0034's `rank_tokens_of` helper) went with it.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { unresolvedFoods } from './unresolvedFoods.js';

export const foodLookups = pgTable(
    'food_lookups',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        /**
         * The food service's internal ULID (003), OPAQUE.
         *
         * NEVER a USDA `fdcId`, and NOT a cross-database foreign key: ADR-0006 gives every stage its own
         * logical database, so this reference MAY dangle and the reader degrades rather than joins.
         */
        foodId: text('food_id'),
        /**
         * The food service's opaque id for a VARIANT of a root (the curated catalog's `food_variant`). A line
         * bound here chose a variant, and a reseed never moves it. Opaque and never a cross-database foreign
         * key, for the same reason as {@link foodLookups.foodId}.
         */
        foodVariantId: text('food_variant_id'),
        unresolvedFoodId: uuid('unresolved_food_id').references(() => unresolvedFoods.id, { onDelete: 'restrict' }),
        /**
         * R20: the AUTHOR's ULID when the referenced food is their PRIVATE authored one, captured at bind
         * time because ADR-0006 forbids the cross-database join. NULL for catalog and promoted foods; every
         * local retrieval surface filters `(food_owner_id IS NULL OR food_owner_id = :caller)`.
         */
        foodOwnerId: varchar('food_owner_id', { length: 255 }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        // ⛔ An owner describes A ROOT FOOD, so it may not be asserted on another arm. Not cosmetic: the
        // account-erasure sweep KEYS on that column, and a private authored food is always a root.
        check('food_lookups_owner_needs_a_root', sql`${table.foodOwnerId} IS NULL OR ${table.foodId} IS NOT NULL`),
        // ⛔ THE INVARIANT: exactly one arm. `num_nonnulls` counts; 0051's header records why the chained
        // two-arm `<>` form and an `OR` of nullability tests are both wrong for three arms.
        check(
            'food_lookups_one_arm',
            sql`num_nonnulls(${table.foodId}, ${table.foodVariantId}, ${table.unresolvedFoodId}) = 1`,
        ),
        // One binding per food-service golden record — the DB-side dedup key that makes a binding race safe.
        uniqueIndex('idx_food_lookups_food_id')
            .on(table.foodId)
            .where(sql`${table.foodId} IS NOT NULL`),
        // One binding per variant, in its own index: a root and a variant are different things even if their
        // opaque ids ever collide.
        uniqueIndex('idx_food_lookups_food_variant_id')
            .on(table.foodVariantId)
            .where(sql`${table.foodVariantId} IS NOT NULL`),
        // One binding per failure record, so a second lookup cannot attach itself to a failure another line
        // already owns.
        uniqueIndex('idx_food_lookups_unresolved_food_id')
            .on(table.unresolvedFoodId)
            .where(sql`${table.unresolvedFoodId} IS NOT NULL`),
        index('idx_food_lookups_food_owner')
            .on(table.foodOwnerId)
            .where(sql`${table.foodOwnerId} IS NOT NULL`),
    ],
);

/** A `food_lookups` row as selected. */
export type FoodLookupRow = InferSelectModel<typeof foodLookups>;
/** A `food_lookups` row for insert. */
export type NewFoodLookupRow = InferInsertModel<typeof foodLookups>;
