/**
 * `pg` pool configuration for the food logical database, shared by the API and both workers so they authenticate
 * identically.
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
import { rdsPoolConfigFromEnv } from '@kitchensink/rds-iam-auth';
import type pg from 'pg';

/** The `food_app` least-privilege role — the only DB principal the food workloads use. */
export const FOOD_DB_USERNAME = DATABASE_ROLES.food.app;

/**
 * How long a food pool waits to open a connection before failing, in milliseconds. Without it `pg` waits forever, and
 * source admission (`SourceCallLogDao.admit`) counts this wait inside the source client's deadline.
 */
export const FOOD_POOL_CONNECT_TIMEOUT_MS = 5_000;

/**
 * How long a food pool waits for any one query's answer before failing it, in milliseconds: `pg`'s client-side
 * `query_timeout`. A backstop, not a bound: queries that must end sooner set their own server-side timeouts (source
 * admission and the block write), and this net is for the case those cannot see, such as a server that stopped
 * answering. It sits well above every wait a bounded query allows (asserted in `sourceCallLog.dao.test.ts`), and far
 * above how long an API, worker or change-refresh query is expected to take.
 *
 * ⚠️ A query it fails keeps running on the server, and its connection stays busy until the server answers.
 */
export const FOOD_POOL_QUERY_TIMEOUT_MS = 30_000;

/**
 * Build a `pg` pool config from the standard food environment. Prefers `DATABASE_URL` (local dev), else the
 * discrete `DB_*` parts — `DB_NAME` REQUIRED (food has no default database) — with IAM auth as `food_app` unless
 * `DB_USERNAME` overrides it. Every pool built from it bounds its connect wait at {@link FOOD_POOL_CONNECT_TIMEOUT_MS}
 * and each query's answer at {@link FOOD_POOL_QUERY_TIMEOUT_MS}.
 *
 * @throws {Error} when neither `DATABASE_URL` nor a complete, valid `DB_HOST`/`DB_PORT`/`DB_NAME` set is present.
 */
export function foodPoolConfigFromEnv(): pg.PoolConfig {
    return {
        ...rdsPoolConfigFromEnv({ username: FOOD_DB_USERNAME }),
        connectionTimeoutMillis: FOOD_POOL_CONNECT_TIMEOUT_MS,
        query_timeout: FOOD_POOL_QUERY_TIMEOUT_MS,
    };
}
