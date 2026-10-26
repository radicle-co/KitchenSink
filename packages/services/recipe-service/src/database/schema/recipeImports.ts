/**
 * Drizzle mirrors for bulk recipe import (ADR-0072, migration 0059): the header, its items, and the snapshot of each
 * item's match lines.
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0059_recipe_imports.sql` is the SOURCE OF TRUTH (repo convention);
 * its header carries the design — the client drives the import, the snapshot outlives the one-day parse job (so the lines
 * hold NO key to the job tables), `saved_at` and `allowance_spent_at` are facts of their own, one parse job per item,
 * no food names and no verdict. `schemaModelConformance` executes every model here against the migrated table, and
 * `importSchemaParity.test.ts` compares each vocabulary below with the CHECK it mirrors.
 */
import { inArray, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    boolean,
    check,
    doublePrecision,
    foreignKey,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';

import { recipeParseJobs } from './parseJobs.js';
import { recipes } from './recipes.js';

/** How an import matches: Save lines as written / Pick the best match for me / Let me review each. Mirrors `MATCH_MODES`. */
export const IMPORT_MATCH_MODES = ['keepAsWritten', 'bindBest', 'review'] as const;

/** Public or private, for the whole import and, optionally, per recipe. */
export const IMPORT_VISIBILITIES = ['public', 'private'] as const;

/** Where an item stands. `ready` is not a stage: readiness is computed from the lines, never stored. */
export const IMPORT_STAGES = ['received', 'parsing', 'matched', 'saved'] as const;

/** The cook's mark on an item in the wizard. Mirrors `ITEM_REVIEWS`. */
export const IMPORT_ITEM_REVIEWS = ['pending', 'reviewed', 'skipped'] as const;

/** The two forms of the per-recipe statement (ADR-0072 §9): "I wrote this" and "From a source". */
export const IMPORT_STATEMENT_KINDS = ['authored', 'source'] as const;

/** What a "from a source" statement says the source is. */
export const IMPORT_SOURCE_KINDS = ['public_web', 'book', 'paid_site'] as const;

/** The tiers that may propose a food, as 0057 stores them. */
export const IMPORT_MATCHED_BY = ['curated', 'memo', 'lexical'] as const;

/** Where the review gate's request stands for a snapshot line. */
export const IMPORT_LINE_REVIEWS = ['owed', 'refused'] as const;

/** One stage of an item. */
export type ImportStage = (typeof IMPORT_STAGES)[number];

/** One statement form. */
export type ImportStatementKind = (typeof IMPORT_STATEMENT_KINDS)[number];

/** One source kind. */
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

export const recipeImports = pgTable(
    'recipe_imports',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: varchar('user_id', { length: 255 }).notNull(),
        matchMode: text('match_mode').notNull(),
        visibility: text('visibility').notNull(),
        /** The wizard position. A position equal to the item count is done; it is derived, not stored. */
        cursorOrdinal: integer('cursor_ordinal').notNull().default(0),
        reviewClosedAt: timestamp('review_closed_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('recipe_imports_match_mode_check', inArray(table.matchMode, [...IMPORT_MATCH_MODES])),
        check('recipe_imports_visibility_check', inArray(table.visibility, [...IMPORT_VISIBILITIES])),
        check('recipe_imports_cursor_ordinal_check', sql`${table.cursorOrdinal} >= 0`),
        index('recipe_imports_user_created_idx').on(table.userId, table.createdAt),
    ],
);

export const recipeImportItems = pgTable(
    'recipe_import_items',
    {
        importId: uuid('import_id')
            .notNull()
            .references(() => recipeImports.id, { onDelete: 'cascade' }),
        ordinal: integer('ordinal').notNull(),
        /** The recipe as the client sent it; dropped once saved. Its size is the contract's bound. */
        payload: jsonb('payload'),
        stage: text('stage').notNull().default('received'),
        review: text('review').notNull().default('pending'),
        /** SET NULL: the TTL purge deletes jobs daily; the snapshot has what is needed. */
        parseJobId: uuid('parse_job_id').references(() => recipeParseJobs.id, { onDelete: 'set null' }),
        allowanceSpentAt: timestamp('allowance_spent_at', { withTimezone: true }),
        matchedAt: timestamp('matched_at', { withTimezone: true }),
        savedAt: timestamp('saved_at', { withTimezone: true }),
        /** SET NULL: the cook may delete the draft, and the item stays saved. */
        recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
        statementKind: text('statement_kind'),
        citation: text('citation'),
        sourceKind: text('source_kind'),
        /** This recipe's own choice, overriding the import's. */
        visibility: text('visibility'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.importId, table.ordinal] }),
        check('recipe_import_items_ordinal_check', sql`${table.ordinal} >= 0`),
        check('recipe_import_items_stage_check', inArray(table.stage, [...IMPORT_STAGES])),
        check('recipe_import_items_review_check', inArray(table.review, [...IMPORT_ITEM_REVIEWS])),
        check('recipe_import_items_statement_kind_check', inArray(table.statementKind, [...IMPORT_STATEMENT_KINDS])),
        check('recipe_import_items_source_kind_check', inArray(table.sourceKind, [...IMPORT_SOURCE_KINDS])),
        check('recipe_import_items_visibility_check', inArray(table.visibility, [...IMPORT_VISIBILITIES])),
        check(
            'recipe_import_items_citation_check',
            sql`btrim(${table.citation}) <> '' AND char_length(${table.citation}) <= 2000`,
        ),
        check(
            'recipe_import_items_payload_is_object',
            sql`${table.payload} IS NULL OR jsonb_typeof(${table.payload}) = 'object'`,
        ),
        check('recipe_import_items_payload_until_saved', sql`${table.payload} IS NOT NULL OR ${table.stage} = 'saved'`),
        check('recipe_import_items_saved_iff_stage', sql`(${table.savedAt} IS NOT NULL) = (${table.stage} = 'saved')`),
        check(
            'recipe_import_items_matched_iff_stage',
            sql`(${table.matchedAt} IS NOT NULL) = (${table.stage} IN ('matched', 'saved'))`,
        ),
        check('recipe_import_items_recipe_needs_save', sql`${table.recipeId} IS NULL OR ${table.savedAt} IS NOT NULL`),
        check(
            'recipe_import_items_job_needs_payment',
            sql`${table.parseJobId} IS NULL OR ${table.allowanceSpentAt} IS NOT NULL`,
        ),
        check(
            'recipe_import_items_statement_authored',
            sql`${table.statementKind} IS DISTINCT FROM 'authored' OR (${table.citation} IS NULL AND ${table.sourceKind} IS NULL)`,
        ),
        check(
            'recipe_import_items_statement_source',
            sql`${table.statementKind} IS DISTINCT FROM 'source' OR (${table.citation} IS NOT NULL AND ${table.sourceKind} IS NOT NULL)`,
        ),
        check(
            'recipe_import_items_statement_recorded',
            sql`${table.statementKind} IS NOT NULL OR (${table.citation} IS NULL AND ${table.sourceKind} IS NULL)`,
        ),
        check(
            'recipe_import_items_saved_has_statement',
            sql`${table.savedAt} IS NULL OR ${table.statementKind} IS NOT NULL`,
        ),
        // One job per item and one item per recipe (partial: most items have neither at first).
        uniqueIndex('recipe_import_items_parse_job_idx')
            .on(table.parseJobId)
            .where(sql`${table.parseJobId} IS NOT NULL`),
        uniqueIndex('recipe_import_items_recipe_idx')
            .on(table.recipeId)
            .where(sql`${table.recipeId} IS NOT NULL`),
    ],
);

