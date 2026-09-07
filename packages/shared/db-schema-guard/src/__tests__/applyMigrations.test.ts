/**
 * The migration APPLY ENGINE — one implementation, three services.
 *
 * ⛔ WHY THIS IS ONE ENGINE NOW. `identity`, `food-service` and `recipe-service` each carried a private copy
 * of this loop: the same advisory-lock key, the same `lock_timeout` dance, the same ledger, the same
 * rollback, the same post-run validation. Three copies of one piece of knowledge, and they had already
 * drifted in their comments about WHY. The third copy is where the rule says to extract, and the manifest
 * assertion below would otherwise have been a fourth thing written three times.
 *
 * Every case here is written to fail if a specific protection is removed, not merely if the code changes.
 * The real driver path — `pg` against Postgres — stays covered by each service's own integration tier; what
 * a fake proves better than a database is ORDERING, and ordering is where every defect in this loop lives.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ApplyMigrationsOptions, MigrationClient, MigrationPool, MigrationQueryResult } from '../index.js';
import {
    EmptyMigrationSetError,
    SchemaManifestMismatchError,
    applyMigrations,
    readMigrationManifest,
} from '../index.js';

/** A scratch migrations directory holding `files` (name → SQL body). */
function makeMigrationsDir(files: Readonly<Record<string, string>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'apply-migrations-'));

    mkdirSync(dir, { recursive: true });

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, name), body);
    }

    return dir;
}

const TWO_MIGRATIONS = {
    '0001_init.sql': 'CREATE TABLE a ();\n',
    '0002_more.sql': 'CREATE TABLE b ();\n',
};

/** How a fake should answer the engine's reads. */
interface FakeOptions {
    /** Migration names already recorded in the ledger. */
    readonly recorded?: readonly string[];
    /** Tables `information_schema` should report as present; defaults to whatever is asked for. */
    readonly presentTables?: readonly string[];
    /** SQL bodies that must fail when executed. */
    readonly failOn?: readonly string[];
}

/** A recording fake pool: every statement in order, plus how many connections were taken. */
class FakePool implements MigrationPool {
    public readonly statements: string[] = [];
    public connections = 0;
    public releases = 0;
    private readonly recorded: Set<string>;
    private readonly options: FakeOptions;

    public constructor(options: FakeOptions = {}) {
        this.options = options;
        this.recorded = new Set(options.recorded ?? []);
    }

    public async connect(): Promise<MigrationClient> {
        this.connections += 1;

        return {
            query: async <Row>(sql: string, values?: unknown[]): Promise<MigrationQueryResult<Row>> =>
                this.answer<Row>(sql, values),
            release: (): void => {
                this.releases += 1;
            },
        };
    }

