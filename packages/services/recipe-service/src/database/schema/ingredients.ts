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
    numeric,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { recipes, tsvector } from './recipes.js';

/**
 * Async food-resolution status (`foodResolutionStatus` in @kitchensink/recipe-core), mirroring the
 * shipped food client's `FoodStatus` (UPPER_SNAKE, incl. terminal states). Set ONLY for
 * database-backed ingredients (food_id present); NULL for user-entered / freeform ingredients.
 *
 * Tied to recipe-core's authoritative {@link FoodResolutionStatus} with `satisfies` (S-R5); the type
 * below is RE-EXPORTED from recipe-core (not redeclared) to reconcile the same-named type.
 */
export const FOOD_RESOLUTION_STATUSES = [
    'PENDING',
    'UNRESOLVED',
    'RESOLVED',
    'NOT_FOUND',
    'FAILED',
] as const satisfies readonly FoodResolutionStatus[];

/** A food-resolution status value — the single authoritative type, re-exported from recipe-core. */
export type { FoodResolutionStatus };

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
        // ⛔ NO NUTRITION COLUMNS, and none may be added (KTD-3 / plan U10, migration 0019).
        //
        // `calories_per_100g`, `protein_g_per_100g`, `carbs_g_per_100g`, `fat_g_per_100g` and `portions`
        // were DROPPED. They were copies of the food service's data taken at resolution time, with no
        // invalidation — so a food corrected upstream left every recipe quoting the old number forever, and
        // the same recipe could report different calories from different rows. The food service is the
        // single writer for a food; this table holds the REFERENCE (`food_id`) and nothing derived from it.
        // Nutrition is read live through `FoodNutritionGateway` (KTD-3b: stale, then absent, never wrong).
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
        // U8/R41 — NULLABLE, and that is the point: `NULL` is the ONE representation of "the source stated
        // no amount" ("butter the size of an egg"). It is never `0`, which the kept positive check below
        // still refuses precisely so a zero cannot become a second spelling of absent.
        quantity: numeric('quantity', { precision: 10, scale: 3 }),
        /** The upper bound when the source stated a RANGE (`2 to 3 cups`); `NULL` for a single value (R36). */
        quantityHigh: numeric('quantity_high', { precision: 10, scale: 3 }),
        unit: text('unit').notNull(),
        displayText: text('display_text'),
        // U11/U14 — the raw line the cook's SOURCE stated, verbatim. ⛔ NOT `displayText`, which is a display
        // OVERRIDE the author chose, and NOT `ingredientName`, which is OUR rendering: the verification gate
        // checks our parse against this, and checking a parse against its own output agrees by construction.
        // `NULL` means the line was AUTHORED rather than transcribed — see `0024_ingredient_source_line.sql`.
        sourceLine: text('source_line'),
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
        // KEPT through U8 on purpose. A Postgres CHECK is satisfied when it evaluates to NULL, so this
        // already admits an absent quantity while still refusing a zero — see `0020_quantity_range.sql`.
        check('recipe_ingredients_quantity_positive', sql`${table.quantity} > 0`),
        // The pair's illegal states, unrepresentable in the database as well as in `IngredientQuantity`: an
        // upper bound with no lower, and an upper bound at or below its lower (coincident bounds ARE an
        // exact quantity). Declared `NOT VALID` in the migration; drizzle has no way to spell that, and the
        // migration is authoritative — this entry exists so a reader of the schema sees the constraint.
        check(
            'recipe_ingredients_quantity_coherent',
            sql`${table.quantityHigh} IS NULL OR (${table.quantity} IS NOT NULL AND ${table.quantityHigh} > ${table.quantity})`,
        ),
        index('idx_recipe_ingredients_recipe_id').on(table.recipeId),
        index('idx_recipe_ingredients_ingredient_id').on(table.ingredientId),
    ],
);

/** A `recipe_ingredients` row as selected. */
export type RecipeIngredientRow = InferSelectModel<typeof recipeIngredients>;
/** A `recipe_ingredients` row for insert. */
export type NewRecipeIngredientRow = InferInsertModel<typeof recipeIngredients>;
