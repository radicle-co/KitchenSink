/**
 * The privilege statements that make the service role a DATA-ONLY principal of a database its owner role owns.
 *
 * Re-applied on EVERY migration run, by the runner acting as the owner: food's per-PR databases are TEMPLATE
 * clones (which copy object ACLs but not the database ACL), and recipe's are created empty (which inherit
 * nothing), so a one-off grant on a base database is not enough. Every statement is idempotent.
 *
 * DESIGN PATTERN: Policy module — pure statement lists; the runner is the thin applier. What each role may do with a
 * table of each set is {@link TABLE_POLICY_RIGHTS}'s, read here and by the audit.
 */
import pg from 'pg';

import { MIGRATION_LEDGER_TABLE, loginRoles, type DatabaseRoles } from './databaseRoles.js';
import {
    SERVICE_ROLE_TABLE_RIGHTS,
    TABLE_POLICY_RIGHTS,
    policyTables,
    type TablePolicy,
    type TablePrivilege,
} from './tablePolicy.js';

const SAFE_DATABASE_NAME = /^[a-z0-9_]+$/u;

// Read from `pg` at call time, not destructured at load: a consumer's test that mocks `pg` must not break on import.
const quote = (identifier: string): string => pg.escapeIdentifier(identifier);

/**
 * Whether a database name is one this system issues: lowercase snake_case, so it is a single identifier with or
 * without quoting. DDL cannot bind a database name as a parameter, so every statement that names one checks
 * this first — the quoting is the second line, not the only one. Pure.
 *
 * @param database - The candidate name.
 * @returns `true` for `^[a-z0-9_]+$`.
 */
export function isSafeDatabaseName(database: string): boolean {
    return SAFE_DATABASE_NAME.test(database);
}

/**
 * Refuse a database name that cannot be quoted blindly into DDL.
 *
 * @param database - The name.
 * @throws {Error} when it is not `^[a-z0-9_]+$`.
 */
function assertSafeDatabaseName(database: string): void {
    if (!isSafeDatabaseName(database)) {
        throw new Error(`Refusing to build privilege statements for database name ${JSON.stringify(database)}.`);
    }
}

/**
 * The DATABASE-level ACL, RESET on every run: revoke everything from PUBLIC (PostgreSQL grants CONNECT to PUBLIC by
 * default, so every login could otherwise connect to every database) and from every login — so a CREATE or TEMP
 * grant that drifted in is taken back rather than kept — then admit exactly the login roles, and TEMP to the seeder
 * where there is one. The migrator needs nothing more on the database itself: its DDL runs as the owner, which holds
 * every database right.
 *
 * Issued by TWO principals, from ONE definition: the platform bootstrap, as the master acting as the owner from the
 * maintenance database (a database ACL is a shared-catalog object, so it needs no connection INTO the database —
 * which prod's master, SET-only on the owner, could not make once PUBLIC is gone), and every migration run, where
 * {@link privilegesBeforeApply} begins with it.
 *
 * @param roles - The database's roles.
 * @param database - The database.
 * @returns The statements, in order. Pure.
 * @throws {Error} when the database name is not safe to quote.
 */
export function databaseAclStatements(roles: DatabaseRoles, database: string): readonly string[] {
    assertSafeDatabaseName(database);

    const logins = loginRoles(roles).map(quote).join(', ');

    return [
        `REVOKE ALL ON DATABASE ${quote(database)} FROM PUBLIC, ${logins}`,
        `GRANT CONNECT ON DATABASE ${quote(database)} TO ${logins}`,
        // The seeder stages the seed in temporary tables (curated catalog plan KTD-1), re-granted after the reset.
        ...(roles.seeder === undefined
            ? []
            : [`GRANT TEMPORARY ON DATABASE ${quote(database)} TO ${quote(roles.seeder)}`]),
    ];
}

/** The service role's default table rights, as SQL. */
const SERVICE_ROLE_DML = SERVICE_ROLE_TABLE_RIGHTS.join(', ');

/**
 * Statements to run BEFORE the migrations, as the owner.
 *
 * The database ACL ({@link databaseAclStatements}), then schema USAGE for the service role and the seeder, and the
 * grant-on-create hook, so every table and sequence a migration creates is granted to the service role as it is
 * created. The seeder's USAGE is explicit because `CREATE DATABASE` gives PUBLIC USAGE on `public` today, and a role's
 * rights must not rest on a template default (curated catalog plan U4).
 *
 * @param roles - The database's roles.
 * @param database - The database being migrated.
 * @returns The statements, in order. Pure.
 * @throws {Error} when the database name is not safe to quote.
 */
