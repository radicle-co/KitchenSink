import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { apiConfigSchema } from '../config.types.js';
import { ConfigValidationError, isConfigValidationError, loadConfig } from '../load-config.js';

// Mock the SSM client so the fallback path is exercised without any network / AWS credentials.
const ssmSend = vi.fn();

vi.mock('@aws-sdk/client-ssm', () => ({
    SSMClient: class {
        public send = ssmSend;
    },
    GetParametersCommand: class {
        public input: unknown;
        constructor(input: unknown) {
            this.input = input;
        }
    },
}));

/**
 * A minimal but fully-valid environment for {@link apiConfigSchema}: the required
 * Clerk/storage/database-connection values, relying on schema defaults for
 * everything else (port, pool, rate limits, etc.). The DB connection uses the
 * `DATABASE_URL` arm of the either/or union so the intersection resolves.
 */
const validEnv = (): Record<string, string> => ({
    NODE_ENV: 'production',
    CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----abc-----END PUBLIC KEY-----',
    CLERK_AUTHORIZED_PARTIES: 'https://commise.app',
    S3_BUCKET_PHOTOS: 'commise-photos',
    S3_BUCKET_VERSIONS: 'commise-versions',
    CLOUDFRONT_URL: 'https://cdn.commise.app',
    DATABASE_URL: 'postgres://recipe_app@localhost:5432/kitchensink_recipes',
});

describe('loadConfig', () => {
    it('parses a fully-valid environment into the typed config with defaults applied', () => {
        const config = loadConfig(apiConfigSchema, validEnv());

        expect(config.NODE_ENV).toBe('production');
        expect(config.CLERK_JWT_KEY).toContain('BEGIN PUBLIC KEY');
        expect(config.S3_BUCKET_PHOTOS).toBe('commise-photos');
        expect(config.CLOUDFRONT_URL).toBe('https://cdn.commise.app');
        // Defaults from the schema are materialized and coerced to their target types.
        expect(config.PORT).toBe(3000);
        expect(config.LOG_LEVEL).toBe('info');
        expect(config.SENTRY_DSN).toBe('');
        expect(config.DATABASE_POOL_SIZE).toBe(50);
        // The DATABASE_URL arm of the connection union is present.
        expect('DATABASE_URL' in config ? config.DATABASE_URL : undefined).toBe(
            'postgres://recipe_app@localhost:5432/kitchensink_recipes',
        );
    });

    it('throws ConfigValidationError (guarded by isConfigValidationError) when a required var is missing', () => {
        const env = validEnv();
        delete env['CLERK_JWT_KEY'];

        let caught: unknown;
        try {
            loadConfig(apiConfigSchema, env);
        } catch (error) {
            caught = error;
        }

        expect(isConfigValidationError(caught)).toBe(true);
        expect(caught).toBeInstanceOf(ConfigValidationError);
        expect((caught as ConfigValidationError).message).toContain('CLERK_JWT_KEY');
    });

    it('throws ConfigValidationError on an invalid value', () => {
        const env = validEnv();
        env['NODE_ENV'] = 'banana';
        env['CLOUDFRONT_URL'] = 'not-a-url';

        expect(() => loadConfig(apiConfigSchema, env)).toThrow(ConfigValidationError);

        try {
            loadConfig(apiConfigSchema, env);
            expect.unreachable('loadConfig should have thrown');
        } catch (error) {
            expect(isConfigValidationError(error)).toBe(true);
            const message = (error as ConfigValidationError).message;
            expect(message).toContain('NODE_ENV');
            expect(message).toContain('CLOUDFRONT_URL');
        }
    });

    it('aggregates every offending key into the error message and issues list', () => {
        const env = validEnv();
        delete env['CLERK_JWT_KEY'];
        delete env['S3_BUCKET_PHOTOS'];
        delete env['CLERK_AUTHORIZED_PARTIES'];

        try {
            loadConfig(apiConfigSchema, env);
            expect.unreachable('loadConfig should have thrown');
        } catch (error) {
            expect(isConfigValidationError(error)).toBe(true);
            const configError = error as ConfigValidationError;

            const offendingKeys = configError.issues.map((issue) => String(issue.path[0]));
            expect(offendingKeys).toContain('CLERK_JWT_KEY');
            expect(offendingKeys).toContain('S3_BUCKET_PHOTOS');
            expect(offendingKeys).toContain('CLERK_AUTHORIZED_PARTIES');
            expect(configError.issues.length).toBeGreaterThanOrEqual(3);

            expect(configError.message).toContain('CLERK_JWT_KEY');
            expect(configError.message).toContain('S3_BUCKET_PHOTOS');
            expect(configError.message).toContain('CLERK_AUTHORIZED_PARTIES');
        }
    });
});

