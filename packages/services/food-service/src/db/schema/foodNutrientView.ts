/**
 * `food_nutrient_view` — the Drizzle mirror of the `food_nutrients JOIN nutrient` view created by
 * `../migrations/0006_food_nutrient_view.sql`, which stays the source of truth.
 *
 * `.existing()` because the view is DDL the migration runner applies; this declaration only gives the query
 * layer a typed handle on it, exactly as the `pgTable` definitions mirror the tables in `food.ts`.
 *
 * ⛔ **It carries `basis` through and decides nothing.** No name matching, no unit matching, no `FILTER`.
 * Which row is *the* calorie figure — `basis === 'per_100g'` AND canonical name AND unit — is decided in
 * ONE place, `../../foods/nutrition/nutrientSelection.ts`, against the identities in `labelNutrientMap.ts`.
 * A column-shaped view would give that rule a second authority in SQL, and its drift is the 4.184x kcal/kJ
 * error rendered as a plausible calorie count. NOT materialized either — see the migration for why.
 */
import { numeric, pgView, text } from 'drizzle-orm/pg-core';

import { nutrientBasisEnum } from './food.js';

/** The join, as a read-only access path: one row per stored nutrient value, with its dictionary name/unit. */
export const foodNutrientView = pgView('food_nutrient_view', {
    foodId: text('food_id').notNull(),
    nutrient: text('nutrient').notNull(),
    unit: text('unit').notNull(),
    basis: nutrientBasisEnum('basis').notNull(),
    // Arbitrary-precision `numeric` (SC-008), which node-postgres returns as a STRING. Converting it is the
    // consumer's job, at the one seam that already does it — dropping that seam makes every calorie `NaN`.
    amount: numeric('amount').notNull(),
}).existing();
