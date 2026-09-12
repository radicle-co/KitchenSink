/**
 * Unit coverage for the identity in-VPC migration runner's DISCOVERY and its ENV boundary —
 * everything that happens before a socket is opened. The DB-backed apply/validate path runs against a
 * real Postgres in `tests/migrate.integration.test.ts`; a mocked pool could not observe an unapplied
 * migration, which is the failure this runner exists to prevent.
 *
 * Every case here asserts on a path that fails CLOSED. A migration runner that resolves successfully
 * having connected to nothing is indistinguishable, to the deploy, from one that had nothing to do —
 * and the in-deploy trigger turns that silence into "the schema is ready" for the ECS service behind it.
 */
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `node:fs` is passed through UNCHANGED except that `readdirSync` becomes a spy over the real one. Ordering
// is the property this runner cannot get wrong — `0004` must precede `0005`, which DROPs and rebuilds what
// `0004` created — and it is the one property a temp directory cannot test: the assertion would only fail
// when the filesystem happened to hand the entries back out of order. Measured: deleting `.sort()` from the
// runner left a temp-directory ordering test GREEN on ext4. Driving `readdirSync` directly makes the check
// deterministic on every filesystem, which is the only form in which it is worth having.
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();

    return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

// Who the IAM token is signed for is the property that matters here, so the signer records it. A `function`
// expression, not an arrow: it is called with `new`.
const signedFor = vi.fn();

vi.mock('@aws-sdk/rds-signer', () => ({
    Signer: vi.fn(function fakeSigner(options: { username: string }) {
        signedFor(options.username);

        return { getAuthToken: (): Promise<string> => Promise.resolve('token') };
    }),
}));

import { discoverMigrations, handler } from '../handler.js';

/** The connection the schema stack hands the runner — the discrete RDS-IAM form. */
const CONNECTION_ENV = { DB_HOST: 'unreachable.invalid', DB_PORT: '5432', DB_NAME: 'kitchensink_identity' } as const;

beforeEach(() => {
    vi.clearAllMocks();

    for (const name of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DATABASE_URL', 'DB_SECRET_ARN']) {
        delete process.env[name];
    }

    Object.assign(process.env, CONNECTION_ENV);
    process.env['STAGE'] = 'test';
});

/**
 * A well-formed migrate event.
 *
 * ⛔ `expectManifestSha` is REQUIRED (ADR-0035), and the handler now parses the event BEFORE it reads the
 * environment — so every case below that asserts the env/secret boundary has to get past the event first.
 * That ordering is deliberate: a malformed invocation should be refused before this function reaches for a
 * production credential.
 */
const MIGRATE_EVENT = { expectManifestSha: 'a'.repeat(64) } as const;

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

describe('discoverMigrations', () => {
    it('returns every .sql in filename order, with the .sql suffix stripped for tracking', () => {
        const dir = scratchDirectory('identity-migrate-');
        writeFileSync(join(dir, '0002_second.sql'), 'SELECT 1;');
        writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;');
        writeFileSync(join(dir, '0010_tenth.sql'), 'SELECT 1;');

        expect(discoverMigrations(dir)).toEqual([
            { name: '0001_first', file: '0001_first.sql' },
            { name: '0002_second', file: '0002_second.sql' },
            { name: '0010_tenth', file: '0010_tenth.sql' },
        ]);
    });

    it('⛔ SORTS what the filesystem hands back — apply order is the whole contract', () => {
        // `0005_identity_reset` DROPs and rebuilds what `0004_users_sub_pk` creates, so an out-of-order
        // apply does not error: it produces a DIFFERENT, wrong schema and records it as successful.
        vi.mocked(readdirSync).mockReturnValueOnce([
            '0010_tenth.sql',
            '0002_second.sql',
            '0001_first.sql',
        ] as unknown as ReturnType<typeof readdirSync>);

        expect(discoverMigrations('/does/not/need/to/exist').map((migration) => migration.name)).toEqual([
            '0001_first',
            '0002_second',
            '0010_tenth',
        ]);
    });

    it('ignores non-SQL files, so a README beside the migrations is never applied as one', () => {
        const dir = scratchDirectory('identity-migrate-');
        writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;');
        writeFileSync(join(dir, 'README.md'), '# not a migration');
        writeFileSync(join(dir, '0001_first.sql.bak'), 'SELECT 1;');

        expect(discoverMigrations(dir).map((migration) => migration.file)).toEqual(['0001_first.sql']);
    });
});

