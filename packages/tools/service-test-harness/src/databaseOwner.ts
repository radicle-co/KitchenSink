/**
 * @module databaseOwner — "this database belongs to the role that should own it", asserted once.
 *
 * A database left by a pre-role-split run belongs to whoever made it — usually `postgres` — and the migrator
 * can neither rebuild nor empty it. The fixture REPORTS that and names the fix; it does not repair it, because
 * `DROP DATABASE` has exactly two authorities in this repository (the per-PR reaper and the role split's armed
 * recreate, asserted by `dropDatabaseAuthority.test.ts`), both production code, and a fixture is neither.
 *
 * It lives in its own module because two fixtures need the rule — `provisionRoleDatabase` for a tier's database
 * and food's base-template bootstrap for `kitchensink_food` — and a second copy of a refusal is a second copy of
 * the reasoning behind it.
 */
import pg from 'pg';

/** Raised when a database exists but belongs to the wrong role — the shape a pre-role-split run leaves. */
export class MisownedDatabaseError extends Error {
    public constructor(database: string, owner: string, expected: string) {
        super(
            `'${database}' exists but is owned by ${owner}, not ${expected}, so the migrator can neither rebuild ` +
                'nor empty it — most likely it was left by a pre-role-split run. Remove that database by hand ' +
                '(psql, as a superuser) and re-run; this fixture will not remove it for you, because the two ' +
                'authorities that may drop a database here (ADR-0039) are production code, and a fixture is neither.',
        );
        this.name = 'MisownedDatabaseError';
        Object.setPrototypeOf(this, MisownedDatabaseError.prototype);
    }
}

/**
 * Type guard for {@link MisownedDatabaseError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the refusal.
 */
export function isMisownedDatabaseError(error: unknown): error is MisownedDatabaseError {
    return error instanceof MisownedDatabaseError;
}

/**
 * Assert that `database` is owned by `expected`, REPORTING a mismatch rather than repairing it.
 *
 * @param masterUrl - A connection as the stand-in master, which can read `pg_database`.
 * @param database - The database to inspect.
 * @param expected - The owner role it must have.
 * @throws {MisownedDatabaseError} when it exists under a different owner.
 * @sideEffect Opens a connection and reads `pg_database`.
 */
export async function assertDatabaseOwnedBy(masterUrl: string, database: string, expected: string): Promise<void> {
    const master = new pg.Pool({ connectionString: masterUrl, max: 1 });

    try {
        const found = await master.query<{ owner: string }>(
            'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
            [database],
        );
        const owner = found.rows[0]?.owner;

        if (owner !== undefined && owner !== expected) {
            throw new MisownedDatabaseError(database, owner, expected);
        }
    } finally {
        await master.end();
    }
}
