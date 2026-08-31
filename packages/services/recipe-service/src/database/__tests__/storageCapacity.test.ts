/**
 * THE STORAGE-CAPACITY GATE for the recipe service.
 *
 * > For every wire field that writes to a bounded column, the zod max must be ≤ what the column can
 * > physically store.
 *
 * ── WHY IT EXISTS: NINE MEASURED 500s THAT SHOULD ALL HAVE BEEN 400s ──
 *
 * `POST /api/v1/recipes` with `servings: 9999999999` passed request validation and died at the INSERT with
 * `22003 value "9999999999" is out of range for type integer`, which the `ApiExceptionFilter` collapses to a
 * generic **500** — the caller told the server broke when the caller sent a bad request. `prepTimeMinutes`,
 * `cookTimeMinutes`, `totalTimeMinutes` and a step's `timerSeconds` had the identical shape against `integer`
 * columns; the four per-line nutrition overrides had it against `numeric(8, 2)`; and `expectedVersion` had it
 * against a WHERE clause, which fails the same way (verified against a live PostgreSQL 16).
 *
 * ── WHY IT IS EXHAUSTIVE OVER COLUMNS RATHER THAN OVER THOSE NINE FIELDS ──
 *
 * The accounting below must cover EVERY bounded column in the service. A new `varchar(n)`, `smallint` or
 * `numeric(p,s)` column therefore fails this test the moment it is added, which is the only version of the
 * check that catches the NEXT instance instead of re-litigating the last one. A column that no wire field
 * writes is exempted with a REASON, so an exemption stays a reviewed decision. `describeColumnCapacity` also
 * THROWS on a column type it does not recognize, so a future `bigint` or `char(n)` cannot slip past as
 * "unbounded".
 *
 * ⚠️ THIS IS AN ASSERTION, NOT A DERIVATION. Nothing here generates zod from drizzle and no drizzle type
 * becomes a wire type — that coupling is exactly what §15.2 removed (`RecipeSearchResponse.facets` used to
 * take its wire type from `dal/search.dal.ts`). The test reads both models and compares them; the mapping
 * between them is stated here, by hand, because it is knowledge that exists nowhere else.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    auditStorageCapacity,
    collectBoundedColumns,
    formatStorageCapacityFindings,
    INT4_MAX,
} from '@kitchensink/contract-gen';
import type { ColumnAccount } from '@kitchensink/contract-gen';
import { recipeIngredientQuantitySchema } from '@kitchensink/recipe-core';
import { setRatingRequestSchema } from '../../ratings/ratings.schema.js';

import * as schema from '../schema/index.js';
import {
    createRecipeRequestSchema,
    recipeIngredientInputSchema,
    recipeStepInputSchema,
    updateRecipeRequestSchema,
} from '../../recipes/recipes.schema.js';

const create = createRecipeRequestSchema.shape;
const update = updateRecipeRequestSchema.shape;
const line = recipeIngredientInputSchema.shape;
const step = recipeStepInputSchema.shape;

/**
 * Why an owner/user/actor `varchar(255)` column takes no wire bound.
 *
 * Every one of them holds an app-user ULID (26 characters) or a service-principal label taken from the
 * VERIFIED token, never from a request body — there is no field a caller could put in them. This is also the
 * authorization boundary, so a client-supplied value here would be a far worse bug than an overflow.
 */
const PRINCIPAL_DERIVED = 'Holds a ULID/label from the verified token, never from a request body (D2).';

