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
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'libpg-query';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    applyMigrations,
    auditLedgerWriters,
    auditSeederOwnerMembership,
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

/** A login outside the database's roles, and a NOLOGIN group it can become: the shapes a third ledger writer takes. */
const OTHER = 'ktp_other';
const GROUP = 'ktp_group';

/** Each case migrates its own database, so no case depends on another's leftovers. */
const DATABASES = [
    'ktp_window',
    'ktp_atomic',
    'ktp_rights',
    'ktp_premise',
    'ktp_pin',
    'ktp_stray',
    'ktp_defacl',
] as const;

/** Food's migrations, which define the catalog trigger's writer reading (`catalog_writer`). */
const FOOD_MIGRATIONS = fileURLToPath(new URL('../../../../services/food-service/src/db/migrations/', import.meta.url));

/**
 * The `CREATE FUNCTION catalog_writer` statement food's migrations leave in force: the last one, read with PostgreSQL's
 * own grammar. Offsets are UTF-8 bytes, so the text is cut from the encoded file, not the string.
 *
 * @returns The statement's text.
 * @throws {Error} when no migration defines it, so a renamed function fails the pin instead of passing it.
 * @sideEffect Reads food's migrations directory.
 */
async function foodCatalogWriter(): Promise<string> {
    let found: string | undefined;

    for (const file of readdirSync(FOOD_MIGRATIONS)
        .filter((name) => name.endsWith('.sql'))
        .sort()) {
        const bytes = readFileSync(join(FOOD_MIGRATIONS, file));

        for (const { stmt, stmt_location: start = 0, stmt_len: length = 0 } of (await parse(bytes.toString('utf8')))
            .stmts ?? []) {
            const names = stmt !== undefined && 'CreateFunctionStmt' in stmt ? stmt.CreateFunctionStmt.funcname : [];
            const last = names?.at(-1);

            if (last !== undefined && 'String' in last && last.String.sval === 'catalog_writer') {
                found = bytes.subarray(start, length === 0 ? undefined : start + length).toString('utf8');
            }
        }
    }

    if (found === undefined) {
        throw new Error(`no migration in ${FOOD_MIGRATIONS} defines catalog_writer`);
    }

    return found;
}

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
    const url = new URL(SERVER_URL);

    url.username = role;
    url.password = PASSWORD;
    url.pathname = `/${database}`;

    return url.toString();
}

