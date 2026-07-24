import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { users } from './users.js';

/** @implements REQ-014 REQ-017 REQ-018 REQ-025 FR-014 FR-017 FR-018 FR-025 ARCH-012 MOD-012 */
export const accounts = pgTable(
    'accounts',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: text('user_id')
            .notNull()
            .unique()
            .references(() => users.id, { onDelete: 'cascade' }),
        subscriptionTier: text('subscription_tier').notNull().default('free'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('accounts_user_id_idx').on(table.userId),
        uniqueIndex('accounts_user_id_unique').on(table.userId),
    ],
);

/** @implements REQ-014 REQ-017 FR-014 FR-017 ARCH-012 MOD-012 */
export type AccountRow = InferSelectModel<typeof accounts>;

/** @implements REQ-014 REQ-017 FR-014 FR-017 ARCH-012 MOD-012 */
export type NewAccountRow = InferInsertModel<typeof accounts>;
