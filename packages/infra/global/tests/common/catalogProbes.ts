/**
 * @module catalogProbes — the read-only questions the role-split suites ask the catalog, through the superuser
 * connection that built their fixtures. Nothing here runs as the stand-in master, so nothing here can be what a test
 * proves.
 *
 * DESIGN PATTERN: Facade over `pg_auth_members`, `pg_database` and the ACL functions.
 */
import {
    edgeConfersMembership,
    pathsToRole,
    readMembershipEdges,
    type CatalogReader,
    type MembershipEdge,
} from '@kitchensink/db-schema-guard';

/** The questions, bound to one superuser connection and one stand-in master. */
export interface CatalogProbes {
    /** The whole membership graph. */
    readonly edges: () => Promise<readonly MembershipEdge[]>;
    /** Whether `role` holds any `pg_auth_members` row into `rds_iam`, whatever its options. */
    readonly holdsIamRow: (role: string) => Promise<boolean>;
    /**
     * The master's membership paths to `role`, read the way the stand-in is run (`inherit-or-set`): the stand-in's
     * ADMIN-only rows are vanilla PostgreSQL's record of an ADMIN that RDS holds without a row.
     */
    readonly masterPathsTo: (role: string) => Promise<readonly (readonly string[])[]>;
    /** `has_database_privilege`: whether `role` holds `privilege` on `database`, however it is reached. */
    readonly can: (role: string, privilege: string, database: string) => Promise<boolean>;
    /** The privileges `role` holds on `database` through an EXPLICIT ACL entry, sorted. */
    readonly explicitGrants: (role: string, database: string) => Promise<readonly string[]>;
}

/**
 * Bind the probes to a connection and a master.
 *
 * @param admin - A superuser connection to the maintenance database.
 * @param master - The stand-in master's name.
 * @returns The probes; each reads the catalog when called.
 */
export function catalogProbes(admin: CatalogReader, master: string): CatalogProbes {
    const edges = async (): Promise<readonly MembershipEdge[]> => readMembershipEdges(admin);

    return {
        edges,
        holdsIamRow: async (role) => (await edges()).some((edge) => edge.member === role && edge.role === 'rds_iam'),
        masterPathsTo: async (role) => pathsToRole(await edges(), master, role, edgeConfersMembership),
        can: async (role, privilege, database) => {
            const result = await admin.query<{ ok: boolean }>('SELECT has_database_privilege($1, $2, $3) AS ok', [
                role,
                database,
                privilege,
            ]);

            return result.rows[0]?.ok ?? false;
        },
        explicitGrants: async (role, database) => {
            const result = await admin.query<{ privilege_type: string }>(
                `SELECT a.privilege_type FROM pg_database d, aclexplode(d.datacl) a
                  WHERE d.datname = $1 AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)
                  ORDER BY 1`,
                [database, role],
            );

            return result.rows.map((row) => row.privilege_type);
        },
    };
}
