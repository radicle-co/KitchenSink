/**
 * Drizzle definitions for the recipe core: the `recipes` golden row (T011) and its ordered
 * `recipe_steps` (T011). Mirrors `specs/001-commise-recipe-app/data-model.md` EXACTLY — every column
 * type, nullability, CHECK, and index. The hand-authored SQL under `../migrations/*.sql` is the DDL the
 * in-VPC migration runner applies; these definitions drive the ORM/query layer and MUST match it.
 *
 * D2 (no local `users` table): `owner_id` stores the app-user ULID (from the token claim) directly as
 * `VARCHAR(255) NOT NULL` — no FK, no user replication. `search_vector` is a plain (nullable) tsvector
 * maintained by a PostgreSQL trigger (see 0001 migration), NOT a generated column.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    boolean,
    check,
    customType,
    index,
    integer,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Postgres `tsvector` column type (drizzle-orm has no native `tsvector`). Nullable and
 * trigger-maintained on `recipes` (weighted title/description/ingredient_names_text) — NOT a generated
 * column, so the service/trigger owns its contents.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
    dataType() {
        return 'tsvector';
    },
});

// ── Controlled value sets (data-model uses TEXT + CHECK, not pgEnum) ──────────────────────────────

/** Recipe visibility (C-004). */
export const RECIPE_VISIBILITIES = ['public', 'private'] as const;
/** Recipe provenance / source classification (C-004). */
export const RECIPE_SOURCE_TYPES = ['user_created', 'imported_public', 'imported_physical', 'imported_paid'] as const;

/** A recipe visibility value. */
export type RecipeVisibility = (typeof RECIPE_VISIBILITIES)[number];
/** A recipe source-type value. */
export type RecipeSourceType = (typeof RECIPE_SOURCE_TYPES)[number];

// ── recipes: the golden row ───────────────────────────────────────────────────────────────────────

export const recipes = pgTable(
    'recipes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        // App-user ULID of the owner (from token claim). No FK, no local users table (D2).
        ownerId: varchar('owner_id', { length: 255 }).notNull(),
        title: text('title').notNull(),
        description: text('description'),
        prepTimeMinutes: integer('prep_time_minutes').notNull(),
        cookTimeMinutes: integer('cook_time_minutes').notNull(),
        totalTimeMinutes: integer('total_time_minutes').notNull(),
        servings: integer('servings').notNull(),

        visibility: text('visibility').notNull().default('public'),
        sourceType: text('source_type').notNull().default('user_created'),
        sourceUrl: text('source_url'),
        sourceAttribution: text('source_attribution'),
        clonedFromId: uuid('cloned_from_id').references((): AnyPgColumn => recipes.id),

        hasSubstantiveEdit: boolean('has_substantive_edit').notNull().default(false),

        cuisine: text('cuisine'),
        dietaryFlags: text('dietary_flags')
            .array()
            .notNull()
            .default(sql`'{}'`),
        tags: text('tags')
            .array()
            .notNull()
            .default(sql`'{}'`),

        hasPartialNutrition: boolean('has_partial_nutrition').notNull().default(false),

        currentVersion: integer('current_version').notNull().default(1),

        ingredientNamesText: text('ingredient_names_text').notNull().default(''),

        // Trigger-maintained weighted tsvector (title A > description B > ingredient_names_text C).
        searchVector: tsvector('search_vector'),

        // Soft-delete tombstone (C-007 / T118). NULL = active.
        deletedAt: timestamp('deleted_at', { withTimezone: true }),

        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('recipes_prep_time_nonneg', sql`${table.prepTimeMinutes} >= 0`),
        check('recipes_cook_time_nonneg', sql`${table.cookTimeMinutes} >= 0`),
        check('recipes_total_time_nonneg', sql`${table.totalTimeMinutes} >= 0`),
        check('recipes_servings_positive', sql`${table.servings} > 0`),
        check('recipes_visibility_check', sql`${table.visibility} IN ('public', 'private')`),
        check(
            'recipes_source_type_check',
            sql`${table.sourceType} IN ('user_created', 'imported_public', 'imported_physical', 'imported_paid')`,
        ),
        index('idx_recipes_search_vector').using('gin', table.searchVector),
        // T118: partial owner index — every read path filters `deleted_at IS NULL`, so the plain index is
        // superseded by this partial one (created plain in 0001, redefined partial in 0002_soft_delete).
        index('idx_recipes_owner_id')
            .on(table.ownerId)
            .where(sql`${table.deletedAt} IS NULL`),
        index('idx_recipes_visibility').on(table.visibility),
        index('idx_recipes_cuisine').on(table.cuisine),
        index('idx_recipes_cloned_from').on(table.clonedFromId),
        index('idx_recipes_dietary_flags').using('gin', table.dietaryFlags),
        index('idx_recipes_tags').using('gin', table.tags),
        index('idx_recipes_public_recent')
            .on(table.visibility, table.createdAt.desc())
            .where(sql`${table.visibility} = 'public'`),
    ],
);

/** A `recipes` row as selected. */
export type RecipeRow = InferSelectModel<typeof recipes>;
/** A `recipes` row for insert. */
export type NewRecipeRow = InferInsertModel<typeof recipes>;

// ── recipe_steps: ordered instructions (FK → recipes ON DELETE CASCADE) ───────────────────────────

export const recipeSteps = pgTable(
    'recipe_steps',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        stepNumber: integer('step_number').notNull(),
        instruction: text('instruction').notNull(),
        // Optional per-step timer in seconds (contract `timerSeconds`); NULL = no timer.
        timerSeconds: integer('timer_seconds'),
    },
    (table) => [
        check('recipe_steps_step_number_positive', sql`${table.stepNumber} > 0`),
        check('recipe_steps_timer_seconds_positive', sql`${table.timerSeconds} IS NULL OR ${table.timerSeconds} > 0`),
        uniqueIndex('recipe_steps_recipe_step_unique').on(table.recipeId, table.stepNumber),
        index('idx_recipe_steps_recipe_id').on(table.recipeId),
    ],
);

/** A `recipe_steps` row as selected. */
export type RecipeStepRow = InferSelectModel<typeof recipeSteps>;
/** A `recipe_steps` row for insert. */
export type NewRecipeStepRow = InferInsertModel<typeof recipeSteps>;
