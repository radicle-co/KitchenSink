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
 *
 * Changed when the migration lock moved into `withSessionAdvisoryLock` and table existence moved to one catalog query:
 * the post-run table check now asks the same `pg_class` query as the policy, so the fake answers both from the tables
 * the run created plus `existingTables`, and a lock refusal can carry a SQLSTATE.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type {
    ApplyMigrationsOptions,
    DatabaseAclRow,
    DatabaseRightsUnmetError,
    LoginRightsRow,
    MigrationClient,
    MigrationPool,
    SessionLockTimeoutError,
    TablePolicy,
} from '../index.js';
import {
    DATABASE_RIGHTS_MARKER,
    DATABASE_ROLES,
    DEFAULT_PRIVILEGES_AUDIT_MARKER,
    EmptyMigrationSetError,
    NO_TABLE_POLICY,
    databaseAclStatements,
    privilegesAfterApply,
    privilegesBeforeApply,
    isDatabaseRightsUnmetError,
    isRoleModelAbsentError,
    isSessionLockTimeoutError,
    isTablePolicySeederMismatchError,
    migrationLedgerReadOnly,
    OWNERSHIP_AUDIT_MARKER,
    SEED_WRITER_PREMISE_MARKER,
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
    /** SQL bodies that must fail when executed. */
    readonly failOn?: readonly string[];
    /** SQL bodies that must fail with a given error, such as one carrying a SQLSTATE. */
    readonly failWith?: Readonly<Record<string, Error>>;
    /** Rows the ownership audit's queries return — each one a violation. */
    readonly auditRows?: readonly { readonly problem: string }[];
    /** Rows the audit returns for a query about the seeder — each one a violation of its exact rights. */
    readonly seederAuditRows?: readonly { readonly problem: string }[];
    /** Rows the seed-writer premise's queries return — each one a premise of KTD-12's trigger that does not hold. */
    readonly premiseRows?: readonly { readonly problem: string }[];
    /** Rows the default-privileges audit returns — each one an entry the grant-on-create hook does not account for. */
    readonly defaultAclRows?: readonly { readonly problem: string }[];
    /** Tables `pg_class` reports beyond those the run created itself. */
    readonly existingTables?: readonly string[];
    /** Roles `pg_roles` should NOT hold; every other role asked about exists. */
    readonly absentRoles?: readonly string[];
    /** Changes to what the database-rights re-read finds; by default every right holds. */
    readonly databaseRights?: {
        readonly database?: Partial<DatabaseAclRow>;
        readonly logins?: Readonly<Record<string, Partial<LoginRightsRow>>>;
    };
}

/** What the fake answers: rows, and the row count `pg` would report, which the engine must not need. */
interface FakeResult<Row> {
    readonly rows: Row[];
    readonly rowCount: number;
}

