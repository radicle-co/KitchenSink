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
 *
 * Changed by curated catalog plan U4a: the table policy now runs inside each migration's transaction, the ledger is
 * created and made read-only in one transaction, and the after-apply block is one transaction. The fake answers the
 * policy's table-existence query from the tables the run has created, so the policy cases see real statements.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type {
    ApplyMigrationsOptions,
    MigrationClient,
    MigrationPool,
    MigrationQueryResult,
    TablePolicy,
} from '../index.js';
import {
    DATABASE_ROLES,
    EmptyMigrationSetError,
    NO_TABLE_POLICY,
    databaseAclStatements,
    privilegesBeforeApply,
    isRoleModelAbsentError,
    isTablePolicySeederMismatchError,
    migrationLedgerReadOnly,
    OWNERSHIP_AUDIT_MARKER,
    SchemaManifestMismatchError,
    applyMigrations,
    readMigrationManifest,
} from '../index.js';

/** Scratch directories this file created, removed in `afterAll` so a FAILING test still cleans up. */
const scratchDirectories: string[] = [];

afterAll(() => {
    for (const directory of scratchDirectories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * A throwaway directory, registered for removal when this file's suites finish.
 *
 * @param prefix - The `mkdtemp` prefix, so a directory that does outlive a run names the suite that made it.
 * @returns The absolute path to the new directory.
 * @sideEffect Creates a directory under the OS temp directory.
 */
function scratchDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));

    scratchDirectories.push(directory);

    return directory;
}

/** A scratch migrations directory holding `files` (name → SQL body). */
function makeMigrationsDir(files: Readonly<Record<string, string>>): string {
    const dir = scratchDirectory('apply-migrations-');

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
    /** Rows the ownership audit's queries return — each one a violation. */
    readonly auditRows?: readonly { readonly problem: string }[];
    /** Rows the audit returns for a query about the seeder — each one a violation of its exact rights. */
    readonly seederAuditRows?: readonly { readonly problem: string }[];
    /** Tables `pg_class` reports beyond those the run created itself. */
    readonly existingTables?: readonly string[];
    /** Roles `pg_roles` should NOT hold; every other role asked about exists. */
    readonly absentRoles?: readonly string[];
}

/** A recording fake pool: every statement in order, plus how many connections were taken. */
class FakePool implements MigrationPool {
    public readonly statements: string[] = [];
    /** The bound values of each statement, by the statement's index. */
    public readonly values: (readonly unknown[] | undefined)[] = [];
    public connections = 0;
    public releases = 0;
    private readonly recorded: Set<string>;
    /** Tables a `CREATE TABLE` this run executed has made. */
    private readonly created = new Set<string>();
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
        this.values.push(values);

        if ((this.options.failOn ?? []).includes(sql)) {
            throw new Error(`fake refused: ${sql}`);
        }

        const createdTable = /^CREATE TABLE (?!IF NOT EXISTS)(\w+)/u.exec(sql)?.[1];

        if (createdTable !== undefined) {
            this.created.add(createdTable);
        }

