/**
 * The one registry of which PostgreSQL role OWNS, MIGRATES and SERVES each database on the shared RDS instance.
 *
 * Three roles per database (`docs/plans/2026-09-11-database-role-split.md`, owner ruling 2026-09-11):
 *
 * - **owner** — NOLOGIN, never holds `rds_iam`. Owns the database (and so `public`, via `pg_database_owner`) and
 *   every object in it. Nothing logs in as it; the migrator `SET ROLE`s to it for DDL.
 * - **migrator** — LOGIN via RDS IAM, a member of the owner. What the schema runner connects as.
 * - **app** — LOGIN via RDS IAM, data access only. What the running service connects as.
 *
 * Why three and not two: the RDS master must be able to act for the owner (non-prod reaping), and it must NEVER
 * be on a chain to `rds_iam` (AWS: that forces IAM auth on the master too, locking it out). An owner that could
 * log in by IAM would hold `rds_iam`, so the master could not join it.
 *
 * DESIGN PATTERN: Registry — a module-level map keyed by a closed union; this module knows no stage and no AWS.
 */

/** A database on the shared instance. */
export type DatabaseService = 'identity' | 'food' | 'recipe';

/** The three roles for one database. */
export interface DatabaseRoles {
    readonly owner: string;
    readonly migrator: string;
    readonly app: string;
}

/**
 * Every database's roles.
 *
 * ⚠️ Identity's service role is `identity_service`, NOT `identity_app`: `identity_app` is the RDS MASTER login, a
 * historical name that reads like identity's app role and is not ({@link RDS_MASTER_USERNAME}).
 */
export const DATABASE_ROLES: Readonly<Record<DatabaseService, DatabaseRoles>> = {
    identity: { owner: 'identity_owner', migrator: 'identity_migrator', app: 'identity_service' },
    food: { owner: 'food_owner', migrator: 'food_migrator', app: 'food_app' },
    recipe: { owner: 'recipe_owner', migrator: 'recipe_migrator', app: 'recipe_app' },
};

/**
 * The RDS master username. Permanent — changing it replaces the instance (ADR-0002). Recorded here so the registry
 * can assert it never reuses the name.
 */
export const RDS_MASTER_USERNAME = 'identity_app';

/** The migration ledger every runner writes and every boot guard reads. */
export const MIGRATION_LEDGER_TABLE = 'schema_migrations';