/** A PostgreSQL error as `pg` raises it: a message and a SQLSTATE. */
function pgError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
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
            query: async <Row>(sql: string, values?: unknown[]): Promise<FakeResult<Row>> =>
                this.answer<Row>(sql, values),
            release: (): void => {
                this.releases += 1;
            },
        };
    }

    private async answer<Row>(sql: string, values?: unknown[]): Promise<FakeResult<Row>> {
        this.statements.push(sql);
        this.values.push(values);

        const failure = this.options.failWith?.[sql];

        if (failure !== undefined) {
            throw failure;
        }

        if ((this.options.failOn ?? []).includes(sql)) {
            throw new Error(`fake refused: ${sql}`);
        }

        const createdTable = /^CREATE TABLE (?!IF NOT EXISTS)(\w+)/u.exec(sql)?.[1];

        if (createdTable !== undefined) {
            this.created.add(createdTable);
        }

        if (sql.startsWith(TABLES_PRESENT_QUERY_PREFIX)) {
            const existing = new Set([...this.created, ...(this.options.existingTables ?? [])]);
            const rows = ((values?.[0] ?? []) as string[])
                .filter((table) => existing.has(table))
                .map((relname) => ({ relname })) as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        if (sql.startsWith('SELECT 1 FROM schema_migrations')) {
            const rows = (this.recorded.has(String(values?.[0])) ? [{}] : []) as unknown as Row[];

            return { rows, rowCount: rows.length };
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

        if (sql.startsWith(DATABASE_RIGHTS_MARKER)) {
            const rows = (values?.length === 1
                ? [this.databaseRow(String(values[0]))]
                : this.loginRows(values?.[1])) as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        if (sql.startsWith(DEFAULT_PRIVILEGES_AUDIT_MARKER)) {
            const rows = [...(this.options.defaultAclRows ?? [])] as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        if (sql.startsWith(SEED_WRITER_PREMISE_MARKER)) {
            const rows = [...(this.options.premiseRows ?? [])] as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        if (sql.startsWith(OWNERSHIP_AUDIT_MARKER)) {
            const aboutSeeder = (values ?? []).includes(ROLES.seeder);
            const rows = [
                ...((aboutSeeder ? this.options.seederAuditRows : this.options.auditRows) ?? []),
            ] as unknown as Row[];

            return { rows, rowCount: rows.length };
        }

        return { rows: [], rowCount: 0 };
    }

    /** The database's row: owned by its service's owner role (`kitchensink_<svc>` → `<svc>_owner`), PUBLIC closed. */
    private databaseRow(database: string): DatabaseAclRow {
        const service = database.replace(/^kitchensink_/u, '');

        return {
            owner: `${service}_owner`,
            connectionLimit: -1,
            publicConnect: false,
            ...this.options.databaseRights?.database,
        };
    }

    /** One healthy row per login role asked about: the migrator inherits the owner's rights, the seeder holds TEMPORARY. */
    private loginRows(asked: unknown): LoginRightsRow[] {
        return (asked as string[]).map((role) => ({
            role,
            connect: true,
            create: role.endsWith('_migrator'),
            temporary: role.endsWith('_migrator') || role.endsWith('_seeder'),
            explicitCreate: false,
            explicitTemporary: role.endsWith('_seeder'),
            ...this.options.databaseRights?.logins?.[role],
        }));
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
const TABLES_PRESENT_QUERY_PREFIX = '/* tables-present */';

/** Food-shaped: `a` is a catalog table and `b` the service-read-only one. */
const POLICY: TablePolicy = {
    catalog: new Set(['a']),
    serviceReadOnly: new Set(['b']),
    dictionaries: new Set(),
};

/**
 * Where the block after the last migration issues its blanket grant: the LAST one in the log, since each migration's
 * own transaction issues one too (see "each migration commits in the after-apply state").
 *
 * @param pool - The fake, after a run.
 * @returns The statement's index, or -1.
 */
function finalBlanketGrant(pool: FakePool): number {
    for (let index = pool.statements.length - 1; index >= 0; index -= 1) {
        if (pool.statements[index]?.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES')) {
            return index;
        }
    }

    return -1;
}

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

/**
 * The ACL reset, re-read (curated catalog plan U3). The runner resets the database ACL of every database it migrates,
 * and a per-PR food database is one the platform bootstrap never sees, so the runner is the only thing that can prove
 * the reset left each login role exactly its rights. The same policy as the bootstrap's (`roles/loginRights.ts`).
 */
describe('applyMigrations — the database rights are re-read after the ACL reset', () => {
    const indexOf = (pool: FakePool, predicate: (sql: string) => boolean): number =>
        pool.statements.findIndex(predicate);

    it('re-reads them after the reset commits and before the ledger or any migration', async () => {
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const before = privilegesBeforeApply(ROLES, 'kitchensink_food');
        const resetCommit = indexOf(pool, (sql) => sql === before[before.length - 1]) + 1;
        const reads = pool.statements.flatMap((sql, index) => (sql.startsWith(DATABASE_RIGHTS_MARKER) ? [index] : []));
        const ledger = indexOf(pool, (sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'));

        expect(pool.statements[resetCommit]).toBe('COMMIT');
        expect(reads).toHaveLength(2);
        expect(Math.min(...reads)).toBeGreaterThan(resetCommit);
        expect(Math.max(...reads)).toBeLessThan(ledger);
        expect(pool.values[reads[0] ?? -1]).toStrictEqual(['kitchensink_food']);
    });

    it.each<[string, FakeOptions['databaseRights'], RegExp]>([
        [
            'a seeder left without its TEMPORARY grant',
            { logins: { food_seeder: { explicitTemporary: false } } },
            /food_seeder lacks its explicit TEMPORARY grant on kitchensink_food/u,
        ],
        [
            'a service role holding CREATE',
            { logins: { food_app: { create: true } } },
            /food_app holds CREATE on kitchensink_food/u,
        ],
        [
            'a database another role owns',
            { database: { owner: 'food_migrator' } },
            /kitchensink_food is owned by food_migrator, not food_owner/u,
        ],
    ])('⛔ refuses %s, runs no migration, and still resets, unlocks and releases', async (_case, rights, message) => {
        const pool = new FakePool({ databaseRights: rights });
        const outcome = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS))).catch(
            (error: unknown) => error,
        );

        expect(isDatabaseRightsUnmetError(outcome)).toBe(true);
        expect((outcome as Error).message).toMatch(message);
        expect((outcome as DatabaseRightsUnmetError).database).toBe('kitchensink_food');
        expect(pool.statements.filter((sql) => sql.startsWith('CREATE TABLE'))).toStrictEqual([]);
        expect(pool.statements).toContain('RESET ROLE');
        expect(pool.statements.some((sql) => sql.startsWith('SELECT pg_advisory_unlock'))).toBe(true);
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

    it('⛔ propagates the migration’s own failure when its ROLLBACK fails too', async () => {
        // A ROLLBACK can only fail on a connection that is already broken, which is when the operator most needs the
        // statement that broke it. An awaited ROLLBACK that throws replaces the error being unwound.
        const pool = new FakePool({ failOn: ['CREATE TABLE a ();\n', 'ROLLBACK'] });

        const thrown = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS))).catch(
            (error: unknown) => error,
        );

        expect((thrown as Error).message).toMatch(/Migration 0001_init failed/u);
        expect(String((thrown as Error).cause)).toContain('fake refused: CREATE TABLE a ();');
        expect(pool.statements).toContain('ROLLBACK');
        expect(pool.releases).toBe(1);
    });

    it('⛔ propagates the after-apply block’s own failure when its ROLLBACK fails too', async () => {
        // Nothing to apply, so the statement fails in the after-apply block and not in a migration's own transaction.
        const failing = 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "food_app"';
        const pool = new FakePool({
            failOn: [failing, 'ROLLBACK'],
            recorded: ['0001_init', '0002_more'],
            existingTables: ['a', 'b'],
        });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            `fake refused: ${failing}`,
        );
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

    it('⛔ reports the lock’s own failure when the reset after it fails too', async () => {
        // The reset runs on a connection the failed lock may have broken. Thrown from a `finally`, its error replaced
        // the lock's, and the deploy log named `RESET lock_timeout` instead of the lock it could not take.
        const pool = new FakePool({ failOn: ['SELECT pg_advisory_lock($1)', 'RESET lock_timeout'] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            'fake refused: SELECT pg_advisory_lock($1)',
        );
        expect(pool.releases).toBe(1);
    });

    it('⛔ turns an exhausted lock wait into the typed timeout naming the migration lock, and migrates nothing', async () => {
        const timeout = pgError('canceling statement due to lock timeout', '55P03');
        const pool = new FakePool({ failWith: { 'SELECT pg_advisory_lock($1)': timeout } });

        const thrown = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS))).catch(
            (error: unknown) => error,
        );

        expect(isSessionLockTimeoutError(thrown)).toBe(true);
        expect((thrown as SessionLockTimeoutError).lock).toStrictEqual({ reserved: 'schemaMigration' });
        expect((thrown as SessionLockTimeoutError).cause).toBe(timeout);
        expect(pool.statements.filter((sql) => /^CREATE TABLE|^SET ROLE/u.test(sql))).toStrictEqual([]);
        expect(pool.releases).toBe(1);
    });

    it('⛔ binds the migration lock to the key text earlier releases bound, so old and new runners still exclude', async () => {
        // A rolling deploy runs the previous release's runner beside this one. They serialize only if both send the
        // same key, and the previous release bound the string '7412200228220022'.
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const lock = pool.statements.indexOf('SELECT pg_advisory_lock($1)');
        const unlock = pool.statements.indexOf('SELECT pg_advisory_unlock($1)');

        expect((pool.values[lock] ?? []).map(String)).toStrictEqual(['7412200228220022']);
        expect((pool.values[unlock] ?? []).map(String)).toStrictEqual(['7412200228220022']);
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
                                ? { rows: [] as Row[] }
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
        // The only table the run made is `a`, and the catalog holds nothing else; no policy table is involved, so the
        // post-run check is the one that must notice `b`.
        const pool = new FakePool();
        const dir = makeMigrationsDir({ '0001_init.sql': 'CREATE TABLE a ();\n' });

        await expect(
            applyMigrations(
                options(pool, dir, {
                    roles: DATABASE_ROLES.identity,
                    database: 'kitchensink_identity',
                    tablePolicy: NO_TABLE_POLICY,
                }),
            ),
        ).rejects.toThrow(/tables missing: b/u);
    });

    it('reads table existence from the one catalog query the policy reads, never from information_schema', async () => {
        // `information_schema.tables` lists only what the current role holds a privilege on, so two queries could
        // disagree about one table. Asked of `pg_class`, the policy and the post-run check see the same catalog.
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const asks = pool.statements.flatMap((sql, index) =>
            sql.startsWith(TABLES_PRESENT_QUERY_PREFIX) ? [pool.values[index]] : [],
        );

        expect(pool.statements.filter((sql) => sql.includes('information_schema'))).toStrictEqual([]);
        expect(asks.at(-1)).toStrictEqual([['a', 'b']]);
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
        const grantAll = finalBlanketGrant(pool);

        expect(revoke).toBeGreaterThan(-1);
        expect(revoke).toBeLessThan(ledger);
        expect(grantAll).toBeGreaterThan(pool.statements.indexOf('COMMIT', lastMigration));
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
        // Nothing to apply, so the check that fails is the one ahead of the after-apply block; each migration's own
        // check is "checks ownership inside the migration" below.
        const pool = new FakePool({
            auditRows: [{ problem: 'table a is owned by food_migrator, not food_owner' }],
            recorded: ['0001_init', '0002_more'],
            existingTables: ['a', 'b'],
        });

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
        const ask = indexOf(pool, (sql) => sql.startsWith(TABLES_PRESENT_QUERY_PREFIX), firstCreate);
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

    it('⛔ a later migration that fails leaves the earlier one’s policy committed and never reaches the final block', async () => {
        // Rewritten when each migration's own transaction began issuing the blanket grant, which made "no blanket grant
        // at all" false. What must hold: the earlier migration commits with its read-only table reset, and nothing runs
        // after the failing migration's ROLLBACK.
        const pool = new FakePool({ failOn: ['CREATE TABLE a2 ();\n'] });
        const dir = makeMigrationsDir({ '0001_b.sql': 'CREATE TABLE b ();\n', '0002_a2.sql': 'CREATE TABLE a2 ();\n' });

        await expect(applyMigrations(options(pool, dir))).rejects.toThrow(/Migration 0002_a2 failed/u);

        const revoke = indexOf(pool, (sql) => sql === 'REVOKE ALL ON TABLE "b" FROM PUBLIC, "food_app"');
        const firstCommit = indexOf(
            pool,
            (sql) => sql === 'COMMIT',
            indexOf(pool, (sql) => sql === 'CREATE TABLE b ();\n'),
        );
        const rollback = indexOf(pool, (sql) => sql === 'ROLLBACK', pool.statements.indexOf('CREATE TABLE a2 ();\n'));

        expect(revoke).toBeGreaterThan(-1);
        expect(revoke).toBeLessThan(firstCommit);
        expect(pool.statements.slice(rollback).filter((sql) => /^(GRANT|REVOKE)/u.test(sql))).toStrictEqual([]);
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

        // The post-run check asks the existence query about the expected tables; the policy, naming none, asks nothing.
        const asks = pool.statements.flatMap((sql, index) =>
            sql.startsWith(TABLES_PRESENT_QUERY_PREFIX) ? [pool.values[index]] : [],
        );

        expect(asks).toStrictEqual([[['a', 'b']]]);
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

        const blanket = finalBlanketGrant(pool);
        const begin = pool.statements.lastIndexOf('BEGIN', blanket);
        const lastPolicy = pool.statements.lastIndexOf('GRANT SELECT ON TABLE "b" TO "food_app"');
        const commit = indexOf(pool, (sql) => sql === 'COMMIT', blanket);

        // The block opens with its check that every policy table exists, then the blanket grant.
        expect(pool.statements.slice(begin + 1, blanket).map((sql) => sql.split('\n')[0])).toStrictEqual([
            TABLES_PRESENT_QUERY_PREFIX,
        ]);
        expect(lastPolicy).toBeGreaterThan(blanket);
        expect(commit).toBeGreaterThan(lastPolicy);
        expect(pool.statements.slice(blanket, commit)).not.toContain('COMMIT');
    });

    it('⛔ ROLLS BACK the after-apply block when a statement in it fails, then resets the role, unlocks and releases', async () => {
        // Without the ROLLBACK the `finally` would run RESET ROLE and the unlock inside an aborted transaction: both
        // fail, both are swallowed, and the session goes back to the pool still holding the lock.
        // Nothing to apply, so the statement fails in the after-apply block and not in a migration's own transaction.
        const failing = 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "food_app"';
        const pool = new FakePool({
            failOn: [failing],
            recorded: ['0001_init', '0002_more'],
            existingTables: ['a', 'b'],
        });

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

        // Each migration's own transaction issued its grants for the tables it had; the final block issued none.
        const lastMigrationCommit = pool.statements.indexOf('COMMIT', pool.statements.indexOf('CREATE TABLE b ();\n'));

        expect(
            pool.statements.slice(lastMigrationCommit + 1).filter((sql) => sql.includes('ON ALL TABLES')),
        ).toStrictEqual([]);
        expect(pool.statements.at(-3)).toBe('ROLLBACK');
    });

    it('fails validation, naming each problem, when the seeder holds more or less than its rights', async () => {
        const pool = new FakePool({ seederAuditRows: [{ problem: 'the seeder food_seeder holds UPDATE on table b' }] });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /seeder privileges:\n {2}- the seeder food_seeder holds UPDATE on table b/u,
        );
    });

    it('⛔ fails validation, naming each problem, when a premise of the seed trigger does not hold', async () => {
        const pool = new FakePool({
            premiseRows: [
                { problem: 'the login food_other can INSERT into b, which only the seeder food_seeder may write' },
                { problem: 'the seeder food_seeder is a member of the owner food_owner' },
            ],
        });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /seed writer premise:\n {2}- the login food_other can INSERT into b[^\n]*\n {2}- the seeder food_seeder is a member/u,
        );
    });

    it('⛔ re-reads the premise on a run that applies nothing, asking about the service-read-only tables', async () => {
        // The premise is a fact about roles, which change outside any migration: a run with nothing to apply is
        // the run that must still notice a third login granted INSERT on the ledger since the last one.
        const pool = new FakePool({ recorded: ['0001_init', '0002_more'], existingTables: ['a', 'b'] });

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const asked = pool.statements
            .map((sql, index) => ({ sql, values: pool.values[index] }))
            .filter(({ sql }) => sql.startsWith(SEED_WRITER_PREMISE_MARKER));

        expect(asked.length).toBeGreaterThan(0);
        expect(asked.some(({ values }) => JSON.stringify(values).includes('["b"]'))).toBe(true);
        expect(asked.every(({ values }) => (values ?? []).includes(ROLES.seeder))).toBe(true);
    });

    it('issues no premise query for a database with no seeder', async () => {
        const pool = new FakePool();

        await applyMigrations(
            options(pool, makeMigrationsDir(TWO_MIGRATIONS), {
                roles: DATABASE_ROLES.identity,
                database: 'kitchensink_identity',
                tablePolicy: NO_TABLE_POLICY,
            }),
        );

        expect(pool.statements.filter((sql) => sql.startsWith(SEED_WRITER_PREMISE_MARKER))).toStrictEqual([]);
    });

    it('⛔ REQUIRES the policy at the TYPE level — an omitted one cannot compile', () => {
        // The plan's reason for the required expectation applies here too: a policy a caller can forget is one a food
        // migrate forgets, and the seed then finds out at its first write.
        type PolicyIsRequired = undefined extends ApplyMigrationsOptions['tablePolicy'] ? false : true;
        const required: PolicyIsRequired = true;

        expect(required).toBe(true);
    });
});

/**
 * Each migration's transaction ends in the after-apply state for the tables that exist by then (curated catalog plan
 * U4a). A stray grant or default privilege a migration adds is reset or refused before that migration commits, so it
 * never outlives a later migration that fails.
 */
describe('applyMigrations — each migration commits in the after-apply state', () => {
    /** The statements of the transaction that applied `body`: from its BEGIN to its COMMIT or ROLLBACK. */
    const transactionOf = (pool: FakePool, body: string): readonly string[] => {
        const at = pool.statements.indexOf(body);
        const begin = pool.statements.lastIndexOf('BEGIN', at);
        const end = pool.statements.findIndex((sql, index) => index > at && (sql === 'COMMIT' || sql === 'ROLLBACK'));

        return pool.statements.slice(begin, end + 1);
    };

    it('⛔ issues the after-apply statements for the tables that exist, after the migration and before its record', async () => {
        const pool = new FakePool();

        await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)));

        const first = transactionOf(pool, 'CREATE TABLE a ();\n');
        const second = transactionOf(pool, 'CREATE TABLE b ();\n');
        const between = (statements: readonly string[]): readonly string[] =>
            statements.slice(
                2,
                statements.findIndex((sql) => sql.startsWith('INSERT INTO schema_migrations')),
            );
        const grants = (statements: readonly string[]): readonly string[] =>
            between(statements).filter((sql) => /^(GRANT|REVOKE)/u.test(sql));

        expect(grants(first)).toStrictEqual(privilegesAfterApply(ROLES, POLICY, ['a']));
        expect(grants(second)).toStrictEqual(privilegesAfterApply(ROLES, POLICY, ['a', 'b']));
        expect(second.at(-1)).toBe('COMMIT');
    });

    it('⛔ checks ownership inside the migration, before its grants, so a misowned object is named', async () => {
        const pool = new FakePool({ auditRows: [{ problem: 'table a is owned by food_migrator, not food_owner' }] });

        const thrown = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS))).catch(
            (error: unknown) => error,
        );
        const first = transactionOf(pool, 'CREATE TABLE a ();\n');

        expect((thrown as Error).message).toMatch(/Migration 0001_init failed/u);
        expect(String((thrown as Error).cause)).toMatch(/ownership:\n {2}- table a is owned by food_migrator/u);
        expect(first.filter((sql) => /^GRANT/u.test(sql))).toStrictEqual([]);
        expect(first.at(-1)).toBe('ROLLBACK');
    });

    it('⛔ refuses a migration that leaves the default privileges other than the hook, unrecorded and rolled back', async () => {
        const pool = new FakePool({
            defaultAclRows: [
                { problem: 'the default privileges of food_owner in schema public give food_seeder SELECT' },
            ],
        });

        const thrown = await applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS))).catch(
            (error: unknown) => error,
        );

        expect((thrown as Error).message).toMatch(/Migration 0001_init failed/u);
        expect(String((thrown as Error).cause)).toMatch(
            /default privileges:\n {2}- the default privileges of food_owner/u,
        );
        expect(transactionOf(pool, 'CREATE TABLE a ();\n').at(-1)).toBe('ROLLBACK');
        expect(pool.statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toStrictEqual([]);
    });

    it('⛔ checks the default privileges on a run that applies nothing', async () => {
        const pool = new FakePool({
            recorded: ['0001_init', '0002_more'],
            existingTables: ['a', 'b'],
            defaultAclRows: [{ problem: 'the default privileges of food_owner in every schema give food_app SELECT' }],
        });

        await expect(applyMigrations(options(pool, makeMigrationsDir(TWO_MIGRATIONS)))).rejects.toThrow(
            /post-migration validation failed — default privileges:\n {2}- the default privileges of food_owner/u,
        );
    });
});
