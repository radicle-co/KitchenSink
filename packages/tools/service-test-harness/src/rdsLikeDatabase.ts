/**
 * Provision a database on a plain PostgreSQL the way the role split provisions one on RDS, so integration tests
 * migrate and connect as the roles production uses — never as a superuser.
 *
 * ## Why
 *
 * A tier running as `postgres`, a SUPERUSER, can do anything — so a missing grant, an object owned by the wrong
 * role, or a runner that forgot `SET ROLE` passes every test and fails only in a real stage
 * (`docs/plans/2026-09-11-database-role-split.md`). This harness reproduces the RDS shape Step 0 measured:
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

import {
    applyRoleModel,
    databaseRoleNames,
    loginRoles,
    withSessionAdvisoryLock,
    type DatabaseRoles,
} from '@kitchensink/db-schema-guard';

import { adminServerUrl } from './adminServer.js';
import { provisionStandInMaster } from './standInMaster.js';

/** The stand-in master's login. Deliberately not the RDS name, so a test can never be mistaken for a stage. */
export const TEST_MASTER_ROLE = 'kitchensink_test_master';

/**
 * How long one provisioning call waits for another to finish. Provisioning serialises on the reserved
 * `testDatabaseProvisioning` lock, because test files run in parallel against one server.
 *
 * Sized under 60 s, the smallest budget any caller provisions inside — the integration tiers' `hookTimeout`, and the
 * e2e `testTimeout` where a case provisions its own database — so a stuck holder fails here, naming the lock, with
 * room left in that budget for the work after it, rather than as an anonymous timeout.
 */
const PROVISION_LOCK_WAIT_MS = 45_000;

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
        await withSessionAdvisoryLock(
            superuser,
            { reserved: 'testDatabaseProvisioning', waitTimeoutMs: PROVISION_LOCK_WAIT_MS },
            () => provisionUnderLock(superuser, options, urlFor),
        );
    } finally {
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

/**
 * The stand-in master, the database's roles and the database, built while this session holds the provisioning lock.
 *
 * @param superuser - The `DATABASE_ADMIN_URL` session holding the lock.
 * @param options - The roles and the database.
 * @param urlFor - A connection string for any principal on any database of this server.
 * @sideEffect Creates roles and a database on the target server, and sets the stand-in logins' passwords.
 */
async function provisionUnderLock(
    superuser: pg.Client,
    options: ProvisionRdsLikeOptions,
    urlFor: (role: string, target: string) => string,
): Promise<void> {
    const { roles, database } = options;

    await provisionStandInMaster(superuser, TEST_MASTER_ROLE, passwordFor(TEST_MASTER_ROLE));

    // A role created by an earlier, pre-harness run belongs to the superuser, and a NOSUPERUSER master may only
    // alter or grant a role it holds ADMIN on. RDS's master holds ADMIN on every such role implicitly
    // (measured, Step 0); an ADMIN-only edge reproduces that without conferring membership.
    for (const role of databaseRoleNames(roles)) {
        await superuser.query(
            `DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = ${pg.escapeLiteral(role)}) THEN GRANT ${pg.escapeIdentifier(role)} TO ${TEST_MASTER_ROLE} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE; END IF; END $$`,
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
            await master.query(
                `CREATE DATABASE ${pg.escapeIdentifier(database)} OWNER ${pg.escapeIdentifier(roles.owner)}`,
            );
        }
    } finally {
        await master.end();
    }

    for (const role of loginRoles(roles)) {
        await superuser.query(
            `ALTER ROLE ${pg.escapeIdentifier(role)} PASSWORD ${pg.escapeLiteral(passwordFor(role))}`,
        );
    }
}