/** One entry per bounded column. Exhaustive by construction — the audit fails on anything unlisted. */
const accounts: readonly ColumnAccount[] = [
    // ── recipes ───────────────────────────────────────────────────────────────────────────────────
    { table: 'recipes', column: 'owner_id', why: PRINCIPAL_DERIVED },
    {
        table: 'recipes',
        column: 'servings',
        fields: [
            { field: 'CreateRecipeRequest.servings', schema: create.servings },
            { field: 'UpdateRecipeRequest.servings', schema: update.servings },
        ],
    },
    {
        table: 'recipes',
        column: 'prep_time_minutes',
        fields: [
            { field: 'CreateRecipeRequest.prepTimeMinutes', schema: create.prepTimeMinutes },
            { field: 'UpdateRecipeRequest.prepTimeMinutes', schema: update.prepTimeMinutes },
        ],
    },
    {
        table: 'recipes',
        column: 'cook_time_minutes',
        fields: [
            { field: 'CreateRecipeRequest.cookTimeMinutes', schema: create.cookTimeMinutes },
            { field: 'UpdateRecipeRequest.cookTimeMinutes', schema: update.cookTimeMinutes },
        ],
    },
    {
        table: 'recipes',
        column: 'total_time_minutes',
        fields: [
            { field: 'CreateRecipeRequest.totalTimeMinutes', schema: create.totalTimeMinutes },
            { field: 'UpdateRecipeRequest.totalTimeMinutes', schema: update.totalTimeMinutes },
        ],
    },
    {
        table: 'recipes',
        column: 'current_version',
        // Server-incremented on write. It is nonetheless bound to `expectedVersion`, which never writes it but
        // is COMPARED against it (`WHERE current_version = $1`) — an out-of-range parameter fails that
        // comparison with the same `22003`, so the field needs the same ceiling an INSERT would demand.
        fields: [{ field: 'UpdateRecipeRequest.expectedVersion (WHERE comparison)', schema: update.expectedVersion }],
    },
    {
        table: 'recipes',
        column: 'average_rating',
        why: 'numeric(3,2), maintained ONLY by the recipe_ratings_aggregate_refresh() trigger; never written by application code.',
    },
    {
        table: 'recipes',
        column: 'rating_count',
        why: 'Maintained ONLY by the ratings aggregate trigger; never written by application code.',
    },

    // ── recipe_steps ──────────────────────────────────────────────────────────────────────────────
    {
        table: 'recipe_steps',
        column: 'step_number',
        why: 'Server-assigned from the steps array INDEX, so it cannot exceed the array length — itself bounded by the 100 kB JSON body limit. (`steps` carries no explicit cardinality cap; flagged as a product decision, not a storage risk.)',
    },
    {
        table: 'recipe_steps',
        column: 'timer_seconds',
        fields: [{ field: 'CreateRecipeRequest.steps[].timerSeconds', schema: step.timerSeconds }],
    },

    // ── recipe_ingredients ────────────────────────────────────────────────────────────────────────
    // ⚠️ U8 — `ingredients[].quantity` is a DISCRIMINATED UNION now, so the wire paths that reach these two
    // columns are `quantity.value`, `quantity.low` and `quantity.high`. The union node itself carries no
    // `maximum` (the bound lives inside each member's properties), so handing `line.quantity` here would
    // read as UNBOUNDED and quietly pass — the accounting names the bound schema each member composes
    // instead. That the union actually applies it at every member is asserted behaviourally, at the
    // boundary values, by `recipe-core`'s `__tests__/ingredientQuantity.test.ts` and by
    // `dto/__tests__/numericBounds.dto.test.ts` (which drives the real Nest pipe).
    {
        table: 'recipe_ingredients',
        column: 'quantity',
        fields: [
            { field: 'CreateRecipeRequest.ingredients[].quantity.value', schema: recipeIngredientQuantitySchema },
            { field: 'CreateRecipeRequest.ingredients[].quantity.low', schema: recipeIngredientQuantitySchema },
        ],
    },
    {
        table: 'recipe_ingredients',
        column: 'quantity_high',
        fields: [{ field: 'CreateRecipeRequest.ingredients[].quantity.high', schema: recipeIngredientQuantitySchema }],
    },
    // U7/U11 (migration 0027) — what the SOURCE printed, before a historical measure was restated. The wire
    // paths are the members of `statedMeasure.quantity`, and they compose the SAME bound schema the restated
    // pair does, so a stated gill that `numeric(10,3)` cannot store is refused in one place rather than four.
    {
        table: 'recipe_ingredients',
        column: 'stated_quantity',
        fields: [
            {
                field: 'CreateRecipeRequest.ingredients[].statedMeasure.quantity.value',
                schema: recipeIngredientQuantitySchema,
            },
            {
                field: 'CreateRecipeRequest.ingredients[].statedMeasure.quantity.low',
                schema: recipeIngredientQuantitySchema,
            },
        ],
    },
    {
        table: 'recipe_ingredients',
        column: 'stated_quantity_high',
        fields: [
            {
                field: 'CreateRecipeRequest.ingredients[].statedMeasure.quantity.high',
                schema: recipeIngredientQuantitySchema,
            },
        ],
    },
    {
        table: 'recipe_ingredients',
        column: 'sort_order',
        why: 'Server-assigned from the ingredients array INDEX, which the 100-line cap (REQ-003a) bounds.',
    },
    {
        table: 'recipe_ingredients',
        column: 'user_calories',
        fields: [{ field: 'CreateRecipeRequest.ingredients[].userCalories', schema: line.userCalories }],
    },
    {
        table: 'recipe_ingredients',
        column: 'user_protein_g',
        fields: [{ field: 'CreateRecipeRequest.ingredients[].userProteinG', schema: line.userProteinG }],
    },
    {
        table: 'recipe_ingredients',
        column: 'user_carbs_g',
        fields: [{ field: 'CreateRecipeRequest.ingredients[].userCarbsG', schema: line.userCarbsG }],
    },
    {
        table: 'recipe_ingredients',
        column: 'user_fat_g',
        fields: [{ field: 'CreateRecipeRequest.ingredients[].userFatG', schema: line.userFatG }],
    },

    // ── ingredients (the local catalog) ───────────────────────────────────────────────────────────

    // ── recipe_photos ─────────────────────────────────────────────────────────────────────────────
    {
        table: 'recipe_photos',
        column: 'size_bytes',
        why: "Written from the ACTUAL stored object's size, which `PhotosService.confirm` answers 413 for above 5 MB before the insert. The wire `fileSize` is a client CLAIM used only for the presign pre-check and is never persisted.",
    },
    {
        table: 'recipe_photos',
        column: 'sort_order',
        why: 'Server-assigned from the reorder array INDEX, bounded by the 10-photo cap (MAX_RECIPE_PHOTOS).',
    },

    // ── recipe_ratings ────────────────────────────────────────────────────────────────────────────
    { table: 'recipe_ratings', column: 'user_id', why: PRINCIPAL_DERIVED },
    {
        table: 'recipe_ratings',
        column: 'stars',
        fields: [{ field: 'SetRatingRequest.stars', schema: setRatingRequestSchema.shape.stars }],
    },

    // ── recipe_versions / pending archives ────────────────────────────────────────────────────────
    {
        table: 'recipe_versions',
        column: 'version_number',
        why: "Server-assigned from the recipe's incrementing current_version. ⚠️ RESIDUAL: the versions vertical's `{versionNumber}` PATH PARAM is a client-supplied value that reaches `WHERE version_number = $1` through a bare `ParseIntPipe` with no range check, so an out-of-range path segment is still a 500 there. Out of scope for the recipes vertical; reported as a follow-up rather than left silent.",
    },
    {
        table: 'recipe_versions',
        column: 'base_version',
        why: 'Server-recorded from the version the write started from; no wire field sets it.',
    },
    { table: 'recipe_versions', column: 'created_by', why: PRINCIPAL_DERIVED },
    {
        table: 'recipe_version_pending_archives',
        column: 'version_number',
        why: 'Copied from the version row the archive worker is retrying; no wire field sets it.',
    },
    {
        table: 'recipe_version_pending_archives',
        column: 'attempts',
        why: 'Server-incremented retry counter; no wire field sets it.',
    },

    // ── collections / author handles / account erasure ────────────────────────────────────────────
    { table: 'collections', column: 'owner_id', why: PRINCIPAL_DERIVED },
    { table: 'author_handles', column: 'user_id', why: PRINCIPAL_DERIVED },
    { table: 'account_erasure_jobs', column: 'owner_id', why: PRINCIPAL_DERIVED },

    // ── ingredient resolution knowledge base (plan U10, 0021) ─────────────────────────────────────
    // The caller-supplied halves of a correction — the phrase and the food id — are `text`, deliberately:
    // `normalized_key` is DERIVED from a bounded wire field rather than being one, and bounding it here would
    // pin the key's length to the phrase's, which the derivation is free to change.
    { table: 'ingredient_resolution_mappings', column: 'user_id', why: PRINCIPAL_DERIVED },
    // U11 (0040): captured from the AUTHENTICATED principal at admission/refresh — never a wire field.
    { table: 'ingredients', column: 'food_owner_id', why: PRINCIPAL_DERIVED },

    // ── parse-correction tier (plan U21, 0029) ────────────────────────────────────────────────────
    // Same shape, same reasoning: `source_line` and `corrected_facts` are the caller-supplied halves and are
    // `text`/`jsonb`, and `normalized_key` is DERIVED from the line rather than being a wire field itself.
    { table: 'ingredient_parse_corrections', column: 'user_id', why: PRINCIPAL_DERIVED },
    { table: 'account_erasure_jobs', column: 'actor', why: PRINCIPAL_DERIVED },
    {
        table: 'account_erasure_jobs',
        column: 'attempts',
        why: 'Server-incremented retry counter; no wire field sets it.',
    },

    // ── parse jobs (plan U8/U9, 0039) ─────────────────────────────────────────────────────────────
    { table: 'recipe_parse_jobs', column: 'owner_id', why: PRINCIPAL_DERIVED },
    {
        table: 'recipe_parse_job_lines',
        column: 'line_index',
        why: 'Server-assigned from the split of the submitted text; the queue message caps it at 9,999 (parseJobMessage) and the U9 request schema bounds the line count below that.',
    },
    {
        table: 'recipe_parse_job_lines',
        column: 'llm_attempts',
        why: 'Server-recorded from the validator loop (bounded at MAX_PARSE_ATTEMPTS = 4); no wire field sets it.',
    },

    // ── band authority (plan U3, 0036) ────────────────────────────────────────────────────────────
    {
        table: 'resolution_band_authority',
        column: 'epoch',
        why: 'Server-incremented on each grant by the band state machine; no wire field sets it.',
    },
    {
        table: 'resolution_band_skips',
        column: 'epoch',
        why: 'Copied from the authority row at skip time by the producer; no wire field sets it.',
    },
];

