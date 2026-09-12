/**
 * The statements that bring a database's three roles into existence and wire their memberships.
 *
 * Split in two ON PURPOSE:
 *
 * - {@link roleModelStatements} creates the roles and their memberships and NEVER mentions `rds_iam`;
 * - {@link iamLoginStatements} grants `rds_iam` to the two LOGIN roles.
 *
 * The applier runs the second only after re-reading the catalog and confirming the master has no path into either
 * login role, because the master holding a membership in a role that holds `rds_iam` is the lock-out
 * (`docs/plans/2026-09-11-database-role-split.md`). Keeping the grant out of the first list is what makes that
 * ordering enforceable rather than a convention.
 *
 * Every statement is idempotent, so the bootstrap can run on every deploy.
 *
 * DESIGN PATTERN: Policy module — pure statement lists; `applyRoleModel` is the thin applier.
 */
import type { DatabaseRoles } from './databaseRoles.js';
import type { LockOutEdges } from './roleGraph.js';

/** Where the statements run. */
export interface RoleModelContext {
    /** The RDS master login the bootstrap connects as. */
    readonly master: string;
    /** Production: no per-PR databases, so the migrator creates none and the master does not inherit the owner. */
    readonly isProd: boolean;
    /**
     * Which `pg_auth_members` rows count as membership when asking whether the master can reach `rds_iam`.
     * Defaults to `every-row` — the conservative reading, and the only one production uses. `inherit-or-set` exists
     * for a vanilla-PostgreSQL stand-in master, whose ADMIN is recorded as rows RDS holds implicitly (see
     * `edgeConfersMembership`).
     */
    readonly lockOutEdges?: LockOutEdges;
}

const quote = (identifier: string): string => `"${identifier}"`;

/** An idempotent `CREATE ROLE` — PostgreSQL has no `IF NOT EXISTS` for roles. */
const createRole = (role: string, login: 'LOGIN' | 'NOLOGIN'): string =>
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${quote(role)} ${login}; END IF; END $$`;

/**
 * Create the owner, migrator and service roles and wire their memberships. Mentions `rds_iam` nowhere.
 *
 * - The owner is re-asserted NOLOGIN and NOCREATEDB on every run, so it cannot drift into a login.
 * - The migrator may create databases only outside prod (per-PR databases, ADR-0006); the service role never.
 * - The migrator holds INHERIT and SET on the owner: it `SET ROLE`s to it for DDL.
 * - The master holds SET on the owner everywhere (to create a database `OWNER` it), and INHERIT only outside prod,
 *   which is what lets the per-PR reaper drop an owner-owned database. In prod nothing reaches inside.
 *
 * ⚠️ Re-granting an existing membership with different options UPDATES them (PostgreSQL 16+), so moving a stage
 * between the two shapes needs no separate revoke; the integration tier checks that against a real server.
 *
 * @param roles - The database's roles.
 * @param context - The master login and the stage kind.
 * @returns The statements, in order. Pure.
 */
export function roleModelStatements(roles: DatabaseRoles, context: RoleModelContext): readonly string[] {
    const inheritForMaster = context.isProd ? 'FALSE' : 'TRUE';

    return [
        createRole(roles.owner, 'NOLOGIN'),
        `ALTER ROLE ${quote(roles.owner)} NOLOGIN NOCREATEDB`,
        createRole(roles.migrator, 'LOGIN'),
        createRole(roles.app, 'LOGIN'),
        `ALTER ROLE ${quote(roles.migrator)} ${context.isProd ? 'NOCREATEDB' : 'CREATEDB'}`,
        `ALTER ROLE ${quote(roles.app)} NOCREATEDB`,
        `GRANT ${quote(roles.owner)} TO ${quote(roles.migrator)} WITH INHERIT TRUE, SET TRUE`,
        `GRANT ${quote(roles.owner)} TO ${quote(context.master)} WITH INHERIT ${inheritForMaster}, SET TRUE`,
    ];
}

/**
 * Grant `rds_iam` to the two LOGIN roles — never to the owner.
 *
 * ⛔ Issue these only after confirming the master has no membership path into either role: `rds_iam` reached
 * through ANY chain forces IAM auth on the master (AWS), locking out every password client.
 *
 * @param roles - The database's roles.
 * @returns The statements. Pure.
 */
export function iamLoginStatements(roles: DatabaseRoles): readonly string[] {
    return [`GRANT rds_iam TO ${quote(roles.migrator)}`, `GRANT rds_iam TO ${quote(roles.app)}`];
}