describe('handler — the env boundary, and who it connects as', () => {
    it('⛔ signs its IAM token for identity_migrator — never the RDS master it used to run as', async () => {
        // The connection attempt that follows fails (the host does not resolve); the assertion is on WHO.
        await expect(handler(MIGRATE_EVENT)).rejects.toThrow();

        expect(signedFor).toHaveBeenCalledWith('identity_migrator');
        expect(signedFor).not.toHaveBeenCalledWith('identity_app');
    });

    it('no longer reads any database secret — DB_SECRET_ARN is not how it connects any more', async () => {
        process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:identity-db-AbCdEf';

        await expect(handler(MIGRATE_EVENT)).rejects.not.toThrow(/secret/iu);
    });

    it('fails fast, naming the variable, with no DB_HOST', async () => {
        delete process.env['DB_HOST'];

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/DB_HOST/u);
        expect(signedFor).not.toHaveBeenCalled();
    });

    it('fails fast, naming the variable, with no DB_NAME — it must know which database it migrates', async () => {
        delete process.env['DB_NAME'];

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/DB_NAME/u);
    });

    it.each(['five-four-three-two', '70000', ''])('rejects DB_PORT %j instead of connecting to NaN', async (port) => {
        process.env['DB_PORT'] = port;

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/DB_PORT/u);
    });
});

describe('handler — the migration-manifest expectation (ADR-0035)', () => {
    /**
     * ⛔ THE PROPERTY THE WHOLE DECISION RESTS ON. A runner that applies whatever SQL it happens to hold and
     * reports `applied: []` is indistinguishable from one with nothing to do — the silent no-op ADR-0022
     * recorded and ADR-0035 removes. It is removed only if the runner REFUSES an invocation that does not
     * say which migration set it expects.
     *
     * These cases exist because the expectation was optional for one release, and while it was, the
     * property was enforced by one argument check in one shell script rather than by this function.
     */
    it('⛔ refuses an invocation carrying no expectation at all', async () => {
        await expect(handler({})).rejects.toThrow(/expectManifestSha/);
    });

    it('⛔ refuses an expectation that is not a sha256 digest', async () => {
        await expect(handler({ expectManifestSha: 'not-a-digest' })).rejects.toThrow(/expectManifestSha/);
        await expect(handler({ expectManifestSha: 'A'.repeat(64) })).rejects.toThrow(/expectManifestSha/);
        await expect(handler({ expectManifestSha: 'a'.repeat(63) })).rejects.toThrow(/expectManifestSha/);
    });

    it('⛔ refuses a MISSPELLED key rather than reading it as absent', async () => {
        // The failure this is really about: a payload the CLI mangled, or a caller that wrote
        // `expectManifestSHA`. Under an optional field that yields `undefined` and a green "clean run".
        await expect(handler({ expectManifestSHA: 'a'.repeat(64) })).rejects.toThrow(/expectManifestSha/);
    });

    it('⛔ refuses BEFORE building a connection', async () => {
        // Ordering, not just outcome. A malformed invocation must be rejected before this function mints a
        // database credential.
        await expect(handler({})).rejects.toThrow();

        expect(signedFor).not.toHaveBeenCalled();
    });

    it('⛔ refuses an unknown key (`.strict()`), e.g. an old caller still sending an action', async () => {
        await expect(handler({ ...MIGRATE_EVENT, action: 'drop' })).rejects.toThrow(/malformed event/u);
    });
});
