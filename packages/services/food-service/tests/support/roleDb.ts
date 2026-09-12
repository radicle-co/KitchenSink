/**
 * The integration tier's database, provisioned the way a stage provisions one (ADR-0039).
 *
 * ## ⛔ Why the suites no longer connect as `postgres`
 *
 * Every suite here used to open its pool on `DATABASE_URL` — a SUPERUSER — and rebuild the schema with a
 * hand-rolled replay of the `.sql` files (`resetSchema`). That replay was not the runner that migrates a
 * real stage: it skipped the advisory lock, the privilege statements, the ownership audit and
 * `expectManifestSha` (ADR-0035). A superuser also satisfies every grant, so a privilege the deployed food
 * service does NOT hold — DDL, `TRUNCATE`, `setval`, a ledger write — passed the tier and failed only in a
 * stage.
 *
 * This module is the one declaration: food's roles, food's migrations, food's own production runner.
 * `tests/globalSetup.ts` provisions once per run; each suite opens a pool on {@link foodDb}'s `appUrl` —
 * `food_app`, DML only — empties data between tests with `truncate()`, and names the elevation explicitly
 * with `asOwner()` when a fixture legitimately needs more.
 *
 * ⚠️ `ANALYZE` and `VACUUM` as `food_app` WARN AND SKIP rather than failing, so a suite that analyses
 * through the subject's connection silently reads stale statistics. Those go through `asOwner`.
 *
 * DESIGN PATTERN: Object Mother over the production runner — it composes `runMigrations`, never restates
 * the DDL.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import {
    hasAdminServer,
    roleDatabase,
    type RoleDatabase,
    type RoleDatabaseSpec,
} from '@kitchensink/service-test-harness';

import { runMigrations } from '../../src/lambdas/migrate/handler.js';

/** Whether an admin server is configured — suites guard with `describe.skipIf(!hasTestDatabase)`. */
export const hasTestDatabase = hasAdminServer;

/** This package's throwaway database. Never `kitchensink_…`, which is what the per-PR reaper's census counts. */
export const FOOD_TEST_DATABASE = 'food_test';

/**
 * The E2E tier's throwaway database — a DIFFERENT one.
 *
 * The two tiers are separate vitest runs that each empty the whole schema between tests, and nothing stops
 * a CI matrix from running them against one server at the same time. They were already separate before the
 * role split (`health.e2e.test.ts` documented `DATABASE_URL=…/food_e2e`), and keeping them separate costs a
 * second `CREATE DATABASE` and removes a class of cross-tier flake that would read as a product bug.
 */
export const FOOD_E2E_DATABASE = 'food_e2e_test';

/** food-service owns these files, and its own runner applies them. */
export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/**
 * How a test database is built. One declaration, used by each tier's `globalSetup.ts` to provision and by
 * {@link foodDb} / {@link foodE2eDb} to connect.
 *
 * @param database - Which throwaway database: the integration tier's by default.
 * @returns The spec.
 */
export function foodDbSpec(database: string = FOOD_TEST_DATABASE): RoleDatabaseSpec {
    return {
        roles: DATABASE_ROLES.food,
        database,
        migrationsDir,
        // The PRODUCTION runner: the lock, the privilege statements, the ownership audit and the manifest
        // expectation are the parts the hand-rolled replay skipped.
        migrate: async ({ pool, migrationsDir: dir, expectManifestSha, database }) => {
            await runMigrations({ pool, migrationsDir: dir, expectManifestSha, database });
        },
    };
}

/**
 * The handle, built once per worker.
 *
 * ⛔ Resolved LAZILY, never at module scope: `roleDatabase` reads `DATABASE_ADMIN_URL` and THROWS when none
 * is set, so a module-level call would turn "no PostgreSQL on this machine" into an import error that
 * `describe.skipIf(!hasTestDatabase)` never gets the chance to answer.
 *
 * @returns The role-database handle: `appUrl` for the subject, `asOwner` for fixture work that needs the owner.
 * @throws {NonDisposableAdminServerError} when no admin server is configured.
 * @sideEffect Reads `DATABASE_ADMIN_URL`.
 */
export function foodDb(): RoleDatabase {
    return handleFor(FOOD_TEST_DATABASE);
}

/**
 * The E2E tier's handle, on {@link FOOD_E2E_DATABASE}.
 *
 * @returns The role-database handle.
 * @throws {NonDisposableAdminServerError} when no admin server is configured.
 * @sideEffect Reads `DATABASE_ADMIN_URL`.
 */
export function foodE2eDb(): RoleDatabase {
    return handleFor(FOOD_E2E_DATABASE);
}

/** The memoised handles — one per database per vitest worker, built on first use. */
const cached = new Map<string, RoleDatabase>();

/**
 * The handle for `database`, built once.
 *
 * @param database - The throwaway database.
 * @returns The handle.
 * @sideEffect Reads `DATABASE_ADMIN_URL` on the first call for a database.
 */
function handleFor(database: string): RoleDatabase {
    const existing = cached.get(database);

    if (existing !== undefined) {
        return existing;
    }

    const handle = roleDatabase(foodDbSpec(database));

    cached.set(database, handle);

    return handle;
}
