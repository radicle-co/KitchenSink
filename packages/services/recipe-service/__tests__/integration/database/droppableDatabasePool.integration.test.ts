/**
 * ⛔ THE ACCEPTANCE CRITERION for tearing down a pool whose database is about to be dropped.
 *
 * `DROP DATABASE … WITH (FORCE)` exists to sever connections — that is the whole point of `FORCE`, and
 * ADR-0006's per-PR cleanup depends on it. But `pool.end()` resolves once every client has been ASKED to
 * close, not once every backend has actually gone, so a drop issued immediately afterwards can terminate a
 * socket that is still closing. Postgres answers that client `57P01`, `pg` re-raises it as a POOL-level
 * `error` event, and an unhandled one fails the whole vitest run.
 *
 * That is not hypothetical. Run 34007471001 reported `Test Files 82 passed | Tests 595 passed | Errors 1
 * error` — every test green, the job red — and the serialized error names the database
 * (`kitchensink_recipes_migrunner`) and catches the client mid-close: `_ending: true, _ended: false`.
 *
 * ⚠️ THE ORDERING FIX DOES NOT WORK, which is why this absorbs instead. `migrationRunner.integration`
 * already awaited `pool.end()` BEFORE `dropDatabase` — the obvious repair was in place and the run still
 * failed, because `end()` makes no promise about the backend. No amount of reordering closes a window the
 * client cannot observe the end of, so the only sound rule is that a caller which drops a database must
 * TOLERATE the termination it asked for.
 *
 * ⚠️ And it must absorb ONLY that. A pool that swallows every error is a pool that hides the connection
 * failures these suites exist to catch, so the predicate is pinned in both directions below.
 */
import pg from 'pg';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BACKEND_TERMINATED, isBackendTermination, poolForDroppableDatabase } from './utils/droppableDatabasePool.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const TEST_DATABASE = 'kitchensink_recipes_droppool';

/** The connection string for `database` on the configured host. Pure. */
function urlFor(database: string): string {
    const url = new URL(DATABASE_URL as string);

    url.pathname = `/${database}`;

    return url.toString();
}

describe.runIf(DATABASE_URL)('a pool whose database will be dropped', () => {
    let maintenancePool: pg.Pool;

    beforeAll(async () => {
        maintenancePool = new pg.Pool({ connectionString: urlFor('postgres') });
        await maintenancePool.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`);
        await maintenancePool.query(`CREATE DATABASE "${TEST_DATABASE}"`);
    });

    afterAll(async () => {
        await maintenancePool.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`);
        await maintenancePool.end();
    });

    it('⛔ survives a REAL backend termination and is still usable afterwards', async () => {
        const pool = poolForDroppableDatabase(urlFor(TEST_DATABASE));

        // A real connection, so there is a real backend for the maintenance side to terminate. Left IDLE in
        // the pool afterwards — an idle pooled client is exactly what a drop finds.
        await pool.query('SELECT 1');

        await maintenancePool.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [TEST_DATABASE],
        );

        // Give pg a turn to deliver the FATAL to the idle client before asserting on it.
        await new Promise((resolve) => setTimeout(resolve, 250));

        // ⚠️ NOT VACUOUS: "absorbed" must not be satisfiable by a pool that never connected or is now dead.
        await expect(pool.query('SELECT 1').then((result) => result.rowCount)).resolves.toBe(1);
        await pool.end();
    });

    it('⛔ is the ONLY reason the termination is not fatal — a bare pool takes the run down', async () => {
        // ⚠️ THIS IS THE ASSERTION, and the shape it replaces is recorded because it looked right and was
        // worthless: attaching a second `error` listener and expecting it to stay empty. An EventEmitter
        // delivers to EVERY listener, so the spy records the event whether or not the helper absorbed it —
        // it fails identically on the fixed code. What "absorbed" actually means is narrower and testable:
        // Node throws on `emit('error')` when NOTHING is listening, and that throw is the unhandled error
        // that reddened run 34007471001. So the falsifiable claim is the CONTRAST.
        const bare = new pg.Pool({ connectionString: urlFor(TEST_DATABASE) });
        const guarded = poolForDroppableDatabase(urlFor(TEST_DATABASE));

        try {
            expect(() => bare.emit('error', { code: BACKEND_TERMINATED })).toThrow();
            expect(() => guarded.emit('error', { code: BACKEND_TERMINATED })).not.toThrow();
        } finally {
            await Promise.all([bare.end(), guarded.end()]);
        }
    });

    it('⛔ still fails loudly on a fault that is NOT a termination', async () => {
        // The mutation that matters most: a helper that absorbs everything turns every DB integration suite
        // in this package into a pool that cannot report it lost its database.
        const pool = poolForDroppableDatabase(urlFor(TEST_DATABASE));

        try {
            expect(() => pool.emit('error', { code: '28P01' })).toThrow();
        } finally {
            await pool.end();
        }
    });
});

describe('isBackendTermination', () => {
    it('recognises the code postgres sends when a backend is terminated', () => {
        expect(isBackendTermination({ code: '57P01' })).toBe(true);
    });

    it('⛔ refuses every OTHER failure, so a real connection fault still surfaces', () => {
        // The mutation that matters: a predicate widened to `true` turns these suites' pools into black
        // holes. Each of these is a fault a DB integration test exists to catch.
        expect(isBackendTermination({ code: '57P02' })).toBe(false); // crash shutdown
        expect(isBackendTermination({ code: '28P01' })).toBe(false); // bad password
        expect(isBackendTermination({ code: '3D000' })).toBe(false); // database does not exist
        expect(isBackendTermination(new Error('ECONNREFUSED'))).toBe(false);
        expect(isBackendTermination({})).toBe(false);
        expect(isBackendTermination(null)).toBe(false);
        expect(isBackendTermination(undefined)).toBe(false);
        expect(isBackendTermination('57P01')).toBe(false);
    });
});
