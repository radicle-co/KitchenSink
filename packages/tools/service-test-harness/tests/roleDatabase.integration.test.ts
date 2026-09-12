/**
 * The role-database fixture against REAL PostgreSQL — the tier that proves the thing a unit test cannot: what
 * the SERVICE role may and may not do once the production role model and migrations have been applied.
 *
 * ## Why this suite is the load-bearing one
 *
 * Every service integration tier used to connect as `postgres`. A superuser satisfies every grant, so a
 * missing privilege, an object owned by the wrong role, or a runner that forgot `SET ROLE` passed the whole
 * tier and failed only in a deployed stage — the defect class the role split (ADR-0039) exists to surface.
 * The refusals below are that tier's negative controls: if the privilege statements ever stop taking DDL,
 * TRUNCATE, sequence writes, temp tables or ledger writes away from `<svc>_app`, these fail here rather than
 * in a stage.
 *
 * ⚠️ `ANALYZE` is the one that fails SILENTLY: as the service role PostgreSQL 18 emits
 * `WARNING: permission denied to analyze "…", skipping it` and the command SUCCEEDS. A suite that analyses
 * through the subject's connection reads stale statistics and cannot tell. That is why `asOwner` exists, and
 * this pins the behaviour so nobody "simplifies" it away.
 *
 * ## How to run it
 *
 * `DATABASE_ADMIN_URL` must name a THROWAWAY PostgreSQL on loopback (CI supplies a service container):
 *
 *     docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name harness-it-pg postgres:18
 *     DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *         npm run test:integration --workspace=@kitchensink/service-test-harness
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DATABASE_ROLES, MIGRATION_LEDGER_TABLE } from '@kitchensink/db-schema-guard';

import { hasAdminServer } from '../src/adminServer.js';
import { engineMigrator, provisionRoleDatabase, type RoleDatabase } from '../src/roleDatabase.js';

/** This suite's own database and schema — never a service's, so it can run beside every other tier. */
const DATABASE = 'harness_role_test';
const ROLES = DATABASE_ROLES.food;

/** A two-file migration set, written to a temp directory: the fixture needs a real ordered `.sql` set. */
function writeMigrations(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harness-migrations-'));

    writeFileSync(
        join(dir, '0001_widgets.sql'),
        'CREATE TABLE widget (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL);',
    );
    writeFileSync(join(dir, '0002_gadgets.sql'), 'CREATE TABLE gadget (id text PRIMARY KEY);');

    return dir;
}

