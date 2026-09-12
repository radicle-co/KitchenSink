import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { accounts, profiles, users } from '@kitchensink/identity-db';
import { rdsPoolConfigFromEnv } from '@kitchensink/rds-iam-auth';

import { getConfig } from '../config/env.js';

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
type IdentityDb = ReturnType<
    typeof drizzle<{ users: typeof users; accounts: typeof accounts; profiles: typeof profiles }>
>;

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
let pool: Pool | null = null;

/** @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012 */
let dbInstance: IdentityDb | null = null;

/**
 * The warm-cached drizzle handle every handler shares, connected as `identity_service` by RDS IAM.
 *
 * ⛔ Not the RDS master. This used to read the master secret and log in as `identity_app`, a member of
 * `rds_superuser` (the role split, `docs/plans/2026-09-11-database-role-split.md`); now each new physical
 * connection gets a fresh IAM token from `@kitchensink/rds-iam-auth`, and `STAGE=local` / `DATABASE_URL` keep the
 * password forms for docker Postgres.
 *
 * @implements REQ-013 REQ-014 REQ-015 REQ-016 REQ-017 REQ-IF-008 REQ-IF-010 REQ-CN-003 FR-013 FR-014 FR-015 FR-016 FR-017 ARCH-010 ARCH-011 ARCH-012 MOD-010 MOD-011 MOD-012
 * @returns The memoized drizzle instance.
 * @throws {ConfigError} when the environment names no database location.
 * @sideEffect Creates the module-level pool on the first call.
 */
export const getDb = async () => {
    if (dbInstance) {
        return dbInstance;
    }

    // Validate first, so a missing location is the coded cold-start ConfigError rather than a bare Error.
    const { DB_POOL_MAX } = getConfig();

    pool = new Pool({
        ...rdsPoolConfigFromEnv({ username: DATABASE_ROLES.identity.app }),
        max: DB_POOL_MAX,
    });

    dbInstance = drizzle<{ users: typeof users; accounts: typeof accounts; profiles: typeof profiles }>(pool, {
        schema: {
            users,
            accounts,
            profiles,
        },
        casing: 'snake_case',
    });

    return dbInstance;
};
