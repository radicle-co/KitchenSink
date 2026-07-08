import { describe, it, expect, expectTypeOf } from 'vitest';
import { getTableColumns, getTableName, type Table } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import * as schema from '../schema/index.js';
import {
    recipes,
    recipeSteps,
    ingredients,
    recipeIngredients,
    recipePhotos,
    recipeVersions,
    recipeVersionPendingArchives,
    collections,
    recipeCollections,
    accountErasureJobs,
    RECIPE_VISIBILITIES,
    RECIPE_SOURCE_TYPES,
    FOOD_RESOLUTION_STATUSES,
    COLLECTION_VISIBILITIES,
    RECIPE_COLLECTION_ADDED_VIA,
    PENDING_ARCHIVE_STATUSES,
    ERASURE_JOB_STATUSES,
} from '../schema/index.js';
import type {
    RecipeRow,
    IngredientRow,
    RecipeVersionRow,
    CollectionRow,
    AccountErasureJobRow,
} from '../schema/index.js';

/** Normalize a column's SQL type (drizzle renders `numeric(8, 2)` with a space; we compare loosely). */
const sqlType = (c: PgColumn): string => c.getSQLType().replace(/\s+/g, '');

/**
 * Assert a Drizzle table's columns match the data-model.md contract EXACTLY: same set of DB column
 * names, same SQL type, same nullability. Keyed by the physical (snake_case) DB column name.
 */
function expectColumns(table: Table, expected: Record<string, { type: string; notNull: boolean }>): void {
    const cols = Object.values(getTableColumns(table)) as PgColumn[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort(), `${getTableName(table)} column set`).toEqual(Object.keys(expected).sort());

    for (const [name, spec] of Object.entries(expected)) {
        const col = byName.get(name);
        expect(col, `${getTableName(table)}.${name} exists`).toBeDefined();
        expect(sqlType(col as PgColumn), `${getTableName(table)}.${name} sql type`).toBe(spec.type.replace(/\s+/g, ''));
        expect((col as PgColumn).notNull, `${getTableName(table)}.${name} notNull`).toBe(spec.notNull);
    }
}

describe('recipe-service schema — D2: no local users table', () => {
    it('the schema barrel exports NO users table', () => {
        expect(Object.keys(schema)).not.toContain('users');
    });

    it('no exported Drizzle table is named "users"', () => {
        const tableNames = Object.values(schema)
            .filter((v): v is Table => typeof v === 'object' && v !== null && Symbol.for('drizzle:Name') in v)
            .map((t) => getTableName(t));
        expect(tableNames).not.toContain('users');
    });

    it('owner_id / created_by are VARCHAR(255) app-user ULIDs (no FK, no users table)', () => {
        expect(getTableColumns(recipes).ownerId.getSQLType()).toBe('varchar(255)');
        expect(getTableColumns(recipes).ownerId.notNull).toBe(true);
        expect(getTableColumns(recipeVersions).createdBy.getSQLType()).toBe('varchar(255)');
        expect(getTableColumns(recipeVersions).createdBy.notNull).toBe(true);
        expect(getTableColumns(collections).ownerId.getSQLType()).toBe('varchar(255)');
        expect(getTableColumns(accountErasureJobs).ownerId.getSQLType()).toBe('varchar(255)');
    });
});

