/** @module @kitchensink/config — Unified configuration system for all Commise apps and services */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * Valid deployment environments.
 * Used as the discriminator for environment-specific behavior.
 */
export const ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/** Union type of valid environment names. */
export type Environment = (typeof ENVIRONMENTS)[number];

/** Zod schema for environment validation. */
export const environmentSchema = z.enum(ENVIRONMENTS);

// ---------------------------------------------------------------------------
// Config Source: where a value comes from
// ---------------------------------------------------------------------------

/**
 * Describes how a config value is resolved at runtime.
 *
 * - `env` — Read from `process.env` (the default for all values)
 * - `ssm` — Fetched from AWS SSM Parameter Store at boot (secrets in local dev / Lambda)
 * - `infra` — Injected by CDK/ECS task definition from SSM → env var (production default for secrets)
 *
 * In production, secrets flow: SSM Parameter Store → CDK ECS TaskDef → container env var → `env` source.
 * The `ssm` source is a fallback for contexts where infra injection isn't available (local dev, Lambda).
 */
export const CONFIG_SOURCES = ['env', 'ssm', 'infra'] as const;

/** Union type of config value sources. */
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

// ---------------------------------------------------------------------------
// SSM Configuration (for runtime fetch mode)
// ---------------------------------------------------------------------------

/**
 * Configuration for SSM Parameter Store access.
 * Only needed when `ssm` source is used (local dev, Lambda).
 */
export const ssmConfigSchema = z.object({
    /** AWS region for SSM calls. Defaults to `us-east-1`. */
    region: z.string().default('us-east-1'),

    /**
     * SSM parameter path prefix. Parameters are namespaced:
     * `/{prefix}/{environment}/{key}`
     *
     * Example: `/commise/production/DATABASE_URL`
     */
    prefix: z.string().default('/commise'),

    /** Whether to decrypt SecureString parameters. Defaults to `true`. */
    withDecryption: z.boolean().default(true),

    /**
     * TTL in seconds for cached SSM values. `0` means no caching (fetch every time).
     * Defaults to 300 (5 minutes).
     */
    cacheTtlSeconds: z.number().int().min(0).default(300),
});

/** Typed SSM configuration. */
export type SsmConfig = z.infer<typeof ssmConfigSchema>;

// ---------------------------------------------------------------------------
// Secret vs Non-Secret Marker
// ---------------------------------------------------------------------------

/**
 * Metadata for a config field indicating whether it contains sensitive data.
 * Used by the config loader to determine SSM fetch behavior and logging redaction.
 */
export interface ConfigFieldMeta {
    /** If `true`, value is never logged, always redacted in diagnostics. */
    readonly secret: boolean;

    /**
     * SSM parameter name override. Defaults to the env var name lowercased.
     * Example: `DATABASE_URL` → `database_url` in SSM path.
     */
    readonly ssmKey?: string;

    /** Human-readable description for documentation and error messages. */
    readonly description: string;
}

// ---------------------------------------------------------------------------
// Base App Config (shared by ALL apps/services)
// ---------------------------------------------------------------------------

/**
 * Base configuration schema shared by every app and service.
 * All values sourced from environment variables, validated at startup.
 */
export const baseConfigSchema = z.object({
    /** Deployment environment. */
    NODE_ENV: environmentSchema,

    /** HTTP port for the server. Defaults to 3000. */
    PORT: z.coerce.number().int().positive().default(3000),

    /** Log level. */
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    /** Sentry DSN for error reporting. Empty string disables Sentry. */
    SENTRY_DSN: z.string().default(''),

    /** Sentry environment tag. Defaults to NODE_ENV value. */
    SENTRY_ENVIRONMENT: z.string().optional(),
});

/** Typed base configuration. */
export type BaseConfig = z.infer<typeof baseConfigSchema>;

// ---------------------------------------------------------------------------
// Database Config
// ---------------------------------------------------------------------------

/**
 * Database configuration. Secret fields marked below.
 * In production: CDK injects `DATABASE_URL` from SSM → env var.
 * In local dev: `.env` file or SSM fetch.
 */
