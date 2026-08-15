/**
 * Single-drainer advisory-lock helpers (T-150, FR-022). Exactly one Fargate consumer drains the
 * `fetch_queue` at a time: each instance tries a Postgres session-level advisory lock on a fixed
 * two-int key; the one that acquires it drains, the others stand by. The lock is held for the lifetime
 * of the dedicated session (a `pg` client checked out for the worker), and released on shutdown.
 *
 * The two-int key class is distinct from the per-name dedup lock (`LOCK_CLASS_DEDUP = 2`, `FoodDao`),
 * so the drainer lock and the add-by-name dedup lock can never collide.
 *
 * @implements FR-022
 */
import type { Client, PoolClient } from 'pg';

/** Advisory-lock classid for the single-drainer lock (distinct from `FoodDao`'s dedup class `2`). */
export const WORKER_LOCK_CLASS = 1;

/** Advisory-lock objid for the single-drainer lock. */
export const WORKER_LOCK_OBJECT = 0;

/** A Postgres session capable of holding a session-level advisory lock (a dedicated checked-out client). */
export type LockSession = Pick<Client | PoolClient, 'query'>;

/**
 * Try to acquire the single-drainer session advisory lock on `session` (non-blocking, FR-022).
 *
 * @param session - A dedicated Postgres session (NOT a transaction — the lock is session-scoped).
 * @returns `true` when this session acquired the lock (it should drain); `false` when another holds it.
 * @sideEffect Acquires a session-level Postgres advisory lock.
 */
export async function acquireWorkerLock(session: LockSession): Promise<boolean> {
    const result = await session.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS locked', [
        WORKER_LOCK_CLASS,
        WORKER_LOCK_OBJECT,
    ]);

    return result.rows[0]?.locked === true;
}

/**
 * Release the single-drainer session advisory lock held by `session` (idempotent — `false` when this
 * session did not hold it).
 *
 * @param session - The session that holds the lock.
 * @returns `true` when a held lock was released.
 * @sideEffect Releases the session-level Postgres advisory lock.
 */
export async function releaseWorkerLock(session: LockSession): Promise<boolean> {
    const result = await session.query<{ released: boolean }>('SELECT pg_advisory_unlock($1, $2) AS released', [
        WORKER_LOCK_CLASS,
        WORKER_LOCK_OBJECT,
    ]);

    return result.rows[0]?.released === true;
}
