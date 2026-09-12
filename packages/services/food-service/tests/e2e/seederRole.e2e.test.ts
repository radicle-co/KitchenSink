/**
 * LOCAL e2e: what `food_seeder` may do on a food database migrated by food's own runner (curated catalog plan U18,
 * U4, KTD-13, KTD-18, ADR-0039, ADR-0051).
 *
 * The seeder is the login the catalog seed connects as. It holds CONNECT and TEMPORARY on the database, its own USAGE
 * on `public`, DML on every catalog table, and SELECT and INSERT on the seed ledger and the dictionaries (U4). It can
 * stage rows in a temporary table, and it cannot create, alter or drop an object, act as another role, or touch
 * `schema_migrations` or any table outside the registry. Which catalog ROWS it may change is the ownership trigger's
 * question, asserted in `catalogSchema.e2e.test.ts`.
 *
 * Every refusal is asserted by SQLSTATE `42501` (insufficient privilege), so a statement that fails for another
 * reason, such as a typo or a missing table, cannot pass as a refusal.
 *
 * The first case pins `public` to the shape `CREATE DATABASE` gives it on a stage, PUBLIC's USAGE included, plus the
 * runner's two grants. Without USAGE every table refusal below would come from the schema, never from the table's own
 * ACL, and a table grant to the seeder would pass unseen.
 */
import { copyFile, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    applyMigrations,
    auditSeederPrivileges,
    auditServicePrivileges,
    DATABASE_ROLES,
    type TablePolicy,
} from '@kitchensink/db-schema-guard';
import { provisionRoleDatabase, roleDatabase, type RoleDatabaseSpec } from '@kitchensink/service-test-harness';

import { FOOD_TABLE_POLICY } from '../../src/db/schema/catalog.js';
import { foodE2eDb, hasTestDatabase, migrationsDir } from '../support/roleDb.js';

const ROLES = DATABASE_ROLES.food;

const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

/** What the seeder holds on a table of each policy set, as `table privilege` lines. */
function expectedSeederGrants(policy: TablePolicy): readonly string[] {
    const rights = {
        catalog: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        serviceReadOnly: ['SELECT', 'INSERT'],
        dictionaries: ['SELECT', 'INSERT'],
    };

    return (['catalog', 'serviceReadOnly', 'dictionaries'] as const)
        .flatMap((set) => [...policy[set]].flatMap((table) => rights[set].map((right) => `${table} ${right}`)))
        .sort();
}

/**
 * A copy of food's migrations plus one more, in a temporary directory, for a runner case that needs a later
 * migration.
 *
 * @param name - The extra migration's file name.
 * @param sql - Its SQL.
 * @returns The directory.
 * @sideEffect Creates a temporary directory and writes files into it.
 */
async function migrationsWith(name: string, sql: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'food-migrations-'));

    for (const file of await readdir(migrationsDir)) {
        if (file.endsWith('.sql')) {
            await copyFile(join(migrationsDir, file), join(dir, file));
        }
    }

    await writeFile(join(dir, name), sql);

    return dir;
}

/**
 * A role database migrated by the shared engine with a given policy, the way food's handler migrates (the handler's
 * policy is fixed, and these cases need one more catalog table).
 *
 * @param database - The throwaway database.
 * @param dir - Its migrations.
 * @param policy - The table policy.
 * @returns The spec.
 */
function specWith(database: string, dir: string, policy: TablePolicy): RoleDatabaseSpec {
    return {
        roles: ROLES,
        database,
        migrationsDir: dir,
        migrate: async ({ pool, migrationsDir: migrations, expectManifestSha, database: target }) => {
            await applyMigrations({
                pool,
                migrationsDir: migrations,
                label: 'food',
                expectedTables: ['food', 'catalog_seed_ledger'],
                expectManifestSha,
                database: target,
                roles: ROLES,
                tablePolicy: policy,
            });
        },
    };
}

/** The SQLSTATE a statement failed with, or `undefined` when it succeeded. */
async function sqlStateOf(client: pg.Client, sql: string): Promise<string | undefined> {
    try {
        await client.query(sql);

        return undefined;
    } catch (error) {
        return (error as { code?: string }).code ?? 'no-code';
    }
}

/**
 * The SQLSTATE a thrown value carries, walking its `cause` chain. Pure.
 *
 * @param error - The thrown value.
 * @returns The first SQLSTATE found, or `undefined`.
 */