export const databaseConfigSchema = z.object({
    /** PostgreSQL connection string. SECRET. */
    DATABASE_URL: z.string().url(),

    /** Connection pool size. Defaults to 50. */
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(50),

    /** Connection pool idle timeout in ms. Defaults to 10000. */
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
});

/** Typed database configuration. */
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

/** Secret/non-secret metadata for database config fields. */
export const databaseConfigMeta: Record<keyof DatabaseConfig, ConfigFieldMeta> = {
    DATABASE_URL: { secret: true, description: 'PostgreSQL connection string' },
    DATABASE_POOL_SIZE: { secret: false, description: 'Connection pool size' },
    DATABASE_IDLE_TIMEOUT_MS: { secret: false, description: 'Pool idle timeout (ms)' },
};

// ---------------------------------------------------------------------------
// Clerk Config
// ---------------------------------------------------------------------------

/**
 * Clerk configuration for networkless session-token verification.
 * Both fields are non-secret: `CLERK_JWT_KEY` is the instance's public PEM key
 * and `CLERK_AUTHORIZED_PARTIES` is the `azp` allowlist. There is no client
 * secret, audience, or JWKS-URI round trip — `@clerk/backend` `verifyToken`
 * validates the token offline against the public key.
 */
export const clerkConfigSchema = z.object({
    /** Clerk instance public JWT key (PEM). Used by `verifyToken` for offline verification. */
    CLERK_JWT_KEY: z.string().min(1),

    /** Comma-separated `azp` allowlist of authorized parties (web/mobile origins). */
    CLERK_AUTHORIZED_PARTIES: z.string().min(1),
});

/** Typed Clerk configuration. */
export type ClerkConfig = z.infer<typeof clerkConfigSchema>;

/** Secret/non-secret metadata for Clerk config fields. */
export const clerkConfigMeta: Record<keyof ClerkConfig, ConfigFieldMeta> = {
    CLERK_JWT_KEY: { secret: false, description: 'Clerk instance public JWT key (PEM)' },
    CLERK_AUTHORIZED_PARTIES: { secret: false, description: 'Authorized parties (azp) allowlist' },
};

// ---------------------------------------------------------------------------
// S3 / Storage Config
// ---------------------------------------------------------------------------

/** S3 and CloudFront configuration for photo storage and serving. */
export const storageConfigSchema = z.object({
    /** S3 endpoint URL. Override for LocalStack in dev. Omit for real AWS. */
    S3_ENDPOINT: z.string().url().optional(),

    /** Force path-style S3 access (required for LocalStack). Defaults to false. */
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

    /** S3 bucket for recipe photos. */
    S3_BUCKET_PHOTOS: z.string().min(1),

    /** S3 bucket for recipe version archives. */
    S3_BUCKET_VERSIONS: z.string().min(1),

    /** CloudFront distribution URL for serving photos. */
    CLOUDFRONT_URL: z.string().url(),

    /** Presigned URL expiry in seconds. Defaults to 900 (15 min). */
    PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900),
});

/** Typed storage configuration. */
export type StorageConfig = z.infer<typeof storageConfigSchema>;

/** Secret/non-secret metadata for storage config fields. */
export const storageConfigMeta: Record<keyof StorageConfig, ConfigFieldMeta> = {
    S3_ENDPOINT: { secret: false, description: 'S3 endpoint (LocalStack override)' },
    S3_FORCE_PATH_STYLE: { secret: false, description: 'Force path-style S3 (LocalStack)' },
    S3_BUCKET_PHOTOS: { secret: false, description: 'Photo storage bucket' },
    S3_BUCKET_VERSIONS: { secret: false, description: 'Version archive bucket' },
    CLOUDFRONT_URL: { secret: false, description: 'CloudFront distribution URL' },
    PRESIGNED_URL_EXPIRY_SECONDS: { secret: false, description: 'Presigned URL TTL' },
};

// ---------------------------------------------------------------------------
// Rate Limiting Config
// ---------------------------------------------------------------------------

