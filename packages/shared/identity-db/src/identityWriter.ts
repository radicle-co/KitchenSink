/**
 * The database surface the identity DAOs need — the seam that replaced a cast at every call site.
 *
 * ## What was wrong
 *
 * The DAOs declared `PostgresJsDatabase`, a driver this package does not depend on (its `package.json` lists
 * `identity-core`, `drizzle-orm`, `ulidx` and nothing else) and which the repo never installs. Production
 * hands them a `NodePgDatabase`. Every caller therefore bridged the gap with `as unknown as` — a claim the
 * type system cannot check — and eight of those casts were in TESTS, which is the shape of a suite reaching
 * past an interface to build the thing it means to exercise.
 *
 * `eraseIdentityRow.ts` had already reached the same conclusion for itself and stated the principle: *"a cast
 * that appears at every call site is not a call-site problem: the signature was simply too narrow."*
 *
 * ## Why a structural `Pick` rather than a driver type
 *
 * ⛔ Widening to `PgDatabase<PgQueryResultHKT>` fixes the DRIVER half and leaves the SCHEMA half broken:
 * that type's schema parameter defaults to `Record<string, never>` and is INVARIANT, while the production
 * handle carries `{users, accounts, profiles}`. Measured — it fails with `Type 'ExtractTablesWithRelations<…>'
 * is not assignable`. So naming any concrete database type here re-opens the same gap one parameter over.
 *
 * A `Pick` names only the four members these DAOs call. It is satisfied structurally, so it holds for any
 * driver AND any schema, which is exactly the range of handles this package is legitimately given.
 *
 * ⚠️ The relational query API (`db.query.*`) is deliberately ABSENT, and that is what makes the schema
 * parameter irrelevant here: it is the only part of drizzle's surface that depends on it. No DAO in this
 * package uses it. A DAO that wants it needs a different seam and a reason, not a cast.
 *
 * ⚠️ Same shape as `food-service`'s `FoodWriter` and `recipe-service`'s `Writer` (the S-R1 seam ADR-0034
 * names), so all three now take a structural write surface rather than a concrete client.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * The read/write surface an identity DAO needs: satisfied by any driver's database handle, and by an open
 * transaction, without a cast.
 *
 * `transaction` is included because `UserDAO` opens its own for the multi-table writes that must commit
 * together; `update` because `eraseIdentityRow` scrubs in place; `execute` because this surface is handed to
 * `@kitchensink/identity-utils`' provisioning routine, which runs an advisory lock through it.
 */
export type IdentityWriter = Pick<
    PgDatabase<PgQueryResultHKT>,
    'select' | 'insert' | 'update' | 'delete' | 'execute'
> & {
    /**
     * Run `fn` as one transaction, handing it THE SAME surface.
     *
     * ⛔ Declared here rather than `Pick`ed, and the reason is the whole difficulty this seam had to solve.
     * Drizzle types the callback's handle as `PgTransaction<…, TSchema, …>`, so `Pick`ing `transaction` drags
     * the schema parameter back in through the callback and fails on exactly the mismatch the cast was
     * hiding — measured: *"Types of property 'transaction' are incompatible"*, with the other four members
     * assigning cleanly.
     *
     * ⚠️ Self-referential ON PURPOSE: the handle inside a transaction is an {@link IdentityWriter} too, which
     * is the Unit-of-Work property stated in the type. A DAO cannot tell whether it was handed the client or
     * a transaction, which is what lets a caller decide atomicity without the DAO participating.
     */
    transaction<T>(fn: (tx: IdentityWriter) => Promise<T>): Promise<T>;
};
