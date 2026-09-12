/**
 * The migration runner creating a per-PR food database, through its real handler with the database mocked (curated
 * catalog plan U7, ADR-0006; the 2026-09-20 ruling: integration mocks the database).
 *
 * The real handler, event parser, bundle check, RDS IAM connection config and database-name rule run here. `pg.Pool`
 * is a recording fake, and the migration engine (`applyMigrations`) is a recording stand-in: its statements are
 * `@kitchensink/db-schema-guard`'s subject and the real server's (`tests/e2e/perPrDatabaseCreation.e2e.test.ts`). What
 * these cases prove is what no unit suite sees across the handler's seams: which connections it opens, as whom, to
 * which database and in which order, and what it leaves behind when a step refuses. `ensureDatabaseExists` on its own
 * is `src/lambdas/migrate/__tests__/handler.test.ts`'s.
 *
 * ⚠️ From source, the handler resolves its SQL two directories above itself, where the bundle copies it
 * (`esbuild.mjs`). `src/lambdas/` has no `migrations/` beside it, so `node:url` is mocked to report the handler inside
 * `src/db/`, the directory that does hold them. Every other module's paths pass through untouched.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DATABASE_ROLES,
    isSchemaManifestMismatchError,
    readMigrationManifest,
    type ApplyMigrationsOptions,
    type MigrateResult,
} from '@kitchensink/db-schema-guard';

import { FOOD_TABLE_POLICY } from '../src/db/schema/catalog.js';
import { handler } from '../src/lambdas/migrate/handler.js';
import { isFoodDatabaseCreateError } from '../src/lambdas/migrate/migrate.errors.js';

/** What the fakes saw, shared with their hoisted factories. */
const fake = vi.hoisted(() => ({
    /** Every connection pool the handler opened, in order. */
    pools: [] as { readonly config: Record<string, unknown>; readonly instance: object }[],
    /** One ordered log across every pool and the engine, so the order between them can be asserted. */
    log: [] as string[],
    /** Whether `pg_database` reports the target database. */
    present: false,
    /** What `CREATE DATABASE` throws, when it should. */
    createError: undefined as unknown,
    /** The engine stand-in: records its call, then answers what the case sets. */
    applyMigrations: vi.fn<(options: ApplyMigrationsOptions) => Promise<MigrateResult>>(),
}));

vi.mock('pg', async (importOriginal) => {
    const actual = await importOriginal<{ default: object }>();

    class Pool {
        private readonly database: string;

        public constructor(config: Record<string, unknown>) {
            this.database = String(config['database']);
            fake.pools.push({ config, instance: this });
            fake.log.push(`open ${this.database}`);
        }

        public async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: []; rowCount: number }> {
            fake.log.push(`query ${this.database}: ${sql}${params.length > 0 ? ` ${JSON.stringify(params)}` : ''}`);

            if (sql.startsWith('CREATE DATABASE') && fake.createError !== undefined) {
                throw fake.createError;
            }

            return { rows: [], rowCount: sql.includes('pg_database') && fake.present ? 1 : 0 };
        }

        public async end(): Promise<void> {
            fake.log.push(`end ${this.database}`);
        }
    }

    return { default: { ...actual.default, Pool } };
});

vi.mock('@kitchensink/db-schema-guard', async (importOriginal) => {
    const actual = await importOriginal<object>();

    return { ...actual, applyMigrations: fake.applyMigrations };
});

vi.mock('node:url', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:url')>();
    const { join: joinPath } = await import('node:path');
    const handlerSource = actual.fileURLToPath(new URL('../src/lambdas/migrate/handler.ts', import.meta.url));
    const sourceDb = actual.fileURLToPath(new URL('../src/db/', import.meta.url));

    return {
        ...actual,
        fileURLToPath: (url: string | URL): string => {
            const path = actual.fileURLToPath(url);

            return path === handlerSource ? joinPath(sourceDb, 'lambdas', 'migrate', 'handler.js') : path;
        },
    };
});

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(PACKAGE_ROOT, 'src', 'db', 'migrations');
const PER_PR = 'kitchensink_food_pr_7';
const ROLES = DATABASE_ROLES.food;

/** The engine's answer when a case lets it succeed. */
const MIGRATED: MigrateResult = {
    applied: ['0001_initial'],
    skipped: [],
    validated: { migrations: 1, tables: 1 },
    manifestSha: 'a'.repeat(64),
};

/** The event a deploy sends: the digest of the migrations the handler holds. */
function migrateEvent(): { expectManifestSha: string } {
    return { expectManifestSha: readMigrationManifest(MIGRATIONS_DIR).sha };
}

/** The options the engine was called with, from its only call. */
function engineOptions(): ApplyMigrationsOptions {
    const [call, ...others] = fake.applyMigrations.mock.calls;

    expect(others).toStrictEqual([]);

    if (call === undefined) {
        throw new Error('the engine was never called');
    }

    return call[0];
}

