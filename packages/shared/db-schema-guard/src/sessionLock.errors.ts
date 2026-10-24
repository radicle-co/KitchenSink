import type { AdvisoryLockKey } from './roles/advisoryLockClasses.js';

/**
 * A session advisory lock was not granted within its bounded wait (`withSessionAdvisoryLock`).
 *
 * The holder is another session doing the same work, so the operator's question is "who holds it and why so long",
 * and the lock and the bound are what answer it. The PostgreSQL error (SQLSTATE 55P03) is the `cause`.
 */
export class SessionLockTimeoutError extends Error {
    /** The lock the wait was for: a registered class and object, or a reserved key by name. */
    public readonly lock: AdvisoryLockKey;
    /** How long the session waited before giving up. */
    public readonly waitTimeoutMs: number;

    public constructor(input: {
        readonly lock: AdvisoryLockKey;
        readonly waitTimeoutMs: number;
        readonly cause: unknown;
    }) {
        super(
            `advisory lock ${describeLock(input.lock)} was not granted within ${String(input.waitTimeoutMs)} ms: ` +
                'another session holds it',
            { cause: input.cause },
        );
        this.name = 'SessionLockTimeoutError';
        this.lock = input.lock;
        this.waitTimeoutMs = input.waitTimeoutMs;
        Object.setPrototypeOf(this, SessionLockTimeoutError.prototype);
    }
}

/**
 * A lock as an operator reads it: `(classId, objectId)` for a registered lock, the key's name for a reserved one. Pure.
 *
 * @param lock - The lock.
 * @returns Its description.
 */
function describeLock(lock: AdvisoryLockKey): string {
    return lock.reserved === undefined ? `(${String(lock.classId)}, ${String(lock.objectId)})` : lock.reserved;
}

/**
 * Type guard for {@link SessionLockTimeoutError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is a session lock that was not granted in time.
 */
export function isSessionLockTimeoutError(value: unknown): value is SessionLockTimeoutError {
    return value instanceof SessionLockTimeoutError;
}
