/**
 * `withSessionAdvisoryLock` — Execute Around over a session advisory lock (curated catalog plan KTD-2): a registered
 * class in the two-argument space, or a reserved key in the single-argument one.
 *
 * A recording fake proves ORDER, which is where every defect in a lock wrapper lives: the bounded wait must be set
 * before the lock and reset after it, the work must run only while the lock is held, and the unlock must run however
 * the work ends without ever replacing the work's own outcome. Contention and the real timeout are a database's to
 * prove; food-service's LOCAL e2e tier takes the lock against a real PostgreSQL.
 */
import { describe, expect, it } from 'vitest';

import { ADVISORY_LOCK_CLASSES, RESERVED_ADVISORY_LOCK_KEYS } from '../roles/advisoryLockClasses.js';
import { SessionLockTimeoutError, isSessionLockTimeoutError } from '../sessionLock.errors.js';
import type { StatementRunner } from '../port.js';
import { withSessionAdvisoryLock, type SessionLockOptions } from '../sessionLock.js';

/** A PostgreSQL error as `pg` raises it: a message and a SQLSTATE. */
function pgError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
}

/** How the fake answers. */
interface FakeOptions {
    /** A statement prefix that fails, with the error it fails with. */
    readonly failOn?: readonly (readonly [string, Error])[];
}

/** A session that records every statement and its bound values. */
class RecordingSession implements StatementRunner {
    public readonly statements: string[] = [];
    public readonly values: (readonly unknown[] | undefined)[] = [];

    public constructor(private readonly options: FakeOptions = {}) {}

    public async query(sql: string, values?: unknown[]): Promise<unknown> {
        this.statements.push(sql);
        this.values.push(values);

        const failure = this.options.failOn?.find(([prefix]) => sql.startsWith(prefix));

        if (failure !== undefined) {
            throw failure[1];
        }

        return { rows: [], rowCount: 0 };
    }
}

const OPTIONS: SessionLockOptions = {
    classId: ADVISORY_LOCK_CLASSES.foodCatalogSeed,
    objectId: 0,
    waitTimeoutMs: 1_234,
};

