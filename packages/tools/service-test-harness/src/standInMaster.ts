/**
 * Stand in for the RDS master on a plain PostgreSQL, in the shape Step 0 measured
 * (`docs/plans/2026-09-11-database-role-split.md`): a NOSUPERUSER login with CREATEROLE, CREATEDB and
 * `pg_signal_backend`, holding ADMIN, and nothing else, on a stand-in `rds_iam` role. That ADMIN is what RDS gives
 * its master implicitly through `rds_superuser`.
 *
 * The harness's own database fixture and the platform bootstrap's suites build their master here, so the three
 * cannot drift apart on what "the master" may do.
 *
 * DESIGN PATTERN: Object Mother — one builder for the stand-in principal every role-split suite runs as.
 */
import pg from 'pg';

import type { CatalogReader } from '@kitchensink/db-schema-guard';

/**
 * Create or re-assert the stand-in master and the `rds_iam` role it holds ADMIN on. Idempotent.
 *
 * @param superuser - A superuser connection to the server.
 * @param master - The stand-in master's name.
 * @param password - Its password, standing in for the RDS master's.
 * @sideEffect Creates or alters roles and grants memberships on the server.
 */
export async function provisionStandInMaster(
    superuser: CatalogReader,
    master: string,
    password: string,
): Promise<void> {
    const name = pg.escapeIdentifier(master);

    await superuser.query(
        "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rds_iam') THEN CREATE ROLE rds_iam NOLOGIN; END IF; END $$",
    );
    await superuser.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${pg.escapeLiteral(master)}) THEN CREATE ROLE ${name} LOGIN; END IF; END $$`,
    );
    await superuser.query(
        `ALTER ROLE ${name} LOGIN NOSUPERUSER CREATEROLE CREATEDB PASSWORD ${pg.escapeLiteral(password)}`,
    );
    await superuser.query(`GRANT rds_iam TO ${name} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    await superuser.query(`GRANT pg_signal_backend TO ${name}`);
}
