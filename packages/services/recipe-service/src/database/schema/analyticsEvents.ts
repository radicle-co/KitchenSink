/**
 * Drizzle mirrors for the analytics events store (analytics plan U1, migration 0043).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0043_analytics_events.sql` is the SOURCE OF TRUTH
 * (repo convention); its header carries the design — delta-upsert fold on EXACTLY one INSERT-only
 * trigger (never 0010's recompute), anonymize-on-erase (KD4), lifetime counts that never decrement
 * (KD6), no foreign keys in either direction, and the PARTIAL idempotency index whose predicate every
 * `ON CONFLICT` landing must repeat.
 *
 * ⛔ `recipeImpactSignals` has ONE legal writer: the `analytics_events_fold_on_insert` trigger.
 * Application code reads it (015's future consumer) and NEVER writes it — a second writer would race
 * the fold and corrupt lifetime history. It is deliberately viewer-less (012-FR-024).
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * The closed v1 event vocabulary, mirrored from the SQL CHECK. Extension is ADDITIVE (origin R8):
 * a new family (e.g. `recipe_cooked` when 015 ships) lands as a migration extending the CHECK plus a
 * member here — never a wire-contract change.
 */
export const ANALYTICS_EVENT_TYPES = ['recipe_saved', 'recipe_viewed', 'query_outcome'] as const;

export const analyticsEvents = pgTable(
    'analytics_events',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        /** Client-minted idempotency key (KTD5); NULL on server-door rows. */
        eventId: uuid('event_id'),
        eventType: text('event_type').notNull(),
        /** The actor's opaque app ULID; NULL after erasure — rows survive their author (KD4). */
        userId: varchar('user_id', { length: 255 }),
        recipeId: uuid('recipe_id'),
        /** The typed search text (query family only); blanked by the erasure sweep with user_id. */
        queryText: text('query_text'),
        payload: jsonb('payload').notNull().default({}),
        /** Client clock on ingest-door rows — untrusted; never keys retention or an index. */
        occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
        /** Server clock — the ONLY time column retention or indexes may key. */
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check(
            'analytics_events_type_valid',
            sql`${table.eventType} IN ('recipe_saved', 'recipe_viewed', 'query_outcome')`,
        ),
        // The erasure pairing rule (KTD8): a typed query may not outlive its author's id.
        check('analytics_events_query_text_needs_user', sql`${table.queryText} IS NULL OR ${table.userId} IS NOT NULL`),
        // Fold families upsert by recipe — a NULL recipe there would abort the capturing INSERT.
        check(
            'analytics_events_credit_needs_recipe',
            sql`${table.eventType} = 'query_outcome' OR ${table.recipeId} IS NOT NULL`,
        ),
        // Idempotency is a persistent invariant: client-door rows always carry their retry key.
        check(
            'analytics_events_client_event_needs_id',
            sql`${table.eventType} <> 'query_outcome' OR ${table.eventId} IS NOT NULL`,
        ),
        // PARTIAL: server-door rows (NULL event_id) stay out of the idempotency namespace. Every
        // landing must spell `ON CONFLICT (event_id) WHERE event_id IS NOT NULL` to match it.
        uniqueIndex('analytics_events_event_id_key')
            .on(table.eventId)
            .where(sql`${table.eventId} IS NOT NULL`),
        index('analytics_events_created_idx').on(table.createdAt),
        index('analytics_events_user_idx')
            .on(table.userId)
            .where(sql`${table.userId} IS NOT NULL`),
        index('analytics_events_recipe_idx')
            .on(table.recipeId, table.createdAt)
            .where(sql`${table.recipeId} IS NOT NULL`),
    ],
);

export const recipeImpactSignals = pgTable(
    'recipe_impact_signals',
    {
        recipeId: uuid('recipe_id').primaryKey(),
        saveCount: bigint('save_count', { mode: 'number' }).notNull().default(0),
        viewCount: bigint('view_count', { mode: 'number' }).notNull().default(0),
        /** Provisioned for 015's `recipe_cooked` (KTD2/SC2); unwritten and unread in v1. */
        cookCount: bigint('cook_count', { mode: 'number' }).notNull().default(0),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('recipe_impact_signals_save_count_nonneg', sql`${table.saveCount} >= 0`),
        check('recipe_impact_signals_view_count_nonneg', sql`${table.viewCount} >= 0`),
        check('recipe_impact_signals_cook_count_nonneg', sql`${table.cookCount} >= 0`),
    ],
);

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];
export type AnalyticsEventRow = InferSelectModel<typeof analyticsEvents>;
export type NewAnalyticsEventRow = InferInsertModel<typeof analyticsEvents>;
export type RecipeImpactSignalRow = InferSelectModel<typeof recipeImpactSignals>;