describe('recipe-service schema — table contracts (T011–T014, T118, T119, T121, T122)', () => {
    it('recipes (T011 + T118 deleted_at)', () => {
        expect(getTableName(recipes)).toBe('recipes');
        expectColumns(recipes, {
            id: { type: 'uuid', notNull: true },
            owner_id: { type: 'varchar(255)', notNull: true },
            title: { type: 'text', notNull: true },
            description: { type: 'text', notNull: false },
            prep_time_minutes: { type: 'integer', notNull: false },
            cook_time_minutes: { type: 'integer', notNull: false },
            total_time_minutes: { type: 'integer', notNull: false },
            servings: { type: 'integer', notNull: false },
            visibility: { type: 'text', notNull: true },
            source_type: { type: 'text', notNull: true },
            source_url: { type: 'text', notNull: false },
            source_attribution: { type: 'text', notNull: false },
            cloned_from_id: { type: 'uuid', notNull: false },
            has_substantive_edit: { type: 'boolean', notNull: true },
            cuisine: { type: 'text', notNull: false },
            dietary_flags: { type: 'text[]', notNull: true },
            tags: { type: 'text[]', notNull: true },
            has_partial_nutrition: { type: 'boolean', notNull: true },
            current_version: { type: 'integer', notNull: true },
            ingredient_names_text: { type: 'text', notNull: true },
            search_vector: { type: 'tsvector', notNull: false },
            deleted_at: { type: 'timestamp with time zone', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
            updated_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('recipe_steps (T011)', () => {
        expect(getTableName(recipeSteps)).toBe('recipe_steps');
        expectColumns(recipeSteps, {
            id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            step_number: { type: 'integer', notNull: true },
            instruction: { type: 'text', notNull: true },
            timer_seconds: { type: 'integer', notNull: false },
        });
    });

    it('ingredients (T012)', () => {
        expect(getTableName(ingredients)).toBe('ingredients');
        expectColumns(ingredients, {
            id: { type: 'uuid', notNull: true },
            name: { type: 'text', notNull: true },
            food_id: { type: 'text', notNull: false },
            food_resolution_status: { type: 'text', notNull: false },
            is_user_entered: { type: 'boolean', notNull: true },
            calories_per_100g: { type: 'numeric(8,2)', notNull: false },
            protein_g_per_100g: { type: 'numeric(8,2)', notNull: false },
            carbs_g_per_100g: { type: 'numeric(8,2)', notNull: false },
            fat_g_per_100g: { type: 'numeric(8,2)', notNull: false },
            search_vector: { type: 'tsvector', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('recipe_ingredients (T012)', () => {
        expect(getTableName(recipeIngredients)).toBe('recipe_ingredients');
        expectColumns(recipeIngredients, {
            id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            ingredient_id: { type: 'uuid', notNull: true },
            quantity: { type: 'numeric(10,3)', notNull: true },
            unit: { type: 'text', notNull: true },
            display_text: { type: 'text', notNull: false },
            sort_order: { type: 'integer', notNull: true },
            ingredient_name: { type: 'text', notNull: true },
            is_user_entered: { type: 'boolean', notNull: true },
            user_calories: { type: 'numeric(8,2)', notNull: false },
            user_protein_g: { type: 'numeric(8,2)', notNull: false },
            user_carbs_g: { type: 'numeric(8,2)', notNull: false },
            user_fat_g: { type: 'numeric(8,2)', notNull: false },
        });
    });

    it('recipe_photos (T013)', () => {
        expect(getTableName(recipePhotos)).toBe('recipe_photos');
        expectColumns(recipePhotos, {
            id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            s3_key: { type: 'text', notNull: true },
            content_type: { type: 'text', notNull: true },
            size_bytes: { type: 'integer', notNull: false },
            sort_order: { type: 'integer', notNull: true },
            created_at: { type: 'timestamp with time zone', notNull: true },
            updated_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('recipe_versions (T013)', () => {
        expect(getTableName(recipeVersions)).toBe('recipe_versions');
        expectColumns(recipeVersions, {
            id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            version_number: { type: 'integer', notNull: true },
            snapshot: { type: 'jsonb', notNull: true },
            base_version: { type: 'integer', notNull: false },
            s3_key: { type: 'text', notNull: false },
            created_by: { type: 'varchar(255)', notNull: true },
            change_summary: { type: 'text', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('recipe_version_pending_archives (T121)', () => {
        expect(getTableName(recipeVersionPendingArchives)).toBe('recipe_version_pending_archives');
        expectColumns(recipeVersionPendingArchives, {
            id: { type: 'uuid', notNull: true },
            recipe_version_id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            version_number: { type: 'integer', notNull: true },
            status: { type: 'text', notNull: true },
            attempts: { type: 'integer', notNull: true },
            last_error: { type: 'text', notNull: false },
            next_attempt_at: { type: 'timestamp with time zone', notNull: true },
            sqs_message_id: { type: 'text', notNull: false },
            sqs_receipt: { type: 'text', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
            updated_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('collections (T014 + T119 source_collection_id)', () => {
        expect(getTableName(collections)).toBe('collections');
        expectColumns(collections, {
            id: { type: 'uuid', notNull: true },
            owner_id: { type: 'varchar(255)', notNull: true },
            name: { type: 'text', notNull: true },
            description: { type: 'text', notNull: false },
            visibility: { type: 'text', notNull: true },
            source_collection_id: { type: 'uuid', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
            updated_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('recipe_collections (T014 + T119 added_via)', () => {
        expect(getTableName(recipeCollections)).toBe('recipe_collections');
        expectColumns(recipeCollections, {
            collection_id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            added_at: { type: 'timestamp with time zone', notNull: true },
            added_via: { type: 'text', notNull: true },
        });
    });

    it('account_erasure_jobs (T122)', () => {
        expect(getTableName(accountErasureJobs)).toBe('account_erasure_jobs');
        expectColumns(accountErasureJobs, {
            id: { type: 'uuid', notNull: true },
            owner_id: { type: 'varchar(255)', notNull: true },
            status: { type: 'text', notNull: true },
            attempts: { type: 'integer', notNull: true },
            last_error: { type: 'text', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
            updated_at: { type: 'timestamp with time zone', notNull: true },
        });
    });
});

describe('recipe-service schema — controlled value sets (CHECK enums)', () => {
    it('recipe visibility', () => {
        expect(RECIPE_VISIBILITIES).toEqual(['public', 'private']);
    });
    it('recipe source_type', () => {
        expect(RECIPE_SOURCE_TYPES).toEqual(['user_created', 'imported_public', 'imported_physical', 'imported_paid']);
    });
    it('food_resolution_status mirrors the food client FoodStatus (UPPER_SNAKE, incl. terminals)', () => {
        expect(FOOD_RESOLUTION_STATUSES).toEqual(['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED']);
    });
    it('collection visibility (private by default)', () => {
        expect(COLLECTION_VISIBILITIES).toEqual(['public', 'private']);
    });
    it('recipe_collections added_via provenance', () => {
        expect(RECIPE_COLLECTION_ADDED_VIA).toEqual(['manual', 'clone_seed', 'pull']);
    });
    it('pending-archive status', () => {
        expect(PENDING_ARCHIVE_STATUSES).toEqual(['pending', 'in_flight', 'failed', 'dlq']);
    });
    it('account erasure job status', () => {
        expect(ERASURE_JOB_STATUSES).toEqual(['queued', 'running', 'completed', 'failed']);
    });
});

describe('recipe-service schema — inferred row types compile with correct nullability', () => {
    it('RecipeRow: required scalars are non-nullable; optionals are nullable', () => {
        expectTypeOf<RecipeRow['id']>().toEqualTypeOf<string>();
        expectTypeOf<RecipeRow['ownerId']>().toEqualTypeOf<string>();
        expectTypeOf<RecipeRow['title']>().toEqualTypeOf<string>();
        expectTypeOf<RecipeRow['dietaryFlags']>().toEqualTypeOf<string[]>();
        expectTypeOf<RecipeRow['currentVersion']>().toEqualTypeOf<number>();
        expectTypeOf<RecipeRow['description']>().toEqualTypeOf<string | null>();
        expectTypeOf<RecipeRow['deletedAt']>().toEqualTypeOf<Date | null>();
        expectTypeOf<RecipeRow['clonedFromId']>().toEqualTypeOf<string | null>();
    });

    it('IngredientRow / RecipeVersionRow / CollectionRow / AccountErasureJobRow compile', () => {
        expectTypeOf<IngredientRow['foodId']>().toEqualTypeOf<string | null>();
        expectTypeOf<IngredientRow['isUserEntered']>().toEqualTypeOf<boolean>();
        expectTypeOf<RecipeVersionRow['snapshot']>().not.toBeNever();
        expectTypeOf<RecipeVersionRow['createdBy']>().toEqualTypeOf<string>();
        expectTypeOf<CollectionRow['sourceCollectionId']>().toEqualTypeOf<string | null>();
        expectTypeOf<AccountErasureJobRow['status']>().toBeString();
    });
});
