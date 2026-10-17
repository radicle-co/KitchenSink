/**
 * The role model must exist before a migrate names it (curated catalog plan U18).
 *
 * Roles are server-wide and created by the global stack's bootstrap (`DataStack`), never by a migrate. A migrate that
 * ran before that bootstrap would fail on its first GRANT with a message that names neither the cause nor the fix, so
 * `applyMigrations` checks first, before its lock, `SET ROLE` or any grant.
 *
 * @pattern Design by contract — a precondition
 */
import { databaseRoleNames, type DatabaseRoles } from './databaseRoles.js';
import type { CatalogReader } from '../port.js';

/** A role the database's model needs does not exist on the server. */
export class RoleModelAbsentError extends Error {
    /** Which schema this is. */
    public readonly label: string;
    /** The database being migrated. */
    public readonly database: string;
    /** The roles that do not exist. */
    public readonly missing: readonly string[];

    public constructor(label: string, database: string, missing: readonly string[]) {
        super(
            `[${label}] ${database} cannot be migrated: the role model is incomplete (missing ${missing.join(', ')}). ` +
                'Roles are created by the platform bootstrap: deploy the global stack first, then migrate.',
        );
        this.name = 'RoleModelAbsentError';
        this.label = label;
        this.database = database;
        this.missing = [...missing];
        Object.setPrototypeOf(this, RoleModelAbsentError.prototype);
    }
}

/**
 * Type guard for {@link RoleModelAbsentError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is an incomplete role model.
 */
export function isRoleModelAbsentError(value: unknown): value is RoleModelAbsentError {
    return value instanceof RoleModelAbsentError;
}

/** Options for {@link assertRoleModelPresent}. */
export interface AssertRoleModelPresentOptions {
    /** Which schema this is, for the message. */
    readonly label: string;
    /** The database being migrated, for the message. */
    readonly database: string;
    /** The database's roles. */
    readonly roles: DatabaseRoles;
}

/**
 * Refuse unless every role of the database exists.
 *
 * @param reader - A connection to the server.
 * @param options - The label, the database and its roles.
 * @throws {RoleModelAbsentError} naming every missing role.
 * @sideEffect One read of `pg_roles`.
 */
export async function assertRoleModelPresent(
    reader: CatalogReader,
    options: AssertRoleModelPresentOptions,
): Promise<void> {
    const wanted = databaseRoleNames(options.roles);
    const { rows } = await reader.query<{ rolname: string }>(
        'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
        [[...wanted]],
    );
    const present = new Set(rows.map((row) => row.rolname));
    const missing = wanted.filter((role) => !present.has(role));

    if (missing.length > 0) {
        throw new RoleModelAbsentError(options.label, options.database, missing);
    }
}