describe('withSessionAdvisoryLock', () => {
    it('bounds the wait, takes the two-argument lock, resets the bound, runs the work, then unlocks', async () => {
        const session = new RecordingSession();
        const seen: string[] = [];

        const result = await withSessionAdvisoryLock(session, OPTIONS, async () => {
            seen.push(...session.statements);

            return 'done';
        });

        expect(result).toBe('done');
        expect(seen).toEqual(['SET lock_timeout = 1234', 'SELECT pg_advisory_lock($1, $2)', 'RESET lock_timeout']);
        expect(session.statements).toEqual([...seen, 'SELECT pg_advisory_unlock($1, $2)']);
        expect(session.values[1]).toEqual([ADVISORY_LOCK_CLASSES.foodCatalogSeed, 0]);
        expect(session.values[3]).toEqual([ADVISORY_LOCK_CLASSES.foodCatalogSeed, 0]);
    });

    it('unlocks when the work throws, and rethrows the work’s own error', async () => {
        const session = new RecordingSession();
        const failure = new Error('the apply failed');

        await expect(
            withSessionAdvisoryLock(session, OPTIONS, async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
        expect(session.statements.at(-1)).toBe('SELECT pg_advisory_unlock($1, $2)');
    });

    it('never lets a failed unlock replace the work’s error', async () => {
        const session = new RecordingSession({
            failOn: [['SELECT pg_advisory_unlock', new Error('connection reset')]],
        });
        const failure = new Error('the apply failed');

        await expect(
            withSessionAdvisoryLock(session, OPTIONS, async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
    });

    it('returns the work’s result when only the unlock fails: the backend that cannot unlock has dropped the lock', async () => {
        const session = new RecordingSession({
            failOn: [['SELECT pg_advisory_unlock', new Error('connection reset')]],
        });

        await expect(withSessionAdvisoryLock(session, OPTIONS, async () => 7)).resolves.toBe(7);
    });

    it('turns an exhausted wait into a typed timeout, resets the bound, and neither runs the work nor unlocks', async () => {
        const timeout = pgError('canceling statement due to lock timeout', '55P03');
        const session = new RecordingSession({ failOn: [['SELECT pg_advisory_lock', timeout]] });
        let ran = false;

        const outcome = withSessionAdvisoryLock(session, OPTIONS, async () => {
            ran = true;
        });

        await expect(outcome).rejects.toSatisfy(isSessionLockTimeoutError);
        await outcome.catch((error: unknown) => {
            expect(error).toBeInstanceOf(SessionLockTimeoutError);
            expect((error as SessionLockTimeoutError).cause).toBe(timeout);
            expect((error as SessionLockTimeoutError).lock).toStrictEqual({
                classId: ADVISORY_LOCK_CLASSES.foodCatalogSeed,
                objectId: 0,
            });
            expect((error as SessionLockTimeoutError).waitTimeoutMs).toBe(1_234);
        });
        expect(ran).toBe(false);
        expect(session.statements).toEqual([
            'SET lock_timeout = 1234',
            'SELECT pg_advisory_lock($1, $2)',
            'RESET lock_timeout',
        ]);
    });

    it('rethrows any other lock failure unchanged, even when the reset fails too', async () => {
        const broken = pgError('terminating connection', '57P01');
        const session = new RecordingSession({
            failOn: [
                ['SELECT pg_advisory_lock', broken],
                ['RESET lock_timeout', new Error('connection gone')],
            ],
        });

        await expect(withSessionAdvisoryLock(session, OPTIONS, async () => undefined)).rejects.toBe(broken);
        expect(session.statements).not.toContain('SELECT pg_advisory_unlock($1, $2)');
    });

    it('unlocks when the reset after a taken lock fails, and reports the reset failure', async () => {
        const resetFailure = new Error('connection reset');
        const session = new RecordingSession({ failOn: [['RESET lock_timeout', resetFailure]] });
        let ran = false;

        await expect(
            withSessionAdvisoryLock(session, OPTIONS, async () => {
                ran = true;
            }),
        ).rejects.toBe(resetFailure);
        expect(ran).toBe(false);
        expect(session.statements.at(-1)).toBe('SELECT pg_advisory_unlock($1, $2)');
    });

    it('refuses a wait bound that is not a positive whole number of milliseconds, before any statement', async () => {
        for (const waitTimeoutMs of [0, -1, 1.5, Number.NaN]) {
            const session = new RecordingSession();

            await expect(
                withSessionAdvisoryLock(session, { ...OPTIONS, waitTimeoutMs }, async () => undefined),
            ).rejects.toThrow(RangeError);
            expect(session.statements).toEqual([]);
        }
    });

    it('refuses an object id outside int4, which the two-argument form takes', async () => {
        const session = new RecordingSession();

        await expect(
            withSessionAdvisoryLock(session, { ...OPTIONS, objectId: 2 ** 31 }, async () => undefined),
        ).rejects.toThrow(RangeError);
        expect(session.statements).toEqual([]);
    });
});

describe('withSessionAdvisoryLock — a reserved key', () => {
    const RESERVED: SessionLockOptions = { reserved: 'schemaMigration', waitTimeoutMs: 1_234 };

    it('takes the reserved key in the single-argument space, runs the work, and releases it there', async () => {
        const session = new RecordingSession();
        const seen: string[] = [];

        await withSessionAdvisoryLock(session, RESERVED, async () => {
            seen.push(...session.statements);
        });

        expect(seen).toEqual(['SET lock_timeout = 1234', 'SELECT pg_advisory_lock($1)', 'RESET lock_timeout']);
        expect(session.statements).toEqual([...seen, 'SELECT pg_advisory_unlock($1)']);
        expect(session.values[1]).toEqual([RESERVED_ADVISORY_LOCK_KEYS.schemaMigration]);
        expect(session.values[3]).toEqual([RESERVED_ADVISORY_LOCK_KEYS.schemaMigration]);
    });

    it('names the reserved key in its typed timeout, and neither runs the work nor unlocks', async () => {
        const timeout = pgError('canceling statement due to lock timeout', '55P03');
        const session = new RecordingSession({ failOn: [['SELECT pg_advisory_lock', timeout]] });
        let ran = false;

        const error = await withSessionAdvisoryLock(session, RESERVED, async () => {
            ran = true;
        }).catch((thrown: unknown) => thrown);

        expect(isSessionLockTimeoutError(error)).toBe(true);
        expect((error as SessionLockTimeoutError).lock).toStrictEqual({ reserved: 'schemaMigration' });
        expect((error as SessionLockTimeoutError).message).toMatch(/advisory lock schemaMigration was not granted/u);
        expect(ran).toBe(false);
        expect(session.statements).not.toContain('SELECT pg_advisory_unlock($1)');
    });

    it.each(['notAKey', 'toString'])(
        'refuses %s, which the registry does not hold, before any statement — the strict lock would take NULL',
        async (name) => {
            // `pg_advisory_lock(NULL)` returns NULL without locking, so the work would run unserialized. A cast is the
            // only way a caller reaches this; `toString` is inherited, not registered, so it must fail too.
            const session = new RecordingSession();
            const options = { reserved: name, waitTimeoutMs: 1_234 } as unknown as SessionLockOptions;

            await expect(withSessionAdvisoryLock(session, options, async () => undefined)).rejects.toThrow(RangeError);
            expect(session.statements).toEqual([]);
        },
    );
});