/** Stub the stage and its database target, as `FoodSchemaStack` sets them. */
function target(database: string, stage = 'pr-7'): void {
    vi.stubEnv('STAGE', stage);
    vi.stubEnv('FOOD_DB_ENDPOINT', 'db.example.internal');
    vi.stubEnv('FOOD_DB_PORT', '5432');
    vi.stubEnv('FOOD_DB_NAME', database);
}

beforeEach(() => {
    fake.pools.length = 0;
    fake.log.length = 0;
    fake.present = false;
    fake.createError = undefined;
    fake.applyMigrations.mockReset();
    fake.applyMigrations.mockImplementation(async (options) => {
        fake.log.push(`migrate ${options.database}`);

        return MIGRATED;
    });
    target(PER_PR);
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('the migration runner creates a per-PR database, its database mocked', () => {
    it('creates an absent per-PR database from template0 as the migrator, closes that connection, then migrates it', async () => {
        await expect(handler(migrateEvent())).resolves.toBe(MIGRATED);

        expect(fake.log).toStrictEqual([
            'open postgres',
            `query postgres: SELECT 1 FROM pg_database WHERE datname = $1 ["${PER_PR}"]`,
            `query postgres: CREATE DATABASE "${PER_PR}" TEMPLATE template0 OWNER "${ROLES.owner}"`,
            'end postgres',
            `open ${PER_PR}`,
            `migrate ${PER_PR}`,
            `end ${PER_PR}`,
        ]);
    });

    it('connects both times as the migrator over RDS IAM, never with a stored password', async () => {
        await handler(migrateEvent());

        expect(fake.pools.map(({ config }) => config['database'])).toStrictEqual(['postgres', PER_PR]);

        for (const { config } of fake.pools) {
            expect(config).toMatchObject({
                host: 'db.example.internal',
                port: 5432,
                user: ROLES.migrator,
                ssl: { rejectUnauthorized: false },
                max: 1,
            });
            expect(typeof config['password']).toBe('function');
        }
    });

    it('hands the engine the per-PR connection, the database, food’s roles and table policy, and the event’s digest', async () => {
        await handler(migrateEvent());

        const options = engineOptions();

        expect(options.pool).toBe(fake.pools[1]?.instance);
        expect(options).toMatchObject({
            database: PER_PR,
            label: 'food',
            migrationsDir: MIGRATIONS_DIR,
            expectManifestSha: migrateEvent().expectManifestSha,
            roles: ROLES,
            tablePolicy: FOOD_TABLE_POLICY,
        });
        expect(options.expectedTables).toContain('food');
    });

    it('finds a per-PR database already present, leaves it alone and migrates it', async () => {
        fake.present = true;

        await handler(migrateEvent());

        expect(fake.log.filter((entry) => entry.includes('CREATE DATABASE'))).toStrictEqual([]);
        expect(fake.log.slice(-3)).toStrictEqual([`open ${PER_PR}`, `migrate ${PER_PR}`, `end ${PER_PR}`]);
    });

    it('migrates the base database without opening a maintenance connection', async () => {
        target('kitchensink_food', 'sandbox');

        await handler(migrateEvent());

        expect(fake.log).toStrictEqual(['open kitchensink_food', 'migrate kitchensink_food', 'end kitchensink_food']);
    });

    it('⛔ refuses a runner holding another migration set before it opens any connection, so no database is created', async () => {
        const outcome = await handler({ expectManifestSha: 'f'.repeat(64) }).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSchemaManifestMismatchError(outcome)).toBe(true);
        expect(fake.log).toStrictEqual([]);
    });

    it('stops at a migrator that may not create the database: the maintenance connection is closed, nothing migrates', async () => {
        fake.createError = Object.assign(new Error('permission denied to create database'), { code: '42501' });

        const outcome = await handler(migrateEvent()).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isFoodDatabaseCreateError(outcome)).toBe(true);
        expect(fake.log.at(-1)).toBe('end postgres');
        expect(fake.log).not.toContain(`open ${PER_PR}`);
        expect(fake.applyMigrations).not.toHaveBeenCalled();
    });

    it('refuses a database outside the food naming contract before any connection', async () => {
        target('kitchensink_identity');

        await expect(handler(migrateEvent())).rejects.toThrow(/invalid FOOD_DB_NAME/u);
        expect(fake.log).toStrictEqual([]);
    });

    it('closes the per-PR connection when the migration fails, and fails with the engine’s error', async () => {
        const failure = new Error('Migration 0001_initial failed');

        fake.applyMigrations.mockRejectedValueOnce(failure);

        await expect(handler(migrateEvent())).rejects.toBe(failure);
        expect(fake.log.at(-1)).toBe(`end ${PER_PR}`);
    });
});
