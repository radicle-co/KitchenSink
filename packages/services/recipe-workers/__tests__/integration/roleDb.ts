/**
 * The integration tier's database for `@kitchensink/recipe-workers`, provisioned the way a stage provisions
 * one (ADR-0039).
 *
 * ## ⛔ Why the suites no longer connect as `postgres`
 *
 * Every suite here used to open its own pool on a URL read from `DATABASE_URL`/`TEST_DATABASE_URL` — a
 * SUPERUSER, which satisfies every grant. So a privilege the deployed workers do NOT hold passed the whole
 * tier and failed only in a stage. Under the role split these Lambdas hold `recipe_app`: DML and nothing
 * else — no DDL, no `TRUNCATE`, no temp tables, no write to `schema_migrations`. This module hands the
 * suites exactly that, so the tier can see what a stage sees.
 *
 * Fixture work that legitimately needs more — emptying tables, probing a constraint — goes through
 * {@link RoleDatabase.asOwner} or {@link RoleDatabase.truncate}, named at the call site rather than granted
 * silently.
 *
 * ## Where the old `disposableDatabaseUrl.ts` went
 *
 * That module's loopback Specification — "a URL being set is not permission to destroy what it points at" —
 * now lives in the harness, as `decideAdminServerUrl` in
 * `packages/tools/service-test-harness/src/adminServer.ts` (covered by that package's
 * `src/__tests__/adminServer.test.ts`). Its second half, "the database name must end in `_test`", moved with
 * the thing it protects and is a precondition on every database the fixture provisions
 * (`roleDatabase`'s `assertDisposable`, covered by `src/__tests__/roleDatabase.test.ts`). Neither rule is
 * re-implemented here.
 *
 * ⚠️ One assertion did NOT move, because its subject no longer exists: the old unit test also pinned
 * `TEST_DATABASE_URL` being read BEFORE `DATABASE_URL`. There is one variable now — `DATABASE_ADMIN_URL` —
 * so there is no precedence left to order, and that coverage is deleted rather than relocated.
 *
 * ## Where the schema comes from
 *
 * recipe-service OWNS these migrations; recipe-workers reads them by FILESYSTEM PATH rather than importing
 * across the workspace boundary — recipe-service devDepends on recipe-workers, so that import would be a
 * cycle, and a deployable exports only its `./infra`. `engineMigrator` applies them with the same engine the
 * production runner uses (`@kitchensink/db-schema-guard`'s `applyMigrations`: the advisory lock, the ledger,
 * the privilege statements, the ownership audit and `expectManifestSha`).
 *
 * DESIGN PATTERN: Object Mother — one declaration of "how this package's test database is built", consumed
 * by `globalSetup.ts` to provision and by every suite to connect.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import {
    engineMigrator,
    hasAdminServer,
    roleDatabase,
    type RoleDatabase,
    type RoleDatabaseSpec,
} from '@kitchensink/service-test-harness';

/** Whether an admin server is configured — suites guard with `describe.skipIf(!hasTestDatabase)`. */
export const hasTestDatabase = hasAdminServer;

/** This package's throwaway database. */
export const RECIPE_WORKERS_TEST_DATABASE = 'recipe_workers_test';

/** recipe-service owns these files; this package reads them by path, never by import. */
const migrationsDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'recipe-service',
    'src',
    'database',
    'migrations',
);

/**
 * The tables THESE workers read or write — a contract with recipe's schema, not a copy of it: asserting
 * recipe's whole shape is recipe-service's own runner suite's job. The engine refuses an empty list by name,
 * because it is the only thing between "every migration is recorded" and "the schema they were supposed to
 * produce exists".
 *
 * ⚠️ Every entry was checked to carry real SQL — `FROM`/`INTO`/`UPDATE`/`JOIN` — in this package's `src/` or
 * in a suite under this directory, so a name here is a dependency and not a transcription of recipe's
 * catalogue (which is roughly twice this long). Adding a table the workers do not touch would make this
 * FALSE prose rather than a failing test: the engine rejects an empty list and a missing table, never a
 * superfluous one.
 */
const EXPECTED_TABLES = [
    'account_erasure_jobs',
    'analytics_events',
    'author_handles',
    'collections',
    'ingredient_parse_cache',
    'ingredient_parse_corrections',
    'ingredient_resolution_mappings',
    'ingredient_resolution_memos',
    'ingredient_resolutions',
    'ingredients',
    'recipe_impact_signals',
    'recipe_ingredient_verification_redrive',
    'recipe_ingredient_verifications',
    'recipe_ingredients',
    'recipe_parse_job_lines',
    'recipe_parse_jobs',
    'recipe_photos',
    'recipe_ratings',
    'recipe_steps',
    'recipe_version_pending_archives',
    'recipe_versions',
    'recipes',
    'verification_spend',
] as const;

/**
 * How this package's test database is built: recipe's roles, recipe's migrations, the shared engine.
 *
 * @returns The spec, for `globalSetup.ts` to provision and {@link recipeWorkersDb} to connect through.
 */
export function recipeWorkersDbSpec(): RoleDatabaseSpec {
    return {
        roles: DATABASE_ROLES.recipe,
        database: RECIPE_WORKERS_TEST_DATABASE,
        migrationsDir,
        migrate: engineMigrator({
            label: 'recipe (for recipe-workers)',
            roles: DATABASE_ROLES.recipe,
            expectedTables: [...EXPECTED_TABLES],
        }),
    };
}

/**
 * The handle: `appUrl` — `recipe_app`, the role the deployed workers hold — for the subject, and `asOwner`
 * for fixture work that needs the owner. Pure; `globalSetup.ts` does the provisioning once per run.
 *
 * @returns The role-database handle.
 * @throws {NonDisposableAdminServerError} when no admin server is configured — guard with
 *   `describe.skipIf(!hasTestDatabase)`.
 * @sideEffect Reads `DATABASE_ADMIN_URL`.
 */
export function recipeWorkersDb(): RoleDatabase {
    return roleDatabase(recipeWorkersDbSpec());
}