function sqlStateWithin(error: unknown): string | undefined {
    let candidate: unknown = error;

    for (let depth = 0; depth < 5 && typeof candidate === 'object' && candidate !== null; depth += 1) {
        if ('code' in candidate && typeof candidate.code === 'string') {
            return candidate.code;
        }

        candidate = 'cause' in candidate ? candidate.cause : undefined;
    }

    return undefined;
}

describe.skipIf(!hasTestDatabase)('the food seeder role on a migrated food database', () => {
    let seeder: pg.Client;

    beforeAll(async () => {
        seeder = new pg.Client({ connectionString: foodE2eDb().seederUrl });
        await seeder.connect();
    });

    afterAll(async () => {
        await seeder?.end();
    });

    it('finds `public` owned by pg_database_owner, with USAGE for PUBLIC, the service role and the seeder', async () => {
        const schema = await seeder.query<{ owner: string; acl: string }>(
            "SELECT nspowner::regrole::text AS owner, nspacl::text AS acl FROM pg_namespace WHERE nspname = 'public'",
        );

        expect(schema.rows).toStrictEqual([
            {
                owner: 'pg_database_owner',
                // The service role's and the seeder's USAGE are the runner's grants, added to the template's two entries.
                // The seeder's is explicit so its rights do not rest on PUBLIC's template USAGE (plan U4a).
                acl:
                    '{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,' +
                    `${ROLES.app}=U/pg_database_owner,${ROLES.seeder}=U/pg_database_owner}`,
            },
        ]);
    });

    it('logs in as food_seeder: no superuser, CREATEDB, CREATEROLE or RLS bypass', async () => {
        const who = await seeder.query<{
            current_user: string;
            rolsuper: boolean;
            rolcreatedb: boolean;
            rolcreaterole: boolean;
            rolbypassrls: boolean;
        }>(
            `SELECT current_user, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls
               FROM pg_roles r WHERE r.rolname = current_user`,
        );

        expect(who.rows).toStrictEqual([
            {
                current_user: ROLES.seeder,
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
            },
        ]);
    });

    it('stages rows in a temporary table', async () => {
        await seeder.query('CREATE TEMPORARY TABLE seed_stage (seed_key text PRIMARY KEY)');

        try {
            await seeder.query("INSERT INTO seed_stage VALUES ('a'), ('b')");

            const counted = await seeder.query<{ n: number }>('SELECT count(*)::int AS n FROM seed_stage');

            expect(counted.rows).toStrictEqual([{ n: 2 }]);
        } finally {
            await seeder.query('DROP TABLE seed_stage');
        }
    });

    const refused: readonly (readonly [string, string])[] = [
        ['creating a table in public', 'CREATE TABLE public.seeder_probe (id int)'],
        ['creating a schema', 'CREATE SCHEMA seeder_probe'],
        ['creating a database', 'CREATE DATABASE seeder_probe'],
        ['altering food', 'ALTER TABLE public.food ADD COLUMN seeder_probe int'],
        ['dropping food', 'DROP TABLE public.food'],
        ['acting as the owner', `SET ROLE ${ROLES.owner}`],
        ['acting as the migrator', `SET ROLE ${ROLES.migrator}`],
        ['acting as the service role', `SET ROLE ${ROLES.app}`],
        ['reading schema_migrations', 'SELECT 1 FROM public.schema_migrations LIMIT 1'],
        ['writing schema_migrations', "DELETE FROM public.schema_migrations WHERE name = 'seeder_probe'"],
        ['reading fetch_queue', 'SELECT 1 FROM public.fetch_queue LIMIT 1'],
        ['writing food_versions', "DELETE FROM public.food_versions WHERE food_id = 'seeder_probe'"],
        ['truncating food', 'TRUNCATE public.food CASCADE'],
        ['updating a ledger row', 'UPDATE public.catalog_seed_ledger SET applied_at = applied_at'],
        ['deleting a dictionary entry', "DELETE FROM public.nutrient WHERE id = 'seeder_probe'"],
    ];

    it.each(refused)('⛔ refuses %s', async (_case, sql) => {
        expect(await sqlStateOf(seeder, sql)).toBe('42501');
    });

    it('holds exactly its policy rights and nothing else, read from the catalog', async () => {
        const held = await seeder.query<{ grant: string }>(
            `SELECT c.relname || ' ' || p AS grant
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest($1::text[]) p
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p')
                AND has_table_privilege(current_user, c.oid, p)
              ORDER BY 1`,
            [TABLE_PRIVILEGES],
        );

        expect(held.rows.map((row) => row.grant)).toStrictEqual(expectedSeederGrants(FOOD_TABLE_POLICY));
        expect(FOOD_TABLE_POLICY.catalog.size).toBeGreaterThan(0);
    });

    it('leaves food_app no write on the ledger, and both audits pass', async () => {
        const app = await seeder.query<{ grant: string }>(
            `SELECT p AS grant FROM unnest($1::text[]) p
              WHERE has_table_privilege($2, 'public.catalog_seed_ledger', p)`,
            [TABLE_PRIVILEGES, ROLES.app],
        );

        expect(app.rows.map((row) => row.grant)).toStrictEqual(['SELECT']);

        const problems = await foodE2eDb().asOwner(async (client) => [
            ...(await auditServicePrivileges(client, ROLES, FOOD_TABLE_POLICY)),
            ...(await auditSeederPrivileges(client, ROLES, FOOD_TABLE_POLICY)),
        ]);

        expect(problems).toStrictEqual([]);
    });

    it('inserts a dictionary entry and a ledger row, and food_app reads the ledger', async () => {
        const sha = 'a'.repeat(64);

        await seeder.query('BEGIN');

        try {
            await seeder.query("INSERT INTO nutrient (id, name, unit) VALUES ('seeder-probe', 'Seeder probe', 'g')");
            await seeder.query("INSERT INTO food_category (id, name) VALUES ('seeder-probe', 'Seeder probe')");
            await seeder.query('INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)', [sha]);

            const read = await seeder.query<{ n: number }>(
                'SELECT count(*)::int AS n FROM catalog_seed_ledger WHERE seed_sha = $1',
                [sha],
            );

            expect(read.rows).toStrictEqual([{ n: 1 }]);
        } finally {
            await seeder.query('ROLLBACK');
        }

        const app = new pg.Client({ connectionString: foodE2eDb().appUrl });

        await app.connect();

        try {
            expect(await sqlStateOf(app, 'SELECT seed_sha FROM catalog_seed_ledger')).toBeUndefined();
            expect(await sqlStateOf(app, `INSERT INTO catalog_seed_ledger (seed_sha) VALUES ('${sha}')`)).toBe('42501');
        } finally {
            await app.end();
        }
    });
});

