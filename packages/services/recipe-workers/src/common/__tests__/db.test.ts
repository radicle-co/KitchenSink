import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the passwordless RDS-IAM connection factory. The external boundaries — `pg.Pool`,
 * the RDS `Signer`, and drizzle — are mocked so the test asserts wiring (env → pool/signer config,
 * the per-connection token function, and the warm-invocation cache) without opening a real socket.
 */

interface PoolConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: () => Promise<string>;
    ssl: { rejectUnauthorized: boolean };
    max: number;
}

interface SignerConfig {
    hostname: string;
    port: number;
    username: string;
    region: string;
}

const { PoolMock, poolConfigs, SignerMock, signerConfigs, getAuthToken, drizzleMock } = vi.hoisted(() => {
    const poolConfigs: PoolConfig[] = [];
    const signerConfigs: SignerConfig[] = [];
    const getAuthToken = vi.fn<() => Promise<string>>().mockResolvedValue('iam-token');

    // Regular `function` (not arrow) implementations so the mocks are constructable with `new`.
    const PoolMock = vi.fn(function (this: unknown, config: PoolConfig) {
        poolConfigs.push(config);

        return { config, end: vi.fn() };
    });
    const SignerMock = vi.fn(function (this: unknown, config: SignerConfig) {
        signerConfigs.push(config);

        return { getAuthToken };
    });
    const drizzleMock = vi.fn((pool: unknown) => ({ __drizzle: true, pool }));

    return { PoolMock, poolConfigs, SignerMock, signerConfigs, getAuthToken, drizzleMock };
});

vi.mock('pg', () => ({ Pool: PoolMock }));
vi.mock('@aws-sdk/rds-signer', () => ({ Signer: SignerMock }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: drizzleMock }));

const ENV_KEYS = [
    'RECIPE_DB_HOST',
    'RECIPE_DB_PORT',
    'RECIPE_DB_NAME',
    'RECIPE_DB_USER',
    'RECIPE_DB_POOL_MAX',
    'AWS_REGION',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

    for (const key of ENV_KEYS) {
        delete process.env[key];
    }

    poolConfigs.length = 0;
    signerConfigs.length = 0;
    vi.clearAllMocks();
    getAuthToken.mockResolvedValue('iam-token');
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

describe('getRecipeDb', () => {
    it('throws MissingConfigError when RECIPE_DB_HOST is absent', async () => {
        process.env['AWS_REGION'] = 'us-east-1';
        const { getRecipeDb } = await import('../db.js');
        const { isMissingConfigError } = await import('../config.js');

        let caught: unknown;

        try {
            getRecipeDb();
        } catch (error) {
            caught = error;
        }

        expect(isMissingConfigError(caught)).toBe(true);
        expect((caught as { variableName: string }).variableName).toBe('RECIPE_DB_HOST');
        expect(PoolMock).not.toHaveBeenCalled();
    });

    it('throws MissingConfigError when AWS_REGION is absent', async () => {
        process.env['RECIPE_DB_HOST'] = 'db.internal';
        // RECIPE_DB_NAME is required too, so it is set here: this case must fail on the REGION.
        process.env['RECIPE_DB_NAME'] = 'kitchensink_recipes';
        const { getRecipeDb } = await import('../db.js');
        const { isMissingConfigError } = await import('../config.js');

        let caught: unknown;

        try {
            getRecipeDb();
        } catch (error) {
            caught = error;
        }

        expect(isMissingConfigError(caught)).toBe(true);
        expect((caught as { variableName: string }).variableName).toBe('AWS_REGION');
    });

    it('throws MissingConfigError when RECIPE_DB_NAME is absent, rather than defaulting to the SHARED db', async () => {
        // #119: `?? 'kitchensink_recipes'` here was a second copy of the footgun that put six workers —
        // three of them destructive scheduled sweepers — on the SHARED sandbox database while the API used
        // the preview's own. The database a worker connects to is never a sensible default: an unset value
        // must stop the worker, not silently redirect it at another stage's data.
        process.env['RECIPE_DB_HOST'] = 'db.internal';
        process.env['AWS_REGION'] = 'eu-west-2';
        const { getRecipeDb } = await import('../db.js');
        const { isMissingConfigError } = await import('../config.js');

        let caught: unknown;

        try {
            getRecipeDb();
        } catch (error) {
            caught = error;
        }

        expect(isMissingConfigError(caught)).toBe(true);
        expect((caught as { variableName: string }).variableName).toBe('RECIPE_DB_NAME');
        expect(PoolMock).not.toHaveBeenCalled();
    });

    it('wires the pool + signer from env, defaulting port/user/pool-size', async () => {
        process.env['RECIPE_DB_HOST'] = 'db.internal';
        process.env['AWS_REGION'] = 'eu-west-2';
        process.env['RECIPE_DB_NAME'] = 'kitchensink_recipes';
        const { getRecipeDb } = await import('../db.js');

        const db = getRecipeDb();

        expect(db).toEqual({ __drizzle: true, pool: expect.anything() });
        expect(poolConfigs).toHaveLength(1);
        const pool = poolConfigs[0];
        expect(pool.host).toBe('db.internal');
        expect(pool.port).toBe(5432);
        expect(pool.database).toBe('kitchensink_recipes');
        expect(pool.user).toBe('recipe_app');
        expect(pool.max).toBe(5);
        // IAM auth mandates TLS.
        expect(pool.ssl).toEqual({ rejectUnauthorized: false });

        expect(signerConfigs[0]).toEqual({
            hostname: 'db.internal',
            port: 5432,
            username: 'recipe_app',
            region: 'eu-west-2',
        });
    });

    it('honours the RECIPE_DB_* overrides', async () => {
        process.env['RECIPE_DB_HOST'] = 'db.internal';
        process.env['AWS_REGION'] = 'us-east-1';
        process.env['RECIPE_DB_PORT'] = '6543';
        process.env['RECIPE_DB_NAME'] = 'other_db';
        process.env['RECIPE_DB_USER'] = 'other_user';
        process.env['RECIPE_DB_POOL_MAX'] = '20';
        const { getRecipeDb } = await import('../db.js');

        getRecipeDb();

        expect(poolConfigs[0]).toMatchObject({ port: 6543, database: 'other_db', user: 'other_user', max: 20 });
        expect(signerConfigs[0]).toMatchObject({ port: 6543, username: 'other_user' });
    });

    it('supplies a password function that mints a fresh IAM token per physical connection', async () => {
        process.env['RECIPE_DB_HOST'] = 'db.internal';
        process.env['RECIPE_DB_NAME'] = 'kitchensink_recipes';
        process.env['AWS_REGION'] = 'us-east-1';
        const { getRecipeDb } = await import('../db.js');

        getRecipeDb();
        const password = poolConfigs[0].password;

        expect(typeof password).toBe('function');
        await expect(password()).resolves.toBe('iam-token');
        // pg re-invokes the function for every new connection → a fresh token each time.
        await password();
        expect(getAuthToken).toHaveBeenCalledTimes(2);
    });

    it('caches the handle across warm invocations (one pool per container)', async () => {
        process.env['RECIPE_DB_HOST'] = 'db.internal';
        process.env['RECIPE_DB_NAME'] = 'kitchensink_recipes';
        process.env['AWS_REGION'] = 'us-east-1';
        const { getRecipeDb } = await import('../db.js');

        const first = getRecipeDb();
        const second = getRecipeDb();

        expect(first).toBe(second);
        expect(PoolMock).toHaveBeenCalledTimes(1);
        expect(drizzleMock).toHaveBeenCalledTimes(1);
    });
});
