/**
 * @module db-bootstrap/postconditions — what a database and each of its login roles must hold once the bootstrap's
 * ACL step has run (ADR-0039; the seeder, curated catalog plan U18).
 *
 * The pass reads the rows from `pg_database` and the ACL functions, never by connecting in (prod's master cannot), and
 * refuses the deploy on any unmet line. The grants themselves are `databaseAclStatements`; this is the re-read that
 * proves they hold, and catches a grant that drifted in by hand.
 *
 * DESIGN PATTERN: Policy module — a pure rule table keyed by `LoginRoleKey`, so a new login part is a compile error
 * here until it has a rule; the bootstrap pass is the thin applier.
 */
import { loginRolesByKey, type DatabaseRoles, type LoginRoleKey } from '@kitchensink/db-schema-guard';

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

/** The unmet lines for one login role. */
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