export const recipeImportLines = pgTable(
    'recipe_import_lines',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        importId: uuid('import_id').notNull(),
        ordinal: integer('ordinal').notNull(),
        lineIndex: integer('line_index').notNull(),
        foodIndex: integer('food_index').notNull(),
        lineDigest: text('line_digest').notNull(),
        judgementDigest: text('judgement_digest').notNull(),
        /** The ingredient phrase the parse lifted out of the line, in the source's own words. */
        phrase: text('phrase').notNull(),
        quantity: numeric('quantity', { precision: 10, scale: 3 }),
        quantityHigh: numeric('quantity_high', { precision: 10, scale: 3 }),
        unit: text('unit').notNull(),
        statedQuantity: numeric('stated_quantity', { precision: 10, scale: 3 }),
        statedQuantityHigh: numeric('stated_quantity_high', { precision: 10, scale: 3 }),
        statedUnit: text('stated_unit'),
        preparation: text('preparation'),
        matchedBy: text('matched_by'),
        foodId: text('food_id'),
        foodVariantId: text('food_variant_id'),
        rung: text('rung'),
        margin: doublePrecision('margin'),
        /** [{ kind, id, rung, isDefault }], ids only, at most five. */
        candidates: jsonb('candidates')
            .notNull()
            .default(sql`'[]'::jsonb`),
        verificationKey: text('verification_key'),
        review: text('review'),
        pickedFoodId: text('picked_food_id'),
        pickedFoodVariantId: text('picked_food_variant_id'),
        pickedAsWritten: boolean('picked_as_written').notNull().default(false),
        pickedAgainstDigest: text('picked_against_digest'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        foreignKey({
            columns: [table.importId, table.ordinal],
            foreignColumns: [recipeImportItems.importId, recipeImportItems.ordinal],
            name: 'recipe_import_lines_import_id_ordinal_fkey',
        }).onDelete('cascade'),
        unique('recipe_import_lines_position_key').on(table.importId, table.ordinal, table.lineIndex, table.foodIndex),
        check('recipe_import_lines_line_index_check', sql`${table.lineIndex} >= 0`),
        check('recipe_import_lines_food_index_check', sql`${table.foodIndex} >= 0`),
        check('recipe_import_lines_matched_by_check', inArray(table.matchedBy, [...IMPORT_MATCHED_BY])),
        check('recipe_import_lines_review_check', inArray(table.review, [...IMPORT_LINE_REVIEWS])),
        check('recipe_import_lines_one_food', sql`num_nonnulls(${table.foodId}, ${table.foodVariantId}) <= 1`),
        check(
            'recipe_import_lines_food_has_tier',
            sql`(${table.matchedBy} IS NULL) = (num_nonnulls(${table.foodId}, ${table.foodVariantId}) = 0)`,
        ),
        check(
            'recipe_import_lines_key_has_food',
            sql`${table.verificationKey} IS NULL OR num_nonnulls(${table.foodId}, ${table.foodVariantId}) = 1`,
        ),
        check(
            'recipe_import_lines_key_iff_owed',
            sql`(${table.review} IS NOT DISTINCT FROM 'owed') = (${table.verificationKey} IS NOT NULL)`,
        ),
        check(
            'recipe_import_lines_review_iff_food',
            sql`(${table.review} IS NULL) = (num_nonnulls(${table.foodId}, ${table.foodVariantId}) = 0)`,
        ),
        check(
            'recipe_import_lines_candidates_bounded',
            sql`jsonb_typeof(${table.candidates}) = 'array' AND jsonb_array_length(${table.candidates}) <= 5`,
        ),
        check(
            'recipe_import_lines_one_pick',
            sql`num_nonnulls(${table.pickedFoodId}, ${table.pickedFoodVariantId}) + (${table.pickedAsWritten})::int <= 1`,
        ),
        check(
            'recipe_import_lines_pick_has_digest',
            sql`(num_nonnulls(${table.pickedFoodId}, ${table.pickedFoodVariantId}) > 0 OR ${table.pickedAsWritten}) = (${table.pickedAgainstDigest} IS NOT NULL)`,
        ),
        check('recipe_import_lines_quantity_positive', sql`${table.quantity} > 0`),
        check(
            'recipe_import_lines_quantity_coherent',
            sql`${table.quantityHigh} IS NULL OR (${table.quantity} IS NOT NULL AND ${table.quantityHigh} > ${table.quantity})`,
        ),
        check(
            'recipe_import_lines_stated_measure_coherent',
            sql`(${table.statedQuantity} IS NULL AND ${table.statedQuantityHigh} IS NULL AND ${table.statedUnit} IS NULL) OR (${table.statedQuantity} IS NOT NULL AND ${table.statedQuantity} > 0 AND ${table.statedUnit} IS NOT NULL AND ${table.statedUnit} <> '' AND ${table.quantity} IS NOT NULL AND (${table.statedQuantityHigh} IS NULL OR ${table.statedQuantityHigh} > ${table.statedQuantity}))`,
        ),
        check(
            'recipe_import_lines_preparation_check',
            sql`${table.preparation} IS NULL OR btrim(${table.preparation}) <> ''`,
        ),
    ],
);

export type RecipeImportRow = InferSelectModel<typeof recipeImports>;
export type NewRecipeImportRow = InferInsertModel<typeof recipeImports>;
export type RecipeImportItemRow = InferSelectModel<typeof recipeImportItems>;
export type NewRecipeImportItemRow = InferInsertModel<typeof recipeImportItems>;
export type RecipeImportLineRow = InferSelectModel<typeof recipeImportLines>;
export type NewRecipeImportLineRow = InferInsertModel<typeof recipeImportLines>;
