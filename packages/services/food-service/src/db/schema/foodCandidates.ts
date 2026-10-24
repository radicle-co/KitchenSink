/**
 * Drizzle table definition for `food_candidates` — the 13th canonical table (D-CANDIDATES), backing
 * the `UNRESOLVED` / disambiguation flow (US-2a: `GET /candidates` → `PATCH`-resolve).
 *
 * The worker persists the surviving per-source candidates on an `UNRESOLVED` outcome; `GET
 * /candidates` reads them; `PATCH`-resolve validates the pick against this set
 * (`CandidateMismatchError` otherwise), RE-FETCHES the picked candidate's full payload from its source
 * by `external_key`, then merges and clears the set. This table stores ONLY disambiguation metadata
 * (`source`, `external_key`, `name`, `summary`) — NO nutrient amounts, portions, or scalar fields
 * (no-raw-payload; the `UNIQUE(food_id, nutrient_id)` golden invariant forbids per-candidate value
 * rows). `created_at` is the candidate-set TTL anchor (FR-025a: expires 30d after).
 *
 * The hand-authored ordered SQL in `../migrations/0000_food_schema.sql` is the SOURCE OF TRUTH.
 *
 * @implements FR-025a FR-028 FR-MRG-5 FR-RES-1 FR-RES-2
 */
import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { food, foodSourceEnum } from './food.js';

/**
 * Per-source candidate set for an `UNRESOLVED` food. `UNIQUE(food_id, source, external_key)` prevents
 * a duplicate candidate; cascades away with its food.
 */
export const foodCandidates = pgTable(
    'food_candidates',
    {
        id: text('id').primaryKey(),
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        source: foodSourceEnum('source').notNull(),
        externalKey: text('external_key').notNull(),
        name: text('name').notNull(),
        summary: text('summary'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        unique('food_candidates_food_source_key_unique').on(table.foodId, table.source, table.externalKey),
        index('food_candidates_food_id_idx').on(table.foodId),
    ],
);

/** A `food_candidates` row as selected. */
export type FoodCandidateRow = InferSelectModel<typeof foodCandidates>;
/** A `food_candidates` row for insert. */
export type NewFoodCandidateRow = InferInsertModel<typeof foodCandidates>;
