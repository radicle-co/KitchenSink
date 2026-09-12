/**
 * @module roleDatabase — an integration database shaped like a stage's under the role split (ADR-0039), whose
 * SUBJECT only ever gets the service role.
 *
 * ## Why
 *
 * Every service integration tier connected as `postgres`, a SUPERUSER, which may do anything — so a missing
 * grant, an object owned by the wrong role, or a runner that forgot `SET ROLE` passed every suite and failed
 * only in a deployed stage. That is the defect the role split exists to make visible, and a superuser tier is
 * structurally incapable of seeing it.
 *
 * So the fixture provisions the production role model (`provisionRdsLikeDatabase`), migrates with the
 * service's OWN production runner as `<svc>_migrator`, and hands the suite ONE connection: `appUrl`, the
 * service role, holding DML and nothing else. Work that legitimately needs more — `ANALYZE`, fixture DDL,
 * `TRUNCATE` — goes through {@link RoleDatabase.asOwner}, which is named at the call site rather than granted
 * silently.
 *
 * ⚠️ `ANALYZE` and `VACUUM` as the service role WARN and SKIP rather than failing (measured on PostgreSQL 18),
 * so a suite that analyses through the app connection silently reads stale statistics. That is why elevation
 * is explicit here instead of "whatever the connection happens to allow".
 *
 * DESIGN PATTERN: Object Mother over the production runner — it composes `applyMigrations`, never restating
 * DDL. · Strategy — the runner is INJECTED ({@link MigrateAsMigrator}), which is what lets a `tools` package
 * migrate a service's schema without depending on the service. · Bracket (scoped elevation) — `asOwner`
 * acquires, `SET ROLE`s, and `RESET ROLE`s in `finally`.
 */
import pg from 'pg';

import {
    MIGRATION_LEDGER_TABLE,
    applyMigrations,
    readMigrationManifest,
    type DatabaseRoles,
} from '@kitchensink/db-schema-guard';

import { adminServerUrl } from './adminServer.js';
import { assertDatabaseOwnedBy } from './databaseOwner.js';
import { provisionRdsLikeDatabase, rdsLikeUrlFor } from './rdsLikeDatabase.js';

/** The suffix a disposable database's name must carry. CI's `recipe_workers_test` is the model. */
export const DISPOSABLE_DATABASE_NAME_SUFFIX = '_test';

/** The prefix the per-PR reaper's census counts — a test database must never wear it. */
const RESERVED_DATABASE_PREFIX = 'kitchensink_';

/** Raised when a database name is not one the fixture may create and empty. */
export class NonDisposableDatabaseError extends Error {
    public constructor(database: string, reason: string) {
        super(
            `refusing to provision '${database}' as an integration database: ${reason}. Name it ` +
                `'<service>${DISPOSABLE_DATABASE_NAME_SUFFIX}'.`,
        );
        this.name = 'NonDisposableDatabaseError';
        Object.setPrototypeOf(this, NonDisposableDatabaseError.prototype);
    }
}

/**
 * Type guard for {@link NonDisposableDatabaseError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the refusal.
 */
export function isNonDisposableDatabaseError(error: unknown): error is NonDisposableDatabaseError {
    return error instanceof NonDisposableDatabaseError;
}

/**
 * A service's production migration runner, as this fixture calls it. Structurally what
 * `runMigrations({ pool, migrationsDir, expectManifestSha, database })` already is in food, recipe and
 * identity — so a service binds its own and nothing here knows which schema it is applying.
 */
export type MigrateAsMigrator = (options: {
    readonly pool: pg.Pool;
    readonly migrationsDir: string;
    readonly expectManifestSha: string;
    readonly database: string;
}) => Promise<unknown>;

/** What a package's fixture module declares. */
export interface RoleDatabaseSpec {
    /** `DATABASE_ROLES.<service>` — never a literal. */
    readonly roles: DatabaseRoles;
    /** The database to provision. Must end in `_test`, and must not start `kitchensink_`. */
    readonly database: string;
    /** The ordered `.sql` migrations the runner applies. */
    readonly migrationsDir: string;
    /** The service's own production runner. */
    readonly migrate: MigrateAsMigrator;
}

