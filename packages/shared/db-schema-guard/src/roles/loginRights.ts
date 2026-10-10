/**
 * What a database and each of its login roles must hold once its ACL has been reset (ADR-0039; the seeder, curated
 * catalog plan U3 and U18).
 *
 * Two steps reset a database's ACL with `databaseAclStatements`, and both re-read it with {@link readDatabaseRights}
 * and refuse on any line {@link unmetPostconditions} reports:
 *
 * - the platform bootstrap, on every database it creates, reading from `postgres` (prod's master cannot connect in);
 * - the migration runner, on the database it migrates. A per-PR food database is created by the runner and never seen
 *   by the bootstrap, so this is the only check its ACL gets, and the seeder writes there.
 *
 * Both reads go to `pg_database` and the ACL functions, so neither needs to connect to the database it judges.
 *
 * @pattern Policy module — a pure rule table keyed by `LoginRoleKey`, so a new login part is a compile error here until
 *   it has a rule; the two callers are thin appliers
 */
import { loginRoles, loginRolesByKey, type DatabaseRoles, type LoginRoleKey } from './databaseRoles.js';
import type { CatalogReader } from '../port.js';

/** Prefixes both reads, so a test double can recognise them. */
export const DATABASE_RIGHTS_MARKER = '/* database-rights */';

/** What the catalog says about the database itself. */
export interface DatabaseAclRow {
    readonly owner: string;
    /** `datconnlimit`; `-2` marks a database an interrupted `DROP` left invalid. */
    readonly connectionLimit: number;
    readonly publicConnect: boolean;
}

/** What the catalog says about one login role's rights on the database. */
export interface LoginRightsRow {
    readonly role: string;
    /** `has_database_privilege`: held however it is reached — its own grant, PUBLIC, or a role it inherits. */
    readonly connect: boolean;
    readonly create: boolean;
    readonly temporary: boolean;
    /** Held through the role's OWN entry in the database ACL. */
    readonly explicitCreate: boolean;
    readonly explicitTemporary: boolean;
}

/** One database's rows, as {@link readDatabaseRights} found them. */
export interface DatabaseRights {
    /** The database's row, or `undefined` when it does not exist. */
    readonly database: DatabaseAclRow | undefined;
    /** One row per login role that exists; a login role with no row does not exist. */
    readonly logins: readonly LoginRightsRow[];
}

/** A right a database ACL can carry beyond CONNECT. */
type DatabaseRight = 'CREATE' | 'TEMPORARY';

/** What one login part must and must not hold. Every part must be able to CONNECT. */
interface LoginRights {
    /** Rights it must hold through its own ACL entry. */
    readonly explicit: readonly DatabaseRight[];
    /** Rights it must not hold through its own ACL entry; it may still inherit them. */
    readonly notExplicit: readonly DatabaseRight[];
    /** Rights it must not hold at all, however reached. */
    readonly notHeld: readonly DatabaseRight[];
}

const LOGIN_RIGHTS: Readonly<Record<LoginRoleKey, LoginRights>> = {
    // The migrator's DDL runs as the owner, whose rights it inherits on purpose; only an explicit grant is drift.
    migrator: { explicit: [], notExplicit: ['CREATE', 'TEMPORARY'], notHeld: [] },
    app: { explicit: [], notExplicit: [], notHeld: ['CREATE', 'TEMPORARY'] },
    // The seeder stages the seed in temporary tables (curated catalog plan KTD-1) and creates nothing that lasts.
    seeder: { explicit: ['TEMPORARY'], notExplicit: [], notHeld: ['CREATE'] },
};

const explicitlyHeld = (row: LoginRightsRow, right: DatabaseRight): boolean =>
    right === 'CREATE' ? row.explicitCreate : row.explicitTemporary;

const held = (row: LoginRightsRow, right: DatabaseRight): boolean => (right === 'CREATE' ? row.create : row.temporary);

/**
 * The unmet lines for one login role. Pure.
 *
 * @param rights - The role's rule.
 * @param row - What the catalog says it holds.
 * @param database - The database, for the sentences.
 * @returns One sentence per unmet line.
 */