        if (sql.startsWith(POLICY_TABLES_QUERY_PREFIX)) {
            const existing = new Set([...this.created, ...(this.options.existingTables ?? [])]);
            const rows = ((values?.[0] ?? []) as string[])
                .filter((table) => existing.has(table))
                .map((relname) => ({ relname })) as unknown as Row[];

            return { rows, rowCount: rows.length };
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

        if (sql.startsWith('SELECT rolname FROM pg_roles')) {
            const absent = this.options.absentRoles ?? [];
            const rows = ((values?.[0] ?? []) as string[])
                .filter((name) => !absent.includes(name))
                .map((rolname) => ({ rolname })) as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        if (sql.startsWith(OWNERSHIP_AUDIT_MARKER)) {
            const aboutSeeder = (values ?? []).includes(ROLES.seeder);
            const rows = [
                ...((aboutSeeder ? this.options.seederAuditRows : this.options.auditRows) ?? []),
            ] as unknown as Row[];

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
const ROLES = DATABASE_ROLES.food;

/** How the engine's table-existence query begins — the fake answers it from the tables the run created. */
const POLICY_TABLES_QUERY_PREFIX = '/* table-policy */';

/** Food-shaped: `a` is a catalog table and `b` the service-read-only one. */
const POLICY: TablePolicy = {
    catalog: new Set(['a']),
    serviceReadOnly: new Set(['b']),
    dictionaries: new Set(),
};

function options(pool: FakePool, migrationsDir: string, overrides: Record<string, unknown> = {}) {
    return {
        pool,
        migrationsDir,
        label: 'test',
        expectedTables: ['a', 'b'],
        expectManifestSha: readMigrationManifest(migrationsDir).sha,
        database: 'kitchensink_food',
        roles: ROLES,
        tablePolicy: POLICY,
        ...overrides,
    };
}

describe('applyMigrations — the role model must exist first (curated plan U18)', () => {
    it('⛔ refuses a database with no seeder role before any lock, SET ROLE, GRANT or REVOKE', async () => {
        const pool = new FakePool({ absentRoles: ['food_seeder'] });
        const outcome = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS))).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isRoleModelAbsentError(outcome)).toBe(true);
        expect(
            pool.statements.filter((sql) => /advisory_lock|^SET ROLE|^GRANT|^REVOKE|lock_timeout/u.test(sql)),
        ).toStrictEqual([]);
        expect(pool.releases).toBe(pool.connections);
    });
});

