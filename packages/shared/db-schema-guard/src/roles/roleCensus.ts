/**
 * The role census: what the RDS master is, what it can do, and the whole membership graph — read-only.
 *
 * Reported by the per-PR reaper's `count` (Step 0 of the database role split) and logged by the role-model
 * bootstrap before it changes anything. It lives beside the graph it reads.
 *
 * ## Why the reaper carries it
 *
 * The role split (`docs/plans/2026-09-11-database-role-split.md`) rests on facts about the LIVE RDS catalog that
 * cannot be measured from outside the VPC: which memberships the master login (`identity_app`) already holds and
 * with which grant options, whether it can create databases or signal backends, and who owns every kitchensink
 * database. The instance is `PRIVATE_ISOLATED`, and this function is the one sanctioned, sandbox-only executor
 * already connected as the master (ADR-0031). So the census rides on its existing `count` action, read-only.
 *
 * ⛔ The one number that must always be empty is `currentUserPathsToRdsIam`: a password-authenticated master on
 * ANY chain to `rds_iam` is locked out (AWS: nested membership counts). This reports it; the role-split bootstrap
 * will assert it.
 */
import { DATABASE_ROLES } from './databaseRoles.js';
import { pathsToRole, readMembershipEdges, type CatalogReader, type MembershipEdge } from './roleGraph.js';

/** The RDS-managed role whose membership switches a login to IAM-token authentication. */
export const RDS_IAM_ROLE = 'rds_iam';

/**
 * The roles whose GRANT the role split depends on the master being able to issue. Step 0 found the sandbox master
 * holds no `pg_auth_members` edge to the app roles at all, so whether it holds ADMIN on them (e.g. implicitly via
 * `rds_superuser`) has to be ASKED of `pg_has_role`, not read off the edges.
 */
export const DEFAULT_ADMIN_PROBE: readonly string[] = [
    DATABASE_ROLES.food.app,
    DATABASE_ROLES.recipe.app,
    RDS_IAM_ROLE,
    'rds_superuser',
];

/** What the census reports. */
export interface RoleCensus {
    /** The role this function connected as — the master, when run by the deployed reaper. */
    readonly currentUser: string;
    /** `server_version`, e.g. `18.3`. */
    readonly serverVersion: string;
    /** The connecting role's own attributes. */
    readonly attributes: { readonly superuser: boolean; readonly createdb: boolean; readonly createrole: boolean };
    /** Whether the connecting role holds `pg_signal_backend` — what `DROP DATABASE … WITH (FORCE)` needs. */
    readonly signalBackend: boolean;
    /** The whole membership graph. */
    readonly edges: readonly MembershipEdge[];
    /** Every chain from the connecting role to `rds_iam`. MUST be empty for the master. */
    readonly currentUserPathsToRdsIam: readonly (readonly string[])[];
    /** Every `kitchensink*` database and the role that owns it. */
    readonly databaseOwners: readonly { readonly datname: string; readonly owner: string }[];
    /** Whether the connecting role holds ADMIN on each probed role; `null` when the role does not exist. */
    readonly adminOn: Readonly<Record<string, boolean | null>>;
}

/** Options for {@link readRoleCensus}. */
export interface RoleCensusOptions {
    /** Roles to ask `pg_has_role(… 'MEMBER WITH ADMIN OPTION')` about. Defaults to {@link DEFAULT_ADMIN_PROBE}. */
    readonly adminProbe?: readonly string[];
}

/**
 * Read the census. Read-only: catalog queries and `pg_has_role` only.
 *
 * @param reader - A connection to the maintenance database.
 * @param options - Which roles to probe for ADMIN.
 * @returns The census.
 * @sideEffect Reads the system catalogs.
 */
export async function readRoleCensus(reader: CatalogReader, options: RoleCensusOptions = {}): Promise<RoleCensus> {
    const [self] = (
        await reader.query<{
            current_user: string;
            server_version: string;
            rolsuper: boolean;
            rolcreatedb: boolean;
            rolcreaterole: boolean;
            signal_backend: boolean;
        }>(
            `SELECT current_user, current_setting('server_version') AS server_version,
                    r.rolsuper, r.rolcreatedb, r.rolcreaterole,
                    pg_has_role(current_user, 'pg_signal_backend', 'USAGE') AS signal_backend
               FROM pg_roles r
              WHERE r.rolname = current_user`,
        )
    ).rows;

    if (self === undefined) {
        throw new Error('role census: the connecting role is not in pg_roles');
    }

    const edges = await readMembershipEdges(reader);
    const databaseOwners = (
        await reader.query<{ datname: string; owner: string }>(
            `SELECT datname, pg_get_userbyid(datdba) AS owner
               FROM pg_database
              WHERE datname LIKE 'kitchensink%'
              ORDER BY datname`,
        )
    ).rows;

    const adminOn: Record<string, boolean | null> = {};

    for (const role of options.adminProbe ?? DEFAULT_ADMIN_PROBE) {
        // By OID from pg_roles, so an absent role yields no row (`null`) instead of an error.
        const [row] = (
            await reader.query<{ admin: boolean }>(
                "SELECT pg_has_role(current_user, oid, 'MEMBER WITH ADMIN OPTION') AS admin FROM pg_roles WHERE rolname = $1",
                [role],
            )
        ).rows;

        adminOn[role] = row === undefined ? null : row.admin;
    }

    return {
        currentUser: self.current_user,
        serverVersion: self.server_version,
        attributes: { superuser: self.rolsuper, createdb: self.rolcreatedb, createrole: self.rolcreaterole },
        signalBackend: self.signal_backend,
        edges,
        currentUserPathsToRdsIam: pathsToRole(edges, self.current_user, RDS_IAM_ROLE),
        databaseOwners,
        adminOn,
    };
}