/**
 * SSM-fallback path (T017): when `ssmFallback` is enabled and a required var is absent from the
 * environment, the loader resolves it from AWS SSM Parameter Store at `/{prefix}/{environment}/{KEY}`
 * and re-validates. The async overload reads `process.env`, so each case snapshots + restores it.
 */
describe('loadConfig — SSM fallback', () => {
    const savedEnv = { ...process.env };

    beforeEach(() => {
        ssmSend.mockReset();
        // Seed process.env with a fully-valid environment, then remove one required var per case.
        for (const [key, value] of Object.entries(validEnv())) {
            process.env[key] = value;
        }
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) {
                delete process.env[key];
            }
        }
        for (const [key, value] of Object.entries(savedEnv)) {
            process.env[key] = value;
        }
    });

    it('resolves a missing required var from SSM and returns the merged, validated config', async () => {
        delete process.env['CLERK_JWT_KEY'];
        ssmSend.mockResolvedValue({
            Parameters: [
                { Name: '/commise/production/CLERK_JWT_KEY', Value: '-----BEGIN PUBLIC KEY-----ssm-----END PUBLIC KEY-----' },
            ],
        });

        const config = await loadConfig(apiConfigSchema, {
            ssmFallback: true,
            ssm: { prefix: '/commise', region: 'us-east-1', withDecryption: true, cacheTtlSeconds: 0 },
            environment: 'production',
        });

        expect(ssmSend).toHaveBeenCalledOnce();
        // The missing key was requested from SSM at the namespaced path.
        const command = ssmSend.mock.calls[0]![0] as { input: { Names: string[]; WithDecryption?: boolean } };
        expect(command.input.Names).toContain('/commise/production/CLERK_JWT_KEY');
        expect(command.input.WithDecryption).toBe(true);
        // The value fetched from SSM is present in the validated config.
        expect(config.CLERK_JWT_KEY).toContain('ssm');
        expect(config.NODE_ENV).toBe('production');
    });

    it('does not touch SSM when the environment already validates', async () => {
        const config = await loadConfig(apiConfigSchema, {
            ssmFallback: true,
            ssm: { prefix: '/commise', region: 'us-east-1', withDecryption: true, cacheTtlSeconds: 0 },
            environment: 'production',
        });

        expect(ssmSend).not.toHaveBeenCalled();
        expect(config.S3_BUCKET_PHOTOS).toBe('commise-photos');
    });

    it('still throws ConfigValidationError when SSM cannot supply the missing var', async () => {
        delete process.env['CLERK_JWT_KEY'];
        ssmSend.mockResolvedValue({ Parameters: [] });

        let caught: unknown;
        try {
            await loadConfig(apiConfigSchema, {
                ssmFallback: true,
                ssm: { prefix: '/commise', region: 'us-east-1', withDecryption: true, cacheTtlSeconds: 0 },
                environment: 'production',
            });
        } catch (error) {
            caught = error;
        }

        expect(isConfigValidationError(caught)).toBe(true);
        expect((caught as ConfigValidationError).message).toContain('CLERK_JWT_KEY');
    });
});
