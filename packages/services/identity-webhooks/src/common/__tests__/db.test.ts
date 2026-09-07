import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the identity-webhooks DB connection factory. The external boundaries — `pg.Pool`
 * and drizzle — are mocked, and `getJsonSecret` (Secrets Manager) is mocked, so the test asserts
 * wiring (typed config → pool `max`/`ssl`, the warm-invocation cache, and config-error propagation)
 * without opening a real socket or calling AWS.
 */

interface PoolConfig {
    user: string;
    password: string;
    host: string;
    port: number;
    database: string;
    ssl: false | { rejectUnauthorized: boolean };
    max: number;
}

const { PoolMock, poolConfigs, drizzleMock, getJsonSecretMock } = vi.hoisted(() => {
    const poolConfigs: PoolConfig[] = [];
    const getJsonSecretMock = vi.fn();

    // Regular `function` (not arrow) implementation so the mock is constructable with `new`.
    const PoolMock = vi.fn(function (this: unknown, config: PoolConfig) {
        poolConfigs.push(config);

        return { config, end: vi.fn() };
    });
    const drizzleMock = vi.fn((pool: unknown) => ({ __drizzle: true, pool }));

    return { PoolMock, poolConfigs, drizzleMock, getJsonSecretMock };
});

vi.mock('pg', () => ({ Pool: PoolMock }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: drizzleMock }));
vi.mock('../secrets.js', () => ({ getJsonSecret: getJsonSecretMock }));

const ENV_KEYS = [
    'DB_SECRET_ARN',
    'IDP_SECRET_KEY',
    'AUTH_SECRET_ARN',
    'STAGE',
    'DB_POOL_MAX',
    'DELETION_QUEUE_URL',
] as const;

const DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:kitchensink/db/test';

const validSecret = {
    username: 'app_user',
    password: 'super-secret',
    host: 'db.internal',
    port: 5432,
    dbname: 'identity',
};

let savedEnv: Record<string, string | undefined>;

/**
 * ⛔ Pay the module graph's COLD transform cost here, outside any test's timeout budget.
 *
 * `afterEach` calls `vi.resetModules()`, so every test re-imports `../db.js` — but only the FIRST import
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

    // A valid base env — every test that expects getConfig() to succeed starts from this.
    process.env['DB_SECRET_ARN'] = DB_SECRET_ARN;
    process.env['IDP_SECRET_KEY'] = 'sk_test_123';

    poolConfigs.length = 0;
    vi.clearAllMocks();
    getJsonSecretMock.mockResolvedValue(validSecret);
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
    it('constructs the pool with max sourced from the typed DB_POOL_MAX config', async () => {
        process.env['DB_POOL_MAX'] = '17';
        const { getDb } = await import('../db.js');

        await getDb(DB_SECRET_ARN);

        expect(poolConfigs).toHaveLength(1);
        expect(poolConfigs[0].max).toBe(17);
    });

    it('defaults the pool max to 5 when DB_POOL_MAX is unset (the config schema default)', async () => {
        const { getDb } = await import('../db.js');

        await getDb(DB_SECRET_ARN);

        expect(poolConfigs[0].max).toBe(5);
    });

    it('disables SSL when STAGE is "local"', async () => {
        process.env['STAGE'] = 'local';
        const { getDb } = await import('../db.js');

        await getDb(DB_SECRET_ARN);

        expect(poolConfigs[0].ssl).toBe(false);
    });

    it('enables SSL (rejectUnauthorized: false) for any non-local STAGE', async () => {
        process.env['STAGE'] = 'sandbox';
        const { getDb } = await import('../db.js');

        await getDb(DB_SECRET_ARN);

        expect(poolConfigs[0].ssl).toEqual({ rejectUnauthorized: false });
    });

    it('enables SSL when STAGE is unset (defaults to "dev", which is non-local)', async () => {
        const { getDb } = await import('../db.js');

        await getDb(DB_SECRET_ARN);

        expect(poolConfigs[0].ssl).toEqual({ rejectUnauthorized: false });
    });

    it('memoizes the db instance — a second call returns the SAME instance without constructing a new pool', async () => {
        const { getDb } = await import('../db.js');

        const first = await getDb(DB_SECRET_ARN);
        const second = await getDb(DB_SECRET_ARN);

        expect(second).toBe(first);
        expect(PoolMock).toHaveBeenCalledTimes(1);
        expect(drizzleMock).toHaveBeenCalledTimes(1);
        expect(getJsonSecretMock).toHaveBeenCalledTimes(1);
    });

    it('propagates a getConfig() error (missing required env) and never constructs a pool', async () => {
        delete process.env['IDP_SECRET_KEY'];
        delete process.env['AUTH_SECRET_ARN'];
        const { getDb } = await import('../db.js');

        await expect(getDb(DB_SECRET_ARN)).rejects.toThrow();

        expect(PoolMock).not.toHaveBeenCalled();
        expect(drizzleMock).not.toHaveBeenCalled();
    });
});
