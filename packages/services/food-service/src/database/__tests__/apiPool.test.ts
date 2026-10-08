/**
 * Unit coverage for the API's `pg` pool: a search after an idle gap must not pay for new connections, because a cold
 * connection can cost the database frame its deadline.
 *
 * The pool is real `pg-pool`; only the client is fake, so the reaping and the floor are the library's own.
 */
import { EventEmitter } from 'node:events';

import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FOOD_API_POOL_IDLE_TIMEOUT_MS, FOOD_API_POOL_MIN, createFoodApiPool, prewarmPool } from '../apiPool.js';

/** Every connect a fake client was asked for, and whether the next ones fail. */
const connects = { count: 0, failing: false };

/**
 * A `pg.Client` that never touches the network: `connect` answers on the next microtask, `end` at once. It extends
 * the real client so the pool's types hold without a cast.
 */
class FakeClient extends pg.Client {
    public override connect(): Promise<pg.Client>;
    public override connect(callback: (err: Error | null) => void): void;
    public override connect(callback?: (err: Error | null) => void): Promise<pg.Client> | undefined {
        connects.count += 1;
        const failure = connects.failing ? new Error('connect ECONNREFUSED') : null;

        if (callback === undefined) {
            return failure === null ? Promise.resolve(this) : Promise.reject(failure);
        }

        queueMicrotask(() => {
            callback(failure);
        });

        return undefined;
    }

    public override end(): Promise<void>;
    public override end(callback: (err: Error | undefined) => void): void;
    public override end(callback?: (err: Error | undefined) => void): Promise<void> | undefined {
        EventEmitter.prototype.emit.call(this, 'end');

        if (callback === undefined) {
            return Promise.resolve();
        }

        callback(undefined);

        return undefined;
    }
}

/**
 * The connections one progressive search holds at once before its database frame is written, counted from the code
 * rather than from the pool: the catalog read (its three queries run one after another on one connection at a time),
 * the authored read, and a remote miss's admission (the budget charge, then the shared window, one after another).
 * Gap recording runs after the `complete` frame.
 */
const CONNECTIONS_ONE_SEARCH_HOLDS = 3;

const logger = { error: vi.fn(), warn: vi.fn() };

/** Acquire `n` clients at once, then release them all. */
async function holdAndRelease(pool: pg.Pool, n: number): Promise<pg.PoolClient[]> {
    const clients = await Promise.all(Array.from({ length: n }, async () => pool.connect()));

    for (const client of clients) {
        client.release();
    }

    return clients;
}

let pool: pg.Pool;

beforeEach(() => {
    vi.useFakeTimers();
    connects.count = 0;
    connects.failing = false;
    logger.error.mockReset();
    logger.warn.mockReset();
    pool = createFoodApiPool({ Client: FakeClient }, logger);
});

afterEach(async () => {
    vi.useRealTimers();
    await pool.end();
});

describe('createFoodApiPool', () => {
    it('serves a search after an idle gap from open connections, opening none', async () => {
        await holdAndRelease(pool, CONNECTIONS_ONE_SEARCH_HOLDS);
        const opened = connects.count;

        await vi.advanceTimersByTimeAsync(FOOD_API_POOL_IDLE_TIMEOUT_MS * 4);
        await holdAndRelease(pool, CONNECTIONS_ONE_SEARCH_HOLDS);

        expect(opened).toBe(CONNECTIONS_ONE_SEARCH_HOLDS);
        expect(connects.count).toBe(opened);
    });

    it('still closes idle connections above the floor', async () => {
        await holdAndRelease(pool, FOOD_API_POOL_MIN + 2);
        expect(pool.totalCount).toBe(FOOD_API_POOL_MIN + 2);

        await vi.advanceTimersByTimeAsync(FOOD_API_POOL_IDLE_TIMEOUT_MS + 1);

        expect(pool.totalCount).toBe(FOOD_API_POOL_MIN);
    });

    it('logs an idle connection the server drops and keeps running, instead of throwing', async () => {
        const [dropped] = await holdAndRelease(pool, 1);

        // A kept connection meets the sandbox's nightly database stop. `pg-pool` re-emits the client's error on the
        // pool, and an `EventEmitter` with no listener throws it, which ends the process.
        expect(() =>
            dropped?.emit('error', new Error('terminating connection due to administrator command')),
        ).not.toThrow();
        expect(pool.totalCount).toBe(0);
        expect(logger.error).toHaveBeenCalledWith(
            'food-pg-pool-idle-client-error',
            expect.objectContaining({ cause: expect.stringContaining('administrator command') }),
        );
    });
});

describe('prewarmPool', () => {
    it('opens the floor at boot, so the first search after a deploy is not cold', async () => {
        await prewarmPool(pool, CONNECTIONS_ONE_SEARCH_HOLDS, logger);

        expect(connects.count).toBe(CONNECTIONS_ONE_SEARCH_HOLDS);
        expect(pool.idleCount).toBe(CONNECTIONS_ONE_SEARCH_HOLDS);
    });

    it('logs and resolves when the database is unreachable, so the task still boots', async () => {
        connects.failing = true;

        await expect(prewarmPool(pool, CONNECTIONS_ONE_SEARCH_HOLDS, logger)).resolves.toBeUndefined();

        expect(logger.warn).toHaveBeenCalledWith(
            'food-pg-pool-prewarm-failed',
            expect.objectContaining({ cause: expect.stringContaining('ECONNREFUSED') }),
        );
        expect(pool.totalCount).toBe(0);
    });
});
