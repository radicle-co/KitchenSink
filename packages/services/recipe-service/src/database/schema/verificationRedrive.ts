/**
 * Drizzle mirror of the pending-verification RE-DRIVE substrate (plan U4c, migration 0037).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0037_verification_redrive.sql` is the SOURCE OF
 * TRUTH (repo convention); its header carries the design — producer-built messages keyed on the verdict
 * store's content key, re-sent by the drain while no verdict exists.
 */
import { pgTable, index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export const verificationRedrive = pgTable(
    'recipe_ingredient_verification_redrive',
    {
        verificationKey: text('verification_key').primaryKey(),
        /** The ready `VerifyIngredientLineMessage`, verbatim. */
        message: jsonb('message').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        /** When the drain last re-sent this row. Null until the first re-drive. */
        lastDrivenAt: timestamp('last_driven_at', { withTimezone: true }),
    },
    (table) => [index('verification_redrive_age_idx').on(table.createdAt)],
);

export type VerificationRedriveRow = InferSelectModel<typeof verificationRedrive>;
export type NewVerificationRedriveRow = InferInsertModel<typeof verificationRedrive>;
