import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
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
    },
    (table) => [uniqueIndex('profiles_user_id_unique').on(table.userId)],
);

/** @implements REQ-015 FR-015 ARCH-015 MOD-015 */
export type ProfileRow = InferSelectModel<typeof profiles>;

/** @implements REQ-015 FR-015 ARCH-015 MOD-015 */
export type NewProfileRow = InferInsertModel<typeof profiles>;