export function privilegesBeforeApply(roles: DatabaseRoles, database: string): readonly string[] {
    const owner = quote(roles.owner);
    const app = quote(roles.app);

    return [
        ...databaseAclStatements(roles, database),
        `GRANT USAGE ON SCHEMA public TO ${app}`,
        ...(roles.seeder === undefined ? [] : [`GRANT USAGE ON SCHEMA public TO ${quote(roles.seeder)}`]),
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ${SERVICE_ROLE_DML} ON TABLES TO ${app}`,
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
    ];
}

/**
 * The statement that makes the migration ledger read-only for the service role: the boot guard reads it, and only the
 * migrator writes it. Issued where the ledger is created and again after every run. Pure.
 *
 * @param roles - The database's roles.
 * @returns The statement.
 */
export function migrationLedgerReadOnly(roles: DatabaseRoles): string {
    return `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ${MIGRATION_LEDGER_TABLE} FROM ${quote(roles.app)}`;
}

/**
 * Reset one role on one table to exactly `rights`. PUBLIC is revoked too: a right granted to PUBLIC reaches every
 * role, so a reset that kept it would leave the role holding more than `rights`, and the seed trigger would read any
 * login holding INSERT on the ledger as the seeder.
 *
 * @param table - The table.
 * @param role - The role.
 * @param rights - What the role holds afterwards.
 * @returns The REVOKE and the GRANT. Pure.
 */
function exactRights(table: string, role: string, rights: readonly TablePrivilege[]): readonly string[] {
    return [
        `REVOKE ALL ON TABLE ${quote(table)} FROM PUBLIC, ${quote(role)}`,
        `GRANT ${rights.join(', ')} ON TABLE ${quote(table)} TO ${quote(role)}`,
    ];
}

/**
 * The table policy's grants for the policy tables in `existing` (curated catalog plan KTD-13).
 *
 * Each table is reset to exactly its set's rights: the seeder on every set, since nothing else grants it a table; the
 * service role only where its set restricts it, since there the reset is what takes back the DML the grant-on-create
 * hook and the blanket grant hand it. A catalog table keeps the service role's default DML untouched, so drift there
 * is left for the audit to report rather than repaired out of sight.
 *
 * The runner issues these inside each migration's transaction, for the tables that exist by then, so a read-only
 * table is never committed with the service role's default DML on it.
 *
 * @param roles - The database's roles.
 * @param policy - Its table policy.
 * @param existing - The tables that exist; policy tables outside it are skipped.
 * @returns The statements, in {@link policyTables} order. Pure.
 */
export function tablePolicyStatements(
    roles: DatabaseRoles,
    policy: TablePolicy,
    existing: Iterable<string>,
): readonly string[] {
    const present = new Set(existing);

    return policyTables(policy)
        .filter(({ table }) => present.has(table))
        .flatMap(({ table, set }) => {
            const rights = TABLE_POLICY_RIGHTS[set];
            const appRestricted = !SERVICE_ROLE_TABLE_RIGHTS.every((right) => rights.app.includes(right));

            return [
                ...(appRestricted ? exactRights(table, roles.app, rights.app) : []),
                ...(roles.seeder === undefined ? [] : exactRights(table, roles.seeder, rights.seeder)),
            ];
        });
}

/**
 * Statements to run AFTER the migrations, as the owner. The runner issues them as ONE transaction: between the
 * blanket grant and the policy's reset the service role holds DML on every read-only table, and only a transaction
 * keeps that state from being seen or from outliving a failure (curated catalog plan U4a).
 *
 * Grants DML on everything that now exists (covering objects that predate the default-privileges hook), makes the
 * migration ledger read-only for the service role, takes every table and sequence right from the seeder, then
 * applies the policy to every table it names.
 *
 * @param roles - The database's roles.
 * @param policy - Its table policy; every table it names must exist.
 * @returns The statements, in order. Pure.
 */
export function privilegesAfterApply(roles: DatabaseRoles, policy: TablePolicy): readonly string[] {
    const app = quote(roles.app);

    return [
        `GRANT ${SERVICE_ROLE_DML} ON ALL TABLES IN SCHEMA public TO ${app}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`,
        migrationLedgerReadOnly(roles),
        ...(roles.seeder === undefined
            ? []
            : [
                  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quote(roles.seeder)}`,
                  `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quote(roles.seeder)}`,
              ]),
        ...tablePolicyStatements(
            roles,
            policy,
            policyTables(policy).map(({ table }) => table),
        ),
    ];
}
