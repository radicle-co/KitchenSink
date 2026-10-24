/**
 * Drizzle mirror of `catalog_seed_ledger` (`../migrations/0018_food_catalog_items_roots_variants.sql` and
 * `../migrations/0021_catalog_seed_recorded.sql`, curated catalog plan KTD-4, KTD-13): one row per applied seed
 * digest, written by the seed only after its verifier passes, in the transaction that wrote the catalog.
 *
 * Insert-only for every role: privileges keep the service role to SELECT and the seeder to SELECT and INSERT, and a
 * statement trigger refuses UPDATE and DELETE from the owner too.
 *
 * @pattern Insert-only log — rows are appended, never changed
 */
import { sql } from 'drizzle-orm';
import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** The seed ledger. */
export const catalogSeedLedger = pgTable('catalog_seed_ledger', {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** The applied seed's SHA-256, 64 lowercase hex digits. */
    seedSha: text('seed_sha').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    /** The login that inserted the row: `session_user`, set by the database. */
    appliedBy: text('applied_by')
        .notNull()
        .default(sql`session_user`),
});
