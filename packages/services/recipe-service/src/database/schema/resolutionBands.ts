/**
 * Drizzle definitions for earned autonomy's MEMORY (plan U3, migration 0036).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0036_resolution_bands.sql` is the SOURCE OF TRUTH
 * (repo convention); its header carries the design — a band is a confidence shape
 * `(rung, margin_band, query_shape, ranker_version)`, the POLICY is `@kitchensink/recipe-core/resolution/band-policy`,
 * and `resolution_band_skips` stores the producer-built verification message so revocation's drain never
 * rebuilds one (R14).
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** The KTD-B lifecycle states, mirrored from the SQL CHECK. */
export const BAND_STATES = ['observing', 'authorized', 'revoked'] as const;

/** Where a band observation's verdict came from, mirrored from the SQL CHECK (R16 lands as correction). */
export const BAND_OBSERVATION_SOURCES = ['gate', 'shadow', 'correction'] as const;

export const resolutionBandAuthority = pgTable(
    'resolution_band_authority',
    {
        rung: text('rung').notNull(),
        marginBand: text('margin_band').notNull(),
        queryShape: text('query_shape').notNull(),
        rankerVersion: text('ranker_version').notNull(),
        state: text('state').notNull().default('observing'),
        /** Increments on each grant; skips record the epoch they happened under (R14). */
        epoch: integer('epoch').notNull().default(0),
        grantedAt: timestamp('granted_at', { withTimezone: true }),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.rung, table.marginBand, table.queryShape, table.rankerVersion] }),
        check('resolution_band_authority_state_check', sql`${table.state} IN ('observing', 'authorized', 'revoked')`),
    ],
);

export const resolutionBandObservations = pgTable(
    'resolution_band_observations',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        rung: text('rung').notNull(),
        marginBand: text('margin_band').notNull(),
        queryShape: text('query_shape').notNull(),
        rankerVersion: text('ranker_version').notNull(),
        /** ⛔ agree/disagree ONLY — a could-not-judge is ABSENCE, never an observation. */
        verdict: text('verdict').notNull(),
        source: text('source').notNull().default('gate'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('resolution_band_observations_verdict_check', sql`${table.verdict} IN ('agree', 'disagree')`),
        check('resolution_band_observations_source_check', sql`${table.source} IN ('gate', 'shadow', 'correction')`),
        index('resolution_band_observations_band_idx').on(
            table.rung,
            table.marginBand,
            table.queryShape,
            table.rankerVersion,
        ),
    ],
);

export const resolutionBandSkips = pgTable('resolution_band_skips', {
    id: uuid('id').primaryKey().defaultRandom(),
    rung: text('rung').notNull(),
    marginBand: text('margin_band').notNull(),
    queryShape: text('query_shape').notNull(),
    rankerVersion: text('ranker_version').notNull(),
    epoch: integer('epoch').notNull(),
    /** The ready `VerifyIngredientLineMessage`, verbatim — the producer built it at skip time. */
    message: jsonb('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the revocation drain sent this message. Never deleted: the row is the audit trail. */
    drainedAt: timestamp('drained_at', { withTimezone: true }),
});

export type BandStateValue = (typeof BAND_STATES)[number];
export type BandObservationSource = (typeof BAND_OBSERVATION_SOURCES)[number];
export type ResolutionBandAuthorityRow = InferSelectModel<typeof resolutionBandAuthority>;
export type NewResolutionBandAuthorityRow = InferInsertModel<typeof resolutionBandAuthority>;
export type ResolutionBandObservationRow = InferSelectModel<typeof resolutionBandObservations>;
export type NewResolutionBandObservationRow = InferInsertModel<typeof resolutionBandObservations>;
export type ResolutionBandSkipRow = InferSelectModel<typeof resolutionBandSkips>;
export type NewResolutionBandSkipRow = InferInsertModel<typeof resolutionBandSkips>;
