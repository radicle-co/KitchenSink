/**
 * The test principal's picked roots (migration `0023_test_picked_roots.sql`, ADR-0040 food half): which catalog roots a
 * signed test principal's remote pick created, so the test purge can take them back. The migration is the source of
 * truth; this model documents it for the DAO.
 *
 * @module
 */
import { sql, type InferSelectModel } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { food } from './food.js';

/** One row per root a test principal's pick created. */
export const testPickedRoot = pgTable(
    'test_picked_root',
    {
        foodId: text('food_id')
            .primaryKey()
            .references(() => food.id, { onDelete: 'cascade' }),
        /** The pool user's app-user ULID. */
        createdBy: text('created_by').notNull(),
        /** A real cook has answered this root since; the purge keeps it. */
        heldByRealUser: boolean('held_by_real_user').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('test_picked_root_created_by_present', sql`char_length(${table.createdBy}) > 0`),
        index('test_picked_root_created_by_idx').on(table.createdBy),
    ],
);

/** A `test_picked_root` row as selected. */
export type TestPickedRootRow = InferSelectModel<typeof testPickedRoot>;
