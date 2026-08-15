/**
 * S-R1 — the Unit-of-Work seam shared across every DAL that needs to enlist more than one write in a
 * single Postgres transaction (`collections/dal/collections.dal.ts`'s `cloneCollection`/`pullFromSource`
 * atomization being the motivating case: a create + N membership inserts that must commit or roll back
 * together, never half-apply).
 *
 * {@link RecipeTx} is the actual open-transaction handle a `RecipeDrizzle.transaction(fn)` callback
 * receives — it supports the FULL query-builder surface (`insert`/`select`/`update`/`delete`/`execute`),
 * so a DAL method that runs an advisory lock (`PhotosDal.create`'s `pg_advisory_xact_lock`) or sets an
 * isolation level (`RecipesDal.readConflict`'s `SET TRANSACTION ISOLATION LEVEL …`) still typechecks when
 * handed a tx. {@link Writer} is the narrower "either the base client or an open tx" surface DAL methods
 * accept as an optional parameter — the single, unified replacement for the three previously-divergent
 * per-file `Writer` copies (`recipes.dal.ts`, `photos.dal.ts` — identical; `recipeIngredients.dal.ts` —
 * missing `update`), all of which OMITTED `execute`. Deliberately kept to two exports and no `class`: this
 * is a promotion of an existing pattern (`RecipesDal.create` already threads `tx` into
 * `RecipeIngredientsDal.replaceForRecipe`), not a new framework.
 */
import type { RecipeDrizzle } from './client.js';

/** The open transaction handle a `RecipeDrizzle.transaction(fn)` callback receives. */
export type RecipeTx = Parameters<Parameters<RecipeDrizzle['transaction']>[0]>[0];

/**
 * The minimal read/write surface a DAL method needs to run standalone (over the base client) OR enlisted
 * in a caller-supplied transaction (over a {@link RecipeTx}). Includes `execute` so advisory-lock and
 * isolation-level statements are available wherever a `Writer` is accepted, not just inside a DAL's own
 * private `db.transaction(...)` call.
 */
export type Writer = Pick<RecipeDrizzle, 'insert' | 'select' | 'update' | 'delete' | 'execute'>;

/**
 * Run `fn` as one Postgres transaction over `db` — a named seam so a call site reads as "these writes are
 * one Unit-of-Work" rather than a bare `db.transaction(...)`. Commits on a resolved `fn`, rolls back (via
 * `pg`/Drizzle's standard transaction machinery) on a thrown/rejected one.
 *
 * @sideEffect Opens a transaction; every write `fn` performs is committed together or rolled back together.
 */
export async function withTransaction<T>(db: RecipeDrizzle, fn: (tx: RecipeTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
}
