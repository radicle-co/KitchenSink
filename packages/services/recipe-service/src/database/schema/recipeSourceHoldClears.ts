/**
 * Drizzle mirror for `recipe_source_hold_clears` (migration 0100): the append-only record of every clear of a recipe's correction
 * hold, by staff or by the cook's earned rewrite (ADR-0106).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0100_recipe_source_hold_clears.sql` is the SOURCE OF TRUTH. A trigger writes
 * `recorded_at` and `xact_id`, so there is no insert type here: the DAL inserts through SQL and names only the columns the caller
 * owns.
 */
import { inArray, sql, type InferSelectModel } from 'drizzle-orm';
import { check, customType, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { HOLD_CLEAR_CAUSES, SOURCE_CORRECTION_REASON_MAX_LENGTH, type HoldClearCause } from '@kitchensink/recipe-core';

import { recipes } from './recipes.js';

/** Postgres `xid8`, read as a decimal string (drizzle has no native type). */
const xid8 = customType<{ data: string; driverData: string }>({
    dataType() {
        return 'xid8';
    },
});

export const recipeSourceHoldClears = pgTable(
    'recipe_source_hold_clears',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        cause: text('cause').$type<HoldClearCause>().notNull(),
        /** The staff account (`erased_` plus 32 hex once erased); NULL only for an earned rewrite. */
        actorAccountId: varchar('actor_account_id', { length: 255 }),
        reason: text('reason').notNull(),
        /** Written by the stamp trigger. */
        recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
        /** Written by the stamp trigger: the top-level transaction id. */
        xactId: xid8('xact_id').notNull(),
    },
    (table) => [
        check('recipe_source_hold_clears_cause_check', inArray(table.cause, [...HOLD_CLEAR_CAUSES])),
        check(
            'recipe_source_hold_clears_cause_actor',
            sql`(${table.cause} = 'staff') = (${table.actorAccountId} IS NOT NULL)`,
        ),
        check(
            'recipe_source_hold_clears_earned_reason',
            sql`${table.cause} <> 'earnedRewrite' OR ${table.reason} = 'earnedRewrite'`,
        ),
        check(
            'recipe_source_hold_clears_reason_check',
            sql`btrim(${table.reason}) <> '' AND length(${table.reason}) <= ${SOURCE_CORRECTION_REASON_MAX_LENGTH}`,
        ),
        check(
            'recipe_source_hold_clears_actor_shape',
            sql`${table.actorAccountId} !~ '^erased_' OR ${table.actorAccountId} ~ '^erased_[0-9a-f]{32}$'`,
        ),
        unique('recipe_source_hold_clears_recipe_xact_key').on(table.recipeId, table.xactId),
    ],
);

export type RecipeSourceHoldClearRow = InferSelectModel<typeof recipeSourceHoldClears>;
