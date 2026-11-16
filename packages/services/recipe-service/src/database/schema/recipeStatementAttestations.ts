/**
 * Drizzle mirror for `recipe_statement_attestations` (migration 0088): the append-only record of every statement a cook made
 * about a recipe and every Public confirmation.
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0088_recipe_statement_attestations.sql` is the SOURCE OF TRUTH (repo
 * convention); its header carries the design: append-only by trigger, one row per act, no copy onto a clone.
 */
import { inArray, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { recipes } from './recipes.js';

/** `explicit` is a statement the cook chose; `implicit` is the confirmation shown beside Public. Mirrored from the SQL CHECK. */
export const ATTESTATION_MODES = ['explicit', 'implicit'] as const;

/** What the cook said. `cleared` is a removed statement; `publicConfirm` is the implicit one. Mirrored from the SQL CHECK. */
export const ATTESTATION_CHOICES = ['authored', 'publicWeb', 'book', 'fromPerson', 'cleared', 'publicConfirm'] as const;

/** The write an attestation rode on. Mirrored from the SQL CHECK. */
export const ATTESTATION_ACTIONS = ['create', 'update', 'setVisibility'] as const;

/** One attestation mode. */
export type AttestationMode = (typeof ATTESTATION_MODES)[number];

/** One attestation choice. */
export type AttestationChoice = (typeof ATTESTATION_CHOICES)[number];

/** One attestation action. */
export type AttestationAction = (typeof ATTESTATION_ACTIONS)[number];

export const recipeStatementAttestations = pgTable(
    'recipe_statement_attestations',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        recipeId: uuid('recipe_id')
            .notNull()
            .references(() => recipes.id, { onDelete: 'cascade' }),
        accountId: varchar('account_id', { length: 255 }).notNull(),
        mode: text('mode').$type<AttestationMode>().notNull(),
        choice: text('choice').$type<AttestationChoice>().notNull(),
        wordingVersion: text('wording_version'),
        locale: text('locale'),
        action: text('action').$type<AttestationAction>().notNull(),
        recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('recipe_statement_attestations_mode_check', inArray(table.mode, [...ATTESTATION_MODES])),
        check('recipe_statement_attestations_choice_check', inArray(table.choice, [...ATTESTATION_CHOICES])),
        check('recipe_statement_attestations_action_check', inArray(table.action, [...ATTESTATION_ACTIONS])),
        check(
            'recipe_statement_attestations_account_shape',
            sql`${table.accountId} !~ '^erased_' OR ${table.accountId} ~ '^erased_[0-9a-f]{32}$'`,
        ),
        index('recipe_statement_attestations_recipe_idx').on(table.recipeId, table.recordedAt),
    ],
);

export type RecipeStatementAttestationRow = InferSelectModel<typeof recipeStatementAttestations>;
export type NewRecipeStatementAttestationRow = InferInsertModel<typeof recipeStatementAttestations>;
