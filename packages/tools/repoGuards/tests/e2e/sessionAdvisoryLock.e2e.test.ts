// @vitest-environment node
/**
 * LOCAL e2e: `withSessionAdvisoryLock` (`@kitchensink/db-schema-guard`) against a real PostgreSQL. Its unit suite runs
 * over a recorded statement list, so it cannot see what the server does with the lock, the bound or the reset. These
 * cases do:
 *
 * - a session that cannot get the lock within its bound gets the typed timeout, its `lock_timeout` is back at the
 *   server default, and the work never runs;
 * - the lock is held for the whole work, across the transactions the work opens, and the bound is gone while it runs;
 * - the lock is released when the work throws, so the next session takes it at once.
 *
 * Every session is the superuser on the throwaway server (`throwawayServer.ts`). The lock is the catalog seed's class
 * with an object id no caller uses, so this suite never contends with another on the same server.
 */
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    ADVISORY_LOCK_CLASSES,
    isSessionLockTimeoutError,
    withSessionAdvisoryLock,
    type SessionLockOptions,
} from '@kitchensink/db-schema-guard';

import { throwawayServerUrl } from '../common/throwawayServer.js';

const SERVER_URL = throwawayServerUrl(process.env['DATABASE_ADMIN_URL']);

/** A lock no caller takes: a registered class, with an object id outside every caller's range. */
const LOCK = { classId: ADVISORY_LOCK_CLASSES.foodCatalogSeed, objectId: 1_999_999_001 } as const;
const OPTIONS: SessionLockOptions = { ...LOCK, waitTimeoutMs: 300 };

/**
 * Open one session on the throwaway server.
 *
 * @param url - The server.
 * @returns The connected session.
 * @sideEffect Opens a connection.
 */
async function openSession(url: string): Promise<pg.Client> {
    const session = new pg.Client({ connectionString: url });
    await session.connect();

    return session;
}

/**
 * Whether `session` can take the lock now, without waiting. A lock it takes is released at once.
 *
 * @param session - A session that does not hold the lock.
 * @returns `true` when the lock was free.
 * @sideEffect Takes and releases the advisory lock when it is free.
 */
async function lockIsFree(session: pg.Client): Promise<boolean> {
    const { rows } = await session.query<{ taken: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS taken', [
        LOCK.classId,
        LOCK.objectId,
    ]);
    const taken = rows[0]?.taken === true;

    if (taken) {
        await session.query('SELECT pg_advisory_unlock($1, $2)', [LOCK.classId, LOCK.objectId]);
    }

    return taken;
}

/**
 * The session's `lock_timeout`.
 *
 * @param session - A session.
 * @returns The setting as PostgreSQL shows it.
 * @sideEffect Reads a session setting.
 */
async function lockTimeoutOf(session: pg.Client): Promise<string | undefined> {
    const { rows } = await session.query<{ lock_timeout: string }>('SHOW lock_timeout');

    return rows[0]?.lock_timeout;
}

describe('withSessionAdvisoryLock against real PostgreSQL', () => {
    const url = SERVER_URL;
    let first: pg.Client;
    let second: pg.Client;
    let serverDefault: string | undefined;

    beforeEach(async () => {
        first = await openSession(url);
        second = await openSession(url);
        serverDefault = await lockTimeoutOf(second);
    });

    afterEach(async () => {
        await first.end();
        await second.end();
    });

    it('answers a lock held past the bound with the typed timeout, resets the bound, and never runs the work', async () => {
        await first.query('SELECT pg_advisory_lock($1, $2)', [LOCK.classId, LOCK.objectId]);
        let ran = false;

        const outcome = await withSessionAdvisoryLock(second, OPTIONS, async () => {
            ran = true;
        }).catch((error: unknown) => error);

        expect(isSessionLockTimeoutError(outcome)).toBe(true);
        expect(ran).toBe(false);
        expect(await lockTimeoutOf(second)).toBe(serverDefault);
    });

    it('holds the lock across the work’s own transactions, with the bound reset while the work runs', async () => {
        const seen = await withSessionAdvisoryLock(first, OPTIONS, async () => {
            await first.query('BEGIN');
            await first.query('SELECT 1');
            await first.query('COMMIT');

            return { free: await lockIsFree(second), bound: await lockTimeoutOf(first) };
        });

        expect(seen).toEqual({ free: false, bound: serverDefault });
        expect(await lockIsFree(second)).toBe(true);
    });

    it('releases the lock when the work throws, and rethrows the work’s own error', async () => {
        const failure = new Error('the work failed');

        await expect(
            withSessionAdvisoryLock(first, OPTIONS, async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);

        expect(await lockIsFree(second)).toBe(true);
    });
});