describe('applyMigrations — the apply loop', () => {
    it('applies unapplied migrations in filename order and skips recorded ones', async () => {
        // `a` exists already: the recorded migration created it on an earlier run.
        const pool = new FakePool({ recorded: ['0001_init'], existingTables: ['a'] });
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

        // The ledger's own creation commits first (U4a); nothing after the failing migration does.
        const failed = pool.statements.indexOf('CREATE TABLE a ();\n');

        expect(pool.statements.slice(failed)).toContain('ROLLBACK');
        expect(pool.statements.slice(failed)).not.toContain('COMMIT');
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

    it('⛔ RELEASES the client even when a CLEANUP statement fails, so the pool cannot leak a connection', async () => {
        // ⛔ The cleanup ran three statements in sequence with nothing between them. A `RESET ROLE` that
        // rejects — a connection reset, a backend termination, exactly the conditions a failing migration
        // run is already in — skipped BOTH the advisory unlock and `client.release()`. The lock then
        // outlives the session for as long as the backend does, the connection never returns to the pool,
        // and `pool.end()` hangs behind it. The step most likely to fail took the other two down with it.
        // ⚠️ And it RESOLVES: the migrations applied, so a stumble while tidying up the connection must not
        // report the run as failed. Reporting failure here would red a deploy whose schema DID move and
        // invite a re-run of work already done.
        const pool = new FakePool({ failOn: ['RESET ROLE'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).resolves.toMatchObject({
            applied: ['0001_init', '0002_more'],
        });

        expect(pool.statements).toContain('SELECT pg_advisory_unlock($1)');
        expect(pool.releases).toBe(1);
    });

    it('⛔ propagates the REAL failure, not the cleanup failure that happened while unwinding from it', async () => {
        // A throw from the `finally` REPLACES the in-flight exception, so the migration error that caused
        // the unwind is destroyed and the operator is shown a `RESET ROLE` failure instead — the one error
        // that explains nothing about why the deploy stopped.
        const pool = new FakePool({ failOn: ['CREATE TABLE a ();\n', 'RESET ROLE'] });

        const thrown = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS))).catch(
            (error: unknown) => error,
        );

        // The migration that actually stopped the deploy — named — and NOT the cleanup statement that
        // failed afterwards while unwinding from it.
        expect((thrown as Error).message).toMatch(/0001_init/);
        expect((thrown as Error).message).not.toMatch(/RESET ROLE/);
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
                database: 'kitchensink_food',
                roles: ROLES,
                tablePolicy: POLICY,
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

/**
 * The role split (`docs/plans/2026-09-11-database-role-split.md`): the runner connects as `<svc>_migrator` and does
 * every DDL statement AS the owner, so everything a migration creates is owned by `<svc>_owner` and the service
 * role gets data privileges only. The ORDER is the contract — these tests pin it against the statement log.
 */
describe('applyMigrations — acting as the owner role', () => {
    const indexOf = (pool: FakePool, predicate: (sql: string) => boolean): number =>
        pool.statements.findIndex(predicate);

    it('SETs ROLE to the owner after taking the lock and before anything is created', async () => {
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const lock = indexOf(pool, (sql) => sql.startsWith('SELECT pg_advisory_lock'));
        const setRole = indexOf(pool, (sql) => sql === 'SET ROLE "food_owner"');
        const ledger = indexOf(pool, (sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'));

        expect(lock).toBeGreaterThan(-1);
        expect(setRole).toBeGreaterThan(lock);
        expect(ledger).toBeGreaterThan(setRole);
    });

    it('applies the before-privileges ahead of the ledger and the after-privileges once the migrations ran', async () => {
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        // The ACL's text is pinned in `privilegeStatements.test.ts`; this case is about its position.
        const [aclReset] = databaseAclStatements(ROLES, 'kitchensink_food');
        const revoke = indexOf(pool, (sql) => sql === aclReset);
        const ledger = indexOf(pool, (sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'));
        const lastMigration = indexOf(pool, (sql) => sql === 'CREATE TABLE b ();\n');
        const grantAll = indexOf(pool, (sql) => sql.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES'));

        expect(revoke).toBeGreaterThan(-1);
        expect(revoke).toBeLessThan(ledger);
        expect(grantAll).toBeGreaterThan(lastMigration);
    });

    it('issues the before-privileges in one transaction, so a dropped connection cannot leave the ACL half reset', async () => {
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const before = privilegesBeforeApply(ROLES, 'kitchensink_food');
        const first = indexOf(pool, (sql) => sql === before[0]);
        const last = indexOf(pool, (sql) => sql === before[before.length - 1]);

        expect(first).toBeGreaterThan(-1);
        expect(pool.statements[first - 1]).toBe('BEGIN');
        expect(pool.statements.slice(first, last + 1)).toStrictEqual([...before]);
        expect(pool.statements[last + 1]).toBe('COMMIT');
    });

    it('rolls the before-privileges back when one of them fails, and runs no migration', async () => {
        const [revoke, grantConnect] = databaseAclStatements(ROLES, 'kitchensink_food');
        const pool = new FakePool({ failOn: [grantConnect ?? ''] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow();

        const revoked = indexOf(pool, (sql) => sql === revoke);

        expect(pool.statements[revoked - 1]).toBe('BEGIN');
        expect(pool.statements[revoked + 2]).toBe('ROLLBACK');
        expect(pool.statements).not.toContain('CREATE TABLE b ();\n');
    });

    it('RESETs the role before releasing the lock, even when a migration fails', async () => {
        // The client goes back to a pool: a session left as the owner would run every later statement with DDL.
        const pool = new FakePool({ failOn: ['CREATE TABLE b ();\n'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow();

        const reset = indexOf(pool, (sql) => sql === 'RESET ROLE');
        const unlock = indexOf(pool, (sql) => sql.startsWith('SELECT pg_advisory_unlock'));

        expect(reset).toBeGreaterThan(-1);
        expect(unlock).toBeGreaterThan(reset);
    });

    it('fails validation, naming each problem, when the ownership audit finds a violation', async () => {
        const pool = new FakePool({ auditRows: [{ problem: 'table a is owned by food_migrator, not food_owner' }] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /owned by food_migrator, not food_owner/u,
        );
    });

    it('refuses a database name it could not quote, before taking a connection', async () => {
        const pool = new FakePool();

        await expect(
            applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS), { database: 'x"; DROP DATABASE y; --' })),
        ).rejects.toThrow(/database name/u);
        expect(pool.connections).toBe(0);
    });
});

/**
 * The table policy (curated catalog plan U4a, blueprint §5). `ALTER DEFAULT PRIVILEGES` hands the service role DML on
 * every table a migration creates, and the blanket after-apply grant hands it DML on every table that exists. A
 * read-only table — the seed ledger — must never be seen in that state: KTD-12's trigger treats a holder of INSERT on
 * the ledger as the seeder. So the policy runs inside each migration's own transaction, and the after-apply block is
 * one transaction.
 */
describe('applyMigrations — the table policy runs inside the transactions that create the tables', () => {
    const indexOf = (pool: FakePool, predicate: (sql: string) => boolean, from = 0): number => {
        const found = pool.statements.slice(from).findIndex(predicate);

        return found === -1 ? -1 : found + from;
    };

    it('⛔ refuses a policy that does not fit the roles, before connecting', async () => {
        const pool = new FakePool();
        const outcome = await applyMigrations(
            options(pool, makeMigrationsDir(TWO_MIGRATIONS), { tablePolicy: NO_TABLE_POLICY }),
        ).catch((error: unknown) => error);

        expect(isTablePolicySeederMismatchError(outcome)).toBe(true);
        expect(pool.connections).toBe(0);
    });

    it('⛔ resets a read-only table between the migration that creates it and that migration’s COMMIT', async () => {
        const pool = new FakePool();
        const readOnlyOnly: TablePolicy = { ...POLICY, catalog: new Set() };

        await applyMigrations(
            options(pool, makeMigrationsDir({ '0001_b.sql': 'CREATE TABLE b ();\n' }), {
                expectedTables: ['b'],
                tablePolicy: readOnlyOnly,
            }),
        );

        const create = indexOf(pool, (sql) => sql === 'CREATE TABLE b ();\n');
        const revoke = indexOf(pool, (sql) => sql === 'REVOKE ALL ON TABLE "b" FROM PUBLIC, "food_app"');
        const grant = indexOf(pool, (sql) => sql === 'GRANT SELECT ON TABLE "b" TO "food_app"');
        const commit = indexOf(pool, (sql) => sql === 'COMMIT', create);

        expect(create).toBeGreaterThan(-1);
        expect(revoke).toBeGreaterThan(create);
        expect(grant).toBeGreaterThan(revoke);
        expect(commit).toBeGreaterThan(grant);
        expect(pool.statements.slice(create, commit)).not.toContain('BEGIN');
    });

    it('asks only for the policy’s own tables, inside the transaction, and grants only those that exist', async () => {
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const firstCreate = indexOf(pool, (sql) => sql === 'CREATE TABLE a ();\n');
        const ask = indexOf(pool, (sql) => sql.startsWith(POLICY_TABLES_QUERY_PREFIX), firstCreate);
        const firstCommit = indexOf(pool, (sql) => sql === 'COMMIT', firstCreate);

        expect(ask).toBeGreaterThan(firstCreate);
        expect(ask).toBeLessThan(firstCommit);
        expect(pool.values[ask]).toStrictEqual([['a', 'b']]);
        // After 0001 only `a` exists, so its transaction names `a` alone.
        expect(pool.statements.slice(firstCreate, firstCommit).filter((sql) => sql.includes('ON TABLE'))).toStrictEqual(
            [
                'REVOKE ALL ON TABLE "a" FROM PUBLIC, "food_seeder"',
                'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "a" TO "food_seeder"',
            ],
        );
    });

    it('⛔ a later migration that fails leaves the earlier one’s policy committed and never reaches the blanket grant', async () => {
        const pool = new FakePool({ failOn: ['CREATE TABLE a2 ();\n'] });
        const dir = makeMigrationsDir({ '0001_b.sql': 'CREATE TABLE b ();\n', '0002_a2.sql': 'CREATE TABLE a2 ();\n' });

        await expect(applyMigrations(options(pool, dir))).rejects.toThrow(/Migration 0002_a2 failed/u);

        const revoke = indexOf(pool, (sql) => sql === 'REVOKE ALL ON TABLE "b" FROM PUBLIC, "food_app"');
        const firstCommit = indexOf(
            pool,
            (sql) => sql === 'COMMIT',
            indexOf(pool, (sql) => sql === 'CREATE TABLE b ();\n'),
        );

        expect(revoke).toBeGreaterThan(-1);
        expect(revoke).toBeLessThan(firstCommit);
        expect(pool.statements.filter((sql) => sql.includes('ON ALL TABLES'))).toStrictEqual([]);
    });

    it('issues no policy query and no table statement for a database with no seeder', async () => {
        const pool = new FakePool();

        await applyMigrations(
            options(pool, makeMigrationsDir(TWO_MIGRATIONS), {
                roles: DATABASE_ROLES.identity,
                database: 'kitchensink_identity',
                tablePolicy: NO_TABLE_POLICY,
            }),
        );

        expect(pool.statements.filter((sql) => sql.startsWith(POLICY_TABLES_QUERY_PREFIX))).toStrictEqual([]);
        expect(pool.statements.filter((sql) => sql.includes(' ON TABLE '))).toStrictEqual([]);
    });

    it('⛔ creates the migration ledger and makes it read-only in ONE transaction', async () => {
        // The grant-on-create hook gives the service role DML on the ledger the moment it is created; on a fresh
        // database a migration that then failed would leave that DML in place until the next good run.
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const create = indexOf(pool, (sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'));

        expect(pool.statements.slice(create - 1, create + 3)).toStrictEqual([
            'BEGIN',
            pool.statements[create],
            migrationLedgerReadOnly(ROLES),
            'COMMIT',
        ]);
    });

    it('⛔ runs the after-apply block as ONE transaction, from the blanket grant to the last policy statement', async () => {
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const blanket = indexOf(pool, (sql) => sql.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES'));
        const begin = pool.statements.lastIndexOf('BEGIN', blanket);
        const lastPolicy = pool.statements.lastIndexOf('GRANT SELECT ON TABLE "b" TO "food_app"');
        const commit = indexOf(pool, (sql) => sql === 'COMMIT', blanket);

        // The block opens with its check that every policy table exists, then the blanket grant.
        expect(pool.statements.slice(begin + 1, blanket).map((sql) => sql.split('\n')[0])).toStrictEqual([
            POLICY_TABLES_QUERY_PREFIX,
        ]);
        expect(lastPolicy).toBeGreaterThan(blanket);
        expect(commit).toBeGreaterThan(lastPolicy);
        expect(pool.statements.slice(blanket, commit)).not.toContain('COMMIT');
    });

    it('⛔ ROLLS BACK the after-apply block when a statement in it fails, then resets the role, unlocks and releases', async () => {
        // Without the ROLLBACK the `finally` would run RESET ROLE and the unlock inside an aborted transaction: both
        // fail, both are swallowed, and the session goes back to the pool still holding the lock.
        const failing = 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "food_app"';
        const pool = new FakePool({ failOn: [failing] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /fake refused/u,
        );

        const failed = pool.statements.indexOf(failing);
        const rollback = indexOf(pool, (sql) => sql === 'ROLLBACK', failed);
        const reset = indexOf(pool, (sql) => sql === 'RESET ROLE', failed);
        const unlock = indexOf(pool, (sql) => sql.startsWith('SELECT pg_advisory_unlock'), failed);

        expect(rollback).toBe(failed + 1);
        expect(reset).toBeGreaterThan(rollback);
        expect(unlock).toBeGreaterThan(reset);
        expect(pool.statements.slice(failed)).not.toContain('COMMIT');
        expect(pool.releases).toBe(1);
    });

    it('⛔ refuses a policy table that no migration created, inside the after-apply transaction and before any grant', async () => {
        const pool = new FakePool();
        const withGhost: TablePolicy = { ...POLICY, catalog: new Set(['a', 'ghost']) };

        await expect(
            applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS), { tablePolicy: withGhost })),
        ).rejects.toThrow(/table policy names tables that do not exist: ghost/u);

        expect(pool.statements.filter((sql) => sql.includes('ON ALL TABLES'))).toStrictEqual([]);
        expect(pool.statements.at(-3)).toBe('ROLLBACK');
    });

    it('fails validation, naming each problem, when the seeder holds more or less than its rights', async () => {
        const pool = new FakePool({ seederAuditRows: [{ problem: 'the seeder food_seeder holds UPDATE on table b' }] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /seeder privileges:\n {2}- the seeder food_seeder holds UPDATE on table b/u,
        );
    });

    it('⛔ REQUIRES the policy at the TYPE level — an omitted one cannot compile', () => {
        // The plan's reason for the required expectation applies here too: a policy a caller can forget is one a food
        // migrate forgets, and the seed then finds out at its first write.
        type PolicyIsRequired = undefined extends ApplyMigrationsOptions['tablePolicy'] ? false : true;
        const required: PolicyIsRequired = true;

        expect(required).toBe(true);
    });
});
