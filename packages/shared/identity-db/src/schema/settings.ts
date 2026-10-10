import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { users } from './users.js';

/**
 * One row per user, one typed nullable column per setting (ADR-0059).
 *
 * `NULL` means "never chosen" and is resolved to the default in code, so no setting column carries a database
 * `DEFAULT`. No row exists until a user's first write.
 */
export const settings = pgTable('settings', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    /** Whether the web "/" key focuses search. `NULL` is "never chosen". */
    searchShortcut: boolean('search_shortcut'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A stored settings row. */
export type SettingsRow = InferSelectModel<typeof settings>;

/** A settings row to insert. */
export type NewSettingsRow = InferInsertModel<typeof settings>;
