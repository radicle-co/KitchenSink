// @vitest-environment node
/**
 * Repo-wide guard: **a service integration suite connects its subject as the SERVICE role, never as a
 * superuser.**
 *
 * ## Why
 *
 * Until the role split (ADR-0039) every service integration tier connected as `postgres`. A superuser
 * satisfies every grant, so the tier that was supposed to prove the deployed privilege model was
 * structurally incapable of failing on it: a missing grant, an object owned by the wrong role, or a runner
 * that forgot `SET ROLE` passed, and failed only in a stage. 144 suites moved onto
 * `@kitchensink/service-test-harness`'s role fixture, whose subject holds DML and nothing else.
 *
 * Nothing stops that drifting back except a rule, because the way back is one line — read `DATABASE_URL`,
 * open a pool — and it looks exactly like every other suite that used to.
 *
 * ## What is asserted
 *
 * 1. The scan finds files at all (a scope that silently resolved to nothing would pass everything else).
 * 2. No file in an integration tier names the connection variables. The fixture reads `DATABASE_ADMIN_URL`;
 *    `DATABASE_URL` is written for a booted app by `applySubjectEnv()` and by the harness's own
 *    `bootServiceApp` (`forcedEnv`), never by a suite.
 * 3. No file in an integration tier carries a superuser credential literal.
 * 4. The MASTER-bearing surface has an exact consumer set: the handful of suites whose subject really is a
 *    database-level operation (creating one, dropping one, terminating a backend) and the fixture itself.
 *
 * ⚠️ What this CANNOT see is a URL a suite assembles at run time from parts. The fixture's post-condition
 * (`provisionRoleDatabase` asks the server for `current_user`, `rolsuper` and `rolbypassrls`) covers the
 * handle it hands out — not a connection string some other code built — so assertion 2 is the real control
 * and is deliberately spelled to catch all three ways of naming the variables.
 */
import { describe, expect, it } from 'vitest';

import { integrationTierSources, readSource, withoutTsComments } from './roleSplitSources.js';

/**
 * The connection variables a suite must not name — bracket form, dot form, or DESTRUCTURED out of
 * `process.env`, which is the idiomatic third spelling and walks past a naive check.
 */
const CONNECTION_VARIABLES =
    /process\.env(?:\[['"](?:DATABASE_URL|TEST_DATABASE_URL|DATABASE_ADMIN_URL)['"]\]|\.(?:DATABASE_URL|TEST_DATABASE_URL|DATABASE_ADMIN_URL)\b)|\{[^}]*\b(?:DATABASE_URL|TEST_DATABASE_URL|DATABASE_ADMIN_URL)\b[^}]*\}\s*=\s*process\.env/u;

/** A superuser credential in a connection string. */
const SUPERUSER_LITERAL = /postgres:[^@\s'"`]*@|:\/\/postgres@/u;

/**
 * The files that may reach the stand-in RDS master, each because its SUBJECT is a database-level operation
 * the service role and the migrator cannot perform: `CREATE DATABASE`, a FORCE drop, or terminating another
 * role's backend (which needs `pg_signal_backend`).
 */
const MASTER_CONSUMERS: readonly string[] = [
    // The base food database is CLONED as a template by the per-PR path, so this fixture owns its lifecycle.
    'packages/services/food-service/tests/support/maintenanceDb.ts',
    // The sibling database standing in for the recipe service's: CREATE DATABASE is the operation, and neither
    // food_app (no CREATEDB) nor food's migrator may perform it for another service's role model.
    'packages/services/food-service/tests/support/recipeProbeDb.ts',
    // Food's runner suites: they create and force-drop the database the runner migrates.
    'packages/services/food-service/tests/migrate.integration.test.ts',
    'packages/services/food-service/tests/migrateTemplateClone.integration.test.ts',
    // Identity's runner suite: same shape.
    'packages/services/identity/tests/migrate.integration.test.ts',
    // Recipe's runner suite, and the pool whose database is dropped underneath it — the FORCE drop IS its subject.
    'packages/services/recipe-service/__tests__/integration/database/migrationRunner.integration.test.ts',
    'packages/services/recipe-service/__tests__/integration/database/droppableDatabasePool.integration.test.ts',
];

/**
 * The master-bearing surface: every name that can hand out a master connection.
 *
 * ⚠️ `urlFor` and `TEST_MASTER_ROLE` are in the list because `RdsLikeDatabase.urlFor(TEST_MASTER_ROLE, …)`
 * builds one without naming `masterUrl` at all — a suite holding an allowlisted handle could otherwise reach
 * the master through a name this guard never read.
 */
const MASTER_SURFACE = /provisionRdsLikeDatabase|masterUrl|migratorMaintenanceUrl|TEST_MASTER_ROLE|\burlFor\b/u;

describe('service integration tiers', () => {
    it('are discovered — an empty scan would pass everything below', () => {
        const sources = integrationTierSources();

        expect(sources.length).toBeGreaterThan(100);
        expect(sources.filter((path) => path.endsWith('vitest.integration.config.ts')).length).toBeGreaterThanOrEqual(
            5,
        );
    });

    it('⛔ never read DATABASE_URL / TEST_DATABASE_URL / DATABASE_ADMIN_URL themselves', () => {
        const offenders = integrationTierSources().filter((path) =>
            CONNECTION_VARIABLES.test(withoutTsComments(readSource(path))),
        );

        expect(offenders).toEqual([]);
    });

    it('⛔ carry no superuser credential literal', () => {
        const offenders = integrationTierSources().filter((path) =>
            SUPERUSER_LITERAL.test(withoutTsComments(readSource(path))),
        );

        expect(offenders).toEqual([]);
    });

    it('reach the stand-in master from exactly the files whose subject is a database-level operation', () => {
        const consumers = integrationTierSources().filter((path) =>
            MASTER_SURFACE.test(withoutTsComments(readSource(path))),
        );

        expect(consumers).toEqual([...MASTER_CONSUMERS].sort());
    });
});