describe('storage capacity — every wire bound fits the column it writes', () => {
    it('holds for every bounded column in the recipe service', () => {
        const findings = auditStorageCapacity({ tables: schema, accounts });

        expect(formatStorageCapacityFindings(findings)).toBe('');
    });

    it('accounts for EVERY bounded column, so a new one fails this test on arrival', () => {
        const bounded = collectBoundedColumns(schema).map((column) => `${column.table}.${column.column}`);
        const accounted = accounts.map((account) => `${account.table}.${account.column}`);

        expect([...accounted].sort()).toEqual([...bounded].sort());
    });

    it('recognizes every column type the service actually uses', () => {
        // `collectBoundedColumns` THROWS on an unrecognized drizzle column type rather than assuming it is
        // unbounded, so this call passing is itself the assertion.
        expect(() => collectBoundedColumns(schema)).not.toThrow();
    });
});

describe('the gate CATCHES each of the nine defects it was built for', () => {
    /**
     * The bound each of the nine fields carried BEFORE this change: an integer with no maximum. Note that
     * `z.number().int()` is not "unbounded" in JSON Schema — it promises a SAFE INTEGER, 9007199254740991,
     * which is 4.2 million times the int4 ceiling. That is precisely why the defect was invisible.
     */
    const UNBOUNDED_INT = z.number().int().positive();

    it.each([
        ['recipes', 'servings'],
        ['recipes', 'prep_time_minutes'],
        ['recipes', 'cook_time_minutes'],
        ['recipes', 'total_time_minutes'],
        ['recipe_steps', 'timer_seconds'],
        ['recipes', 'current_version'],
        ['recipe_ingredients', 'user_calories'],
        ['recipe_ingredients', 'user_protein_g'],
        ['recipe_ingredients', 'quantity'],
    ])('reports %s.%s the moment its wire field loses its maximum', (table, column) => {
        const findings = auditStorageCapacity({
            tables: schema,
            accounts: accounts.map((existing) =>
                existing.table === table && existing.column === column
                    ? { table, column, fields: [{ field: 'regression probe', schema: UNBOUNDED_INT }] }
                    : existing,
            ),
        });

        expect(findings).toHaveLength(1);
        expect(formatStorageCapacityFindings(findings)).toMatch(new RegExp(`${table}\\.${column}`, 'u'));
    });

    it('reports a bounded column that nobody accounted for', () => {
        const findings = auditStorageCapacity({
            tables: schema,
            accounts: accounts.filter((account) => account.column !== 'servings'),
        });

        expect(formatStorageCapacityFindings(findings)).toMatch(/recipes\.servings/u);
    });

    it('knows the int4 ceiling it is comparing against', () => {
        expect(INT4_MAX).toBe(2_147_483_647);
    });
});
