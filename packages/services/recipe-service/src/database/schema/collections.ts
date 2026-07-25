/**
 * Drizzle definitions for `collections` (T014) and the `recipe_collections` junction (T014). Includes
 * T119 clone provenance: `collections.source_collection_id` (self-FK ON DELETE SET NULL) and
 * `recipe_collections.added_via` (manual | clone_seed | pull). Mirrors data-model.md EXACTLY.
 *
 * D2 (no local `users` table): `owner_id` stores the app-user ULID (from token claim) directly as
 * `VARCHAR(255) NOT NULL` — no FK, no user replication. Collections are PRIVATE by default (FR-010).
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    check,
    index,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uuid,
    varchar,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { RecipeCollectionAddedVia, RecipeVisibility } from '@kitchensink/recipe-core';

import { recipes } from './recipes.js';

/**
 * Collection visibility (FR-010) — private by default. Reuses the {@link RecipeVisibility} value set
 * (recipe-core's `Collection.visibility` is itself typed `RecipeVisibility`, not a separate union — see
 * its docstring), so the array is tied with `satisfies` (S-R5) to fail the build on drift. `CollectionVisibility`
 * stays its own name (no collision with recipe-core) since every existing consumer imports it from this file.
 */
export const COLLECTION_VISIBILITIES = ['public', 'private'] as const satisfies readonly RecipeVisibility[];
/**
 * Provenance of how a recipe entered a collection (FR-011). Tied to recipe-core's authoritative
 * {@link RecipeCollectionAddedVia} with `satisfies` (S-R5); the type below is RE-EXPORTED from
 * recipe-core (not redeclared) to reconcile the same-named type.
 */
export const RECIPE_COLLECTION_ADDED_VIA = [
    'manual',
    'clone_seed',
    'pull',
] as const satisfies readonly RecipeCollectionAddedVia[];

/** A collection visibility value (identical domain to {@link RecipeVisibility}). */
export type CollectionVisibility = (typeof COLLECTION_VISIBILITIES)[number];
/** A recipe-collection membership provenance value — the single authoritative type, re-exported from recipe-core. */
export type { RecipeCollectionAddedVia };

// ── collections ───────────────────────────────────────────────────────────────────────────────────

export const collections = pgTable(
    'collections',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        // App-user ULID (from token claim); no FK, no local users table (D2).
        ownerId: varchar('owner_id', { length: 255 }).notNull(),
        name: text('name').notNull(),
        description: text('description'),
        visibility: text('visibility').notNull().default('private'),
        // Clone provenance (FR-011 / T119). NULL = original. ON DELETE SET NULL: deleting a source
        // collection orphans the clone's provenance pointer rather than cascading the delete.
        sourceCollectionId: uuid('source_collection_id').references((): AnyPgColumn => collections.id, {
            onDelete: 'set null',
        }),
        // W5 Task 1: pull-refresh provenance. NULLABLE, no default — populated on clone (Task 2) and on
        // each successful pull (Task 3); a pre-existing / never-pulled collection has none of these.
        lastPulledAt: timestamp('last_pulled_at', { withTimezone: true, mode: 'date' }),
        sourceOwnerHandle: text('source_owner_handle'),
        sourceCollectionName: text('source_collection_name'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('collections_visibility_check', sql`${table.visibility} IN ('public', 'private')`),
        index('idx_collections_owner_id').on(table.ownerId),
        index('idx_collections_source_collection')
            .on(table.sourceCollectionId)
            .where(sql`${table.sourceCollectionId} IS NOT NULL`),
    ],
);

/** A `collections` row as selected. */
export type CollectionRow = InferSelectModel<typeof collections>;
/** A `collections` row for insert. */
export type NewCollectionRow = InferInsertModel<typeof collections>;

// ── recipe_collections: junction (composite PK) ───────────────────────────────────────────────────

export const recipeCollections = pgTable(
    'recipe_collections',
    {
        collectionId: uuid('collection_id')
            .notNull()
            .references(() => collections.id, { onDelete: 'cascade' }),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
        // Provenance of how this recipe entered the collection (FR-011 / T119).
        addedVia: text('added_via').notNull().default('manual'),
    },
    (table) => [
        check('recipe_collections_added_via_check', sql`${table.addedVia} IN ('manual', 'clone_seed', 'pull')`),
        primaryKey({ columns: [table.collectionId, table.recipeId] }),
        index('idx_recipe_collections_recipe_id').on(table.recipeId),
    ],
);

/** A `recipe_collections` row as selected. */
export type RecipeCollectionRow = InferSelectModel<typeof recipeCollections>;
/** A `recipe_collections` row for insert. */
export type NewRecipeCollectionRow = InferInsertModel<typeof recipeCollections>;
