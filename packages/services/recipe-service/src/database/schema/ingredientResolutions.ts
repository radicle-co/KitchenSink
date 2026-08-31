/**
 * Drizzle definition for the cascade's provenance EVENTS (plan U2, migration 0035).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0035_ingredient_resolutions.sql` is the SOURCE OF
 * TRUTH (repo convention); read its header for why these are events keyed by ingredient rather than line
 * columns, and why there is deliberately NO `user_id` until plan U11 lands the R20 dimension together
 * with its erasure ruling.
 *
 * The ranked columns (`rung`, `margin`, `shortlist`, `bandEpoch`) are nullable because today's tiers
 * (curated, memo) rank nothing — the lexical tier (plan U4) is what populates them, and the band log
 * (plan U3) is what reads them.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ingredientResolutions = pgTable(
    'ingredient_resolutions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ingredientId: uuid('ingredient_id').notNull(),
        /** A `RESOLUTION_TIER_IDS` member — CHECKed in SQL so a typo'd tier is refused at the write. */
        tier: text('tier').notNull(),
        /** The winner's rank rung (`RankTier`), null for tiers that rank nothing. */
        rung: text('rung'),
        /** `top - runnerUp`, null when there was no runner-up. Raw value; bucketing is U3 calibration. */
        margin: numeric('margin'),
        /** The FULL structured `ScoredCandidate[]` snapshot (KTD-C) — null for non-ranking tiers. */
        shortlist: jsonb('shortlist'),
        /** The band key's third axis (`QueryShape`), recorded at resolve time (plan U3, 0036). */
        queryShape: text('query_shape'),
        /** The ranker version the shortlist was produced under — the band key's fourth axis (0036). */
        rankerVersion: text('ranker_version'),
        /** The band-authority epoch the resolution was made under (plan U3). Null until bands exist. */
        bandEpoch: text('band_epoch'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('ingredient_resolutions_tier_check', sql`${table.tier} IN ('curated', 'lexical', 'memo', 'llm')`),
        index('ingredient_resolutions_latest_idx').on(table.ingredientId, table.createdAt),
    ],
);

export type IngredientResolutionRow = InferSelectModel<typeof ingredientResolutions>;
export type NewIngredientResolutionRow = InferInsertModel<typeof ingredientResolutions>;
