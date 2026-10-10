/**
 * The food role model and the shared base database in a real PostgreSQL, as a stage's platform bootstrap leaves them
 * (curated catalog plan U7).
 *
 * A per-PR food database is created empty from `template0` by the migrator and seeded by the seed step, so a suite
 * that exercises that path needs the roles, the migrator's maintenance connection and the master to clean up, but no
 * catalog in the base. The base is created because the bootstrap creates it on every stage, never migrated or seeded
 * here.
 *
 * ⚠️ `kitchensink_food` is the ONE name in this package's tests that keeps the `kitchensink_` prefix the
 * per-PR reaper's census counts: it is a PRODUCTION constant, and `FOOD_DATABASE_NAME_PATTERN` refuses anything else.
 */
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import {
    assertDatabaseOwnedBy,
    provisionRdsLikeDatabase,
    type RdsLikeDatabase,
} from '@kitchensink/service-test-harness';

import { BASE_FOOD_DATABASE_NAME } from '../../src/lambdas/migrate/handler.js';

/**
 * Create the food role model and the base `kitchensink_food` database if absent. Idempotent.
 *
 * @returns The base's connection strings, for each principal.
 * @throws {MisownedDatabaseError} when a pre-role-split base is in the way.
 * @sideEffect Connects to PostgreSQL and may execute `CREATE ROLE` and `CREATE DATABASE`.
 */
export async function ensureFoodRoleModel(): Promise<RdsLikeDatabase> {
    // The production role model, applied by a NOSUPERUSER stand-in for the RDS master.
    const provisioned = await provisionRdsLikeDatabase({
        roles: DATABASE_ROLES.food,
        database: BASE_FOOD_DATABASE_NAME,
    });
    // ⛔ REPORTED, never repaired — the harness owns that rule, and the reason, once.
    await assertDatabaseOwnedBy(provisioned.masterUrl, BASE_FOOD_DATABASE_NAME, DATABASE_ROLES.food.owner);

    return provisioned;
}
