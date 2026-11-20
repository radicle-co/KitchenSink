/**
 * Drizzle mirror for `recipe_source_evidence` (migration 0086): the append-only record of every third-party source ever
 * stated for a recipe.
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0086_recipe_source_evidence.sql` is the SOURCE OF TRUTH (repo
 * convention); its header carries the design: append-only by trigger, a deferred backstop on `recipes`, and clone inheritance.
 */
import { inArray, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { RECIPE_SOURCE_KINDS, type RecipeSourceKind } from '@kitchensink/recipe-core';

import { recipes } from './recipes.js';

/** How a statement reached the service, mirrored from the SQL CHECK. */
export const SOURCE_EVIDENCE_CAPTURES = ['pastedPage', 'editorLink', 'editorCitation', 'importFile'] as const;

/**
 * The source kinds an `editorCitation` row may hold: the cook typed a citation for a book or a paid site. Mirrored from
 * the SQL `recipe_source_evidence_capture_shape` CHECK (migration 0091), and the LOCAL e2e parity test inserts every
 * kind to keep the two equal.
 */
export const EDITOR_CITATION_SOURCE_KINDS = ['book', 'paid_site'] as const satisfies readonly RecipeSourceKind[];

/** One way a statement reached the service. */
export type SourceEvidenceCapture = (typeof SOURCE_EVIDENCE_CAPTURES)[number];

export const recipeSourceEvidence = pgTable(
    'recipe_source_evidence',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        capture: text('capture').$type<SourceEvidenceCapture>().notNull(),
        sourceUrl: text('source_url'),
        sourceKey: text('source_key'),
        sourceDomain: text('source_domain'),
        sourceKind: text('source_kind').$type<RecipeSourceKind>(),
        citation: text('citation'),
        pasteDigest: text('paste_digest'),
        creditAuthors: text('credit_authors').array(),
        creditPublisher: text('credit_publisher'),
        creditCopyrightNotice: text('credit_copyright_notice'),
        creditCopyrightHolder: text('credit_copyright_holder'),
        creditLicense: text('credit_license'),
        imageUrl: text('image_url'),
        recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('recipe_source_evidence_capture_check', inArray(table.capture, [...SOURCE_EVIDENCE_CAPTURES])),
        check('recipe_source_evidence_source_kind_check', inArray(table.sourceKind, [...RECIPE_SOURCE_KINDS])),
        index('recipe_source_evidence_recipe_id_idx').on(table.recipeId),
        index('recipe_source_evidence_source_key_idx').on(table.sourceKey),
    ],
);

export type RecipeSourceEvidenceRow = InferSelectModel<typeof recipeSourceEvidence>;
export type NewRecipeSourceEvidenceRow = InferInsertModel<typeof recipeSourceEvidence>;
