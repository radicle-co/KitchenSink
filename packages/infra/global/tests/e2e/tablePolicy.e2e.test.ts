// @vitest-environment node
/**
 * LOCAL e2e: the migration runner's table policy against a real PostgreSQL (curated catalog plan U4a, KTD-13,
 * blueprint §5).
 *
 * `ALTER DEFAULT PRIVILEGES` gives the service role DML on every table a migration creates, and the after-apply
 * blanket grant gives it DML on every table that exists. On a service-read-only table, the seed ledger, that DML must
 * never be seen and never be left behind: KTD-12's trigger reads a holder of INSERT on the ledger as the seeder. The
 * runner therefore applies the policy inside each migration's own transaction and runs the after-apply block as one
 * transaction. These cases prove both against PostgreSQL, where a unit test of the statement order cannot.
 *
 * The roles stand in for food's: `ktp_owner` (NOLOGIN), `ktp_migrator` (a member of the owner), `ktp_app` and
 * `ktp_seeder`. A password replaces RDS IAM, which changes how a login authenticates and nothing about what it may do.
 * The superuser (`DATABASE_ADMIN_URL`) only builds fixtures and reads results. Names are prefixed `ktp_` so this suite
 * never collides with another on the same server.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    applyMigrations,
    readMigrationManifest,
    type DatabaseRoles,
    type MigrationClient,
    type MigrationPool,
    type TablePolicy,
} from '@kitchensink/db-schema-guard';

import { throwawayServerUrl } from '../common/throwawayServer.js';

const ADMIN_URL = process.env['DATABASE_ADMIN_URL'];
/** The throwaway server — loopback only; a refused URL fails the run here (see `throwawayServer.ts`). */
const SERVER_URL = throwawayServerUrl(ADMIN_URL);
const PASSWORD = 'ktp-pw';

const ROLES = {
    owner: 'ktp_owner',
    migrator: 'ktp_migrator',
    app: 'ktp_app',
    seeder: 'ktp_seeder',
} as const satisfies DatabaseRoles;

/** Each case migrates its own database, so no case depends on another's leftovers. */
const DATABASES = ['ktp_window', 'ktp_atomic', 'ktp_rights'] as const;

const TABLE_PRIVILEGES = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
    'MAINTAIN',
] as const;

/** A catalog table, the read-only ledger (an identity column, as the seed ledger has), a dictionary, and a stray. */
const TABLES_SQL = `CREATE TABLE item (id text PRIMARY KEY);
CREATE TABLE ledger (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, seed_sha text NOT NULL);
CREATE TABLE dict (id text PRIMARY KEY);
CREATE TABLE other (id int);
`;

/** What {@link failingPool} sends instead: an error PostgreSQL raises inside the transaction. */
const FAILS_ON_THE_SERVER = 'SELECT 1 / 0';

const POLICY: TablePolicy = {
    catalog: new Set(['item']),
    serviceReadOnly: new Set(['ledger']),
    dictionaries: new Set(['dict']),
};

/** A connection string for `role` on `database`, on the `DATABASE_ADMIN_URL` server. */
function urlFor(role: string, database: string): string {
    const url = new URL(SERVER_URL ?? 'postgres://localhost/postgres');

    url.username = role;
    url.password = PASSWORD;
    url.pathname = `/${database}`;

    return url.toString();
}

/** The superuser's URL for `database`. */
function adminUrlFor(database: string): string {
    const url = new URL(SERVER_URL ?? 'postgres://localhost/postgres');

    url.pathname = `/${database}`;

    return url.toString();
}

/** A scratch migrations directory holding `files`; removed by `afterAll`. */
const scratch: string[] = [];

function migrationsDir(files: Readonly<Record<string, string>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'ktpMigrations'));

    scratch.push(dir);

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, name), body);
    }

    return dir;
}

/**
 * A pool whose clients send a statement that fails ON THE SERVER in place of `refused`, and pass every other statement
 * to `inner`. Failing on the server matters: it aborts the open transaction exactly as a real failure would, where an
 * error thrown on the client would leave the transaction open and hide a missing ROLLBACK.
 */
