/**
 * Run work while one session holds an advisory lock, waiting a bounded time for it.
 *
 * @pattern Execute Around — the lock is taken before the work and released after it, however the work ends
 *
 * The one place in the repository that takes and releases a blocking SESSION advisory lock
 * (`packages/infra/global/__tests__/sessionAdvisoryLockSites.test.ts`). The lock is a registered class in the
 * two-argument space or a reserved key in the single-argument one (`roles/advisoryLockClasses.ts`).
 *
 * A SESSION lock outlives every transaction the work opens, which is the point: a caller that must plan against
 * another caller's COMMITTED rows takes it before its first transaction begins (curated catalog plan KTD-2). A lock
 * taken inside a transaction comes too late, because PostgreSQL fixes a REPEATABLE READ snapshot at the transaction's
 * first statement.
 *
 * The wait is bounded with `lock_timeout`: `pg_advisory_lock` waits forever by default, so a holder killed mid-flight
 * would hang every later caller with nothing to read. The bound is RESET as soon as the lock is granted, because it is
 * a session setting and would otherwise shorten every lock wait the work makes. RESET restores the server default, not
 * a value the caller set before.
 *
 * ⛔ The unlock is in its own `finally`, and is best-effort: a cleanup statement fails only on a connection that is
 * already broken, and PostgreSQL drops a session's advisory locks when its backend goes away. A failed unlock must
 * never replace the work's own outcome, so it is swallowed rather than reported.
 */
import type { StatementRunner } from './port.js';
import { RESERVED_ADVISORY_LOCK_KEYS, type AdvisoryLockKey } from './roles/advisoryLockClasses.js';
import { SessionLockTimeoutError } from './sessionLock.errors.js';

/** Which lock, and how long to wait for it. */
export type SessionLockOptions = AdvisoryLockKey & {
    /** How long to wait for the lock, in whole milliseconds; sized under the caller's own runtime budget. */
    readonly waitTimeoutMs: number;
};

/** The statements one lock is taken and released with, and the values both bind. */
interface LockStatements {
    readonly lock: string;
    readonly unlock: string;
    readonly values: readonly number[];
}

/** The SQLSTATE PostgreSQL raises when `lock_timeout` expires (`lock_not_available`). */
const LOCK_NOT_AVAILABLE = '55P03';

/** The `int4` range the two-argument form takes. */
const INT4_MIN = -(2 ** 31);
const INT4_MAX = 2 ** 31 - 1;

/**
 * Whether an error is PostgreSQL's lock-timeout refusal. Pure.
 *
 * @param error - Anything thrown.
 * @returns `true` for SQLSTATE 55P03.
 */
function isLockNotAvailable(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === LOCK_NOT_AVAILABLE;
}

/**
 * The lock alone, without its bound. Pure.
 *
 * @param options - The lock and its bound.
 * @returns The lock, as the timeout reports it.
 */
function lockOf(options: SessionLockOptions): AdvisoryLockKey {
    return options.reserved === undefined
        ? { classId: options.classId, objectId: options.objectId }
        : { reserved: options.reserved };
}

/**
 * Refuse options the lock statements would misread, and resolve the statements. Pure.
 *
 * @param options - The lock and its bound.
 * @returns The lock's statements and values.
 * @throws {RangeError} when the bound is not a positive whole number, a registered object id is outside `int4`, or a
 *   reserved name is not in the registry — the lock function is strict, so a NULL key returns without locking and the
 *   work would run unserialized.
 */
function lockStatements(options: SessionLockOptions): LockStatements {
    if (!Number.isSafeInteger(options.waitTimeoutMs) || options.waitTimeoutMs <= 0) {
        throw new RangeError(
            `waitTimeoutMs must be a positive whole number of ms, not ${String(options.waitTimeoutMs)}`,
        );
    }

    if (options.reserved !== undefined) {
        if (!Object.hasOwn(RESERVED_ADVISORY_LOCK_KEYS, options.reserved)) {
            throw new RangeError(`${String(options.reserved)} is not a reserved advisory-lock key`);
        }

        return {
            lock: 'SELECT pg_advisory_lock($1)',
            unlock: 'SELECT pg_advisory_unlock($1)',
            values: [RESERVED_ADVISORY_LOCK_KEYS[options.reserved]],
        };
    }

    if (!Number.isSafeInteger(options.objectId) || options.objectId < INT4_MIN || options.objectId > INT4_MAX) {
        throw new RangeError(`objectId must be an int4, not ${String(options.objectId)}`);
    }

    return {
        lock: 'SELECT pg_advisory_lock($1, $2)',
        unlock: 'SELECT pg_advisory_unlock($1, $2)',
        values: [options.classId, options.objectId],
    };
}

/**
 * Take the lock within the bound, and reset the bound whatever happens.
 *
 * @param session - A connection outside any transaction.
 * @param options - The lock and its bound.
 * @param statements - The lock's statements.
 * @throws {SessionLockTimeoutError} when the bound expires first.
 * @throws The driver's error for any other failure, unchanged.
 * @sideEffect Sets and resets `lock_timeout`; takes a session advisory lock.
 */
async function takeLock(
    session: StatementRunner,
    options: SessionLockOptions,
    statements: LockStatements,
): Promise<void> {
    await session.query(`SET lock_timeout = ${String(options.waitTimeoutMs)}`);

    try {
        await session.query(statements.lock, [...statements.values]);
    } catch (error) {
        // The lock's failure is the one reported: a reset that also fails is on a connection already lost.
        await session.query('RESET lock_timeout').catch(() => undefined);

        if (isLockNotAvailable(error)) {
            throw new SessionLockTimeoutError({
                lock: lockOf(options),
                waitTimeoutMs: options.waitTimeoutMs,
                cause: error,
            });
        }

        throw error;
    }
}

/**
 * Run `work` while this session holds the advisory lock `options` names.
 *
 * @param session - A connection outside any transaction; the work runs on whatever connection it closes over.
 * @param options - The lock and how long to wait for it.
 * @param work - The work.
 * @returns What `work` returned.
 * @throws {RangeError} when the options are out of range, before any statement.
 * @throws {SessionLockTimeoutError} when the lock is not granted within the bound; `work` does not run.
 * @throws Whatever `work` throws, after the lock is released.
 * @sideEffect Sets and resets `lock_timeout`, and takes and releases a session advisory lock.
 */
export async function withSessionAdvisoryLock<T>(
    session: StatementRunner,
    options: SessionLockOptions,
    work: () => Promise<T>,
): Promise<T> {
    const statements = lockStatements(options);

    await takeLock(session, options, statements);

    try {
        // A failed reset leaves the bound on the session, so the work does not run; the lock is still released below.
        await session.query('RESET lock_timeout');

        return await work();
    } finally {
        await session.query(statements.unlock, [...statements.values]).catch(() => undefined);
    }
}
