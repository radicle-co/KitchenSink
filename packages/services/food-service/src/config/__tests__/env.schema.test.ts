/**
 * Unit tests for the food-service environment schema.
 *
 * Traceability:
 * - FR-019, FR-031 (env-driven USDA config)
 * - T-002 acceptance: missing `USDA_API_KEY` at startup throws a descriptive Zod validation error;
 *   all vars carry their documented defaults.
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { EnvironmentSchema } from '../env.schema.js';

const VALID_ENV = {
    STAGE: 'test',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
} as const;

describe('EnvironmentSchema', () => {
    it('throws a descriptive ZodError when USDA_API_KEY is missing', () => {
        const { USDA_API_KEY: _omitted, ...withoutKey } = VALID_ENV;

        const result = EnvironmentSchema.safeParse(withoutKey);

        expect(result.success).toBe(false);
        if (result.success) {
            throw new Error('expected validation to fail');
        }

        expect(result.error).toBeInstanceOf(ZodError);
        const keyIssue = result.error.issues.find((issue) => issue.path.includes('USDA_API_KEY'));
        expect(keyIssue).toBeDefined();
    });

    it('parses a valid environment and applies USDA defaults', () => {
        const env = EnvironmentSchema.parse(VALID_ENV);

        expect(env.USDA_API_KEY).toBe('test-usda-key');
        expect(env.USDA_API_BASE_URL).toBe('https://api.nal.usda.gov/fdc/v1');
        expect(env.USDA_RATE_LIMIT_PER_HOUR).toBe(1000);
        expect(env.USDA_STALE_THRESHOLD_DAYS).toBe(30);
        expect(env.USDA_TOMBSTONE_TTL_DAYS).toBe(30);
        expect(env.USDA_WORKER_DESIRED_COUNT).toBe(1);
        expect(env.USDA_LEASE_TIMEOUT_SECONDS).toBe(30);
    });

    it('coerces numeric overrides supplied as strings (env vars are always strings)', () => {
        const env = EnvironmentSchema.parse({
            ...VALID_ENV,
            USDA_RATE_LIMIT_PER_HOUR: '500',
            USDA_LEASE_TIMEOUT_SECONDS: '45',
        });

        expect(env.USDA_RATE_LIMIT_PER_HOUR).toBe(500);
        expect(env.USDA_LEASE_TIMEOUT_SECONDS).toBe(45);
    });

    it('accepts the discrete DB_* connection form', () => {
        const { DATABASE_URL: _url, ...rest } = VALID_ENV;
        const env = EnvironmentSchema.parse({
            ...rest,
            DB_HOST: 'localhost',
            DB_PORT: '5432',
            DB_NAME: 'kitchensink_food',
            DB_USERNAME: 'food_app',
            DB_PASSWORD: 'pw',
        });

        expect(env.USDA_API_KEY).toBe('test-usda-key');
    });
});
