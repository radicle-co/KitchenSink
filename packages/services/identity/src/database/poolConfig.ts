/**
 * `pg` pool configuration for the identity database: the identity service's own RDS-IAM login.
 *
 * ⛔ The service used to connect with the RDS MASTER's password — `identity_app`, `rds_superuser`, injected by ECS
 * from the master secret — behind a public ALB, and so owned every table it wrote. The role split
 * (`docs/plans/2026-09-11-database-role-split.md`) gives it `identity_service`: an RDS-IAM login with data
 * privileges only. The wiring lives once, in `@kitchensink/rds-iam-auth`; this module names identity's role.
 */
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { rdsPoolConfigFromEnv, type RdsEnv } from '@kitchensink/rds-iam-auth';
import type pg from 'pg';

/**
 * Build the identity service's pool config from its environment.
 *
 * @param env - Defaults to `process.env`. `DATABASE_URL` wins (local development); otherwise `DB_HOST`, `DB_PORT`
 *   and `DB_NAME`, logging in as `identity_service` unless `DB_USERNAME` overrides it.
 * @returns The pool config.
 * @throws {Error} naming whichever required variable is missing or malformed.
 */
export function identityPoolConfig(env: RdsEnv = process.env): pg.PoolConfig {
    return rdsPoolConfigFromEnv({ username: DATABASE_ROLES.identity.app }, env);
}
