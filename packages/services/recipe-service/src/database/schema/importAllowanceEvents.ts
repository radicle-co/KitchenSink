/**
 * Drizzle mirror for the daily import allowance ledger (004 FR-022, migration 0058).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0058_import_allowance_events.sql` is the SOURCE OF TRUTH (repo
 * convention); its header carries the design: one row per unit spent, an event counts for 24 hours, no GRANT written
 * (the service role's DML comes from the default privileges, ADR-0039), erased with its user.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** What can spend a unit of the allowance, mirrored from the SQL CHECK. */
export const IMPORT_ALLOWANCE_CHANNELS = ['paste', 'bulk'] as const;

/** One channel that can spend a unit. */
export type ImportAllowanceChannel = (typeof IMPORT_ALLOWANCE_CHANNELS)[number];

export const importAllowanceEvents = pgTable(
    'import_allowance_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: varchar('user_id', { length: 255 }).notNull(),
        channel: text('channel').notNull(),
        units: integer('units').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('import_allowance_events_channel_check', sql`${table.channel} IN ('paste', 'bulk')`),
        check('import_allowance_events_units_check', sql`${table.units} > 0`),
        index('import_allowance_events_user_created_idx').on(table.userId, table.createdAt),
    ],
);

export type ImportAllowanceEventRow = InferSelectModel<typeof importAllowanceEvents>;
export type NewImportAllowanceEventRow = InferInsertModel<typeof importAllowanceEvents>;
