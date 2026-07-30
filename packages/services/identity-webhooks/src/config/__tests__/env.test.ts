import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CONFIG_ERROR_CODE,
    ConfigError,
    EnvironmentSchema,
    WebhookEnvironmentSchema,
    getConfig,
    getErasureFanoutConfig,
    getWebhookConfig,
    isConfigError,
    resetConfigCacheForTests,
    resolveEnvironment,
    resolveWebhookEnvironment,
} from '../env.js';

const validBaseEnv = {
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:kitchensink/db/test',
    IDP_SECRET_KEY: 'sk_test_123',
    IDP_PUBLISHABLE_KEY: 'pk_test_123',
    IDP_WEBHOOK_SECRET: 'whsec_test_123',
    IDP_JWKS_URL: 'https://example.idp.example.com/.well-known/jwks.json',
    IDP_ISSUER: 'https://example.idp.example.com',
};

describe('EnvironmentSchema', () => {
    it('parses a complete valid env into the typed shape', () => {
        const parsed = EnvironmentSchema.parse(validBaseEnv);

        expect(parsed).toMatchObject({
            DB_SECRET_ARN: validBaseEnv.DB_SECRET_ARN,
            IDP_SECRET_KEY: 'sk_test_123',
            IDP_PUBLISHABLE_KEY: 'pk_test_123',
            IDP_WEBHOOK_SECRET: 'whsec_test_123',
            IDP_JWKS_URL: 'https://example.idp.example.com/.well-known/jwks.json',
            IDP_ISSUER: 'https://example.idp.example.com',
        });
    });

    it('defaults STAGE to "dev" and DB_POOL_MAX to 5 when absent', () => {
        const parsed = EnvironmentSchema.parse(validBaseEnv);

        expect(parsed.STAGE).toBe('dev');
        expect(parsed.DB_POOL_MAX).toBe(5);
    });

    it('coerces DB_POOL_MAX from a string env var to a number', () => {
        const parsed = EnvironmentSchema.parse({ ...validBaseEnv, DB_POOL_MAX: '12' });

        expect(parsed.DB_POOL_MAX).toBe(12);
        expect(typeof parsed.DB_POOL_MAX).toBe('number');
    });

    it('throws a ZodError when DB_SECRET_ARN is missing', () => {
        const { DB_SECRET_ARN: _omit, ...rest } = validBaseEnv;

        expect(() => EnvironmentSchema.parse(rest)).toThrow();
    });

    it('throws when neither IDP_SECRET_KEY nor AUTH_SECRET_ARN is provided', () => {
        const { IDP_SECRET_KEY: _omit, ...rest } = validBaseEnv;

        expect(() => EnvironmentSchema.parse(rest)).toThrow();
    });

    it('accepts AUTH_SECRET_ARN instead of IDP_SECRET_KEY', () => {
        const { IDP_SECRET_KEY: _omit, ...rest } = validBaseEnv;

        expect(() =>
            EnvironmentSchema.parse({
                ...rest,
                AUTH_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:kitchensink/auth/test',
            }),
        ).not.toThrow();
    });
});

describe('WebhookEnvironmentSchema', () => {
    it('parses a complete valid webhook env', () => {
        expect(() =>
            WebhookEnvironmentSchema.parse({
                ...validBaseEnv,
                DELETION_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue',
            }),
        ).not.toThrow();
    });

    it('throws when DELETION_QUEUE_URL is missing, even though the base fields are present', () => {
        const { DELETION_QUEUE_URL: _unused, ...rest } = validBaseEnv as typeof validBaseEnv & {
            DELETION_QUEUE_URL?: string;
        };

        expect(() =>
            WebhookEnvironmentSchema.parse({
                ...rest,
                IDP_WEBHOOK_SECRET: 'whsec_test_123',
            }),
        ).toThrow();
    });

    it('throws when IDP_WEBHOOK_SECRET is missing, even though the base fields are present', () => {
        expect(() =>
            WebhookEnvironmentSchema.parse({
                ...validBaseEnv,
                IDP_WEBHOOK_SECRET: undefined,
                DELETION_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue',
            }),
        ).toThrow();
    });
});

describe('ConfigError', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is an Error subclass carrying the stable grep-able code and the underlying zod issues', () => {
        vi.stubEnv('DB_SECRET_ARN', '');
        vi.stubEnv('IDP_SECRET_KEY', '');
        vi.stubEnv('AUTH_SECRET_ARN', '');

        let caught: unknown;

        try {
            resolveEnvironment();
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        expect(caught).toBeInstanceOf(ConfigError);
        expect((caught as ConfigError).name).toBe('ConfigError');
        expect((caught as ConfigError).code).toBe('IDENTITY_WEBHOOKS_INVALID_ENV');
        expect((caught as ConfigError).issues.length).toBeGreaterThan(0);
    });

    it('isConfigError narrows only genuine ConfigError instances', () => {
        expect(isConfigError(new Error('nope'))).toBe(false);
        expect(isConfigError('IDENTITY_WEBHOOKS_INVALID_ENV')).toBe(false);
        expect(isConfigError(undefined)).toBe(false);
    });
});

describe('resolveEnvironment', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('parses process.env with IdP env vars', () => {
        for (const [key, value] of Object.entries(validBaseEnv)) {
            vi.stubEnv(key, value);
        }

        expect(resolveEnvironment()).toMatchObject(validBaseEnv);
    });

    it('throws a typed coded ConfigError (not a bare ZodError) naming the missing var', () => {
        vi.stubEnv('DB_SECRET_ARN', '');
        vi.stubEnv('IDP_SECRET_KEY', '');
        vi.stubEnv('AUTH_SECRET_ARN', '');

        let caught: unknown;

        try {
            resolveEnvironment();
        } catch (error) {
            caught = error;
        }

        expect(isConfigError(caught)).toBe(true);
        expect((caught as ConfigError).code).toBe(CONFIG_ERROR_CODE);
        expect((caught as ConfigError).message).toContain('DB_SECRET_ARN');
        expect((caught as ConfigError).invalidVars).toContain('DB_SECRET_ARN');
        expect((caught as ConfigError).issues.length).toBeGreaterThan(0);
    });
});

