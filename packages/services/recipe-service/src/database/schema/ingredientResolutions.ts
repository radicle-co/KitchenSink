/**
 * Drizzle definition for the cascade's provenance EVENTS (plan U2, migration 0035).
 *
 * ⚠️ The hand-authored SQL is the SOURCE OF TRUTH (repo convention): `0035_ingredient_resolutions.sql`
 * for why these are EVENTS keyed by the shared row rather than line columns, and why there is deliberately
 * no `user_id`; `0051_ingredient_grain.sql` for the re-point below.
 *
 * ⚠️ SINCE 0051 THE SUBJECT IS `food_lookups`, NOT THE DEAD CATALOG. 0035's grain argument is unchanged —
 * a resolution is a fact about one admission at one moment, never a property of the shared row — and
 * `food_lookups` IS the shared row the old `ingredients` catalog was. A resolution may now point at a
 * binding on the UNRESOLVED arm: the cascade ran, produced evidence, and produced no food. That is a
 * coherent inhabitant, not corruption.
 *
 * The ranked columns (`rung`, `margin`, `shortlist`, `bandEpoch`) are nullable because today's tiers
 * (curated, memo) rank nothing — the lexical tier (plan U4) is what populates them, and the band log
 * (plan U3) is what reads them.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { boolean, check, index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ingredientResolutions = pgTable(
    'ingredient_resolutions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        foodLookupId: uuid('food_lookup_id').notNull(),
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
        /** U11 (0040): the shortlist contained the caller's own private food — excluded from band stats. */
        authorAugmented: boolean('author_augmented').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('ingredient_resolutions_tier_check', sql`${table.tier} IN ('curated', 'lexical', 'memo', 'llm')`),
        index('ingredient_resolutions_lookup_latest_idx').on(table.foodLookupId, table.createdAt),
    ],
);

export type IngredientResolutionRow = InferSelectModel<typeof ingredientResolutions>;
export type NewIngredientResolutionRow = InferInsertModel<typeof ingredientResolutions>;
