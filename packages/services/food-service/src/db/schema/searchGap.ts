/**
 * The search-gap record (migration `0022_search_gap.sql`, ADR-0055 point 4): wording a cook used for a food our
 * catalog holds under other words, one row per query, source and item, counted. No user (ADR-0027). The migration is
 * the source of truth; this model documents it for the DAO.
 *
 * @module
 */
import { sql, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { foodVariant } from './catalogItems.js';
import { food, foodSourceEnum } from './food.js';

/** One gap per query, source and item. */
export const searchGap = pgTable(
    'search_gap',
    {
        /** The canonical term the cook searched for. */
        query: text('query').notNull(),
        source: foodSourceEnum('source').notNull(),
        /** The source's key for the item it answered with. */
        externalKey: text('external_key').notNull(),
        /** The root that holds the item. */
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        /** The variant that holds the item, when one does. */
        foodVariantId: text('food_variant_id').references(() => foodVariant.id, { onDelete: 'cascade' }),
        /** The source's name for the item. */
        remoteName: text('remote_name').notNull(),
        occurrences: integer('occurrences').notNull().default(1),
        firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ name: 'search_gap_pkey', columns: [table.query, table.source, table.externalKey] }),
        check('search_gap_query_length', sql`char_length(${table.query}) BETWEEN 1 AND 200`),
        check('search_gap_counted', sql`${table.occurrences} >= 1`),
        check('search_gap_seen_in_order', sql`${table.lastSeenAt} >= ${table.firstSeenAt}`),
        index('search_gap_last_seen_idx').on(table.lastSeenAt),
        index('search_gap_food_id_idx').on(table.foodId),
        index('search_gap_food_variant_id_idx')
            .on(table.foodVariantId)
            .where(sql`${table.foodVariantId} IS NOT NULL`),
    ],
);

/** A `search_gap` row as selected. */
export type SearchGapRow = InferSelectModel<typeof searchGap>;
