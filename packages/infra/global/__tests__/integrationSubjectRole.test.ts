// @vitest-environment node
/**
 * Repo-wide guard: **a service's real-database suite connects its subject as the SERVICE role, never as a
 * superuser.** Those suites are LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a); the scan also reads the integration
 * tiers, which open no database at all (`testTierDependencies.test.ts`).
 *
 * ## Why
 *
 * A superuser satisfies every grant, so an integration tier connected as `postgres` is structurally
 * incapable of failing on the deployed privilege model (ADR-0039): a missing grant, an object owned by the
 * wrong role, or a runner that forgot `SET ROLE` passes, and fails only in a stage. The suites run on
 * `@kitchensink/service-test-harness`'s role fixture, whose subject holds DML and nothing else.
 *
 * Nothing stops that drifting back except a rule, because the way back is one line — read `DATABASE_URL`,
 * open a pool — and it looks like any ordinary suite.
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
 * 5. The seeder's connection has an exact consumer set too: the suites whose subject is the food seed or the
 *    seeder's own rights.
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
    // The food role model and base database a stage's bootstrap leaves, provisioned through the stand-in master.
    'packages/services/food-service/tests/support/maintenanceDb.ts',
    // Food's runner suites: they create and force-drop the database the runner migrates.
    'packages/services/food-service/tests/e2e/migrate.e2e.test.ts',
    'packages/services/food-service/tests/e2e/perPrDatabaseCreation.e2e.test.ts',
    // Identity's runner suite: same shape.
    'packages/services/identity/tests/e2e/migrate.e2e.test.ts',
    // Recipe's runner suite, and the pool whose database is dropped underneath it — the FORCE drop IS its subject.
    'packages/services/recipe-service/tests/e2e/database/migrationRunner.e2e.test.ts',
    'packages/services/recipe-service/tests/e2e/database/droppableDatabasePool.e2e.test.ts',
];

/**
 * The files whose SUBJECT is the food seed or the seeder's own rights, and which therefore connect as `food_seeder`
 * (ADR-0051, curated catalog plan KTD-18). The seeder may write seed-owned catalog rows the service role may not, so a
 * suite connected as the seeder is no proof of anything the SERVICE does; a suite reaches it only to test the seed.
 */
const SEEDER_SUBJECTS: readonly string[] = [
    // The seeder's grants and the ownership trigger it is judged by.
    'packages/services/food-service/tests/e2e/seederRole.e2e.test.ts',
    'packages/services/food-service/tests/e2e/catalogSchema.e2e.test.ts',
    // The seed's read port, its apply, and its independent verifier, each run as the seed runs them.
    'packages/services/food-service/tests/e2e/catalogSnapshot.e2e.test.ts',
    'packages/services/food-service/tests/e2e/catalogSeedApply.e2e.test.ts',
    'packages/services/food-service/tests/e2e/copyLoader.e2e.test.ts',
    'packages/services/food-service/tests/e2e/catalogForwardEndParity.e2e.test.ts',
    'packages/services/food-service/tests/e2e/catalogVerifierCompare.e2e.test.ts',
    'packages/services/food-service/tests/e2e/catalogVerifierParity.e2e.test.ts',
    'packages/services/food-service/tests/e2e/catalogVerifierSeeded.e2e.test.ts',
    // The seed function's core, applied and described over a seeder connection.
    'packages/services/food-service/tests/e2e/seedFunction.e2e.test.ts',
    // A per-PR database created from template0, migrated, then seeded as the seeder.
    'packages/services/food-service/tests/e2e/perPrDatabaseCreation.e2e.test.ts',
    // The SC-007 perf fixture's seeded half, written as the seed's role so the ownership trigger judges it.
    'packages/services/food-service/tests/e2e/perfFixtureDistribution.e2e.test.ts',
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

    it('connect as the seeder from exactly the files whose subject is the seed or the seeder’s own rights', () => {
        // Both doors to a seeder connection: the role database's `seederUrl`, and `urlFor` named with the seeder role.
        const subjects = integrationTierSources().filter((path) =>
            /\bseederUrl\b|\burlFor\(\s*DATABASE_ROLES\.\w+\.seeder\b/u.test(withoutTsComments(readSource(path))),
        );

        expect(subjects).toEqual([...SEEDER_SUBJECTS].sort());
    });
});