describe('resolveWebhookEnvironment', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('parses process.env with the webhook-specific required fields', () => {
        for (const [key, value] of Object.entries(validBaseEnv)) {
            vi.stubEnv(key, value);
        }

        vi.stubEnv('DELETION_QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue');

        expect(resolveWebhookEnvironment()).toMatchObject({
            ...validBaseEnv,
            DELETION_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue',
        });
    });
});

describe('getConfig / getWebhookConfig (memoized cold-start accessors)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        resetConfigCacheForTests();
    });

    it('parses once and caches — a later process.env mutation is NOT reflected until reset', () => {
        for (const [key, value] of Object.entries(validBaseEnv)) {
            vi.stubEnv(key, value);
        }

        const first = getConfig();

        expect(first.DB_SECRET_ARN).toBe(validBaseEnv.DB_SECRET_ARN);

        vi.stubEnv('DB_SECRET_ARN', 'arn:aws:secretsmanager:us-east-1:123456789012:secret:kitchensink/db/changed');
        const second = getConfig();

        // Same cached object, unaffected by the mutation above — proves it wasn't re-parsed.
        expect(second).toBe(first);
        expect(second.DB_SECRET_ARN).toBe(validBaseEnv.DB_SECRET_ARN);
    });

    it('resetConfigCacheForTests forces the next call to re-parse process.env', () => {
        for (const [key, value] of Object.entries(validBaseEnv)) {
            vi.stubEnv(key, value);
        }

        getConfig();

        vi.stubEnv('DB_SECRET_ARN', 'arn:aws:secretsmanager:us-east-1:123456789012:secret:kitchensink/db/changed');
        resetConfigCacheForTests();

        expect(getConfig().DB_SECRET_ARN).toBe(
            'arn:aws:secretsmanager:us-east-1:123456789012:secret:kitchensink/db/changed',
        );
    });

    it('getWebhookConfig fails fast (throws) when the webhook-only fields are absent', () => {
        const {
            DELETION_QUEUE_URL: _unused,
            IDP_WEBHOOK_SECRET: _unused2,
            ...rest
        } = validBaseEnv as typeof validBaseEnv & {
            DELETION_QUEUE_URL?: string;
        };

        for (const [key, value] of Object.entries(rest)) {
            vi.stubEnv(key, value);
        }

        let caught: unknown;

        try {
            getWebhookConfig();
        } catch (error) {
            caught = error;
        }

        expect(isConfigError(caught)).toBe(true);
        expect((caught as ConfigError).code).toBe(CONFIG_ERROR_CODE);
        expect((caught as ConfigError).message).toContain('DELETION_QUEUE_URL');
    });

    it('getWebhookConfig succeeds and caches independently of getConfig', () => {
        for (const [key, value] of Object.entries(validBaseEnv)) {
            vi.stubEnv(key, value);
        }

        vi.stubEnv('DELETION_QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue');

        expect(getWebhookConfig().IDP_WEBHOOK_SECRET).toBe('whsec_test_123');
    });
});

describe('getErasureFanoutConfig (CR-002 / U4b — fail-closed fan-out gate)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns the signing key + recipe/food base URLs when all three are set', () => {
        vi.stubEnv('SERVICE_ERASURE_SIGNING_KEY', 'PRIVATE-PEM');
        vi.stubEnv('RECIPE_SERVICE_BASE_URL', 'https://recipe.example.test');
        vi.stubEnv('FOOD_SERVICE_BASE_URL', 'https://food.example.test');

        expect(getErasureFanoutConfig()).toEqual({
            signingKeyPem: 'PRIVATE-PEM',
            recipeBaseUrl: 'https://recipe.example.test',
            foodBaseUrl: 'https://food.example.test',
        });
    });

    it.each([['SERVICE_ERASURE_SIGNING_KEY'], ['RECIPE_SERVICE_BASE_URL'], ['FOOD_SERVICE_BASE_URL']])(
        'throws a ConfigError naming %s when it is missing (never silently skips a leg)',
        (missing) => {
            const all = {
                SERVICE_ERASURE_SIGNING_KEY: 'PRIVATE-PEM',
                RECIPE_SERVICE_BASE_URL: 'https://recipe.example.test',
                FOOD_SERVICE_BASE_URL: 'https://food.example.test',
            } as Record<string, string>;

            for (const [key, value] of Object.entries(all)) {
                if (key !== missing) {
                    vi.stubEnv(key, value);
                }
            }

            let caught: unknown;

            try {
                getErasureFanoutConfig();
            } catch (err) {
                caught = err;
            }

            expect(isConfigError(caught)).toBe(true);
            expect((caught as ConfigError).message).toContain(missing);
        },
    );

    it('treats an EMPTY value as missing (fails closed, not a blank-signing-key erase)', () => {
        vi.stubEnv('SERVICE_ERASURE_SIGNING_KEY', '');
        vi.stubEnv('RECIPE_SERVICE_BASE_URL', 'https://recipe.example.test');
        vi.stubEnv('FOOD_SERVICE_BASE_URL', 'https://food.example.test');

        expect(() => getErasureFanoutConfig()).toThrow(ConfigError);
    });
});
