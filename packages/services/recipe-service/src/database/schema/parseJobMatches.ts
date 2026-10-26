/**
 * Drizzle mirror for a paste job's match proposals (ADR-0071, migration 0057).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0057_recipe_parse_job_matches.sql` is the SOURCE OF TRUTH
 * (repo convention); its header carries the design: proposals that bind nothing, no food names, keyed to the LINE so a
 * job's deletion (and account erasure, which deletes jobs) removes them.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    check,
    doublePrecision,
    foreignKey,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';

import { recipeParseJobLines } from './parseJobs.js';

/** The tiers that may propose a food, mirrored from the SQL CHECK. */
export const MATCH_PROPOSING_TIERS = ['curated', 'memo', 'lexical'] as const;

/** One tier that may propose a food. */
export type MatchProposingTier = (typeof MATCH_PROPOSING_TIERS)[number];

/** Where a proposal's review stands, mirrored from the SQL CHECK. */
export const MATCH_REVIEWS = ['owed', 'refused'] as const;

export const recipeParseJobMatches = pgTable(
    'recipe_parse_job_matches',
    {
        jobId: uuid('job_id').notNull(),
        lineIndex: integer('line_index').notNull(),
        foodIndex: integer('food_index').notNull(),
        lineDigest: text('line_digest').notNull(),
        judgementDigest: text('judgement_digest').notNull(),
        /** NULL: the chain found nothing. */
        matchedBy: text('matched_by'),
        foodId: text('food_id'),
        foodVariantId: text('food_variant_id'),
        rung: text('rung'),
        margin: doublePrecision('margin'),
        /** `[{ kind, id, rung }]`, ids only, food's ranked order, at most five. */
        candidates: jsonb('candidates')
            .notNull()
            .default(sql`'[]'::jsonb`),
        verificationKey: text('verification_key'),
        /** `owed` or `refused`; NULL: nothing to review. */
        review: text('review'),
        enqueuedAt: timestamp('enqueued_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.jobId, table.lineIndex, table.foodIndex] }),
        foreignKey({
            columns: [table.jobId, table.lineIndex],
            foreignColumns: [recipeParseJobLines.jobId, recipeParseJobLines.lineIndex],
        }).onDelete('cascade'),
        check('recipe_parse_job_matches_food_index_check', sql`${table.foodIndex} >= 0`),
        check('recipe_parse_job_matches_matched_by_check', sql`${table.matchedBy} IN ('curated', 'memo', 'lexical')`),
        check('recipe_parse_job_matches_one_food', sql`num_nonnulls(${table.foodId}, ${table.foodVariantId}) <= 1`),
        check(
            'recipe_parse_job_matches_food_has_tier',
            sql`(${table.matchedBy} IS NULL) = (num_nonnulls(${table.foodId}, ${table.foodVariantId}) = 0)`,
        ),
        check(
            'recipe_parse_job_matches_key_has_food',
            sql`${table.verificationKey} IS NULL OR num_nonnulls(${table.foodId}, ${table.foodVariantId}) = 1`,
        ),
        check('recipe_parse_job_matches_review_check', sql`${table.review} IN ('owed', 'refused')`),
        check(
            'recipe_parse_job_matches_key_iff_owed',
            sql`(${table.review} IS NOT DISTINCT FROM 'owed') = (${table.verificationKey} IS NOT NULL)`,
        ),
        check(
            'recipe_parse_job_matches_refusal_has_food',
            sql`${table.review} IS DISTINCT FROM 'refused' OR num_nonnulls(${table.foodId}, ${table.foodVariantId}) = 1`,
        ),
        check(
            'recipe_parse_job_matches_enqueue_has_key',
            sql`${table.enqueuedAt} IS NULL OR ${table.verificationKey} IS NOT NULL`,
        ),
        check(
            'recipe_parse_job_matches_candidates_bounded',
            sql`jsonb_typeof(${table.candidates}) = 'array' AND jsonb_array_length(${table.candidates}) <= 5`,
        ),
    ],
);

export type RecipeParseJobMatchRow = InferSelectModel<typeof recipeParseJobMatches>;
export type NewRecipeParseJobMatchRow = InferInsertModel<typeof recipeParseJobMatches>;
