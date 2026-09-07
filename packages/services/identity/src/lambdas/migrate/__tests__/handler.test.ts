/**
 * Unit coverage for the identity in-VPC migration runner's DISCOVERY and its ENV/SECRET boundary —
 * everything that happens before a socket is opened. The DB-backed apply/validate path runs against a
 * real Postgres in `tests/migrate.integration.test.ts`; a mocked pool could not observe an unapplied
 * migration, which is the failure this runner exists to prevent.
 *
 * Every case here asserts on a path that fails CLOSED. A migration runner that resolves successfully
 * having connected to nothing is indistinguishable, to the deploy, from one that had nothing to do —
 * and the in-deploy trigger turns that silence into "the schema is ready" for the ECS service behind it.
 */
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const send = vi.fn();

// `function` expressions, not arrows: both of these are called with `new`, and an arrow is not a
// constructor. The bodies dereference `send` lazily (at construction), which is what lets them close over
// a binding declared below the hoisted `vi.mock` call.
vi.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: vi.fn(function fakeClient() {
        return { send };
    }),
    GetSecretValueCommand: vi.fn(function fakeCommand(input: unknown) {
        return { input };
    }),
}));

import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

import { discoverMigrations, handler } from '../handler.js';

/** A well-formed RDS-style secret payload — the shape the identity DB secret really carries. */
const validSecret = {
    username: 'identity_app',
    password: 'hunter2',
    host: 'db.internal',
    port: 5432,
    dbname: 'kitchensink_identity',
};

/** Queue a `GetSecretValue` response carrying `SecretString`. */
const respondWithSecret = (payload: unknown): void => {
    send.mockResolvedValueOnce({ SecretString: JSON.stringify(payload) });
};

beforeEach(() => {
    vi.clearAllMocks();
    process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:identity-db-AbCdEf';
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

describe('discoverMigrations', () => {
    it('returns every .sql in filename order, with the .sql suffix stripped for tracking', () => {
        const dir = mkdtempSync(join(tmpdir(), 'identity-migrate-'));
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
        const dir = mkdtempSync(join(tmpdir(), 'identity-migrate-'));
        writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;');
        writeFileSync(join(dir, 'README.md'), '# not a migration');
        writeFileSync(join(dir, '0001_first.sql.bak'), 'SELECT 1;');

        expect(discoverMigrations(dir).map((migration) => migration.file)).toEqual(['0001_first.sql']);
    });
});

describe('handler — the env/secret boundary', () => {
    it('fails fast with no DB_SECRET_ARN, before it asks Secrets Manager for anything', async () => {
        delete process.env['DB_SECRET_ARN'];

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/DB_SECRET_ARN/);
        expect(send).not.toHaveBeenCalled();
    });

    it('asks for exactly the secret named in DB_SECRET_ARN', async () => {
        respondWithSecret({ ...validSecret, host: 'unreachable.invalid' });
        // The connection attempt that follows is expected to fail; the assertion is on the lookup.
        await expect(handler(MIGRATE_EVENT)).rejects.toThrow();

        expect(GetSecretValueCommand).toHaveBeenCalledWith({
            SecretId: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:identity-db-AbCdEf',
        });
    });

    it('rejects a secret with no SecretString (a binary secret is not a connection)', async () => {
        send.mockResolvedValueOnce({ SecretBinary: new Uint8Array([1, 2, 3]) });

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/SecretString/);
    });

    it('rejects a secret whose payload is not JSON', async () => {
        send.mockResolvedValueOnce({ SecretString: 'not-json' });

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/JSON/i);
    });

    it('rejects a secret carrying neither dbname nor database', async () => {
        const { dbname: _dbname, ...withoutDatabase } = validSecret;
        respondWithSecret(withoutDatabase);

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/dbname/i);
    });

    it('accepts the `database` spelling as well as `dbname`', async () => {
        const { dbname: _dbname, ...rest } = validSecret;
        respondWithSecret({ ...rest, database: 'kitchensink_identity', host: 'unreachable.invalid' });

        // Past the secret gate: the only remaining failure is the connection itself, never a shape error.
        await expect(handler(MIGRATE_EVENT)).rejects.not.toThrow(/dbname|database/i);
    });

    it('rejects a non-numeric port instead of connecting to NaN', async () => {
        respondWithSecret({ ...validSecret, port: 'five-four-three-two' });

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/port/i);
    });

    it('rejects a port outside the TCP range', async () => {
        respondWithSecret({ ...validSecret, port: 70000 });

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/port/i);
    });

    it('rejects a secret with no username or password rather than connecting anonymously', async () => {
        const { username: _username, ...withoutUsername } = validSecret;
        respondWithSecret(withoutUsername);

        await expect(handler(MIGRATE_EVENT)).rejects.toThrow(/username/i);
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

    it('⛔ refuses BEFORE reaching for the database credential', async () => {
        // Ordering, not just outcome. A malformed invocation must be rejected before this function asks
        // Secrets Manager for a production credential.
        vi.mocked(GetSecretValueCommand).mockClear();

        await expect(handler({})).rejects.toThrow();

        expect(GetSecretValueCommand).not.toHaveBeenCalled();
    });
});