/** The handle a suite works through. */
export interface RoleDatabase {
    readonly database: string;
    readonly roles: DatabaseRoles;
    /** The SUBJECT's only connection: the service role, DML and nothing else. */
    readonly appUrl: string;
    /** The migrator's connection — for suites whose subject IS the runner. */
    readonly migratorUrl: string;
    /** Rebuild: empty the schema as the owner, then re-apply every migration as the migrator. */
    reset(): Promise<void>;
    /** Empty every table's DATA as the owner, keeping the schema and the migration ledger. */
    truncate(): Promise<void>;
    /** Run `work` as the database's OWNER, on the migrator's session. The role is reset even on a throw. */
    asOwner<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T>;
    /** Point `DATABASE_URL` at {@link appUrl}, for a suite that boots the service's own app factory. */
    applySubjectEnv(): void;
}

/**
 * The single `TRUNCATE` that empties a schema's data.
 *
 * ⛔ The migration ledger is excluded: emptying it would make the next `reset()` re-apply every migration
 * over an existing schema, which fails on the first `CREATE TABLE`.
 *
 * @param tables - Every table in the schema.
 * @returns The statement, or `undefined` when there is nothing to empty. Pure.
 */
export function truncateStatement(tables: readonly string[]): string | undefined {
    const targets = tables.filter((table) => table !== MIGRATION_LEDGER_TABLE);

    if (targets.length === 0) {
        return undefined;
    }

    return `TRUNCATE TABLE ${targets.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`;
}

/** Refuse a database name this fixture must not create, empty or rebuild. */
function assertDisposable(database: string): void {
    if (database.startsWith(RESERVED_DATABASE_PREFIX)) {
        throw new NonDisposableDatabaseError(
            database,
            `'${RESERVED_DATABASE_PREFIX}' names a real stage's database, which the per-PR reaper's census counts`,
        );
    }

    if (!database.endsWith(DISPOSABLE_DATABASE_NAME_SUFFIX)) {
        throw new NonDisposableDatabaseError(
            database,
            `it does not end in '${DISPOSABLE_DATABASE_NAME_SUFFIX}', so nothing marks it as throwaway`,
        );
    }
}

/**
 * Build the handle. No I/O: a suite calls this in its own worker and gets the same URLs the provisioning
 * globalSetup made, without a connection string crossing the worker boundary.
 *
 * @param spec - The roles, the database, the migrations and the runner.
 * @returns The handle. Its URLs resolve the server when READ, not here.
 * @throws {NonDisposableDatabaseError} when the name is not disposable.
 * @sideEffect Reads `DATABASE_ADMIN_URL` when a URL is read or a connection is opened.
 */
