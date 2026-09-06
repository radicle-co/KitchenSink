/**
 * A connection pool for a database the suite is going to DROP.
 *
 * `pool.end()` resolves once every client has been ASKED to close, not once every backend is gone, so a
 * following `DROP DATABASE … WITH (FORCE)` can terminate a socket that is still closing. Postgres answers
 * that client `57P01`, `pg` re-raises it as a POOL-level `error` event, and an unhandled one fails the
 * whole vitest run — every test green, the job red.
 *
 * ⛔ REORDERING DOES NOT FIX IT, which is why this exists at all. `migrationRunner.integration.test.ts`
 * already awaited `pool.end()` BEFORE the drop and still failed: `end()` makes no promise about the
 * backend, so no ordering closes a window the client cannot observe the end of. The only sound rule is
 * that a caller which drops a database must tolerate the termination it asked for.
 *
 * ⛔ SHARED, because the hazard is not one service's. It was measured in recipe-service
 * (`kitchensink_recipes_migrunner`, run 34007471001) and food-service's
 * `tests/migrate.integration.test.ts` opens `perPrPool` on a database its own `beforeEach` and `afterAll`
 * drop with FORCE — the same shape, one `beforeEach` away from firing on every test. Two copies of "which
 * pg error a teardown is allowed to absorb" is the drift DRY governs.
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
