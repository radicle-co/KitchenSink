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
    numeric,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
    RecipeDifficulty,
    RecipeMealType,
    RecipeSourceType,
    RecipeStatus,
    RecipeVisibility,
} from '@kitchensink/recipe-core';

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
//
// `@kitchensink/recipe-core` is the AUTHORITATIVE source for each of these value sets (S-R5). Every
// array below is tied to its recipe-core type with `as const satisfies readonly <Type>[]`: a rename or
// addition in recipe-core that this file doesn't mirror FAILS THE BUILD here instead of silently
// drifting (see W8-a.3, which added `draft` to the status domain — exactly the drift this guards
// against). The types themselves are RE-EXPORTED from recipe-core below rather than redeclared, so
// there is ONE authoritative `RecipeVisibility`/`RecipeSourceType`/`RecipeDifficulty`/`RecipeStatus`.

/** Recipe visibility (C-004). */
export const RECIPE_VISIBILITIES = ['public', 'private'] as const satisfies readonly RecipeVisibility[];
/** Recipe provenance / source classification (C-004). */
export const RECIPE_SOURCE_TYPES = [
    'user_created',
    'imported_public',
    'imported_physical',
    'imported_paid',
] as const satisfies readonly RecipeSourceType[];
/** Author-stated difficulty (CR-001 / FR-001b). NULL ("not stated") is a first-class state, not in this set. */
export const RECIPE_DIFFICULTIES = ['easy', 'medium', 'hard'] as const satisfies readonly RecipeDifficulty[];
/** Publication status (W8-a.3) — backs `recipes_status_check` below. */
export const RECIPE_STATUSES = ['draft', 'published'] as const satisfies readonly RecipeStatus[];
/**
 * Author-stated meal type (plan U34) — backs `recipes_meal_type_check` below. NULL ("not stated") is a
 * first-class state and is deliberately NOT in this set, exactly as for difficulty.
 *
 * The `satisfies` is the whole point: `tags` and `dietary_flags` beside it are unconstrained `text[]` on
 * purpose, so this is the ONE classification column whose domain the database enforces, and a recipe-core
 * addition this array does not mirror fails the build here rather than passing a CHECK that silently
 * rejects the new value at run time.
 */
export const RECIPE_MEAL_TYPES_DB = [
    'breakfast',
    'brunch',
    'lunch',
    'dinner',
    'snack',
    'dessert',
    'drink',
] as const satisfies readonly RecipeMealType[];

// Single authoritative types — re-exported from recipe-core rather than redeclared, so a schema
// consumer importing `RecipeVisibility`/`RecipeSourceType`/`RecipeDifficulty`/`RecipeStatus` FROM THIS
// FILE gets the exact same type as one importing it from `@kitchensink/recipe-core` directly.
export type { RecipeVisibility, RecipeSourceType, RecipeDifficulty, RecipeMealType, RecipeStatus };

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

        // Difficulty (CR-001 / FR-001b). NULLABLE, NO default — "the author did not state one" is a
        // real state, and there is no honest default. NULL renders as NO badge, never a guess. See the
        // 0010 migration comment for why this deliberately diverges from the servings/times NOT NULL.
        difficulty: text('difficulty'),

        // Meal type (plan U34). NULLABLE, NO default, for exactly the reason difficulty is: "the author did
        // not say" is a real state and there is no honest default. Its sibling classification columns
        // (`tags`, `dietary_flags`) are unconstrained text[] BY DESIGN — see RECIPE_MEAL_TYPES_DB above for
        // why this one axis is closed and those are not.
        mealType: text('meal_type'),

        // Denormalized rating aggregate (CR-001 / FR-013a). Maintained ONLY by the
        // recipe_ratings_aggregate_refresh() trigger (0010 migration) — NEVER written by application
        // code. average_rating IS NULL exactly when rating_count = 0 (an unrated recipe has no average;
        // 0.00 would render as a real zero-star score), enforced by recipes_rating_aggregate_coherent.
        averageRating: numeric('average_rating', { precision: 3, scale: 2 }),
        ratingCount: integer('rating_count').notNull().default(0),

        visibility: text('visibility').notNull().default('public'),
        // Publication status (W8-a.3 / 0013 migration) — a SECURITY boundary orthogonal to visibility and
        // deleted_at. A draft is owner-only regardless of visibility; NOT NULL default 'published' (every
        // existing row genuinely is published). Domain constrained by recipes_status_check below.
        status: text('status').notNull().default('published'),
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

        // ⛔ NO `lead_calories_per_serving` COLUMN, and this comment is here so nobody adds one back. It
        // existed (0012, W8-a.1) as denormalized per-serving calories recomputed on every write. Migration
        // 0019 DROPPED it: it was a copy of the food service's data that froze at the recipe's last save,
        // with no invalidation. `nutrition.integration.test.ts` asserts against the live `information_schema`
        // that it is gone, because only that tier can. A card's calorie figure now comes from
        // `POST /api/v1/recipes/nutrition-batch` (ADR-0021); the detail read's comes from the same live
        // computation it already performs. Neither is stored, and there is no third source.

        // Denormalized author display-name (W8-a.2 / decision 6 / 0015 migration) — profiles.displayName
        // written at create/clone time so cards render "by @handle" without a cross-service call. NULLABLE:
        // a pre-feature row has none until its next write / the backfill; kept current by the handle-sync
        // consumer's fan-out. The owner_id ULID stays the join/authz key — never the handle.
        authorHandle: text('author_handle'),

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
        // Difficulty: NULL passes (NULL IN (...) is NULL, not false), so this enforces the enum on stated values.
        check('recipes_difficulty_check', sql`${table.difficulty} IN ('easy', 'medium', 'hard')`),
        // Meal type: NULL passes (NULL IN (...) is NULL, not false), so this enforces the vocabulary on
        // stated values only — same shape as the difficulty check above.
        check(
            'recipes_meal_type_check',
            sql`${table.mealType} IN ('breakfast', 'brunch', 'lunch', 'dinner', 'snack', 'dessert', 'drink')`,
        ),
        // Publication status (W8-a.3) — NOT NULL, so this enforces the full draft|published domain.
        check('recipes_status_check', sql`${table.status} IN ('draft', 'published')`),
        check('recipes_rating_count_nonneg', sql`${table.ratingCount} >= 0`),
        check(
            'recipes_average_rating_range',
            sql`${table.averageRating} IS NULL OR (${table.averageRating} >= 1 AND ${table.averageRating} <= 5)`,
        ),
        // The incoherent pairing (a count with no average, or an average with no count) is unrepresentable.
        check('recipes_rating_aggregate_coherent', sql`(${table.ratingCount} = 0) = (${table.averageRating} IS NULL)`),
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