    private async answer<Row>(sql: string, values?: unknown[]): Promise<MigrationQueryResult<Row>> {
        this.statements.push(sql);

        if ((this.options.failOn ?? []).includes(sql)) {
            throw new Error(`fake refused: ${sql}`);
        }

        if (sql.startsWith('SELECT 1 FROM schema_migrations')) {
            const name = String(values?.[0]);

            return { rows: [], rowCount: this.recorded.has(name) ? 1 : 0 };
        }

        if (sql.startsWith('INSERT INTO schema_migrations')) {
            this.recorded.add(String(values?.[0]));

            return { rows: [], rowCount: 1 };
        }

        if (sql.startsWith('SELECT name FROM schema_migrations')) {
            const rows = [...this.recorded].map((name) => ({ name })) as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        if (sql.startsWith('SELECT table_name')) {
            const asked = (values?.[0] ?? []) as string[];
            const present = this.options.presentTables ?? asked;
            const rows = asked
                .filter((table) => present.includes(table))
                .map((table) => ({ table_name: table })) as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        return { rows: [], rowCount: 0 };
    }
}

/**
 * The engine's standard arguments for a fixture directory.
 *
 * ⚠️ `expectManifestSha` defaults to the digest of the very directory under test, because the field is
 * REQUIRED (ADR-0035) and every case here is about the apply loop rather than the expectation. The two
 * cases that ARE about the expectation override it.
 */
function options(pool: FakePool, migrationsDir: string, overrides: Record<string, unknown> = {}) {
    return {
        pool,
        migrationsDir,
        label: 'test',
        expectedTables: ['a', 'b'],
        expectManifestSha: readMigrationManifest(migrationsDir).sha,
        ...overrides,
    };
}

describe('applyMigrations — the apply loop', () => {
    it('applies unapplied migrations in filename order and skips recorded ones', async () => {
        const pool = new FakePool({ recorded: ['0001_init'] });
        const result = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        expect(result.skipped).toStrictEqual(['0001_init']);
        expect(result.applied).toStrictEqual(['0002_more']);
        expect(pool.statements).toContain('CREATE TABLE b ();\n');
        expect(pool.statements).not.toContain('CREATE TABLE a ();\n');
    });

    it('reports the manifest of the set it actually ran', async () => {
        const dir = makeMigrationsDir(TWO_MIGRATIONS);
        const result = await applyMigrations(options(new FakePool(), dir));

        expect(result.manifestSha).toBe(readMigrationManifest(dir).sha);
    });

    it('takes the advisory lock BEFORE creating the ledger', async () => {
        // ⛔ The ledger is checked-then-applied, which is not atomic. Two runners that both create the ledger
        // and both read it empty each execute every migration, and the loser dies on a CREATE the winner
        // just committed — a red deploy, not a retry. The lock has to precede the table.
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const lock = pool.statements.findIndex((sql) => sql.includes('pg_advisory_lock'));
        const ledger = pool.statements.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations'));

        expect(lock).toBeGreaterThanOrEqual(0);
        expect(lock).toBeLessThan(ledger);
    });

    it('RESETS lock_timeout immediately, because the client goes back to a shared pool', async () => {
        // Left set, it silently shortens every later statement's lock wait on whoever checks this client out.
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const set = pool.statements.findIndex((sql) => sql.startsWith('SET lock_timeout'));
        const reset = pool.statements.findIndex((sql) => sql === 'RESET lock_timeout');

        expect(set).toBeGreaterThanOrEqual(0);
        expect(reset).toBeGreaterThan(set);
    });

    it('ROLLS BACK a failed migration and leaves its name unrecorded, so the next run retries it', async () => {
        // Fails on the FIRST migration on purpose, so "nothing committed, nothing recorded" is an assertion
        // about the failing migration rather than one accidentally satisfied by an earlier success.
        const pool = new FakePool({ failOn: ['CREATE TABLE a ();\n'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /Migration 0001_init failed/u,
        );

        expect(pool.statements).toContain('ROLLBACK');
        expect(pool.statements).not.toContain('COMMIT');
        expect(pool.statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toStrictEqual([]);
    });

    it('STOPS at the first failure instead of carrying on into later migrations', async () => {
        // ⛔ Migrations are ordered because later ones assume earlier ones landed. Continuing past a failure
        // applies a change to a schema that is not the one it was written against.
        const pool = new FakePool({ failOn: ['CREATE TABLE a ();\n'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow();

        expect(pool.statements).not.toContain('CREATE TABLE b ();\n');
    });

    it('RELEASES the advisory lock and the client even when a migration fails', async () => {
        // ⛔ A session advisory lock outlives the statement that took it, and `release()` returns the session
        // to the pool still holding it — deadlocking the very next runner. The unlock cannot live on the
        // happy path.
        const pool = new FakePool({ failOn: ['CREATE TABLE a ();\n'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow();

        expect(pool.statements).toContain('SELECT pg_advisory_unlock($1)');
        expect(pool.releases).toBe(1);
    });

    it('does NOT attempt to unlock when the lock was never taken', async () => {
        // Unlocking a lock this session does not hold is a warning and a lie in the log, and it would mask
        // the real failure (the lock timed out) behind a second, spurious one.
        const pool = new FakePool({ failOn: ['SELECT pg_advisory_lock($1)'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow();

        expect(pool.statements).not.toContain('SELECT pg_advisory_unlock($1)');
        expect(pool.releases).toBe(1);
    });
});

describe('applyMigrations — post-run validation', () => {
    it('throws when a discovered migration is not recorded afterwards', async () => {
        // Derived on both sides — the files it found against the ledger it wrote — so it cannot be satisfied
        // by a hardcoded list going stale.
        const pool = new FakePool();
        const dir = makeMigrationsDir(TWO_MIGRATIONS);
        // A ledger that silently forgets: the INSERT is accepted and the read-back reports nothing.
        const forgetful = new Proxy(pool, {
            get(target, property) {
                if (property !== 'connect') {
                    return Reflect.get(target, property) as unknown;
                }

                return async (): Promise<MigrationClient> => {
                    const client = await target.connect();

                    return {
                        release: client.release,
                        query: async <Row>(sql: string, values?: unknown[]) =>
                            sql.startsWith('SELECT name FROM schema_migrations')
                                ? ({ rows: [], rowCount: 0 } as MigrationQueryResult<Row>)
                                : client.query<Row>(sql, values),
                    };
                };
            },
        });

        await expect(applyMigrations(options(forgetful as unknown as FakePool, dir))).rejects.toThrow(
            /migrations not recorded: 0001_init, 0002_more/u,
        );
    });

    it('throws naming the tables the schema is missing after a clean apply', async () => {
        const pool = new FakePool({ presentTables: ['a'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /tables missing: b/u,
        );
    });

    it('refuses an EMPTY expected-tables list rather than validating nothing', async () => {
        // The table check is the only thing standing between "every migration is recorded" and "the schema
        // those migrations were supposed to produce actually exists". An empty list passes vacuously.
        const pool = new FakePool();

        await expect(
            applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS), { expectedTables: [] })),
        ).rejects.toThrow(/no expected tables/iu);
    });
});

describe('applyMigrations — the manifest expectation', () => {
    it('runs when the expectation matches the set it holds', async () => {
        const dir = makeMigrationsDir(TWO_MIGRATIONS);
        const pool = new FakePool();
        const result = await applyMigrations(options(pool, dir, { expectManifestSha: readMigrationManifest(dir).sha }));

        expect(result.applied).toStrictEqual(['0001_init', '0002_more']);
    });

    it('refuses a mismatch WITHOUT connecting, so a stale runner never takes the lock', async () => {
        // ⛔ Ordering is the assertion. A stale runner that connects and takes the advisory lock before
        // failing blocks the correct runner behind it for the whole lock timeout, turning a clear "wrong
        // bundle" failure into a slow, confusing one.
        const pool = new FakePool();

        await expect(
            applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS), { expectManifestSha: 'f'.repeat(64) })),
        ).rejects.toBeInstanceOf(SchemaManifestMismatchError);

        expect(pool.connections).toBe(0);
    });

    it('refuses an empty migration directory before connecting', async () => {
        // ⚠️ The expectation is supplied explicitly because the helper derives it from the directory, and an
        // empty one has no digest to derive — which is itself the point: `readMigrationManifest` refuses
        // BEFORE the expectation is even compared, so an empty bundle can never be certified by matching an
        // expectation computed the same way.
        const pool = new FakePool();
        const dir = makeMigrationsDir({ 'README.md': '# none\n' });

        await expect(
            applyMigrations({
                pool,
                migrationsDir: dir,
                label: 'test',
                expectedTables: ['a', 'b'],
                expectManifestSha: 'a'.repeat(64),
            }),
        ).rejects.toBeInstanceOf(EmptyMigrationSetError);

        expect(pool.connections).toBe(0);
    });

    it('⛔ REQUIRES the expectation at the TYPE level — an omitted one cannot compile', () => {
        // ADR-0035 rejects the optional form by name: "an optional expectation is one a caller forgets, and
        // a forgotten one is indistinguishable from the behaviour it replaces". It WAS optional here for one
        // release, because the in-stack `triggers.Trigger` sent a custom-resource payload carrying none —
        // and while that stood, the property the whole decision rests on was enforced by one argument check
        // in one shell script rather than by the runner.
        //
        // Asserted as a TYPE rather than a runtime case, because that is what the guarantee IS: a caller
        // that omits it does not fail at run time, it fails to build. If the field goes back to optional,
        // `ExpectationIsRequired` resolves to `false` and this line stops compiling.
        type ExpectationIsRequired = undefined extends ApplyMigrationsOptions['expectManifestSha'] ? false : true;
        const required: ExpectationIsRequired = true;

        expect(required).toBe(true);
    });
});
