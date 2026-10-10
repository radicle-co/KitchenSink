/**
 * The Unit-of-Work seam for the ingredient service — the sibling of recipe-service's
 * `src/database/unitOfWork.ts`, which ADR-0034 names the S-R1 seam.
 *
 * ## Why this exists
 *
 * A DAO that takes the CONCRETE {@link FoodDrizzle} can only be enlisted in a transaction by lying about the
 * handle: `tx as unknown as FoodDrizzle`. A transaction exposes the identical query-builder surface these
 * DAOs use, and differs only in members they never touch (`$client`, `transaction` itself) — so such a cast
 * bridges no real difference; it compensates for a type that names more than the DAOs need.
 *
 * ⛔ ONE DERIVATION, which is what makes this a seam rather than a tidy-up. A per-file copy of
 * `Parameters<Parameters<FoodDrizzle['transaction']>[0]>[0]`, or an inline cast citing a helper in another
 * file, is one claim with two implementations — and they drift apart about where the rule lives.
 *
 * ⚠️ recipe-service's `Writer` records the cost of per-file copies: "one missing `update`, all of which
 * OMITTED `execute`." Two copies is where that drift starts.
 *
 * ## What callers get
 *
 * {@link FoodWriter} is a STRUCTURAL type, so both the base client and an open transaction satisfy it with no
 * cast at all: a DAO stops caring which it was handed, and the caller decides whether the work is atomic.
 */
import type { FoodDrizzle } from './database.module.js';

/**
 * The open-transaction handle a `FoodDrizzle.transaction(fn)` callback receives.
 *
 * Derived from the client rather than restated, so it cannot drift from the drizzle version in use — and
 * derived ONCE, so no second copy can disagree with it.
 */
export type FoodTx = Parameters<Parameters<FoodDrizzle['transaction']>[0]>[0];

/**
 * The read/write surface a DAO needs: satisfied by the base client AND by an open transaction.
 *
 * ⛔ `execute` is in the list deliberately. Omitting it forces a cast back at the call sites that run advisory
 * locks or raw SQL — the omission does not announce itself until someone needs it, and by then the cast is
 * the established habit.
 *
 * ⛔ `transaction` IS included here and is NOT in recipe-service's `Writer`, which is a real difference
 * between the two services rather than an oversight. `FoodDao.createByName` opens a transaction of its own to
 * hold the per-name advisory lock across its dedup upsert, so transaction control is part of the surface a
 * food DAO actually needs. An open transaction
 * satisfies it too: `tx.transaction(...)` is a SAVEPOINT, which is the correct nesting behaviour for a DAO
 * that may be called standalone or already enlisted.
 *
 * ⚠️ So this type is "what a food DAO needs", not "the write surface" in the abstract. If a future DAO wants
 * something outside it, widen this ONE type with a reason rather than reaching for the concrete client at a
 * call site.
 */
export type FoodWriter = Pick<FoodDrizzle, 'insert' | 'select' | 'update' | 'delete' | 'execute' | 'transaction'>;

/**
 * Run `fn` as one transaction — a named seam, so a call site reads as "these writes are one Unit of Work"
 * rather than as a bare `db.transaction(...)`.
 *
 * @param db - The base client.
 * @param fn - The work, handed the open transaction.
 * @returns Whatever `fn` returns.
 * @sideEffect Opens a transaction; every write `fn` performs commits together or rolls back together.
 */
export async function withTransaction<T>(db: FoodDrizzle, fn: (tx: FoodTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
}
