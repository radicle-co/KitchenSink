/**
 * Drizzle definitions for ingredients (T012): the shared `ingredients` catalog (food-service-backed or
 * user-entered) and the `recipe_ingredients` junction. Mirrors data-model.md EXACTLY.
 *
 * `food_id` is an OPAQUE cross-service reference to the food service's internal ULID (003) — NEVER a
 * USDA `fdcId`, and NOT a cross-DB FK. It is paired with `food_resolution_status` (async lifecycle,
 * UPPER_SNAKE) and a SEPARATE `is_user_entered` boolean (freeform/user-supplied nutrition, FR-007a).
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import type { IngredientPortion } from '@kitchensink/recipe-core';

import { recipes, tsvector } from './recipes.js';

/**
 * Async food-resolution status (`foodResolutionStatus` in @kitchensink/recipe-core), mirroring the
 * shipped food client's `FoodStatus` (UPPER_SNAKE, incl. terminal states). Set ONLY for
 * database-backed ingredients (food_id present); NULL for user-entered / freeform ingredients.
 */
export const FOOD_RESOLUTION_STATUSES = ['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED'] as const;

/** A food-resolution status value. */
export type FoodResolutionStatus = (typeof FOOD_RESOLUTION_STATUSES)[number];

// ── ingredients: food-service-backed + user-entered catalog ───────────────────────────────────────

export const ingredients = pgTable(
    'ingredients',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        name: text('name').notNull(),
        // Opaque reference to the food service (003) golden record by its internal ULID. NEVER a USDA
        // fdcId; not a cross-DB FK. NULL for user-entered / freeform ingredients.
        foodId: text('food_id'),
        foodResolutionStatus: text('food_resolution_status'),
        isUserEntered: boolean('is_user_entered').notNull().default(false),
        // Per-100g nutrition — populated from the food golden record once RESOLVED; NULL while pending.
        caloriesPer100g: numeric('calories_per_100g', { precision: 8, scale: 2 }),
        proteinGPer100g: numeric('protein_g_per_100g', { precision: 8, scale: 2 }),
        carbsGPer100g: numeric('carbs_g_per_100g', { precision: 8, scale: 2 }),
        fatGPer100g: numeric('fat_g_per_100g', { precision: 8, scale: 2 }),
        // Household-measure portions (`[{ unit, gramsPerUnit }]`), normalized from the food golden record's
        // portions once RESOLVED; used to convert a recipe line's volumetric/count unit to grams (#11).
        portions: jsonb('portions').$type<IngredientPortion[]>(),
        searchVector: tsvector('search_vector'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check(
            'ingredients_food_resolution_status_check',
            sql`${table.foodResolutionStatus} IN ('PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED')`,
        ),
        index('idx_ingredients_search_vector').using('gin', table.searchVector),
        // UNIQUE (0006): one catalog row per food-service golden record — the DB-side dedup key that
        // makes `createFoodBacked` race-proof. Also serves as the food_id lookup index.
        uniqueIndex('idx_ingredients_food_id')
            .on(table.foodId)
            .where(sql`${table.foodId} IS NOT NULL`),
        // UNIQUE (0006): case-insensitive freeform dedup — one user-entered row per name. Makes
        // `createFreeform` race-proof; scoped to user-entered rows so food-backed rows may share a name.
        uniqueIndex('idx_ingredients_freeform_name')
            .on(sql`lower(${table.name})`)
            .where(sql`${table.isUserEntered} = true`),
        // pg_trgm GIN index for fuzzy autocomplete (typo-tolerant ingredient search).
        index('idx_ingredients_name_trgm').using('gin', sql`${table.name} gin_trgm_ops`),
    ],
);

/** An `ingredients` row as selected. */
export type IngredientRow = InferSelectModel<typeof ingredients>;
/** An `ingredients` row for insert. */
export type NewIngredientRow = InferInsertModel<typeof ingredients>;

// ── recipe_ingredients: junction with denormalized display + user-entered nutrition ───────────────

export const recipeIngredients = pgTable(
    'recipe_ingredients',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        ingredientId: uuid('ingredient_id')
            .notNull()
            .references(() => ingredients.id),
        quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
        unit: text('unit').notNull(),
        displayText: text('display_text'),
        sortOrder: integer('sort_order').notNull().default(0),

        // Denormalized for display / search_vector assembly (no JOIN needed on write).
        ingredientName: text('ingredient_name').notNull(),
        isUserEntered: boolean('is_user_entered').notNull().default(false),

        // User-entered nutrition override (FR-007a).
        userCalories: numeric('user_calories', { precision: 8, scale: 2 }),
        userProteinG: numeric('user_protein_g', { precision: 8, scale: 2 }),
        userCarbsG: numeric('user_carbs_g', { precision: 8, scale: 2 }),
        userFatG: numeric('user_fat_g', { precision: 8, scale: 2 }),
    },
    (table) => [
        check('recipe_ingredients_quantity_positive', sql`${table.quantity} > 0`),
        index('idx_recipe_ingredients_recipe_id').on(table.recipeId),
        index('idx_recipe_ingredients_ingredient_id').on(table.ingredientId),
    ],
);

/** A `recipe_ingredients` row as selected. */
export type RecipeIngredientRow = InferSelectModel<typeof recipeIngredients>;
/** A `recipe_ingredients` row for insert. */
export type NewRecipeIngredientRow = InferInsertModel<typeof recipeIngredients>;
