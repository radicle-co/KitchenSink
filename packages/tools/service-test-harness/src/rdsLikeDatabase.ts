/**
 * Provision a database on a plain PostgreSQL the way the role split provisions one on RDS, so integration tests
 * migrate and connect as the roles production uses — never as a superuser.
 *
 * ## Why
 *
 * Every integration tier used to run as `postgres`, a SUPERUSER, which can do anything — so a missing grant, an
 * object owned by the wrong role, or a runner that forgot `SET ROLE` passed every test and failed only in a real
 * stage (`docs/plans/2026-09-11-database-role-split.md`). This harness reproduces the RDS shape Step 0 measured:
 *
 * - a stand-in `rds_iam` role;
 * - a NOSUPERUSER master (CREATEROLE, CREATEDB, `pg_signal_backend`) holding ADMIN — and nothing else — on
 *   `rds_iam`, which is what RDS gives its master implicitly through `rds_superuser`;
 * - the database's roles created by the REAL `applyRoleModel`, run AS that master, and the database created
 *   `OWNER <svc>_owner`.
 *
 * Passwords stand in for RDS IAM tokens: that changes how a login authenticates and nothing about what it may do.
 *
 * DESIGN PATTERN: Test fixture (Object Mother) over the production applier — it composes `applyRoleModel`, never
 * restates it.
 */
import pg from 'pg';

import { applyRoleModel, type DatabaseRoles } from '@kitchensink/db-schema-guard';

import { adminServerUrl } from './adminServer.js';

/** The stand-in master's login. Deliberately not the RDS name, so a test can never be mistaken for a stage. */
export const TEST_MASTER_ROLE = 'kitchensink_test_master';

/** Serialises provisioning across test files that run in parallel against one server. */
const PROVISION_LOCK_KEY = 7_412_200_228_220_023;

/** The password each stand-in login is given. */
const passwordFor = (role: string): string => `${role}-test-password`;

/**
 * A connection string for `role` on `database`, on the given server.
 *
 * Passwords stand in for RDS IAM tokens: that changes how a login authenticates and nothing about what it may do.
 *
 * @param server - The admin server's URL, whose host, port and scheme are kept.
 * @param role - The login role.
 * @param database - The database to connect to.
 * @returns The connection string. Pure.
 */
export function rdsLikeUrlFor(server: string, role: string, database: string): string {
    const url = new URL(server);

    url.username = role;
    url.password = passwordFor(role);
    url.pathname = `/${database}`;

    return url.toString();
}

/** Options for {@link provisionRdsLikeDatabase}. */
export interface ProvisionRdsLikeOptions {
    /** The database's roles — normally `DATABASE_ROLES.<service>`. */
    readonly roles: DatabaseRoles;
    /** The database to create, owned by `roles.owner`. */
    readonly database: string;
    /** Create the database when absent (default `true`). */
    readonly createDatabase?: boolean;
}

/** Connection strings for each principal. */
export interface RdsLikeDatabase {
    readonly database: string;
    readonly roles: DatabaseRoles;
    /** The stand-in master, on the maintenance database — what a bootstrap or the reaper connects as. */
    readonly masterUrl: string;
    /** The migrator, on the maintenance database — where a runner creates per-PR databases. */
    readonly migratorMaintenanceUrl: string;
    /** The migrator, on the database. */
    readonly migratorUrl: string;
    /** The service role, on the database. */
    readonly appUrl: string;
    /** Any principal on any database of this server. */
    readonly urlFor: (role: string, database: string) => string;
}

/**
 * Provision the roles and the database. Idempotent; safe to call from every test file.
 *
 * @param options - The roles and the database; the server comes from `DATABASE_ADMIN_URL`.
 * @returns Connection strings for the master, the migrator and the service role.
 * @sideEffect Creates roles and a database on the target server.
 */
export async function provisionRdsLikeDatabase(options: ProvisionRdsLikeOptions): Promise<RdsLikeDatabase> {
    const { roles, database } = options;
    const superuserUrl = adminServerUrl();
    const urlFor = (role: string, target: string): string => rdsLikeUrlFor(superuserUrl, role, target);

    const superuser = new pg.Client({ connectionString: superuserUrl });

    await superuser.connect();

    try {
        await superuser.query('SELECT pg_advisory_lock($1)', [PROVISION_LOCK_KEY]);

        await superuser.query(
            "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rds_iam') THEN CREATE ROLE rds_iam NOLOGIN; END IF; END $$",
        );
        await superuser.query(
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${TEST_MASTER_ROLE}') THEN CREATE ROLE ${TEST_MASTER_ROLE} LOGIN; END IF; END $$`,
        );
        await superuser.query(
            `ALTER ROLE ${TEST_MASTER_ROLE} LOGIN NOSUPERUSER CREATEROLE CREATEDB PASSWORD '${passwordFor(TEST_MASTER_ROLE)}'`,
        );
        await superuser.query(`GRANT rds_iam TO ${TEST_MASTER_ROLE} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
        await superuser.query(`GRANT pg_signal_backend TO ${TEST_MASTER_ROLE}`);

        // A role created by an earlier, pre-harness run belongs to the superuser, and a NOSUPERUSER master may only
        // alter or grant a role it holds ADMIN on. RDS's master holds ADMIN on every such role implicitly
        // (measured, Step 0); an ADMIN-only edge reproduces that without conferring membership.
        for (const role of [roles.owner, roles.migrator, roles.app]) {
            await superuser.query(
                `DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN GRANT "${role}" TO ${TEST_MASTER_ROLE} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE; END IF; END $$`,
            );
        }

        const master = new pg.Client({ connectionString: urlFor(TEST_MASTER_ROLE, 'postgres') });

        await master.connect();

        try {
            // `inherit-or-set`: vanilla PostgreSQL records this stand-in's ADMIN (on rds_iam, and on every role it
            // creates) as `pg_auth_members` rows RDS confers without a row, so the production reading (`every-row`)
            // would refuse here for rows the real master does not have. See `edgeConfersMembership`.
            await applyRoleModel(master, {
                roles,
                context: { master: TEST_MASTER_ROLE, isProd: false, lockOutEdges: 'inherit-or-set' },
            });

            const exists = await master.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);

            if ((options.createDatabase ?? true) && exists.rowCount === 0) {
                await master.query(`CREATE DATABASE "${database}" OWNER "${roles.owner}"`);
            }
        } finally {
            await master.end();
        }

        for (const role of [roles.migrator, roles.app]) {
            await superuser.query(`ALTER ROLE "${role}" PASSWORD '${passwordFor(role)}'`);
        }
    } finally {
        await superuser.query('SELECT pg_advisory_unlock($1)', [PROVISION_LOCK_KEY]).catch(() => undefined);
        await superuser.end();
    }

    return {
        database,
        roles,
        masterUrl: urlFor(TEST_MASTER_ROLE, 'postgres'),
        migratorMaintenanceUrl: urlFor(roles.migrator, 'postgres'),
        migratorUrl: urlFor(roles.migrator, database),
        appUrl: urlFor(roles.app, database),
        urlFor,
    };
}
