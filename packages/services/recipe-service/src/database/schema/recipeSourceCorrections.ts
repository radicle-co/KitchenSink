/**
 * Drizzle mirror for `recipe_source_corrections` (migration 0092): the append-only record of every staff correction of a recipe's
 * source answer.
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0092_recipe_source_lock.sql` is the SOURCE OF TRUTH (repo convention); its
 * header carries the design: append-only by trigger, one row per correction, and one erasure update that relabels the actor.
 */
import { inArray, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import {
    SOURCE_CORRECTION_GROUNDS,
    SOURCE_CORRECTION_REASON_MAX_LENGTH,
    type SourceCorrectionGround,
} from '@kitchensink/recipe-core';

import { recipes } from './recipes.js';

export const recipeSourceCorrections = pgTable(
    'recipe_source_corrections',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        /** The staff account, or `erased_` plus 32 hex characters once that account is erased. */
        actorAccountId: varchar('actor_account_id', { length: 255 }).notNull(),
        recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
        oldSourceType: text('old_source_type').notNull(),
        newSourceType: text('new_source_type').notNull(),
        oldSourceKind: text('old_source_kind'),
        newSourceKind: text('new_source_kind'),
        oldStatementKind: text('old_statement_kind'),
        newStatementKind: text('new_statement_kind'),
        oldSourceUrl: text('old_source_url'),
        newSourceUrl: text('new_source_url'),
        oldSourceAttribution: text('old_source_attribution'),
        newSourceAttribution: text('new_source_attribution'),
        ground: text('ground').$type<SourceCorrectionGround>().notNull(),
        reason: text('reason').notNull(),
    },
    (table) => [
        check('recipe_source_corrections_ground_check', inArray(table.ground, [...SOURCE_CORRECTION_GROUNDS])),
        check(
            'recipe_source_corrections_reason_check',
            sql`btrim(${table.reason}) <> '' AND length(${table.reason}) <= ${SOURCE_CORRECTION_REASON_MAX_LENGTH}`,
        ),
        check(
            'recipe_source_corrections_actor_shape',
            sql`${table.actorAccountId} !~ '^erased_' OR ${table.actorAccountId} ~ '^erased_[0-9a-f]{32}$'`,
        ),
        index('recipe_source_corrections_recipe_idx').on(table.recipeId, table.recordedAt),
    ],
);

export type RecipeSourceCorrectionRow = InferSelectModel<typeof recipeSourceCorrections>;
export type NewRecipeSourceCorrectionRow = InferInsertModel<typeof recipeSourceCorrections>;
