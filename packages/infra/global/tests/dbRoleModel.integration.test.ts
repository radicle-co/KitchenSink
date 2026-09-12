// @vitest-environment node
/**
 * Integration: the role split's privilege statements, applied to a REAL PostgreSQL, produce a service role that
 * can read and write data and can do nothing else.
 *
 * ## Why a unit test is not enough
 *
 * `privilegeStatements.test.ts` pins the exact statements. It cannot tell whether PostgreSQL then does what those
 * statements are MEANT to achieve — whether default privileges fire for a table the owner creates under `SET ROLE`,
 * whether the ledger revoke leaves SELECT behind, whether a login the grants never mention can still connect. Each
 * of those is a claim about PostgreSQL, so it is checked against PostgreSQL. The roles here stand in for
 * `food_owner` / `food_migrator` / `food_app`; RDS IAM is replaced by passwords, which changes how a login
 * authenticates and nothing about what it may do.
 *
 * `DATABASE_URL` must point at the maintenance database of a throwaway PostgreSQL as a superuser (CI provides one).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    MIGRATION_LEDGER_TABLE,
    applyMigrations,
    applyRoleModel,
    assertRoleModel,
    isRoleModelPostconditionError,
    privilegesAfterApply,
    privilegesBeforeApply,
    readMigrationManifest,
} from '@kitchensink/db-schema-guard';

const DATABASE_URL = process.env['DATABASE_URL'];
const DB = 'ks_rolemodel_db';
const ROLES = { owner: 'ks_rm_owner', migrator: 'ks_rm_migrator', app: 'ks_rm_app' } as const;
const OUTSIDER = 'ks_rm_outsider';

/** A connection string for `role` against `database`, on the same server as `DATABASE_URL`. */
function urlFor(role: string, database: string): string {
    const url = new URL(DATABASE_URL ?? 'postgres://localhost/postgres');

    url.username = role;
    url.password = 'pw';
    url.pathname = `/${database}`;

    return url.toString();
}

/** Run `sql` as `role` against `database`, returning the error message or `undefined` on success. */
async function attempt(role: string, sql: string): Promise<string | undefined> {
    const client = new pg.Client({ connectionString: urlFor(role, DB) });

    try {
        await client.connect();
        await client.query(sql);

        return undefined;
    } catch (error) {
        return (error as Error).message;
    } finally {
        await client.end().catch(() => undefined);
    }
}

