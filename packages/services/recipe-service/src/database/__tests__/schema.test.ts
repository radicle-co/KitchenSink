import { describe, it, expect, expectTypeOf } from 'vitest';
import { getTableColumns, getTableName, type Table } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
    RecipeVisibility as RecipeCoreVisibility,
    RecipeSourceType as RecipeCoreSourceType,
    RecipeDifficulty as RecipeCoreDifficulty,
    RecipeStatus as RecipeCoreStatus,
    FoodResolutionStatus as RecipeCoreFoodResolutionStatus,
    RecipeCollectionAddedVia as RecipeCoreCollectionAddedVia,
    RecipeVersionArchiveStatus as RecipeCoreVersionArchiveStatus,
    foodResolutionStatusSchema,
    lineResolutionStatusSchema,
} from '@kitchensink/recipe-core';

import * as schema from '../schema/index.js';
import {
    recipes,
    recipeSteps,
    ingredients,
    recipeIngredients,
    recipePhotos,
    recipeRatings,
    authorHandles,
    recipeVersions,
    recipeVersionPendingArchives,
    collections,
    recipeCollections,
    accountErasureJobs,
    RECIPE_VISIBILITIES,
    RECIPE_SOURCE_TYPES,
    RECIPE_DIFFICULTIES,
    RECIPE_STATUSES,
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

/** Sorted-array set-equality: order-independent, so array authoring order never fails the assertion. */
const expectSetEqual = (actual: readonly string[], expected: readonly string[]): void => {
    expect([...actual].sort()).toEqual([...expected].sort());
};

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
        // Existence IS the check here: the set-equality assertion above already guarantees every expected
        // name is present, but this per-column lookup pinpoints exactly WHICH column is missing (with its
        // own labeled failure message) instead of only a whole-set diff, before the two shape assertions
        // below dereference `col` as a `PgColumn`.
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
        // Widened to `unknown` values first: the barrel also exports non-table members (types, the
        // custom `tsvector` column builder), so `Object.values(schema)` is a union a `v is Table`
        // predicate is not assignable to. Narrowing from `unknown` is what makes the guard legal.
        const tableNames = Object.values(schema as Record<string, unknown>)
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
            prep_time_minutes: { type: 'integer', notNull: true },
            cook_time_minutes: { type: 'integer', notNull: true },
            total_time_minutes: { type: 'integer', notNull: true },
            servings: { type: 'integer', notNull: true },
            // CR-001: nullable difficulty (no default) + trigger-maintained rating aggregate.
            difficulty: { type: 'text', notNull: false },
            average_rating: { type: 'numeric(3,2)', notNull: false },
            rating_count: { type: 'integer', notNull: true },
            visibility: { type: 'text', notNull: true },
            source_type: { type: 'text', notNull: true },
            source_url: { type: 'text', notNull: false },
            source_attribution: { type: 'text', notNull: false },
            cloned_from_id: { type: 'uuid', notNull: false },
            has_substantive_edit: { type: 'boolean', notNull: true },
            cuisine: { type: 'text', notNull: false },
            dietary_flags: { type: 'text[]', notNull: true },
            tags: { type: 'text[]', notNull: true },
            author_handle: { type: 'text', notNull: false },
            status: { type: 'text', notNull: true },
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
            search_vector: { type: 'tsvector', notNull: false },
            // U5/U6 (migration 0024): the materialized ranking terms the tier ladder sorts on. Nullable
            // because they are GENERATED from `name` — Postgres owns the value and no writer supplies it.
            rank_folded: { type: 'text', notNull: false },
            rank_tokens: { type: 'text[]', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('recipe_ingredients (T012)', () => {
        expect(getTableName(recipeIngredients)).toBe('recipe_ingredients');
        expectColumns(recipeIngredients, {
            id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            ingredient_id: { type: 'uuid', notNull: true },
            // U8/R41 — NULLABLE since migration 0020: `NULL` is the ONE representation of "the source
            // stated no amount". `quantity_high` carries the upper bound of a stated range (R36).
            quantity: { type: 'numeric(10,3)', notNull: false },
            quantity_high: { type: 'numeric(10,3)', notNull: false },
            unit: { type: 'text', notNull: true },
            display_text: { type: 'text', notNull: false },
            // U11/U14 (migration 0024) — the RAW line the cook's source stated. NULLABLE, and the null is a
            // STATEMENT rather than missing data: it means the line was AUTHORED, not transcribed, which
            // `decideVerification` reads as `skip: 'no-source-text'`. ⛔ Distinct from `display_text` (an
            // author-chosen display override) and from `ingredient_name` (OUR rendering) — the verification
            // gate checks our parse against this, and checking a parse against its own output always agrees.
            source_line: { type: 'text', notNull: false },
            // U7/U11 (migration 0027) — what the SOURCE printed, before a historical measure was restated
            // into one the USDA household-portion table carries. All three are NULL together for an authored
            // line, for a line stating a modern unit, and for every line imported before 0027. Without them
            // the gate is shown `0.5 cup` beside a source reading `one gill of milk` and correctly disagrees
            // with a line we parsed RIGHT.
            stated_quantity: { type: 'numeric(10,3)', notNull: false },
            stated_quantity_high: { type: 'numeric(10,3)', notNull: false },
            stated_unit: { type: 'text', notNull: false },
            // U26/U27 (migration 0030) — how this recipe prepares the food, and which section the line sits
            // in. Both NULLABLE, and `NULL` is the ONLY spelling of absent: a `NOT VALID` CHECK refuses `''`
            // and whitespace-only, so "no preparation" and "ungrouped" cannot acquire a second
            // representation. ⛔ `preparation` is distinct from `display_text`, which is a free-form display
            // OVERRIDE whose one producer (the cookbook importer) fills it with the source's whole clause.
            preparation: { type: 'text', notNull: false },
            group_label: { type: 'text', notNull: false },
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
            // The cover-thumbnail rendition key (FOLLOW-UP-CR-001-A) — nullable (pre-feature / degraded rows).
            thumbnail_key: { type: 'text', notNull: false },
            content_type: { type: 'text', notNull: true },
            size_bytes: { type: 'integer', notNull: false },
            sort_order: { type: 'integer', notNull: true },
            created_at: { type: 'timestamp with time zone', notNull: true },
            updated_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('recipe_ratings (CR-001 / FR-013)', () => {
        expect(getTableName(recipeRatings)).toBe('recipe_ratings');
        expectColumns(recipeRatings, {
            id: { type: 'uuid', notNull: true },
            recipe_id: { type: 'uuid', notNull: true },
            // The RATER's app-user ULID — no FK, no users table (D2), same as recipes.owner_id.
            user_id: { type: 'varchar(255)', notNull: true },
            stars: { type: 'integer', notNull: true },
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
            device_label: { type: 'text', notNull: false },
            editor_handle: { type: 'text', notNull: false },
            created_at: { type: 'timestamp with time zone', notNull: true },
        });
    });

    it('author_handles (W8-a.2 read model)', () => {
        expect(getTableName(authorHandles)).toBe('author_handles');
        expectColumns(authorHandles, {
            user_id: { type: 'varchar(255)', notNull: true },
            display_name: { type: 'text', notNull: true },
            source_timestamp: { type: 'timestamp with time zone', notNull: true },
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

    it('collections (T014 + T119 source_collection_id + W5 pull provenance)', () => {
        expect(getTableName(collections)).toBe('collections');
        expectColumns(collections, {
            id: { type: 'uuid', notNull: true },
            owner_id: { type: 'varchar(255)', notNull: true },
            name: { type: 'text', notNull: true },
            description: { type: 'text', notNull: false },
            visibility: { type: 'text', notNull: true },
            source_collection_id: { type: 'uuid', notNull: false },
            // W5 Task 1: pull-refresh provenance (populated by later tasks; nullable, no default).
            last_pulled_at: { type: 'timestamp with time zone', notNull: false },
            source_owner_handle: { type: 'text', notNull: false },
            source_collection_name: { type: 'text', notNull: false },
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
            // CR-002 / U3b+U3a: the durable DONATE election + the captured removed-recipe set (crash-convergence).
            publish_recipe_ids: { type: 'jsonb', notNull: false },
            removed_recipe_ids: { type: 'jsonb', notNull: false },
            // CR-002 / U4a (migration 0018): the R8 audit fields — who/what triggered the erasure and when
            // it was confirmed. trigger_source is NOT NULL (default 'user'); actor/confirmed_at are nullable
            // (backfilled for pre-0018 rows, always written by the app on new rows).
            trigger_source: { type: 'text', notNull: true },
            actor: { type: 'varchar(255)', notNull: false },
            confirmed_at: { type: 'timestamp with time zone', notNull: false },
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

describe('recipe-service schema — value sets are tied to @kitchensink/recipe-core (S-R5)', () => {
    // Runtime companion to the compile-time `satisfies readonly <RecipeCoreType>[]` tie on each schema
    // array: even if the `satisfies` constraint were ever loosened or bypassed, a value-set divergence
    // from recipe-core's authoritative enums is still caught HERE, at test time. Each pair below MUST
    // set-equal recipe-core's own `Object.values(...)` — never a hand-copied literal — so a rename or
    // addition in recipe-core (e.g. W8-a.3's `draft` status) fails this test the moment it's out of sync.
    it('RECIPE_VISIBILITIES set-equals recipe-core RecipeVisibility', () => {
        expectSetEqual(RECIPE_VISIBILITIES, Object.values(RecipeCoreVisibility));
    });
    it('RECIPE_SOURCE_TYPES set-equals recipe-core RecipeSourceType', () => {
        expectSetEqual(RECIPE_SOURCE_TYPES, Object.values(RecipeCoreSourceType));
    });
    it('RECIPE_DIFFICULTIES set-equals recipe-core RecipeDifficulty', () => {
        expectSetEqual(RECIPE_DIFFICULTIES, Object.values(RecipeCoreDifficulty));
    });
    it('RECIPE_STATUSES set-equals recipe-core RecipeStatus', () => {
        expectSetEqual(RECIPE_STATUSES, Object.values(RecipeCoreStatus));
    });
    it('FOOD_RESOLUTION_STATUSES set-equals recipe-core’s CATALOG status schema — NOT the wider union', () => {
        // ⛔ REWRITTEN, not relaxed (plan U14). This used to compare against `Object.values(
        // FoodResolutionStatus)`, which was the same set. That union has since gained `NEEDS_REVIEW` — the
        // verification gate's own per-RECIPE-LINE verdict — and migration 0023 forbids writing one to this
        // SHARED, ownerless catalog column, blast radius first among its three reasons. The authority for
        // what this column may hold is therefore `foodResolutionStatusSchema` (the five-value food-service
        // mirror), and comparing against it is what keeps the guard meaningful instead of merely green.
        expectSetEqual(FOOD_RESOLUTION_STATUSES, foodResolutionStatusSchema.options);
    });

    it('⛔ FOOD_RESOLUTION_STATUSES EXCLUDES NEEDS_REVIEW, which the line union carries and this one may not', () => {
        expect(FOOD_RESOLUTION_STATUSES).not.toContain(RecipeCoreFoodResolutionStatus.NEEDS_REVIEW);
        expect(lineResolutionStatusSchema.options).toContain(RecipeCoreFoodResolutionStatus.NEEDS_REVIEW);
    });
    it('COLLECTION_VISIBILITIES set-equals recipe-core RecipeVisibility (Collection.visibility reuses it)', () => {
        expectSetEqual(COLLECTION_VISIBILITIES, Object.values(RecipeCoreVisibility));
    });
    it('RECIPE_COLLECTION_ADDED_VIA set-equals recipe-core RecipeCollectionAddedVia', () => {
        expectSetEqual(RECIPE_COLLECTION_ADDED_VIA, Object.values(RecipeCoreCollectionAddedVia));
    });
    it('PENDING_ARCHIVE_STATUSES set-equals recipe-core RecipeVersionArchiveStatus', () => {
        expectSetEqual(PENDING_ARCHIVE_STATUSES, Object.values(RecipeCoreVersionArchiveStatus));
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

    it('CollectionRow: W5 pull provenance columns are nullable', () => {
        expectTypeOf<CollectionRow['lastPulledAt']>().toEqualTypeOf<Date | null>();
        expectTypeOf<CollectionRow['sourceOwnerHandle']>().toEqualTypeOf<string | null>();
        expectTypeOf<CollectionRow['sourceCollectionName']>().toEqualTypeOf<string | null>();

        const fixture: Pick<CollectionRow, 'lastPulledAt' | 'sourceOwnerHandle' | 'sourceCollectionName'> = {
            lastPulledAt: null,
            sourceOwnerHandle: null,
            sourceCollectionName: null,
        };
        expect(fixture.lastPulledAt).toBeNull();

        const populated: Pick<CollectionRow, 'lastPulledAt' | 'sourceOwnerHandle' | 'sourceCollectionName'> = {
            lastPulledAt: new Date('2026-07-24T00:00:00.000Z'),
            sourceOwnerHandle: '@chef',
            sourceCollectionName: 'Weeknight Dinners',
        };
        expect(populated.sourceOwnerHandle).toBe('@chef');
    });
});
