/**
 * The privilege statements that make the service role a DATA-ONLY principal of a database its owner role owns.
 *
 * Re-applied on EVERY migration run, by the runner acting as the owner: food's per-PR databases are TEMPLATE
 * clones (which copy object ACLs but not the database ACL), and recipe's are created empty (which inherit
 * nothing), so a one-off grant on a base database is not enough. Every statement is idempotent.
 *
 * DESIGN PATTERN: Policy module — pure statement lists; the runner is the thin applier.
 */
import { MIGRATION_LEDGER_TABLE, type DatabaseRoles } from './databaseRoles.js';

/** A database name safe to quote into DDL (it cannot be a bound parameter). */
const SAFE_DATABASE_NAME = /^[a-z0-9_]+$/u;

/** Quote a role or database identifier that has already been validated. */
const quote = (identifier: string): string => `"${identifier}"`;

/**
 * Refuse a database name that cannot be quoted blindly into DDL.
 *
 * @param database - The name.
 * @throws {Error} when it is not `^[a-z0-9_]+$`.
 */
function assertSafeDatabaseName(database: string): void {
    if (!SAFE_DATABASE_NAME.test(database)) {
        throw new Error(`Refusing to build privilege statements for database name ${JSON.stringify(database)}.`);
    }
}

/**
 * The DATABASE-level ACL, RESET on every run: revoke everything from PUBLIC (PostgreSQL grants CONNECT to PUBLIC by
 * default, so every login could otherwise connect to every database) and from both logins — so a CREATE or TEMP
 * grant that drifted in is taken back rather than kept — then admit exactly the migrator and the service role. The
 * migrator needs nothing more on the database itself: its DDL runs as the owner, which holds every database right.
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

    return [
        `REVOKE ALL ON DATABASE ${quote(database)} FROM PUBLIC, ${quote(roles.migrator)}, ${quote(roles.app)}`,
        `GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(roles.migrator)}, ${quote(roles.app)}`,
    ];
}

/**
 * Statements to run BEFORE the migrations, as the owner.
 *
 * The database ACL ({@link databaseAclStatements}), then schema USAGE for the service role and the grant-on-create
 * hook, so every table and sequence a migration creates is granted to the service role as it is created.
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
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
    ];
}

/**
 * Statements to run AFTER the migrations, as the owner.
 *
 * Grants DML on everything that now exists (covering objects that predate the default-privileges hook), then
 * makes the migration ledger read-only for the service role — the boot guard reads it; only the migrator writes.
 *
 * @param roles - The database's roles.
 * @returns The statements, in order. Pure.
 */
export function privilegesAfterApply(roles: DatabaseRoles): readonly string[] {
    const app = quote(roles.app);

    return [
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`,
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ${MIGRATION_LEDGER_TABLE} FROM ${app}`,
    ];
}
