/**
 * The integration tier's database, provisioned the way a stage provisions one (ADR-0039).
 *
 * ## ⛔ Why the suites do not connect as `postgres`
 *
 * A pool on `DATABASE_URL` — a SUPERUSER — satisfies every grant, and a hand-rolled replay of the `.sql`
 * files is not the runner that migrates a real stage: it skips the advisory lock, the privilege statements,
 * the ownership audit and `expectManifestSha` (ADR-0035). Either lets a privilege the deployed food service
 * does NOT hold — DDL, `TRUNCATE`, `setval`, a ledger write — pass the tier and fail only in a stage.
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
import { roleDatabase, type RoleDatabase, type RoleDatabaseSpec } from '@kitchensink/service-test-harness';

import { runMigrations } from '../../src/lambdas/migrate/handler.js';

/**
 * The LOCAL e2e tier's throwaway database. Only that tier opens a database: the integration tier mocks it
 * (`docs/CODING_STANDARDS.md` §7.1a). Never `kitchensink_…`, which is what the per-PR reaper's census counts.
 */
export const FOOD_E2E_DATABASE = 'food_e2e_test';

/** food-service owns these files, and its own runner applies them. */
export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/**
 * How a test database is built. One declaration, used by the e2e tier's `globalSetup.ts` to provision and by
 * {@link foodDb} to connect.
 *
 * @param database - Which throwaway database: the e2e tier's by default.
 * @returns The spec.
 */
export function foodDbSpec(database: string = FOOD_E2E_DATABASE): RoleDatabaseSpec {
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
 * is set, and an import error names no suite. The tier's `globalSetup.ts` refuses a run with no server first.
 *
 * @returns The role-database handle: `appUrl` for the subject, `asOwner` for fixture work that needs the owner.
 * @throws {NonDisposableAdminServerError} when no admin server is configured.
 * @sideEffect Reads `DATABASE_ADMIN_URL`.
 */
export function foodDb(): RoleDatabase {
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