function failingPool(inner: pg.Pool, refused: string): MigrationPool {
    return {
        connect: async (): Promise<MigrationClient> => {
            const client = await inner.connect();

            return {
                query: async <Row>(sql: string, values?: unknown[]) => {
                    const result = await client.query(sql === refused ? FAILS_ON_THE_SERVER : sql, values);

                    return { rows: result.rows as Row[], rowCount: result.rowCount };
                },
                release: () => client.release(),
            };
        },
    };
}

describe.skipIf(!SERVER_URL)('the table policy, applied by the migration runner, against real PostgreSQL', () => {
    const admin = new pg.Pool({ connectionString: SERVER_URL, max: 2 });

    /** The privileges `role` holds on `table` in `database`, however reached, in {@link TABLE_PRIVILEGES} order. */
    async function held(database: string, role: string, table: string): Promise<readonly string[]> {
        const client = new pg.Client({ connectionString: adminUrlFor(database) });

        await client.connect();

        try {
            const result = await client.query<{ privilege: string }>(
                `SELECT p AS privilege FROM unnest($3::text[]) WITH ORDINALITY AS t(p, n)
                  WHERE has_table_privilege($1, format('public.%I', $2::text), p) ORDER BY n`,
                [role, table, TABLE_PRIVILEGES],
            );

            return result.rows.map((row) => row.privilege);
        } finally {
            await client.end();
        }
    }

    /** Run `sql` in `database` as the superuser. */
    async function asAdmin(database: string, sql: string): Promise<void> {
        const client = new pg.Client({ connectionString: adminUrlFor(database) });

        await client.connect();

        try {
            await client.query(sql);
        } finally {
            await client.end();
        }
    }

    /** Migrate `database` from `dir` as the migrator, under `policy`, through `pool`. */
    async function migrateThrough(
        pool: MigrationPool,
        database: string,
        dir: string,
        policy: TablePolicy,
    ): Promise<unknown> {
        return applyMigrations({
            pool,
            migrationsDir: dir,
            label: 'ktp',
            expectedTables: ['item', 'ledger', 'dict'],
            expectManifestSha: readMigrationManifest(dir).sha,
            database,
            roles: ROLES,
            tablePolicy: policy,
        });
    }

    /** A pool of one session as the migrator on `database`. */
    const migratorPool = (database: string): pg.Pool =>
        new pg.Pool({ connectionString: urlFor(ROLES.migrator, database), max: 1 });

    /** Migrate `database` from `dir` as the migrator, under `policy`, on a pool of its own. */
    async function migrate(database: string, dir: string, policy: TablePolicy): Promise<unknown> {
        const pool = migratorPool(database);

        try {
            return await migrateThrough(pool, database, dir, policy);
        } finally {
            await pool.end();
        }
    }

    async function cleanUp(): Promise<void> {
        for (const database of DATABASES) {
            await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        }

        for (const role of Object.values(ROLES)) {
            await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        }
    }

    beforeAll(async () => {
        await cleanUp();
        await admin.query(`CREATE ROLE ${ROLES.owner} NOLOGIN`);
        await admin.query(`CREATE ROLE ${ROLES.migrator} LOGIN PASSWORD '${PASSWORD}'`);
        await admin.query(`CREATE ROLE ${ROLES.app} LOGIN PASSWORD '${PASSWORD}'`);
        await admin.query(`CREATE ROLE ${ROLES.seeder} LOGIN PASSWORD '${PASSWORD}'`);
        await admin.query(`GRANT ${ROLES.owner} TO ${ROLES.migrator} WITH INHERIT TRUE, SET TRUE`);

        for (const database of DATABASES) {
            await admin.query(`CREATE DATABASE ${database} OWNER ${ROLES.owner}`);
        }
    });

    afterAll(async () => {
        await cleanUp();
        await admin.end();

        for (const dir of scratch) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    describe('a later migration that fails', () => {
        const dir = migrationsDir({
            '0001_tables.sql': TABLES_SQL,
            '0002_broken.sql': '-- Fails on purpose: division by zero.\nSELECT 1 / 0;\n',
        });

        beforeAll(async () => {
            await expect(migrate('ktp_window', dir, POLICY)).rejects.toThrow(/Migration 0002_broken failed/u);
        });

        it('⛔ leaves the service role no write on the service-read-only table the earlier migration created', async () => {
            expect(await held('ktp_window', ROLES.app, 'ledger')).toStrictEqual(['SELECT']);
        });

        it('⛔ leaves the service role no write on the migration ledger, on a database it migrated for the first time', async () => {
            expect(await held('ktp_window', ROLES.app, 'schema_migrations')).toStrictEqual(['SELECT']);
        });

        it('leaves the dictionary and the seeder’s tables as the policy says', async () => {
            expect(await held('ktp_window', ROLES.app, 'dict')).toStrictEqual(['SELECT', 'INSERT']);
            expect(await held('ktp_window', ROLES.seeder, 'item')).toStrictEqual([
                'SELECT',
                'INSERT',
                'UPDATE',
                'DELETE',
            ]);
            expect(await held('ktp_window', ROLES.seeder, 'ledger')).toStrictEqual(['SELECT', 'INSERT']);
        });
    });

    describe('a failure inside the after-apply block', () => {
        const dir = migrationsDir({ '0001_tables.sql': TABLES_SQL });

        beforeAll(async () => {
            await migrate('ktp_atomic', dir, POLICY);
        });

        it('⛔ rolls the whole block back: the blanket grant does not survive on the read-only table', async () => {
            // The first statement after the blanket grant fails. Run statement by statement, the blanket INSERT on
            // `ledger` would already be committed with nothing left to take it back.
            const refused = `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${ROLES.app}"`;
            const pool = migratorPool('ktp_atomic');

            try {
                await expect(migrateThrough(failingPool(pool, refused), 'ktp_atomic', dir, POLICY)).rejects.toThrow(
                    /division by zero/u,
                );

                // Read while the pool still holds the session. Without a ROLLBACK the session would be stuck in an
                // aborted transaction, still acting as the owner and still holding the migration lock.
                const session = await pool.query<{ who: string }>('SELECT current_user AS who');
                const locks = await admin.query<{ held: number }>(
                    `SELECT count(*)::int AS held FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                      WHERE l.locktype = 'advisory' AND a.usename = $1`,
                    [ROLES.migrator],
                );

                expect(session.rows).toStrictEqual([{ who: ROLES.migrator }]);
                expect(locks.rows[0]?.held).toBe(0);
            } finally {
                await pool.end();
            }

            expect(await held('ktp_atomic', ROLES.app, 'ledger')).toStrictEqual(['SELECT']);
            expect(await held('ktp_atomic', ROLES.app, 'dict')).toStrictEqual(['SELECT', 'INSERT']);
        });

        it('lets the next run take the lock and pass', async () => {
            await expect(migrate('ktp_atomic', dir, POLICY)).resolves.toMatchObject({ applied: [] });
        });
    });

    describe('a clean run', () => {
        const first = migrationsDir({ '0001_tables.sql': TABLES_SQL });
        const later = migrationsDir({
            '0001_tables.sql': TABLES_SQL,
            '0002_more.sql': 'CREATE TABLE item_part (id text PRIMARY KEY);\n',
        });
        const laterPolicy: TablePolicy = { ...POLICY, catalog: new Set(['item', 'item_part']) };

        beforeAll(async () => {
            await migrate('ktp_rights', first, POLICY);
        });

        it('gives the service role exactly its rights on each set, and DML on an unregistered table', async () => {
            expect(await held('ktp_rights', ROLES.app, 'item')).toStrictEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
            expect(await held('ktp_rights', ROLES.app, 'ledger')).toStrictEqual(['SELECT']);
            expect(await held('ktp_rights', ROLES.app, 'dict')).toStrictEqual(['SELECT', 'INSERT']);
            expect(await held('ktp_rights', ROLES.app, 'other')).toStrictEqual([
                'SELECT',
                'INSERT',
                'UPDATE',
                'DELETE',
            ]);
            expect(await held('ktp_rights', ROLES.app, 'schema_migrations')).toStrictEqual(['SELECT']);
        });

        it('gives the seeder exactly its rights on each set, and nothing on the migration ledger or an unregistered table', async () => {
            expect(await held('ktp_rights', ROLES.seeder, 'item')).toStrictEqual([
                'SELECT',
                'INSERT',
                'UPDATE',
                'DELETE',
            ]);
            expect(await held('ktp_rights', ROLES.seeder, 'ledger')).toStrictEqual(['SELECT', 'INSERT']);
            expect(await held('ktp_rights', ROLES.seeder, 'dict')).toStrictEqual(['SELECT', 'INSERT']);
            expect(await held('ktp_rights', ROLES.seeder, 'other')).toStrictEqual([]);
            expect(await held('ktp_rights', ROLES.seeder, 'schema_migrations')).toStrictEqual([]);
        });

        it('lets the seeder add a ledger row through its identity column with no sequence right, and read it back', async () => {
            const seeder = new pg.Client({ connectionString: urlFor(ROLES.seeder, 'ktp_rights') });

            await seeder.connect();

            try {
                await seeder.query("INSERT INTO ledger (seed_sha) VALUES ('a')");

                const rows = await seeder.query<{ n: number }>('SELECT count(*)::int AS n FROM ledger');

                expect(rows.rows).toStrictEqual([{ n: 1 }]);
            } finally {
                await seeder.end();
            }
        });

        it('takes back a write a hand grant gave the service role on the read-only table', async () => {
            await asAdmin('ktp_rights', `GRANT INSERT ON ledger TO ${ROLES.app}`);

            await migrate('ktp_rights', first, POLICY);

            expect(await held('ktp_rights', ROLES.app, 'ledger')).toStrictEqual(['SELECT']);
        });

        it('⛔ fails the run when the seeder reaches an unregistered table through PUBLIC, naming it', async () => {
            await asAdmin('ktp_rights', 'GRANT SELECT ON other TO PUBLIC');

            try {
                await expect(migrate('ktp_rights', first, POLICY)).rejects.toThrow(
                    /seeder privileges:[\s\S]*ktp_seeder holds SELECT on table other/u,
                );
            } finally {
                await asAdmin('ktp_rights', 'REVOKE SELECT ON other FROM PUBLIC');
            }
        });

        it('⛔ fails the run when the seeder holds MAINTAIN through pg_maintain, naming it', async () => {
            // PostgreSQL 17 added MAINTAIN (VACUUM, ANALYZE, REINDEX, REFRESH, CLUSTER, LOCK) and the predefined
            // role that confers it on every table. An audit that compares only the seven older rights reads a
            // seeder holding it as exact.
            await asAdmin('ktp_rights', `GRANT pg_maintain TO ${ROLES.seeder}`);

            try {
                await expect(migrate('ktp_rights', first, POLICY)).rejects.toThrow(
                    /seeder privileges:[\s\S]*ktp_seeder holds MAINTAIN on table item/u,
                );
            } finally {
                await asAdmin('ktp_rights', `REVOKE pg_maintain FROM ${ROLES.seeder}`);
            }
        });

        it('gives the seeder DML on a catalog table a later migration adds', async () => {
            await expect(migrate('ktp_rights', later, laterPolicy)).resolves.toMatchObject({ applied: ['0002_more'] });

            expect(await held('ktp_rights', ROLES.seeder, 'item_part')).toStrictEqual([
                'SELECT',
                'INSERT',
                'UPDATE',
                'DELETE',
            ]);
        });

        it('gives the seeder explicit USAGE on public, and no CREATE', async () => {
            const client = new pg.Client({ connectionString: adminUrlFor('ktp_rights') });

            await client.connect();

            try {
                const acl = await client.query<{ grantee: string; privilege: string }>(
                    `SELECT a.grantee::regrole::text AS grantee, a.privilege_type AS privilege
                       FROM pg_namespace n, aclexplode(n.nspacl) a
                      WHERE n.nspname = 'public' AND a.grantee = $1::regrole`,
                    [ROLES.seeder],
                );

                expect(acl.rows).toStrictEqual([{ grantee: ROLES.seeder, privilege: 'USAGE' }]);
            } finally {
                await client.end();
            }
        });
    });
});
