/**
 * Unit coverage for food's environment binding: the `food_app` role and the required database. The auth-mode
 * branching itself (static password locally, IAM token over TLS when deployed) is `@kitchensink/rds-iam-auth`'s.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { foodPoolConfigFromEnv } from '../poolConfig.js';

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