describe.skipIf(!hasTestDatabase)('the runner grants the seeder its rights as each migration lands', () => {
    it('gives the seeder DML on a catalog table a later migration adds', async () => {
        const dir = await migrationsWith(
            '0999_policy_probe.sql',
            'CREATE TABLE "policy_probe" ("item_id" text NOT NULL REFERENCES "food_item" ("id"));',
        );
        const policy = { ...FOOD_TABLE_POLICY, catalog: new Set([...FOOD_TABLE_POLICY.catalog, 'policy_probe']) };
        const handle = await provisionRoleDatabase(specWith('food_u4policy_test', dir, policy));
        const seederClient = new pg.Client({ connectionString: handle.seederUrl });

        await seederClient.connect();

        try {
            const held = await seederClient.query<{ grant: string }>(
                `SELECT p AS grant FROM unnest($1::text[]) p WHERE has_table_privilege(current_user, 'public.policy_probe', p)`,
                [TABLE_PRIVILEGES],
            );

            expect(held.rows.map((row) => row.grant)).toStrictEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
        } finally {
            await seederClient.end();
        }
    });

    it('leaves food_app no write on the ledger when a later migration fails', async () => {
        const dir = await migrationsWith('0999_fails.sql', 'SELECT 1 / 0;');
        const spec = specWith('food_u4window_test', dir, FOOD_TABLE_POLICY);

        const failure = await provisionRoleDatabase(spec).then(
            () => undefined,
            (error: unknown) => error,
        );

        // Division by zero, so the run failed in the probe migration and not for any other reason.
        expect(sqlStateWithin(failure)).toBe('22012');

        const app = new pg.Client({ connectionString: roleDatabase(spec).appUrl });

        await app.connect();

        try {
            const held = await app.query<{ grant: string }>(
                `SELECT p AS grant FROM unnest($1::text[]) p
                  WHERE has_table_privilege(current_user, 'public.catalog_seed_ledger', p)`,
                [TABLE_PRIVILEGES],
            );

            expect(held.rows.map((row) => row.grant)).toStrictEqual(['SELECT']);
        } finally {
            await app.end();
        }
    });
});
