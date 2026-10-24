/**
 * The food API's `pg` pool: its size, how long an idle connection lives, and the floor of connections it keeps.
 *
 * A new connection is slow here (TLS, then an RDS IAM token), slow enough that a search opening its connections from
 * cold can miss `DATABASE_FRAME_DEADLINE_MS` and answer both database groups unavailable. So the pool keeps a floor of
 * one search's connections, {@link prewarmPool} opens it at boot, and the pool listens for `error`.
 *
 * @pattern Factory — builds the one API pool from the shared food pool config
 */
import pg from 'pg';

const { Pool } = pg;

/** The most connections the API pool opens. */
export const FOOD_API_POOL_MAX = 20;

/** How long a connection above {@link FOOD_API_POOL_MIN} may sit idle before the pool closes it, in milliseconds. */
export const FOOD_API_POOL_IDLE_TIMEOUT_MS = 30_000;

/**
 * The connections the pool keeps open however long it is idle: what one progressive search holds at once before its
 * database frame is written (the catalog read, the authored read, a remote miss's admission).
 */
export const FOOD_API_POOL_MIN = 3;

/** Where the pool reports what it could not do. */
export interface FoodPoolLogger {
    error(message: string, context: Readonly<Record<string, unknown>>): void;
    warn(message: string, context: Readonly<Record<string, unknown>>): void;
}

/**
 * Build the API pool.
 *
 * ⚠️ It listens for `error`. `pg-pool` re-emits an idle connection's error on the pool, and an `EventEmitter` with no
 * listener throws it, ending the process. Kept connections meet every server-side close, such as the sandbox's nightly
 * database stop, so the listener is what lets the floor exist.
 *
 * @param base - The connection config (`foodPoolConfigFromEnv`).
 * @param logger - Where the pool reports a failure.
 * @returns The pool.
 */
export function createFoodApiPool(base: pg.PoolConfig, logger: FoodPoolLogger): pg.Pool {
    const pool = new Pool({
        ...base,
        max: FOOD_API_POOL_MAX,
        min: FOOD_API_POOL_MIN,
        idleTimeoutMillis: FOOD_API_POOL_IDLE_TIMEOUT_MS,
    });

    // The pool has already removed the client; the next request opens a new one.
    pool.on('error', (error) => {
        logger.error('food-pg-pool-idle-client-error', { cause: String(error) });
    });

    return pool;
}

/**
 * Open `count` connections and return them to the pool idle. `pg-pool` keeps a floor once it has opened it, but never
 * opens one by itself, so without this the first search after a deploy or a wake is cold. It never rejects: a database
 * that cannot be reached at boot is logged, and the task boots anyway.
 *
 * @param pool - The pool.
 * @param count - How many.
 * @param logger - Where a failure is reported.
 * @returns When they are open, or when opening them failed.
 * @sideEffect Opens database connections; logs a failure.
 */
export async function prewarmPool(pool: pg.Pool, count: number, logger: FoodPoolLogger): Promise<void> {
    const opened = await Promise.allSettled(Array.from({ length: count }, async () => pool.connect()));

    for (const result of opened) {
        if (result.status === 'fulfilled') {
            result.value.release();
        }
    }

    const failure = opened.find((result) => result.status === 'rejected');

    if (failure !== undefined) {
        logger.warn('food-pg-pool-prewarm-failed', { cause: String(failure.reason) });
    }
}
