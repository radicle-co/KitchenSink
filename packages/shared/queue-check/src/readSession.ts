/**
 * ONE checked-out database connection, for the whole of a backstop's read.
 *
 * ⛔ THIS TYPE EXISTS TO MAKE A SPECIFIC BUG UNREPRESENTABLE, and the bug is not hypothetical — two of the
 * three backstops shipped with it before this type did.
 *
 * Every backstop reads inside `BEGIN TRANSACTION READ ONLY`, and that transaction is the enforcement rather
 * than a convention: it is what stops a thing that watches a queue from being able to make the queue worse.
 * The natural port for "run a statement" is a bare function — and `pg.Pool` satisfies one structurally while
 * checking a connection OUT PER CALL. Passed a pool, `BEGIN`, the reads and `COMMIT` land on different
 * backends: the `BEGIN` applies to a session nothing else uses, the reads run with no transaction at all, and
 * the guarantee is silently absent while every assertion about what the reads RETURN still passes.
 *
 * ⛔ `release` IS THE WHOLE MECHANISM. `pg.Pool` has `end`; `pg.PoolClient` has `release`. Requiring it makes
 * a pool structurally unassignable, so the compiler refuses the mistake at every call site rather than a
 * reviewer having to notice it.
 *
 * ⚠️ A RUNTIME TEST FOR THIS WOULD BE THEATRE, which is why there is not one. An idle pool hands back the
 * same connection every time, so comparing `pg_backend_pid()` across the statements passes under the bug, and
 * so does attempting a write mid-read. The property only diverges under concurrency — green until production,
 * which is the kind of test this repository counts as coverage rather than proof.
 */

/** Runs one parameterised statement. */
export type QueryRunner = (text: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * A connection held for the whole read. See the module docstring for why `release` must be present.
 *
 * ⛔ `release` IS A MARKER, AND IT IS DELIBERATELY NOT CALLABLE. It exists only so a `pg.Pool` — which has
 * `end`, not `release` — is structurally unassignable. Typing it `() => void` invited exactly the mistake
 * this type exists to prevent, one layer over: a reader would call it, and since the owner ALSO releases in
 * its own `finally`, the second call throws `Release called on client which has already been released`. A
 * `pg.PoolClient`'s real `release` satisfies `unknown`, so the discrimination still works and the invitation
 * is gone.
 */
export interface ReadSession {
    readonly query: QueryRunner;
    /** Present so a pool is unassignable. ⛔ NOT for calling — the owner of the connection releases it. */
    readonly release: unknown;
}
