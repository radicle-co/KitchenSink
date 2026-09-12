/**
 * The Unit-of-Work seam for the ingredient service — the sibling of recipe-service's
 * `src/database/unitOfWork.ts`, which ADR-0034 names the S-R1 seam.
 *
 * ## Why this exists
 *
 * A DAO here took the CONCRETE {@link FoodDrizzle}, so enlisting one in a transaction meant lying about the
 * handle: `tx as unknown as FoodDrizzle`. A transaction exposes the identical query-builder surface these
 * DAOs use, and differs only in members they never touch (`$client`, `transaction` itself) — so the cast was
 * not bridging a real difference, it was compensating for a type that named more than the DAOs needed.
 *
 * ⛔ THE CAST WAS ALSO DUPLICATED, which is what makes this a seam rather than a tidy-up.
 * `Parameters<Parameters<FoodDrizzle['transaction']>[0]>[0]` was re-derived VERBATIM in two files, and
 * `mergeAndPersist.service.ts`'s narrowing helper described itself as "the single, documented narrowing
 * point" while `authoredFoods.dao.ts` performed the same cast inline and cited that helper across files. One
 * claim, two implementations, already disagreeing about where the rule lived.
 *
 * ⚠️ recipe-service reached this shape by the same route and recorded the cost: its `Writer` replaced "three
 * previously-divergent per-file copies — one missing `update`, all of which OMITTED `execute`." Two files is
 * where that drift starts, which is where the ingredient service is now.
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
 * derived ONCE, which is the half the two previous copies got wrong.
 */
export type FoodTx = Parameters<Parameters<FoodDrizzle['transaction']>[0]>[0];

/**
 * The read/write surface a DAO needs: satisfied by the base client AND by an open transaction.
 *
 * ⛔ `execute` is in the list deliberately. recipe-service's copies omitted it, which is exactly what forced
 * a cast back at the call sites that run advisory locks or raw SQL — the omission does not announce itself
 * until someone needs it, and by then the cast is the established habit.
 *
 * ⛔ `transaction` IS included here and is NOT in recipe-service's `Writer`, which is a real difference
 * between the two services rather than an oversight. `FoodDao.createByName` opens a transaction of its own to
 * hold the per-name advisory lock across its dedup upsert, so transaction control is part of the surface a
 * food DAO actually needs — the compiler said so the moment the cast stopped hiding it. An open transaction
 * satisfies it too: `tx.transaction(...)` is a SAVEPOINT, which is the correct nesting behaviour for a DAO
 * that may be called standalone or already enlisted.
 *
 * ⚠️ So this type is "what a food DAO needs", not "the write surface" in the abstract. If a future DAO wants
 * something outside it, widen this ONE type with a reason rather than reaching for the concrete client at a
 * call site — the concrete client is what the cast was.
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
