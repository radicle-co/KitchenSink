import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the identity-webhooks DB connection factory.
 *
 * `pg.Pool` and drizzle are mocked so no socket opens; `@kitchensink/rds-iam-auth` is REAL, so these assert what
 * the pool is actually handed — the login role, the IAM token provider, TLS — not that a mock was called. The
 * signer's token call is stubbed at the SDK boundary.
 *
 * ⛔ What changed and why (the role split, `docs/plans/2026-09-11-database-role-split.md`): `getDb` used to read
 * the RDS MASTER secret and log in as `identity_app`, a member of `rds_superuser`. It now logs in as
 * `identity_service` by RDS IAM and never touches Secrets Manager — asserted below, not assumed.
 */

interface PoolConfig {
    readonly user?: string;
    readonly password?: string | (() => Promise<string>);
    readonly host?: string;
    readonly port?: number;
    readonly database?: string;
    readonly connectionString?: string;
    readonly ssl?: false | { rejectUnauthorized: boolean };
    readonly max?: number;
}

const { PoolMock, poolConfigs, drizzleMock, getJsonSecretMock, getAuthTokenMock, signerOptions } = vi.hoisted(() => {
    const poolConfigs: PoolConfig[] = [];
    const signerOptions: Record<string, unknown>[] = [];

    // Regular `function` (not arrow) implementations so the mocks are constructable with `new`.
    const PoolMock = vi.fn(function (this: unknown, config: PoolConfig) {
        poolConfigs.push(config);

        return { config, end: vi.fn() };
    });

    return {
        PoolMock,
        poolConfigs,
        drizzleMock: vi.fn((pool: unknown) => ({ __drizzle: true, pool })),
        getJsonSecretMock: vi.fn(),
        getAuthTokenMock: vi.fn(),
        signerOptions,
    };
});

vi.mock('pg', () => ({ Pool: PoolMock, default: { Pool: PoolMock } }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: drizzleMock }));
vi.mock('../secrets.js', () => ({ getJsonSecret: getJsonSecretMock }));
vi.mock('@aws-sdk/rds-signer', () => ({
    Signer: vi.fn(function (this: unknown, options: Record<string, unknown>) {
        signerOptions.push(options);

        return { getAuthToken: getAuthTokenMock };
    }),
}));

const ENV_KEYS = [
    'DATABASE_URL',
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USERNAME',
    'DB_PASSWORD',
    'IDP_SECRET_KEY',
    'AUTH_SECRET_ARN',
    'STAGE',
    'DB_POOL_MAX',
    'DELETION_QUEUE_URL',
] as const;

let savedEnv: Record<string, string | undefined>;

/**
 * ⛔ Pay the module graph's COLD transform cost here, outside any test's timeout budget.
 *
 * `beforeEach` calls `vi.resetModules()`, so every test re-imports `../db.js` — but only the FIRST import
 * compiles the graph (pg, drizzle, the AWS SDK); the rest hit vitest's transform cache. That made the first
 * test in this file cost ~5.2s against the 5s default while its siblings ran in 43-65ms, and it went red in
 * CI the moment it shared a runner with `buildInputs.test.ts` (37s of esbuild). The test was never slow —
 * the first import was, and the timeout simply landed on whichever test drew the short straw.
 *
 * Warming it in a hook with its own generous budget makes the cost explicit and stops it being charged to a
 * test assertion. Do NOT "fix" this by raising `testTimeout` globally: that hides genuinely slow tests.
 */
beforeAll(async () => {
    await import('../db.js');
}, 60_000);

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

    for (const key of ENV_KEYS) {
        delete process.env[key];
    }

    // The deployed shape: instance coordinates and a Clerk secret — no password anywhere.
    process.env['DB_HOST'] = 'db.internal';
    process.env['DB_PORT'] = '5432';
    process.env['DB_NAME'] = 'kitchensink_identity';
    process.env['IDP_SECRET_KEY'] = 'sk_test_123';

    poolConfigs.length = 0;
    signerOptions.length = 0;
    vi.clearAllMocks();
    getAuthTokenMock.mockResolvedValue('iam-token');
    // Fresh module scope per test so the module-level `pool`/`dbInstance` cache does not leak across cases.
    vi.resetModules();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = savedEnv[key];
        }
    }
});

describe('getDb', () => {
    it('logs in as identity_service — never the RDS master — at the configured instance', async () => {
        const { getDb } = await import('../db.js');

        await getDb();

        expect(poolConfigs).toHaveLength(1);
        expect(poolConfigs[0]).toMatchObject({
            user: 'identity_service',
            host: 'db.internal',
            port: 5432,
            database: 'kitchensink_identity',
        });
        expect(poolConfigs[0]?.user).not.toBe('identity_app');
    });

    it('authenticates with a fresh RDS IAM token per connection, over TLS, for identity_service', async () => {
        const { getDb } = await import('../db.js');

        await getDb();

        const password = poolConfigs[0]?.password;

        expect(typeof password).toBe('function');
        await expect((password as () => Promise<string>)()).resolves.toBe('iam-token');
        expect(signerOptions).toEqual([
            expect.objectContaining({ username: 'identity_service', hostname: 'db.internal' }),
        ]);
        expect(poolConfigs[0]?.ssl).toEqual({ rejectUnauthorized: false });
    });

    it('never reads Secrets Manager for the database', async () => {
        const { getDb } = await import('../db.js');

        await getDb();

        expect(getJsonSecretMock).not.toHaveBeenCalled();
    });

    it('prefers DATABASE_URL when set (local development and the integration tier)', async () => {
        process.env['DATABASE_URL'] = 'postgres://identity_service:pw@localhost:5432/kitchensink_identity';
        const { getDb } = await import('../db.js');

        await getDb();

        expect(poolConfigs[0]?.connectionString).toBe(
            'postgres://identity_service:pw@localhost:5432/kitchensink_identity',
        );
        expect(signerOptions).toEqual([]);
    });

    it('uses the static DB_PASSWORD without TLS when STAGE is "local"', async () => {
        process.env['STAGE'] = 'local';
        process.env['DB_PASSWORD'] = 'localdev';
        const { getDb } = await import('../db.js');

        await getDb();

        expect(poolConfigs[0]).toMatchObject({ password: 'localdev', ssl: false });
        expect(signerOptions).toEqual([]);
    });

    it('constructs the pool with max sourced from the typed DB_POOL_MAX config', async () => {
        process.env['DB_POOL_MAX'] = '17';
        const { getDb } = await import('../db.js');

        await getDb();

        expect(poolConfigs[0]?.max).toBe(17);
    });

    it('defaults the pool max to 5 when DB_POOL_MAX is unset (the config schema default)', async () => {
        const { getDb } = await import('../db.js');

        await getDb();

        expect(poolConfigs[0]?.max).toBe(5);
    });

    it('memoizes the db instance — a second call returns the SAME instance without constructing a new pool', async () => {
        const { getDb } = await import('../db.js');

        const first = await getDb();
        const second = await getDb();

        expect(second).toBe(first);
        expect(PoolMock).toHaveBeenCalledTimes(1);
        expect(drizzleMock).toHaveBeenCalledTimes(1);
    });

    it('propagates a config error (no database location) and never constructs a pool', async () => {
        delete process.env['DB_HOST'];
        const { getDb } = await import('../db.js');

        await expect(getDb()).rejects.toThrow(/DB_HOST/u);

        expect(PoolMock).not.toHaveBeenCalled();
        expect(drizzleMock).not.toHaveBeenCalled();
    });
});