export function roleDatabase(spec: RoleDatabaseSpec): RoleDatabase {
    assertDisposable(spec.database);

    const { roles, database } = spec;

    // ⛔ The server is resolved on USE, not on construction. A suite builds its handle at module scope and
    // gates with `describe.skipIf(!hasTestDatabase)`; if this threw here, a machine with no PostgreSQL would
    // get an import-time failure instead of the skip the gate promises — the tier would go red for being
    // absent, which is the opposite of what `hasAdminServer` exists to express.
    const urlFor = (role: string): string => rdsLikeUrlFor(adminServerUrl(), role, database);

    /** One migrator pool per call: these run in `beforeAll`/`beforeEach`, never on a hot path. */
    const withMigrator = async <T>(work: (pool: pg.Pool) => Promise<T>): Promise<T> => {
        const pool = new pg.Pool({ connectionString: urlFor(roles.migrator), max: 1 });

        try {
            return await work(pool);
        } finally {
            await pool.end();
        }
    };

    const asOwner = async <T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
        withMigrator(async (pool) => {
            const client = await pool.connect();

            try {
                await client.query(`SET ROLE "${roles.owner}"`);

                return await work(client);
            } finally {
                // Both in `finally`: a throw inside `work` must not leave the session acting as the owner, and
                // the client must go back to the pool either way.
                await client.query('RESET ROLE').catch(() => undefined);
                client.release();
            }
        });

    return {
        database,
        roles,
        get appUrl(): string {
            return urlFor(roles.app);
        },
        get migratorUrl(): string {
            return urlFor(roles.migrator);
        },
        asOwner,
        applySubjectEnv: (): void => {
            process.env['DATABASE_URL'] = urlFor(roles.app);
        },
        reset: async (): Promise<void> =>
            withMigrator(async (pool) => {
                const client = await pool.connect();

                try {
                    await client.query(`SET ROLE "${roles.owner}"`);
                    // The owner owns `public` here (the database is `OWNER <svc>_owner`), so only it may drop it.
                    await client.query('DROP SCHEMA public CASCADE');
                    await client.query('CREATE SCHEMA public');
                } finally {
                    await client.query('RESET ROLE').catch(() => undefined);
                    client.release();
                }

                await spec.migrate({
                    pool,
                    migrationsDir: spec.migrationsDir,
                    expectManifestSha: readMigrationManifest(spec.migrationsDir).sha,
                    database,
                });
            }),
        truncate: async (): Promise<void> =>
            asOwner(async (client) => {
                // Read the table list from the catalogue rather than a hand-written list, which would drift with
                // every migration. Partitions are emptied through their parent.
                const tables = await client.query<{ relname: string }>(
                    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`,
                );
                const statement = truncateStatement(tables.rows.map((row) => row.relname));

                if (statement !== undefined) {
                    await client.query(statement);
                }
            }),
    };
}

/**
 * Provision the database and migrate it, then PROVE the subject's connection is the service role.
 *
 * The post-condition is the runtime belt a static guard cannot supply: a URL assembled at runtime is exactly
 * what a source scan cannot see, so the fixture asks the server who it is.
 *
 * @param spec - The roles, the database, the migrations and the runner.
 * @returns The handle.
 * @throws {Error} when the subject's connection is a superuser, bypasses RLS, or is not the service role.
 * @sideEffect Creates roles and a database on the admin server, and executes DDL as the migrator.
 */
export async function provisionRoleDatabase(spec: RoleDatabaseSpec): Promise<RoleDatabase> {
    const handle = roleDatabase(spec);
    const provisioned = await provisionRdsLikeDatabase({ roles: spec.roles, database: spec.database });

    // ⛔ REPORTED, never repaired: `DROP DATABASE` has exactly two authorities in this repository (the per-PR
    // reaper and the role split's armed recreate, asserted by `dropDatabaseAuthority.test.ts`), both production
    // code, and a test fixture is neither.
    await assertDatabaseOwnedBy(provisioned.masterUrl, spec.database, spec.roles.owner);

    await handle.reset();

    const app = new pg.Pool({ connectionString: handle.appUrl, max: 1 });

    try {
        const who = await app.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
            'SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user',
        );
        const row = who.rows[0];

        if (row?.current_user !== spec.roles.app || row.rolsuper || row.rolbypassrls) {
            throw new Error(
                `the integration subject connects as ${JSON.stringify(row)}, not as the unprivileged ` +
                    `${spec.roles.app} — the tier would prove nothing about the deployed privilege model.`,
            );
        }
    } finally {
        await app.end();
    }

    return handle;
}

/**
 * A runner for a package that consumes ANOTHER service's schema — `recipe-workers` over recipe's, and
 * `identity-webhooks` over identity's. Both are forbidden from importing the owning service's runner
 * (`recipe-service` devDepends on `recipe-workers`, so that import is a cycle; a deployable exports only its
 * `./infra`), so they migrate through the same engine directly.
 *
 * ⛔ `expectedTables` is REQUIRED, because the engine refuses an empty list by name: it "is the only thing
 * between 'every migration is recorded' and 'the schema they were supposed to produce exists'". A consumer
 * states the tables IT reads — not the owning service's whole schema, which is that service's own suite to
 * assert — so this list is a contract with the schema, not a copy of it.
 *
 * @param options - The label failures are reported under, the database's roles, and the tables to require.
 * @returns A runner the fixture can call.
 */
export function engineMigrator(options: {
    readonly label: string;
    readonly roles: DatabaseRoles;
    readonly expectedTables: readonly string[];
}): MigrateAsMigrator {
    return async ({ pool, migrationsDir, expectManifestSha, database }) =>
        applyMigrations({
            pool,
            migrationsDir,
            label: options.label,
            expectedTables: options.expectedTables,
            expectManifestSha,
            database,
            roles: options.roles,
        });
}