describe.skipIf(!DATABASE_URL)('the role split against real PostgreSQL', () => {
    describe('role split privileges against real PostgreSQL', () => {
        const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

        async function dropAll(): Promise<void> {
            await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);

            for (const role of [...Object.values(ROLES), OUTSIDER]) {
                await admin.query(`DROP ROLE IF EXISTS ${role}`);
            }
        }

        beforeAll(async () => {
            await dropAll();
            await admin.query(`CREATE ROLE ${ROLES.owner} NOLOGIN`);
            await admin.query(`CREATE ROLE ${ROLES.migrator} LOGIN PASSWORD 'pw'`);
            await admin.query(`CREATE ROLE ${ROLES.app} LOGIN PASSWORD 'pw'`);
            await admin.query(`CREATE ROLE ${OUTSIDER} LOGIN PASSWORD 'pw'`);
            await admin.query(`GRANT ${ROLES.owner} TO ${ROLES.migrator} WITH INHERIT TRUE, SET TRUE`);
            await admin.query(`CREATE DATABASE ${DB} OWNER ${ROLES.owner}`);

            // The runner's pass, as the MIGRATOR acting as the owner: before-privileges, one migration, after.
            const migrator = new pg.Client({ connectionString: urlFor(ROLES.migrator, DB) });

            await migrator.connect();

            try {
                await migrator.query(`SET ROLE ${ROLES.owner}`);

                for (const sql of privilegesBeforeApply(ROLES, DB)) {
                    await migrator.query(sql);
                }

                await migrator.query(`CREATE TABLE ${MIGRATION_LEDGER_TABLE} (filename text PRIMARY KEY)`);
                await migrator.query(`INSERT INTO ${MIGRATION_LEDGER_TABLE} VALUES ('0000_init.sql')`);
                await migrator.query('CREATE TABLE foods (id bigserial PRIMARY KEY, name text NOT NULL)');

                for (const sql of privilegesAfterApply(ROLES)) {
                    await migrator.query(sql);
                }

                // A table created AFTER the grants: only the default-privileges hook can cover it.
                await migrator.query('CREATE TABLE later (id bigserial PRIMARY KEY)');
                await migrator.query('RESET ROLE');
            } finally {
                await migrator.end();
            }
        });

        afterAll(async () => {
            await dropAll();
            await admin.end();
        });

        it('the service role can read and write data, including through a sequence', async () => {
            expect(await attempt(ROLES.app, "INSERT INTO foods (name) VALUES ('flour')")).toBeUndefined();
            expect(await attempt(ROLES.app, "UPDATE foods SET name = 'bread flour'")).toBeUndefined();
            expect(await attempt(ROLES.app, 'SELECT * FROM foods')).toBeUndefined();
            expect(await attempt(ROLES.app, 'DELETE FROM foods')).toBeUndefined();
        });

        it('covers a table created after the grants — the default-privileges hook fired for the owner', async () => {
            expect(await attempt(ROLES.app, 'INSERT INTO later DEFAULT VALUES')).toBeUndefined();
        });

        it('reads the ledger (the boot guard does) but cannot write it', async () => {
            expect(await attempt(ROLES.app, `SELECT * FROM ${MIGRATION_LEDGER_TABLE}`)).toBeUndefined();
            expect(await attempt(ROLES.app, `INSERT INTO ${MIGRATION_LEDGER_TABLE} VALUES ('x')`)).toMatch(
                /permission denied/u,
            );
            expect(await attempt(ROLES.app, `DELETE FROM ${MIGRATION_LEDGER_TABLE}`)).toMatch(/permission denied/u);
        });

        it.each([
            ['create a table', 'CREATE TABLE evil (id int)'],
            ['alter a table', 'ALTER TABLE foods ADD COLUMN evil int'],
            ['drop a table', 'DROP TABLE foods'],
            ['truncate a table', 'TRUNCATE foods'],
        ])('⛔ the service role cannot %s — it holds no DDL', async (_label, sql) => {
            expect(await attempt(ROLES.app, sql)).toMatch(/permission denied|must be owner/u);
        });

        it('⛔ a login the grants never mention cannot even connect — PUBLIC lost CONNECT', async () => {
            expect(await attempt(OUTSIDER, 'SELECT 1')).toMatch(/permission denied for database/u);
        });

        it('everything the migration created is owned by the OWNER, not the migrator that ran it', async () => {
            // pg_class is per-database, so it is read from inside the fixture database.
            const inside = new pg.Client({ connectionString: urlFor(ROLES.migrator, DB) });

            await inside.connect();

            try {
                const rows = (
                    await inside.query<{ relname: string; owner: string }>(
                        `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
                           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S')`,
                    )
                ).rows;

                expect(rows.length).toBeGreaterThanOrEqual(5);
                expect(rows.filter((row) => row.owner !== ROLES.owner)).toEqual([]);
            } finally {
                await inside.end();
            }
        });
    });

    /**
     * The role model applied by a stand-in for the RDS master: NOSUPERUSER, CREATEROLE, CREATEDB, holding ADMIN — and
     * nothing else — on a stand-in `rds_iam`. That is what Step 0 measured on sandbox (ADMIN via `rds_superuser`, no
     * membership), so this is the closest a plain PostgreSQL gets to running the bootstrap as RDS runs it.
     */
    describe('applyRoleModel / assertRoleModel as a NOSUPERUSER master', () => {
        const superuser = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
        const MASTER = 'ks_ra_master';
        const TEST_ROLES = { owner: 'ks_ra_owner', migrator: 'ks_ra_migrator', app: 'ks_ra_app' } as const;
        let createdIam = false;
        let master: pg.Pool;

        async function reset(): Promise<void> {
            for (const role of [...Object.values(TEST_ROLES), MASTER]) {
                await superuser.query(`DROP ROLE IF EXISTS ${role}`);
            }
        }

        beforeAll(async () => {
            await reset();
            createdIam = (await superuser.query("SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam'")).rowCount === 0;

            if (createdIam) {
                await superuser.query('CREATE ROLE rds_iam NOLOGIN');
            }

            await superuser.query(`CREATE ROLE ${MASTER} LOGIN PASSWORD 'pw' NOSUPERUSER CREATEROLE CREATEDB`);
            await superuser.query(`GRANT rds_iam TO ${MASTER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
            master = new pg.Pool({ connectionString: urlFor(MASTER, 'postgres'), max: 1 });
        });

        afterAll(async () => {
            await master.end();
            await reset();

            if (createdIam) {
                await superuser.query('DROP ROLE IF EXISTS rds_iam');
            }

            await superuser.end();
        });

        // `inherit-or-set`: this vanilla-PostgreSQL stand-in holds its ADMIN (on rds_iam, and on every role it creates)
        // as rows that RDS confers without a row; the production reading, `every-row`, is exercised against those very
        // rows in dbBootstrap.integration.test.ts, where refusing is the subject.
        const input = (isProd: boolean) => ({
            roles: TEST_ROLES,
            context: { master: MASTER, isProd, lockOutEdges: 'inherit-or-set' as const },
        });

        it('non-prod: applies cleanly, and every postcondition holds', async () => {
            await applyRoleModel(master, input(false));
            await expect(assertRoleModel(master, input(false))).resolves.toBeUndefined();
        });

        it('is idempotent — a second run changes nothing and still holds', async () => {
            await applyRoleModel(master, input(false));
            await expect(assertRoleModel(master, input(false))).resolves.toBeUndefined();
        });

        it("re-granting with prod options UPDATES the master's membership to SET-only, and the migrator loses CREATEDB", async () => {
            await applyRoleModel(master, input(true));
            await expect(assertRoleModel(master, input(true))).resolves.toBeUndefined();
            // And the non-prod shape no longer holds, so the assertion discriminates between the two.
            await expect(assertRoleModel(master, input(false))).rejects.toThrow(/INHERIT=false|CREATEDB=false/u);
        });

        it('⛔ refuses to grant rds_iam, and names the lock-out, when the master is a member of a login role', async () => {
            // The trap, planted: the master joins the service role.
            await superuser.query(`GRANT ${TEST_ROLES.app} TO ${MASTER} WITH INHERIT TRUE, SET TRUE`);

            try {
                const outcome = await applyRoleModel(master, input(false)).catch((error: unknown) => error);

                expect(isRoleModelPostconditionError(outcome)).toBe(true);
                expect(String((outcome as Error).message)).toMatch(/member of a login role/u);

                // …and the postcondition sees the path the trap created.
                const asserted = await assertRoleModel(master, input(false)).catch((error: unknown) => error);

                expect(String((asserted as Error).message)).toMatch(/reaches rds_iam/u);
            } finally {
                await superuser.query(`REVOKE ${TEST_ROLES.app} FROM ${MASTER}`);
            }
        });

        it('the master still logs in by password after all of it — the property the whole design protects', async () => {
            const fresh = new pg.Client({ connectionString: urlFor(MASTER, 'postgres') });

            await fresh.connect();
            await fresh.end();
        });
    });

    /**
     * The ENGINE, as a runner will call it: connected as the migrator, handed the roles, over a migration set with the
     * shapes the real schemas use — a trusted extension (whose member objects PostgreSQL gives to the bootstrap
     * superuser, not to us), a table with a sequence, a view and a trigger function.
     */
    describe('applyMigrations with roles, against real PostgreSQL', () => {
        const superuser = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
        const DB_NAME = 'ks_engine_db';
        const R = { owner: 'ks_en_owner', migrator: 'ks_en_migrator', app: 'ks_en_app' } as const;
        const dir = mkdtempSync(path.join(tmpdir(), 'engine-roles-'));

        writeFileSync(
            path.join(dir, '0001_init.sql'),
            'CREATE EXTENSION IF NOT EXISTS pg_trgm;\nCREATE TABLE foods (id bigserial PRIMARY KEY, name text NOT NULL);\n',
        );
        writeFileSync(
            path.join(dir, '0002_more.sql'),
            'CREATE VIEW food_names AS SELECT name FROM foods;\nCREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;\n',
        );

        let migrator: pg.Pool;

        const run = () =>
            applyMigrations({
                pool: migrator,
                migrationsDir: dir,
                label: 'engine-it',
                expectedTables: ['foods'],
                expectManifestSha: readMigrationManifest(dir).sha,
                database: DB_NAME,
                roles: R,
            });

        beforeAll(async () => {
            await superuser.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);

            for (const role of Object.values(R)) {
                await superuser.query(`DROP ROLE IF EXISTS ${role}`);
            }

            await superuser.query(`CREATE ROLE ${R.owner} NOLOGIN`);
            await superuser.query(`CREATE ROLE ${R.migrator} LOGIN PASSWORD 'pw'`);
            await superuser.query(`CREATE ROLE ${R.app} LOGIN PASSWORD 'pw'`);
            await superuser.query(`GRANT ${R.owner} TO ${R.migrator} WITH INHERIT TRUE, SET TRUE`);
            await superuser.query(`CREATE DATABASE ${DB_NAME} OWNER ${R.owner}`);
            migrator = new pg.Pool({ connectionString: urlFor(R.migrator, DB_NAME), max: 1 });
        });

        afterAll(async () => {
            await migrator.end();
            await superuser.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);

            for (const role of Object.values(R)) {
                await superuser.query(`DROP ROLE IF EXISTS ${role}`);
            }

            await superuser.end();
            rmSync(dir, { recursive: true, force: true });
        });

        it('migrates as the owner and passes its own ownership audit — extension members excluded', async () => {
            const result = await run();

            expect(result.applied).toEqual(['0001_init', '0002_more']);
        });

        it('is idempotent: a second run skips everything and still passes the audit', async () => {
            const result = await run();

            expect(result.applied).toEqual([]);
        });

        it('left the session as the migrator, not the owner, when the client went back to the pool', async () => {
            const { rows } = await migrator.query<{ current_user: string }>('SELECT current_user');

            expect(rows[0]?.current_user).toBe(R.migrator);
        });

        it('⛔ fails validation when the service role holds MORE than data access on a table (TRUNCATE)', async () => {
            const owner = new pg.Client({ connectionString: urlFor(R.migrator, DB_NAME) });

            await owner.connect();

            try {
                await owner.query(`SET ROLE ${R.owner}`);
                await owner.query(`GRANT TRUNCATE ON foods TO ${R.app}`);
                await expect(run()).rejects.toThrow(/ks_en_app holds TRUNCATE on table foods/u);
            } finally {
                await owner.query(`REVOKE TRUNCATE ON foods FROM ${R.app}`);
                await owner.end();
            }
        });

        it('⛔ fails validation when the service role can CREATE in the public schema', async () => {
            const owner = new pg.Client({ connectionString: urlFor(R.migrator, DB_NAME) });

            await owner.connect();

            try {
                await owner.query(`SET ROLE ${R.owner}`);
                await owner.query(`GRANT CREATE ON SCHEMA public TO ${R.app}`);
                await expect(run()).rejects.toThrow(/ks_en_app can CREATE in schema public/u);
            } finally {
                await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${R.app}`);
                await owner.end();
            }
        });

        it('⛔ fails validation when an object is owned by the login that connected instead of the owner', async () => {
            // The failure the role split exists to end: DDL run WITHOUT SET ROLE lands owned by the migrator.
            await migrator.query('CREATE TABLE stray (id int)');

            try {
                await expect(run()).rejects.toThrow(/table stray is owned by ks_en_migrator, not ks_en_owner/u);
            } finally {
                await migrator.query('DROP TABLE stray');
            }
        });
    });
});
