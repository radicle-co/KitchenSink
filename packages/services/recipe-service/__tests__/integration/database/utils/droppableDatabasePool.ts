/**
 * A connection pool for a database this suite is going to DROP.
 *
 * See `../droppableDatabasePool.integration.test.ts` for the failing run and the reasoning; the short form
 * is that `pool.end()` resolves before the backend is gone, so `DROP DATABASE … WITH (FORCE)` can terminate
 * a socket that is still closing and `pg` surfaces that as an unhandled pool-level error.
 */
import pg from 'pg';

/** Postgres' code for a backend terminated by an administrator command (`57P01`). */
export const BACKEND_TERMINATED = '57P01';

/**
 * Whether `error` is a backend termination — what `DROP … WITH (FORCE)` and `pg_terminate_backend` raise.
 *
 * @param error - Any thrown or emitted value.
 * @returns `true` only for a `57P01`.
 */
export function isBackendTermination(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { readonly code?: unknown }).code === BACKEND_TERMINATED
    );
}

/**
 * Open a pool that tolerates having its database dropped out from under it.
 *
 * @param connectionString - The database to connect to.
 * @returns A pool that absorbs `57P01` and re-raises everything else.
 * @sideEffect Opens a connection pool.
 */
export function poolForDroppableDatabase(connectionString: string): pg.Pool {
    const pool = new pg.Pool({ connectionString });

    // ⛔ ATTACHED AT CREATION, not at teardown. The FATAL can arrive at any moment after the drop is issued,
    // including while `end()` is still draining, so a listener added just before the drop is already a race.
    //
    // ⚠️ It absorbs `57P01` ONLY, and RETHROWS everything else — an uncaught exception, which is the same
    // loud failure a listener-less pool already produced. Re-EMITTING instead would re-enter this very
    // listener and recurse forever, so a suite that cannot reach its database must throw, not emit.
    pool.on('error', (error) => {
        if (!isBackendTermination(error)) {
            throw error;
        }
    });

    return pool;
}
