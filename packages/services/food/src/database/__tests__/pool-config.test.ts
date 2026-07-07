/**
 * Unit coverage for the food pool-config auth-mode branching: local docker uses a static password with
 * no TLS; every deployed stage authenticates `food_app` via an RDS IAM token function over TLS.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FOOD_DB_USERNAME, foodPoolConfig, foodPoolConfigFromEnv } from '../pool-config.js';

const CONNECTION = { host: 'db.example.com', port: 5432, database: 'kitchensink_food', username: FOOD_DB_USERNAME };

const SAVED = { ...process.env };

function resetEnv(): void {
    for (const key of ['STAGE', 'DATABASE_URL', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD']) {
        delete process.env[key];
    }
}

beforeEach(resetEnv);
afterEach(() => {
    resetEnv();
    Object.assign(process.env, SAVED);
});

describe('foodPoolConfig', () => {
    it('local: static password, no TLS (docker Postgres)', () => {
        process.env['STAGE'] = 'local';
        process.env['DB_PASSWORD'] = 'localdev';

        const config = foodPoolConfig(CONNECTION);

        expect(config.ssl).toBe(false);
        expect(config.password).toBe('localdev');
        expect(config.user).toBe('food_app');
    });

    it('deployed: IAM token function over TLS (no static password)', () => {
        process.env['STAGE'] = 'pr-59';

        const config = foodPoolConfig(CONNECTION);

        // TLS on, RDS CA not verified.
        expect(config.ssl).toEqual({ rejectUnauthorized: false });
        // The password is a token provider, not a literal — pg calls it per new connection.
        expect(typeof config.password).toBe('function');
    });
});

describe('foodPoolConfigFromEnv', () => {
    it('prefers DATABASE_URL verbatim (local dev)', () => {
        process.env['DATABASE_URL'] = 'postgresql://food_app:pw@localhost:5432/kitchensink_food';

        expect(foodPoolConfigFromEnv()).toEqual({
            connectionString: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
        });
    });

    it('deployed: builds discrete IAM config as food_app', () => {
        process.env['STAGE'] = 'pr-59';
        process.env['DB_HOST'] = 'db.example.com';
        process.env['DB_PORT'] = '5432';
        process.env['DB_NAME'] = 'kitchensink_food_pr_59';

        const config = foodPoolConfigFromEnv();

        expect(config.user).toBe('food_app');
        expect(config.database).toBe('kitchensink_food_pr_59');
        expect(typeof config.password).toBe('function');
    });

    it('throws when neither DATABASE_URL nor the discrete DB_* set is present', () => {
        expect(() => foodPoolConfigFromEnv()).toThrow(/DATABASE_URL or DB_HOST/);
    });

    it('fails fast on a non-numeric DB_PORT (rather than a confusing pg/rds-signer error later)', () => {
        process.env['STAGE'] = 'pr-59';
        process.env['DB_HOST'] = 'db.example.com';
        process.env['DB_PORT'] = 'not-a-port';
        process.env['DB_NAME'] = 'kitchensink_food_pr_59';

        expect(() => foodPoolConfigFromEnv()).toThrow(/Invalid DB_PORT/);
    });
});
