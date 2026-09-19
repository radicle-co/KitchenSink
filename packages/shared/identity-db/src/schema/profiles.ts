import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { users } from './users.js';

/** @implements REQ-015 REQ-019 REQ-025 FR-015 FR-019 FR-025 ARCH-015 MOD-015 */
export const profiles = pgTable(
    'profiles',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        displayName: text('display_name').notNull(),
        avatarUrl: text('avatar_url'),
        bio: text('bio'),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        /**
         * U9 (R21/R25): when a handle sync became owed, or NULL when nothing is owed.
         *
         * ⛔ Set in the SAME statement as the display-name change, because the publish happens after the
         * commit and is deliberately best-effort — a failed fan-out must not fail the rename. Before this
         * column a failed publish left nothing behind at all: the name changed in identity, never changed on
         * the cook's recipes, and the only trace was one log line.
         *
         * ⚠️ A TIMESTAMP, not a boolean. A second rename while the first publish is still failing must keep
         * the NEWER intent, and the backstop needs the age to tell a stale debt from a seconds-old one.
         */
        handleSyncOwedAt: timestamp('handle_sync_owed_at', { withTimezone: true }),
        /**
         * U9: why the last publish failed, as a CODE from a closed vocabulary.
         *
         * ⚠️ Never an exception message — those can carry a display name, and this column exists to make a
         * failure visible without copying the user's text anywhere new.
         */
        handleSyncFailureCode: text('handle_sync_failure_code'),
    },
    (table) => [
        uniqueIndex('profiles_user_id_unique').on(table.userId),
        // Partial: the backstop reads only the owed rows, which are a vanishing fraction of profiles.
        index('profiles_handle_sync_owed_idx')
            .on(table.handleSyncOwedAt)
            .where(sql`handle_sync_owed_at IS NOT NULL`),
    ],
);

/** @implements REQ-015 FR-015 ARCH-015 MOD-015 */
export type ProfileRow = InferSelectModel<typeof profiles>;

/** @implements REQ-015 FR-015 ARCH-015 MOD-015 */
export type NewProfileRow = InferInsertModel<typeof profiles>;
