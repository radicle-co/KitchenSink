import { beforeEach, describe, expect, it, vi } from 'vitest';

const signerCalls: unknown[] = [];

vi.mock('@aws-sdk/rds-signer', () => ({
    Signer: class {
        public constructor(options: unknown) {
            signerCalls.push(options);
        }

        public getAuthToken(): Promise<string> {
            return Promise.resolve(`token-${signerCalls.length}`);
        }
    },
}));

const { rdsPoolConfig, rdsPoolConfigFromEnv } = await import('../poolConfig.js');

const CONNECTION = { host: 'db.internal', port: 5432, database: 'kitchensink_food', username: 'food_app' };

beforeEach(() => {
    signerCalls.length = 0;
});

describe('rdsPoolConfig — a deployed stage', () => {
    it('authenticates with an IAM token minted by a FUNCTION, so every new connection gets a fresh one', async () => {
        const config = rdsPoolConfig(CONNECTION, { AWS_REGION: 'eu-west-1' });

        // ⛔ A string would be ONE token, valid ~15 minutes, reused by every later connection — a warm pool
        // that outlives it then fails every reconnect with 28P01.
        expect(typeof config.password).toBe('function');
        await expect((config.password as () => Promise<string>)()).resolves.toBe('token-1');
        expect(signerCalls).toEqual([
            { hostname: 'db.internal', port: 5432, username: 'food_app', region: 'eu-west-1' },
        ]);
    });

    it('connects with TLS (IAM auth requires it) and the coordinates it was given', () => {
        const config = rdsPoolConfig(CONNECTION, {});

        expect(config.ssl).toEqual({ rejectUnauthorized: false });
        expect(config).toMatchObject({
            host: 'db.internal',
            port: 5432,
            database: 'kitchensink_food',
            user: 'food_app',
        });
    });

    it('resolves the region from AWS_REGION, then AWS_DEFAULT_REGION, then us-east-1', () => {
        rdsPoolConfig(CONNECTION, { AWS_REGION: 'a-1', AWS_DEFAULT_REGION: 'b-1' });
        rdsPoolConfig(CONNECTION, { AWS_DEFAULT_REGION: 'b-1' });
        rdsPoolConfig(CONNECTION, {});

        expect(signerCalls.map((call) => (call as { region: string }).region)).toEqual(['a-1', 'b-1', 'us-east-1']);
    });
});

describe('rdsPoolConfig — STAGE=local', () => {
    it('uses the static DB_PASSWORD with no TLS and no IAM, against docker Postgres', () => {
        const config = rdsPoolConfig(CONNECTION, { STAGE: 'local', DB_PASSWORD: 'pw' });

        expect(config).toMatchObject({ ssl: false, password: 'pw' });
        expect(signerCalls).toEqual([]);
    });

    it('refuses without DB_PASSWORD rather than silently attempting IAM against a local server', () => {
        expect(() => rdsPoolConfig(CONNECTION, { STAGE: 'local' })).toThrow(/DB_PASSWORD/u);
    });
});

describe('rdsPoolConfigFromEnv', () => {
    const defaults = { username: 'food_app' };

    it('prefers DATABASE_URL (local dev) over the discrete parts', () => {
        expect(rdsPoolConfigFromEnv(defaults, { DATABASE_URL: 'postgres://x', DB_HOST: 'h', DB_PORT: '1' })).toEqual({
            connectionString: 'postgres://x',
        });
    });

    it('builds from DB_HOST/DB_PORT/DB_NAME, with the default username unless DB_USERNAME overrides it', () => {
        const env = { DB_HOST: 'h', DB_PORT: '5432', DB_NAME: 'd' };

        expect(rdsPoolConfigFromEnv(defaults, env)).toMatchObject({
            host: 'h',
            port: 5432,
            database: 'd',
            user: 'food_app',
        });
        expect(rdsPoolConfigFromEnv(defaults, { ...env, DB_USERNAME: 'food_migrator' })).toMatchObject({
            user: 'food_migrator',
        });
    });

    it('uses the default database only when the caller supplies one', () => {
        const env = { DB_HOST: 'h', DB_PORT: '5432' };

        expect(rdsPoolConfigFromEnv({ ...defaults, database: 'kitchensink_recipes' }, env)).toMatchObject({
            database: 'kitchensink_recipes',
        });
        expect(() => rdsPoolConfigFromEnv(defaults, env)).toThrow(/DB_NAME/u);
    });

    it('refuses a missing host or port', () => {
        expect(() => rdsPoolConfigFromEnv(defaults, { DB_PORT: '5432', DB_NAME: 'd' })).toThrow(/DB_HOST/u);
        expect(() => rdsPoolConfigFromEnv(defaults, { DB_HOST: 'h', DB_NAME: 'd' })).toThrow(/DB_PORT/u);
    });

    it.each(['abc', '', '0', '65536', '54.3'])(
        'refuses a malformed DB_PORT (%j) before pg or the signer sees it',
        (port) => {
            expect(() => rdsPoolConfigFromEnv(defaults, { DB_HOST: 'h', DB_PORT: port, DB_NAME: 'd' })).toThrow(
                /DB_PORT/u,
            );
        },
    );
});
