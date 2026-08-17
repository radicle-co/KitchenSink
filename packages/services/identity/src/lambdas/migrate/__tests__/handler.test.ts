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

        await expect(handler()).rejects.toThrow(/DB_SECRET_ARN/);
        expect(send).not.toHaveBeenCalled();
    });

    it('asks for exactly the secret named in DB_SECRET_ARN', async () => {
        respondWithSecret({ ...validSecret, host: 'unreachable.invalid' });
        // The connection attempt that follows is expected to fail; the assertion is on the lookup.
        await expect(handler()).rejects.toThrow();

        expect(GetSecretValueCommand).toHaveBeenCalledWith({
            SecretId: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:identity-db-AbCdEf',
        });
    });

    it('rejects a secret with no SecretString (a binary secret is not a connection)', async () => {
        send.mockResolvedValueOnce({ SecretBinary: new Uint8Array([1, 2, 3]) });

        await expect(handler()).rejects.toThrow(/SecretString/);
    });

    it('rejects a secret whose payload is not JSON', async () => {
        send.mockResolvedValueOnce({ SecretString: 'not-json' });

        await expect(handler()).rejects.toThrow(/JSON/i);
    });

    it('rejects a secret carrying neither dbname nor database', async () => {
        const { dbname: _dbname, ...withoutDatabase } = validSecret;
        respondWithSecret(withoutDatabase);

        await expect(handler()).rejects.toThrow(/dbname/i);
    });

    it('accepts the `database` spelling as well as `dbname`', async () => {
        const { dbname: _dbname, ...rest } = validSecret;
        respondWithSecret({ ...rest, database: 'kitchensink_identity', host: 'unreachable.invalid' });

        // Past the secret gate: the only remaining failure is the connection itself, never a shape error.
        await expect(handler()).rejects.not.toThrow(/dbname|database/i);
    });

    it('rejects a non-numeric port instead of connecting to NaN', async () => {
        respondWithSecret({ ...validSecret, port: 'five-four-three-two' });

        await expect(handler()).rejects.toThrow(/port/i);
    });

    it('rejects a port outside the TCP range', async () => {
        respondWithSecret({ ...validSecret, port: 70000 });

        await expect(handler()).rejects.toThrow(/port/i);
    });

    it('rejects a secret with no username or password rather than connecting anonymously', async () => {
        const { username: _username, ...withoutUsername } = validSecret;
        respondWithSecret(withoutUsername);

        await expect(handler()).rejects.toThrow(/username/i);
    });
});
