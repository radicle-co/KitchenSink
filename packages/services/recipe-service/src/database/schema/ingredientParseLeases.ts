/**
 * Drizzle definition for `ingredient_parse_leases` (migration 0049) — which lines are being parsed RIGHT NOW.
 *
 * ⚠️ The hand-authored `src/database/migrations/0049_parse_lease.sql` is the SOURCE OF TRUTH (repo
 * convention — the in-VPC runner applies those files in filename order). Read its header before changing
 * anything here: it carries why this is a lease rather than an advisory lock, and why the key is the line
 * rather than the cache's per-engine key.
 *
 * ⛔ NO ROW HERE IS AN ANSWER. Presence means "some worker is asking the engines about this line"; the answer
 * lives in `ingredient_parse_cache`. Nothing may read this table to decide what a line parsed to, and a reader
 * that did would get a boolean about scheduling dressed as a fact about an ingredient.
 *
 * ⛔ NO OWNER COLUMN, and the erasure argument is `ingredient_parse_cache`'s, one table over: the row carries
 * a one-way digest of a line and a timestamp, with no person-to-row link, so it is absent from the
 * account-erasure sweep for the same reason. It is also transient — the holder deletes its own row, and a
 * holder that died leaves one that expires — so unlike the cache it does not even persist installation-wide.
 *
 * ⛔ WRITTEN ONLY BY `recipe-workers`, never by this service. The table lives in recipe's database because
 * that is where the parse cache it guards lives (ADR-0019 §3: the parser owns no database of its own), and
 * the migration lives here because this service owns the schema. The model exists so the table has a
 * declared shape `schemaModelConformance` can hold to, not because anything in this service reads it.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** One in-flight parse. */
export const ingredientParseLeases = pgTable('ingredient_parse_leases', {
    /**
     * The line being parsed — `{version}:{sha256hex}`, derived by
     * `@kitchensink/recipe-core/parsing/parse-key`.
     *
     * ⛔ TEXT, not `uuid`, for `ingredient_parse_cache`'s reason: the `{version}:` prefix is part of the
     * VALUE, so a change to the derivation is an enumerable re-partition rather than a silent one.
     */
    lineDigest: text('line_digest').primaryKey(),
    /**
     * When this lease stops being honoured.
     *
     * ⛔ A row past it is indistinguishable from no row. That is what makes a worker that died mid-parse
     * cost one duplicate call instead of blocking its line forever, and it is the whole reason this is a
     * lease and not a lock.
     */
    leasedUntil: timestamp('leased_until', { withTimezone: true }).notNull(),
});

/** One lease row, as Drizzle returns it. */
export type IngredientParseLeaseRow = typeof ingredientParseLeases.$inferSelect;
