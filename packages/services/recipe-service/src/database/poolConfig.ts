/**
 * `pg` pool configuration for the recipe logical database (`kitchensink_recipes`) on the shared RDS
 * instance. Mirrors the shipped food service (`packages/services/food-service/src/database/poolConfig.ts`):
 * deployed stages authenticate the passwordless `recipe_app` role with short-lived RDS IAM tokens — no
 * database password anywhere. `pg` invokes the `password` provider on every new pooled connection, so
 * the ~15-minute token TTL is refreshed transparently as the pool opens/recycles connections.
 *
 * `STAGE=local` keeps static-password auth against docker Postgres. TLS is always on in deployed stages
 * (RDS IAM auth requires it) but the Amazon RDS CA is not verified (`rejectUnauthorized: false`): the
 * connection is encrypted and the endpoint is a known RDS host reached inside the VPC.
 *
 * The role is provisioned by DataStack's `RecipeDbRoleModel` custom resource; this module defines the pool
 * contract the DatabaseModule provider depends on.
 */
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { rdsPoolConfig, rdsPoolConfigFromEnv } from '@kitchensink/rds-iam-auth';
import type pg from 'pg';

/** Connection coordinates for the recipe database (host/port/name/user come from the environment). */
export interface RecipeDbConnection {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
}

/** The recipe service's logical database on the shared RDS instance. */
export const RECIPE_DB_NAME = 'kitchensink_recipes';

/** The `recipe_app` least-privilege role — the only DB principal the recipe workloads use (RDS-IAM). */
export const RECIPE_DB_USERNAME = DATABASE_ROLES.recipe.app;

/**
 * Build a `pg` pool config from explicit connection coordinates. Deployed stages get an IAM-token
 * `password` provider; `STAGE=local` gets the static `DB_PASSWORD`. The wiring lives once, in
 * `@kitchensink/rds-iam-auth`.
 */
export function recipePoolConfig(connection: RecipeDbConnection): pg.PoolConfig {
    return rdsPoolConfig(connection);
}

/**
 * Build a `pg` pool config from the standard recipe service environment. Prefers `DATABASE_URL` (local
 * dev), else the discrete `DB_*` parts — `DB_NAME` defaulting to {@link RECIPE_DB_NAME} — with IAM auth as
 * `recipe_app` unless `DB_USERNAME` overrides it.
 *
 * @throws {Error} when neither `DATABASE_URL` nor a complete, valid `DB_HOST`/`DB_PORT` set is present.
 */
export function recipePoolConfigFromEnv(): pg.PoolConfig {
    return rdsPoolConfigFromEnv({ username: RECIPE_DB_USERNAME, database: RECIPE_DB_NAME });
}
