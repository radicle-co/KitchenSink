/**
 * `pg` pool configuration for the food logical database, shared by the API, both workers, and the
 * migrate lambda so they authenticate identically.
 *
 * Deployed stages authenticate the `food_app` role passwordlessly with short-lived RDS IAM tokens
 * (ADR-0006 / feature 003): there is no database password anywhere. `pg` invokes the `password` function
 * on every new pooled connection, so the ~15-minute IAM token TTL is refreshed transparently as the pool
 * opens or recycles connections — no manual rotation. Local dev (`STAGE=local`) keeps static-password
 * auth against docker Postgres.
 *
 * TLS is always on — RDS IAM auth *requires* it — but the Amazon RDS CA is not verified
 * (`rejectUnauthorized: false`): the connection is encrypted, and the server is a known RDS endpoint
 * reached inside the VPC (see database.module.ts for the full rationale).
 *
 * The wiring itself lives once, in `@kitchensink/rds-iam-auth`; this module names food's role and database
 * requirements and nothing else.
 *
 * @implements FR-001
 */
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { rdsPoolConfig, rdsPoolConfigFromEnv } from '@kitchensink/rds-iam-auth';
import type pg from 'pg';

/** Connection coordinates for the food database (host/port/name/user come from the environment). */
export interface FoodDbConnection {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
}

/** The `food_app` least-privilege role — the only DB principal the food workloads use. */
export const FOOD_DB_USERNAME = DATABASE_ROLES.food.app;

/**
 * Build a `pg` pool config from explicit connection coordinates. Deployed stages get an IAM-token
 * `password` provider; `STAGE=local` gets the static `DB_PASSWORD`.
 */
export function foodPoolConfig(connection: FoodDbConnection): pg.PoolConfig {
    return rdsPoolConfig(connection);
}

/**
 * Build a `pg` pool config from the standard food environment. Prefers `DATABASE_URL` (local dev), else the
 * discrete `DB_*` parts — `DB_NAME` REQUIRED (food has no default database) — with IAM auth as `food_app` unless
 * `DB_USERNAME` overrides it.
 *
 * @throws {Error} when neither `DATABASE_URL` nor a complete, valid `DB_HOST`/`DB_PORT`/`DB_NAME` set is present.
 */
export function foodPoolConfigFromEnv(): pg.PoolConfig {
    return rdsPoolConfigFromEnv({ username: FOOD_DB_USERNAME });
}
