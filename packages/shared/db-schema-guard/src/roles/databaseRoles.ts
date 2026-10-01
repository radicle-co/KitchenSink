/**
 * The one registry of which PostgreSQL role OWNS, MIGRATES and SERVES each database on the shared RDS instance.
 *
 * Three roles per database, and a fourth for food (`docs/plans/2026-09-11-database-role-split.md`, owner ruling
 * 2026-09-11):
 *
 * - **owner** — NOLOGIN, never holds `rds_iam`. Owns the database (and so `public`, via `pg_database_owner`) and
 *   every object in it. Nothing logs in as it; the migrator `SET ROLE`s to it for DDL.
 * - **migrator** — LOGIN via RDS IAM, a member of the owner. What the schema runner connects as.
 * - **app** — LOGIN via RDS IAM, data access only. What the running service connects as.
 * - **seeder** — food only (curated catalog plan U18, KTD-18). LOGIN via RDS IAM, CONNECT and TEMP on its database,
 *   no DDL and no membership. What the catalog seed connects as.
 *
 * Why three and not two: the RDS master must be able to act for the owner (non-prod reaping), and it must NEVER
 * be on a chain to `rds_iam` (AWS: that forces IAM auth on the master too, locking it out). An owner that could
 * log in by IAM would hold `rds_iam`, so the master could not join it.
 *
 * DESIGN PATTERN: Registry — a module-level map keyed by a closed union; this module knows no stage and no AWS.
 */

/** A database on the shared instance. */
export type DatabaseService = 'identity' | 'food' | 'recipe';

/** The roles for one database. */
export interface DatabaseRoles {
    readonly owner: string;
    readonly migrator: string;
    readonly app: string;
    /** The catalog seeder, where the database is seeded (food only). */
    readonly seeder?: string;
}

/**
 * Every database's roles.
 *
 * ⚠️ Identity's service role is `identity_service`, NOT `identity_app`: `identity_app` is the RDS MASTER login, a
 * historical name that reads like identity's app role and is not ({@link RDS_MASTER_USERNAME}).
 */
export const DATABASE_ROLES = {
    identity: { owner: 'identity_owner', migrator: 'identity_migrator', app: 'identity_service' },
    food: { owner: 'food_owner', migrator: 'food_migrator', app: 'food_app', seeder: 'food_seeder' },
    recipe: { owner: 'recipe_owner', migrator: 'recipe_migrator', app: 'recipe_app' },
} as const satisfies Readonly<Record<DatabaseService, DatabaseRoles>>;

/**
 * Every role of a database, the seeder last. The one list a presence check or a role census iterates. Pure.
 *
 * @param roles - The database's roles.
 * @returns Owner, migrator, service role, then the seeder when there is one.
 */
export function databaseRoleNames(roles: DatabaseRoles): readonly string[] {
    return [roles.owner, ...loginRoles(roles)];
}

/** The part a LOGIN role plays: every role of a database but its owner. */
export type LoginRoleKey = Exclude<keyof DatabaseRoles, 'owner'>;

/**
 * Every LOGIN role of a database, keyed by the part it plays. The one place that lists the login keys: a caller that
 * holds a rule per part keys it by {@link LoginRoleKey}, so a new part is a compile error there. Pure.
 *
 * @param roles - The database's roles.
 * @returns Migrator, service role, then the seeder when there is one, in that order.
 */
export function loginRolesByKey(roles: DatabaseRoles): ReadonlyMap<LoginRoleKey, string> {
    const entries: [LoginRoleKey, string][] = [
        ['migrator', roles.migrator],
        ['app', roles.app],
    ];

    if (roles.seeder !== undefined) {
        entries.push(['seeder', roles.seeder]);
    }

    return new Map(entries);
}

/**
 * Every LOGIN role of a database — the list `rds_iam` and CONNECT are granted over, and the list the master must be
 * proven unable to reach before either. Never the owner. Pure.
 *
 * ⛔ Derived, never typed out: a login role added to the registry and missed by a hand-written list is a role
 * `rds_iam` reaches without the master-reach check before it (ADR-0039 §8).
 *
 * @param roles - The database's roles.
 * @returns Migrator, service role, then the seeder when there is one.
 */
export function loginRoles(roles: DatabaseRoles): readonly string[] {
    return [...loginRolesByKey(roles).values()];
}

/**
 * The RDS master username. Permanent — changing it replaces the instance (ADR-0002). Recorded here so the registry
 * can assert it never reuses the name.
 */
export const RDS_MASTER_USERNAME = 'identity_app';

/** The migration ledger every runner writes and every boot guard reads. */
export const MIGRATION_LEDGER_TABLE = 'schema_migrations';