/** Rate limiting configuration per endpoint category. */
export const rateLimitConfigSchema = z.object({
    /** Write endpoint limit (req/min per user). Defaults to 30. */
    RATE_LIMIT_WRITE: z.coerce.number().int().positive().default(30),

    /** Photo upload limit (req/min per user). Defaults to 10. */
    RATE_LIMIT_PHOTO_UPLOAD: z.coerce.number().int().positive().default(10),

    /** Search endpoint limit (req/min per user). Defaults to 60. */
    RATE_LIMIT_SEARCH: z.coerce.number().int().positive().default(60),
});

/** Typed rate limiting configuration. */
export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;

// ---------------------------------------------------------------------------
// Composite: Full API Config
// ---------------------------------------------------------------------------

/**
 * Complete configuration schema for the NestJS API (`@kitchensink/api`).
 * Merges all config domains into a single validated schema.
 *
 * Usage at app boot:
 * ```typescript
 * import { loadConfig, apiConfigSchema } from '@kitchensink/config';
 * const config = await loadConfig(apiConfigSchema);
 * ```
 */
export const apiConfigSchema = baseConfigSchema
    .merge(databaseConfigSchema)
    .merge(clerkConfigSchema)
    .merge(storageConfigSchema)
    .merge(rateLimitConfigSchema);

/** Typed full API configuration. */
export type ApiConfig = z.infer<typeof apiConfigSchema>;

// ---------------------------------------------------------------------------
// Composite: Photo Processor Lambda Config
// ---------------------------------------------------------------------------

/**
 * Configuration schema for the photo processor Lambda.
 * Subset of the full API config — no Clerk, no rate limits.
 */
export const photoProcessorConfigSchema = baseConfigSchema.merge(storageConfigSchema).merge(databaseConfigSchema);

/** Typed photo processor configuration. */
export type PhotoProcessorConfig = z.infer<typeof photoProcessorConfigSchema>;

// ---------------------------------------------------------------------------
// Config Loader Interface
// ---------------------------------------------------------------------------

/**
 * Options for the config loader.
 *
 * The loader resolves values in this order:
 * 1. `process.env` (always checked first — covers infra-injected secrets + non-secrets)
 * 2. SSM Parameter Store (if `ssmFallback` is enabled and env var is missing)
 * 3. Zod schema default (if defined)
 * 4. Validation error (if required and no value found)
 */
export interface LoadConfigOptions {
    /**
     * Enable SSM fallback for missing env vars marked as secret.
     * When `true`, the loader fetches missing secret values from SSM Parameter Store.
     *
     * Typical usage:
     * - `true` in local development (secrets not in env, fetched from SSM)
     * - `true` in Lambda (no ECS task def to inject secrets)
     * - `false` in Fargate production (CDK injects all secrets as env vars)
     *
     * Defaults to `false`.
     */
    readonly ssmFallback?: boolean;

    /** SSM configuration. Required if `ssmFallback` is `true`. */
    readonly ssm?: SsmConfig;

    /**
     * Environment override. Defaults to `process.env.NODE_ENV`.
     * Used to construct SSM path: `/{prefix}/{environment}/{key}`.
     */
    readonly environment?: Environment;
}

/**
 * Config loader function signature.
 *
 * Validates all environment variables against the provided Zod schema,
 * optionally fetching secrets from SSM Parameter Store for missing values.
 *
 * Fails fast on startup with a clear error listing ALL missing/invalid values
 * (not one at a time).
 *
 * @example
 * ```typescript
 * // In NestJS main.ts
 * import { loadConfig, apiConfigSchema } from '@kitchensink/config';
 *
 * async function bootstrap() {
 *   const config = await loadConfig(apiConfigSchema, {
 *     ssmFallback: process.env.NODE_ENV === 'development',
 *     ssm: { prefix: '/commise', region: 'us-east-1' },
 *   });
 *
 *   const app = await NestFactory.create(AppModule);
 *   app.listen(config.PORT);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // In Lambda handler
 * import { loadConfig, photoProcessorConfigSchema } from '@kitchensink/config';
 *
 * const config = await loadConfig(photoProcessorConfigSchema, {
 *   ssmFallback: true,
 *   ssm: { prefix: '/commise' },
 * });
 * ```
 */
export type LoadConfigFn = <T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    options?: LoadConfigOptions,
) => Promise<z.infer<z.ZodObject<T>>>;