function unmetForLogin(rights: LoginRights, row: LoginRightsRow, database: string): string[] {
    const { role } = row;

    return [
        ...(row.connect ? [] : [`${role} cannot CONNECT to ${database}`]),
        ...rights.explicit
            .filter((right) => !explicitlyHeld(row, right))
            .map((right) => `${role} lacks its explicit ${right} grant on ${database}`),
        ...rights.notExplicit
            .filter((right) => explicitlyHeld(row, right))
            .map((right) => `${role} holds an explicit ${right} grant on ${database}`),
        ...rights.notHeld.filter((right) => held(row, right)).map((right) => `${role} holds ${right} on ${database}`),
    ];
}

/**
 * Every postcondition the catalog rows do not meet. Pure.
 *
 * @param expected - The database and its roles.
 * @param database - The database's row, or `undefined` when it does not exist.
 * @param logins - One row per login role that exists; a login role with no row does not exist.
 * @returns One sentence per unmet line; empty when every line holds.
 */
export function unmetPostconditions(
    expected: { readonly roles: DatabaseRoles; readonly database: string },
    database: DatabaseAclRow | undefined,
    logins: readonly LoginRightsRow[],
): readonly string[] {
    const { roles, database: name } = expected;

    if (database === undefined) {
        return [`${name} does not exist`];
    }

    const rowsByRole = new Map(logins.map((row) => [row.role, row]));

    return [
        ...(database.owner === roles.owner ? [] : [`${name} is owned by ${database.owner}, not ${roles.owner}`]),
        ...(database.connectionLimit === -2 ? [`${name} is mid-DROP`] : []),
        ...(database.publicConnect ? [`PUBLIC can still CONNECT to ${name}`] : []),
        ...[...loginRolesByKey(roles)].flatMap(([key, role]) => {
            const row = rowsByRole.get(role);

            return row === undefined ? [`${role} does not exist`] : unmetForLogin(LOGIN_RIGHTS[key], row, name);
        }),
    ];
}

/**
 * Read a database's row and each login role's rights on it, from the catalog.
 *
 * The explicit columns read the ACL itself: `has_database_privilege` also counts what a role inherits, which the
 * migrator is meant to (from the owner).
 *
 * @param reader - A connection to any database on the instance; `pg_database` and `pg_roles` are cluster-wide.
 * @param roles - The database's roles; every login role is asked about, derived from the registry.
 * @param database - The database.
 * @returns Its rows.
 * @sideEffect Reads `pg_database`, `pg_roles` and the database's ACL.
 */
export async function readDatabaseRights(
    reader: CatalogReader,
    roles: DatabaseRoles,
    database: string,
): Promise<DatabaseRights> {
    const [row] = (
        await reader.query<DatabaseAclRow>(
            `${DATABASE_RIGHTS_MARKER}
             SELECT pg_get_userbyid(datdba) AS owner, datconnlimit AS "connectionLimit",
                    has_database_privilege('public', datname, 'CONNECT') AS "publicConnect"
               FROM pg_database WHERE datname = $1`,
            [database],
        )
    ).rows;
    const logins = (
        await reader.query<LoginRightsRow>(
            `${DATABASE_RIGHTS_MARKER}
             SELECT r.rolname AS role,
                    has_database_privilege(r.oid, d.oid, 'CONNECT') AS connect,
                    has_database_privilege(r.oid, d.oid, 'CREATE') AS create,
                    has_database_privilege(r.oid, d.oid, 'TEMPORARY') AS temporary,
                    EXISTS (SELECT 1 FROM aclexplode(d.datacl) a
                             WHERE a.grantee = r.oid AND a.privilege_type = 'CREATE') AS "explicitCreate",
                    EXISTS (SELECT 1 FROM aclexplode(d.datacl) a
                             WHERE a.grantee = r.oid AND a.privilege_type = 'TEMPORARY') AS "explicitTemporary"
               FROM pg_database d CROSS JOIN pg_roles r
              WHERE d.datname = $1 AND r.rolname = ANY($2::text[])`,
            [database, loginRoles(roles)],
        )
    ).rows;

    return { database: row, logins };
}