/** The superuser's URL for `database`. */
function adminUrlFor(database: string): string {
    const url = new URL(SERVER_URL);

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

describe('the table policy, applied by the migration runner, against real PostgreSQL', () => {
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
        expectedTables: readonly string[] = ['item', 'ledger', 'dict'],
    ): Promise<unknown> {
        return applyMigrations({
            pool,
            migrationsDir: dir,
            label: 'ktp',
            expectedTables,
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
    async function migrate(
        database: string,
        dir: string,
        policy: TablePolicy,
        expectedTables?: readonly string[],
    ): Promise<unknown> {
        const pool = migratorPool(database);

        try {
            return await migrateThrough(pool, database, dir, policy, expectedTables);
        } finally {
            await pool.end();
        }
    }

    async function cleanUp(): Promise<void> {
        for (const database of DATABASES) {
            await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        }

        for (const role of [...Object.values(ROLES), OTHER, GROUP]) {
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
        await admin.query(`CREATE ROLE ${OTHER} LOGIN PASSWORD '${PASSWORD}'`);
        await admin.query(`CREATE ROLE ${GROUP} NOLOGIN`);

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

        it('takes back a table right and a sequence right the seeder was handed outside the policy', async () => {
            await asAdmin('ktp_rights', `GRANT SELECT, INSERT ON other TO ${ROLES.seeder}`);
            await asAdmin('ktp_rights', `GRANT USAGE, SELECT, UPDATE ON SEQUENCE ledger_id_seq TO ${ROLES.seeder}`);

            await migrate('ktp_rights', first, POLICY);

            expect(await held('ktp_rights', ROLES.seeder, 'other')).toStrictEqual([]);

            const client = new pg.Client({ connectionString: adminUrlFor('ktp_rights') });

            await client.connect();

            try {
                const sequence = await client.query<{ privilege: string }>(
                    `SELECT p AS privilege FROM unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p
                      WHERE has_sequence_privilege($1, 'public.ledger_id_seq', p)`,
                    [ROLES.seeder],
                );

                expect(sequence.rows).toStrictEqual([]);
            } finally {
                await client.end();
            }
        });

        it('takes back a PUBLIC grant on the read-only table', async () => {
            await asAdmin('ktp_rights', 'GRANT INSERT, UPDATE ON ledger TO PUBLIC');

            await migrate('ktp_rights', first, POLICY);

            const client = new pg.Client({ connectionString: adminUrlFor('ktp_rights') });

            await client.connect();

            try {
                const toPublic = await client.query<{ privilege: string }>(
                    `SELECT a.privilege_type AS privilege FROM pg_class c, aclexplode(c.relacl) a
                      WHERE c.relname = 'ledger' AND a.grantee = 0`,
                );

                expect(toPublic.rows).toStrictEqual([]);
            } finally {
                await client.end();
            }

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

    /**
     * Each migration commits in the after-apply state for the tables that exist by then, with the default privileges
     * holding exactly the grant-on-create hook, so a stray grant or default privilege never outlives the migration
     * that made it, even when a later migration fails.
     */
    describe('each migration commits in the after-apply state', () => {
        /** The default-privilege entries of `database`, one `role grantee privilege objtype` line each. */
        async function defaultPrivileges(database: string): Promise<readonly string[]> {
            const client = new pg.Client({ connectionString: adminUrlFor(database) });

            await client.connect();

            try {
                const result = await client.query<{ entry: string }>(
                    `SELECT format('%s %s %s %s', pg_get_userbyid(d.defaclrole), pg_get_userbyid(a.grantee),
                                   a.privilege_type, d.defaclobjtype) AS entry
                       FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a ORDER BY 1`,
                );

                return result.rows.map((row) => row.entry);
            } finally {
                await client.end();
            }
        }

        /** The migrations recorded in `database`. */
        async function recorded(database: string): Promise<readonly string[]> {
            const client = new pg.Client({ connectionString: adminUrlFor(database) });

            await client.connect();

            try {
                const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY 1');

                return result.rows.map((row) => row.name);
            } finally {
                await client.end();
            }
        }

        it('⛔ resets a stray seeder grant inside the migration that made it, though a later migration fails', async () => {
            const dir = migrationsDir({
                '0001_tables.sql': TABLES_SQL,
                '0002_stray.sql': `GRANT SELECT ON other TO ${ROLES.seeder};\n`,
                '0003_broken.sql': '-- Fails on purpose: division by zero.\nSELECT 1 / 0;\n',
            });

            await expect(migrate('ktp_stray', dir, POLICY)).rejects.toThrow(/Migration 0003_broken failed/u);

            expect(await recorded('ktp_stray')).toStrictEqual(['0001_tables', '0002_stray']);
            expect(await held('ktp_stray', ROLES.seeder, 'other')).toStrictEqual([]);
        });

        describe('a default privilege outside the grant-on-create hook', () => {
            const clean = migrationsDir({ '0001_tables.sql': TABLES_SQL });
            const hook = [
                `${ROLES.owner} ${ROLES.app} DELETE r`,
                `${ROLES.owner} ${ROLES.app} INSERT r`,
                `${ROLES.owner} ${ROLES.app} SELECT S`,
                `${ROLES.owner} ${ROLES.app} SELECT r`,
                `${ROLES.owner} ${ROLES.app} UPDATE r`,
                `${ROLES.owner} ${ROLES.app} USAGE S`,
            ];

            it('⛔ refuses the migration that adds one: rolled back, unrecorded, the entry gone', async () => {
                const dir = migrationsDir({
                    '0001_tables.sql': TABLES_SQL,
                    '0002_defaults.sql': `ALTER DEFAULT PRIVILEGES FOR ROLE ${ROLES.owner} IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLES.seeder};\nCREATE TABLE later (id int);\n`,
                });

                await expect(migrate('ktp_defacl', dir, POLICY)).rejects.toThrow(/Migration 0002_defaults failed/u);

                expect(await recorded('ktp_defacl')).toStrictEqual(['0001_tables']);
                expect(await defaultPrivileges('ktp_defacl')).toStrictEqual(hook);
            });

            it('passes the database once the migration is gone (positive control)', async () => {
                await expect(migrate('ktp_defacl', clean, POLICY)).resolves.toMatchObject({ applied: [] });
            });

            it('⛔ fails a run that applies nothing when one was added outside any migration', async () => {
                const grant = `ALTER DEFAULT PRIVILEGES FOR ROLE ${ROLES.owner} GRANT SELECT ON TABLES TO ${OTHER}`;

                await asAdmin('ktp_defacl', grant);

                try {
                    await expect(migrate('ktp_defacl', clean, POLICY)).rejects.toThrow(
                        /default privileges:[\s\S]*ktp_owner in every schema give ktp_other SELECT on new tables/u,
                    );
                } finally {
                    await asAdmin(
                        'ktp_defacl',
                        grant.replace(' GRANT SELECT ON TABLES TO ', ' REVOKE SELECT ON TABLES FROM '),
                    );
                }

                expect(await defaultPrivileges('ktp_defacl')).toStrictEqual(hook);
            });
        });
    });

    /**
     * KTD-12's trigger reads its writer from privileges: a member of the owner is the owner, and a holder of INSERT on
     * the seed ledger is the seeder. Both readings rest on premises nothing else checks, so the runner re-reads them on
     * every run: only the seeder can write the ledger, by any route, and the seeder is no member of the owner.
     */
    describe('the seed trigger’s premises, re-read on every run', () => {
        const dir = migrationsDir({ '0001_tables.sql': TABLES_SQL });

        /** Run `grant`, expect the next run to fail matching `refusal`, then run `revoke`. */
        async function refusedWhile(
            grant: readonly string[],
            revoke: readonly string[],
            refusal: RegExp,
        ): Promise<void> {
            for (const sql of grant) {
                await asAdmin('ktp_premise', sql);
            }

            try {
                await expect(migrate('ktp_premise', dir, POLICY)).rejects.toThrow(refusal);
            } finally {
                for (const sql of revoke) {
                    await asAdmin('ktp_premise', sql);
                }
            }
        }

        beforeAll(async () => {
            await migrate('ktp_premise', dir, POLICY);
            await asAdmin('ktp_premise', `GRANT CONNECT ON DATABASE ktp_premise TO ${OTHER}`);
        });

        it('passes a database where only the seeder can write the ledger (positive control)', async () => {
            await expect(migrate('ktp_premise', dir, POLICY)).resolves.toMatchObject({ applied: [] });
        });

        it('⛔ fails the run when a third login holds INSERT on the ledger', async () => {
            await refusedWhile(
                [`GRANT INSERT ON ledger TO ${OTHER}`],
                [`REVOKE INSERT ON ledger FROM ${OTHER}`],
                /seed writer premise:[\s\S]*the login ktp_other can INSERT into ledger/u,
            );
        });

        it('⛔ fails the run when a third login holds INSERT on one column of the ledger', async () => {
            // `has_table_privilege` reads table-level grants only, so a column grant lets a login add a ledger row
            // that a table-level check never sees.
            await refusedWhile(
                [`GRANT INSERT (seed_sha) ON ledger TO ${OTHER}`],
                [`REVOKE INSERT (seed_sha) ON ledger FROM ${OTHER}`],
                /seed writer premise:[\s\S]*the login ktp_other can INSERT into ledger/u,
            );
        });

        it('⛔ fails the run when a third login can SET ROLE to a role that holds INSERT on the ledger', async () => {
            await refusedWhile(
                [`GRANT INSERT ON ledger TO ${GROUP}`, `GRANT ${GROUP} TO ${OTHER} WITH INHERIT FALSE, SET TRUE`],
                [`REVOKE ${GROUP} FROM ${OTHER}`, `REVOKE INSERT ON ledger FROM ${GROUP}`],
                /seed writer premise:[\s\S]*the login ktp_other can INSERT into ledger/u,
            );
        });

        it('⛔ fails the run when the seeder holds an ADMIN-only membership in the owner', async () => {
            // PostgreSQL 18's pg_has_role(…, 'MEMBER') counts an ADMIN-only row, so the trigger would read every seeder
            // write as the owner's and skip its check.
            await refusedWhile(
                [`GRANT ${ROLES.owner} TO ${ROLES.seeder} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`],
                [`REVOKE ${ROLES.owner} FROM ${ROLES.seeder}`],
                /seed writer premise:[\s\S]*the seeder ktp_seeder is a member of the owner ktp_owner/u,
            );
        });

        it('takes back a column-level INSERT the service role was handed on the ledger', async () => {
            await asAdmin('ktp_premise', `GRANT INSERT (seed_sha) ON ledger TO ${ROLES.app}`);

            await migrate('ktp_premise', dir, POLICY);

            const client = new pg.Client({ connectionString: adminUrlFor('ktp_premise') });

            await client.connect();

            try {
                const result = await client.query<{ held: boolean }>(
                    "SELECT has_any_column_privilege($1, 'public.ledger', 'INSERT') AS held",
                    [ROLES.app],
                );

                expect(result.rows).toStrictEqual([{ held: false }]);
            } finally {
                await client.end();
            }
        });
    });

    /**
     * The premises are only worth checking if they are the trigger's own readings. These cases run food's REAL
     * `catalog_writer`, taken from its migrations, against the audit over one table of membership and grant shapes:
     * the audit must call the seeder a member of the owner exactly when the trigger reads it as the owner, and must
     * report every third login the trigger would read as the seeder.
     */
    describe('the premise audit and the trigger read the same writer', () => {
        const PIN_SQL = `CREATE TABLE item (id text PRIMARY KEY);
CREATE TABLE catalog_seed_ledger (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, seed_sha text NOT NULL);
`;
        const PIN_POLICY: TablePolicy = {
            catalog: new Set(['item']),
            serviceReadOnly: new Set(['catalog_seed_ledger']),
            dictionaries: new Set(),
        };

        /** What the real trigger reads `role` as, on `item`. */
        async function writerAs(role: string): Promise<string | undefined> {
            const client = new pg.Client({ connectionString: adminUrlFor('ktp_pin') });

            await client.connect();

            try {
                await client.query(`SET SESSION AUTHORIZATION ${role}`);

                const result = await client.query<{ writer: string }>(
                    "SELECT public.catalog_writer('public.item'::regclass) AS writer",
                );

                return result.rows[0]?.writer;
            } finally {
                await client.end();
            }
        }

        /** Run the audit's two queries on `ktp_pin`. */
        async function audit(): Promise<{ readonly inOwner: boolean; readonly writers: readonly string[] }> {
            const client = new pg.Client({ connectionString: adminUrlFor('ktp_pin') });

            await client.connect();

            try {
                return {
                    inOwner: (await auditSeederOwnerMembership(client, ROLES)).length > 0,
                    writers: await auditLedgerWriters(client, ROLES, PIN_POLICY),
                };
            } finally {
                await client.end();
            }
        }

        /** Apply `grant`, read both sides, then apply `revoke` whatever happened. */
        async function readBoth(
            grant: readonly string[],
            revoke: readonly string[],
            role: string,
        ): Promise<{ readonly writer: string | undefined; readonly inOwner: boolean; readonly flagged: boolean }> {
            try {
                for (const sql of grant) {
                    await asAdmin('ktp_pin', sql);
                }

                const writer = await writerAs(role);
                const { inOwner, writers } = await audit();

                return { writer, inOwner, flagged: writers.some((line) => line.includes(`the login ${role} `)) };
            } finally {
                for (const sql of revoke) {
                    await asAdmin('ktp_pin', sql);
                }
            }
        }

        beforeAll(async () => {
            const dir = migrationsDir({
                '0001_tables.sql': PIN_SQL,
                '0002_writer.sql': `${await foodCatalogWriter()};\n`,
            });

            await migrate('ktp_pin', dir, PIN_POLICY, ['item', 'catalog_seed_ledger']);
            await asAdmin('ktp_pin', `GRANT CONNECT ON DATABASE ktp_pin TO ${OTHER}`);
        });

        const SEEDER_SHAPES: readonly (readonly [
            shape: string,
            grant: readonly string[],
            revoke: readonly string[],
        ])[] = [
            ['no membership', [], []],
            [
                'an ADMIN-only row',
                [`GRANT ${ROLES.owner} TO ${ROLES.seeder} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`],
                [`REVOKE ${ROLES.owner} FROM ${ROLES.seeder}`],
            ],
            [
                'a SET-only row',
                [`GRANT ${ROLES.owner} TO ${ROLES.seeder} WITH INHERIT FALSE, SET TRUE`],
                [`REVOKE ${ROLES.owner} FROM ${ROLES.seeder}`],
            ],
            [
                'an INHERIT-only row',
                [`GRANT ${ROLES.owner} TO ${ROLES.seeder} WITH INHERIT TRUE, SET FALSE`],
                [`REVOKE ${ROLES.owner} FROM ${ROLES.seeder}`],
            ],
            [
                'a row with no option at all',
                [`GRANT ${ROLES.owner} TO ${ROLES.seeder} WITH INHERIT FALSE, SET FALSE`],
                [`REVOKE ${ROLES.owner} FROM ${ROLES.seeder}`],
            ],
            [
                'a chain of ADMIN-only rows through a group',
                [
                    `GRANT ${ROLES.owner} TO ${GROUP} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
                    `GRANT ${GROUP} TO ${ROLES.seeder} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
                ],
                [`REVOKE ${GROUP} FROM ${ROLES.seeder}`, `REVOKE ${ROLES.owner} FROM ${GROUP}`],
            ],
            ['superuser', [`ALTER ROLE ${ROLES.seeder} SUPERUSER`], [`ALTER ROLE ${ROLES.seeder} NOSUPERUSER`]],
        ];

        it.each(SEEDER_SHAPES)(
            'the seeder with %s: the audit reports it exactly when the trigger reads it as the owner',
            async (shape, grant, revoke) => {
                const { writer, inOwner } = await readBoth(grant, revoke, ROLES.seeder);

                expect(inOwner).toBe(writer === 'owner');
                expect(writer).toBe(shape === 'no membership' ? 'seeder' : 'owner');
            },
        );

        const THIRD_LOGIN_SHAPES: readonly (readonly [
            shape: string,
            grant: readonly string[],
            revoke: readonly string[],
            trigger: string,
        ])[] = [
            ['no grant', [], [], 'other'],
            [
                'its own INSERT',
                [`GRANT INSERT ON catalog_seed_ledger TO ${OTHER}`],
                [`REVOKE INSERT ON catalog_seed_ledger FROM ${OTHER}`],
                'seeder',
            ],
            [
                'INSERT through PUBLIC',
                ['GRANT INSERT ON catalog_seed_ledger TO PUBLIC'],
                ['REVOKE INSERT ON catalog_seed_ledger FROM PUBLIC'],
                'seeder',
            ],
            [
                'INSERT inherited from a group',
                [`GRANT INSERT ON catalog_seed_ledger TO ${GROUP}`, `GRANT ${GROUP} TO ${OTHER} WITH INHERIT TRUE`],
                [`REVOKE ${GROUP} FROM ${OTHER}`, `REVOKE INSERT ON catalog_seed_ledger FROM ${GROUP}`],
                'seeder',
            ],
            [
                'INSERT on one column',
                [`GRANT INSERT (seed_sha) ON catalog_seed_ledger TO ${OTHER}`],
                [`REVOKE INSERT (seed_sha) ON catalog_seed_ledger FROM ${OTHER}`],
                'other',
            ],
            [
                'a group with INSERT it can only SET ROLE to',
                [
                    `GRANT INSERT ON catalog_seed_ledger TO ${GROUP}`,
                    `GRANT ${GROUP} TO ${OTHER} WITH INHERIT FALSE, SET TRUE`,
                ],
                [`REVOKE ${GROUP} FROM ${OTHER}`, `REVOKE INSERT ON catalog_seed_ledger FROM ${GROUP}`],
                'other',
            ],
        ];

        it.each(THIRD_LOGIN_SHAPES)(
            'a third login with %s: the audit reports every login the trigger reads as the seeder',
            async (shape, grant, revoke, trigger) => {
                const { writer, flagged } = await readBoth(grant, revoke, OTHER);

                expect(writer).toBe(trigger);
                // The audit is wider than the trigger: a login that can add a ledger row it is not read as writing is
                // reported too, since the ledger is the seed's record.
                expect(flagged).toBe(shape !== 'no grant');
            },
        );
    });
});