describe.skipIf(!hasAdminServer)('roleDatabase against real PostgreSQL', () => {
    let migrationsDir: string;
    let db: RoleDatabase;
    let app: pg.Pool;

    /** Run `sql` as the subject and return the SQLSTATE it was refused with, or `undefined` if it succeeded. */
    async function refusal(sql: string): Promise<string | undefined> {
        try {
            await app.query(sql);

            return undefined;
        } catch (error: unknown) {
            return (error as { code?: string }).code;
        }
    }

    beforeAll(async () => {
        migrationsDir = writeMigrations();
        db = await provisionRoleDatabase({
            roles: ROLES,
            database: DATABASE,
            migrationsDir,
            migrate: engineMigrator({ label: 'harness', roles: ROLES, expectedTables: ['widget', 'gadget'] }),
        });
        app = new pg.Pool({ connectionString: db.appUrl, max: 2 });
    }, 120_000);

    afterAll(async () => {
        await app?.end();
        rmSync(migrationsDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        await db.truncate();
    });

    it('hands the subject the SERVICE role — not a superuser, and not the owner', async () => {
        const who = await app.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
            'SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user',
        );

        expect(who.rows[0]).toEqual({ current_user: ROLES.app, rolsuper: false, rolbypassrls: false });
    });

    it('lets the subject do DML, and only DML', async () => {
        await app.query("INSERT INTO widget (name) VALUES ('one')");
        await app.query("UPDATE widget SET name = 'two'");

        expect((await app.query('SELECT name FROM widget')).rows).toEqual([{ name: 'two' }]);

        await app.query('DELETE FROM widget');
    });

    it('⛔ REFUSES the subject every privilege the role split takes away', async () => {
        expect(await refusal('CREATE TABLE sneaky (id int)')).toBe('42501');
        expect(await refusal('TRUNCATE TABLE widget')).toBe('42501');
        expect(await refusal('CREATE TEMP TABLE scratch (id int)')).toBe('42501');
        expect(await refusal('ALTER TABLE widget ADD COLUMN sneaky int')).toBe('42501');
        expect(await refusal(`INSERT INTO ${MIGRATION_LEDGER_TABLE} (name) VALUES ('0003_forged.sql')`)).toBe('42501');
        // SELECT on the ledger is deliberate: the boot guard reads it as the service role.
        expect(await refusal(`SELECT count(*) FROM ${MIGRATION_LEDGER_TABLE}`)).toBeUndefined();
    });

    it('⛔ ANALYZE as the subject WARNS AND SKIPS — silent staleness, which is why asOwner exists', async () => {
        const client = await app.connect();
        const notices: string[] = [];

        client.on('notice', (notice) => notices.push(notice.message ?? ''));

        try {
            await client.query('ANALYZE widget');
        } finally {
            client.release();
        }

        expect(notices.join('\n')).toMatch(/permission denied to analyze/u);

        // …and through the owner it actually runs, with no warning to swallow.
        await expect(db.asOwner(async (owner) => owner.query('ANALYZE widget'))).resolves.toBeDefined();
    });

    it('asOwner RESETs the role even when the work throws, so the session is never left elevated', async () => {
        await expect(
            db.asOwner(async () => {
                throw new Error('fixture failure');
            }),
        ).rejects.toThrow('fixture failure');

        const who = await db.asOwner(async (client) => client.query<{ user: string }>('SELECT current_user AS user'));

        expect(who.rows[0]?.user).toBe(ROLES.owner);
    });

    it('truncate() empties the data and KEEPS the schema and the migration ledger', async () => {
        await app.query("INSERT INTO widget (name) VALUES ('doomed')");

        await db.truncate();

        expect((await app.query('SELECT count(*)::int AS n FROM widget')).rows[0]).toEqual({ n: 0 });
        // ⛔ The ledger must survive: emptying it would make the next reset re-apply 0001 over an existing table.
        expect((await app.query(`SELECT count(*)::int AS n FROM ${MIGRATION_LEDGER_TABLE}`)).rows[0]).toEqual({ n: 2 });
    });

    it('reset() rebuilds the schema from the migrations, as the migrator', async () => {
        await db.asOwner(async (owner) => owner.query('DROP TABLE gadget'));

        await db.reset();

        expect((await app.query('SELECT count(*)::int AS n FROM gadget')).rows[0]).toEqual({ n: 0 });
        expect((await app.query(`SELECT count(*)::int AS n FROM ${MIGRATION_LEDGER_TABLE}`)).rows[0]).toEqual({ n: 2 });
    });

    it('⛔ REPORTS a database owned by someone else instead of rebuilding it', async () => {
        // The pre-role-split shape: a database left behind by a superuser run. The migrator could neither
        // rebuild nor empty it, and the fixture must NOT clean it up — `DROP DATABASE` has exactly two
        // authorities in this repository (the per-PR reaper and the armed legacy recreate,
        // `dropDatabaseAuthority.test.ts` asserts the set by equality) and a test fixture is neither.
        //
        // Ownership is flipped rather than a second database created, so this suite issues no DROP either.
        const maintenance = new pg.Pool({ connectionString: db.migratorUrl.replace(`/${DATABASE}`, '/postgres') });

        try {
            await maintenance.query(`ALTER DATABASE "${DATABASE}" OWNER TO "${ROLES.migrator}"`);

            await expect(
                provisionRoleDatabase({
                    roles: ROLES,
                    database: DATABASE,
                    migrationsDir,
                    migrate: engineMigrator({ label: 'harness', roles: ROLES, expectedTables: ['widget', 'gadget'] }),
                }),
            ).rejects.toThrow(/owned by .*, not /u);
        } finally {
            await maintenance.query(`ALTER DATABASE "${DATABASE}" OWNER TO "${ROLES.owner}"`).catch(() => undefined);
            await maintenance.end();
        }
    }, 60_000);
});
