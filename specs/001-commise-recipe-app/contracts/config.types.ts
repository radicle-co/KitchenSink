/**
 * @module recipes/config — Configuration contract for the recipe service, living in its own
 * `config/` module at `packages/services/recipe-service/src/config/`.
 *
 * There is **no** shared `@kitchensink/shared-config` package: like the identity and food services,
 * each service owns its config module (schemas + loader). This file documents the recipe service's
 * config contract; the schemas below are defined and validated inside that service's `config/` module.
 */

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
     * Example: `/commise/production/SENTRY_DSN`. Note the database is passwordless (RDS-IAM),
     * so there is no `DATABASE_URL`/DB-password parameter in SSM.
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

/** The recipe service's logical database on the shared RDS cluster. */
export const RECIPE_DB_NAME = 'kitchensink_recipes';

/** The least-privilege role the recipe workloads authenticate as (passwordless, RDS-IAM). */
export const RECIPE_DB_USERNAME = 'recipe_app';

/** Default AWS region used when minting RDS IAM auth tokens. */
export const DEFAULT_AWS_REGION = 'us-east-1';

/**
 * Database CONNECTION config — passwordless **RDS-IAM**, mirroring the shipped food service
 * (`packages/services/food-service/src/database/pool-config.ts`). There is deliberately **no**
 * database password secret and **no** `secret: true` `DATABASE_URL` fetched from SSM.
 *
 * Either/or, exactly like the food service's `EnvironmentSchema`:
 * - `DATABASE_URL` — **LOCAL DEV ONLY** (a full libpq URL against docker Postgres). It is **not** a
 *   production secret; deployed stages never set it.
 * - the discrete `DB_HOST` / `DB_PORT` / `DB_NAME` (=`kitchensink_recipes`) / `DB_USERNAME`
 *   (=`recipe_app`) parts plus `AWS_REGION`. Deployed stages authenticate `recipe_app`
 *   passwordlessly: the `pg` pool's `password` provider mints a short-lived (~15-min) RDS IAM auth
 *   token per new connection via `@aws-sdk/rds-signer` `new Signer({ hostname, port, username, region
 *   }).getAuthToken()`, so the token is refreshed transparently as the pool opens/recycles
 *   connections — no rotation, no stored secret. TLS is required by RDS IAM auth.
 */
export const databaseConnectionSchema = z.union([
    z.object({
        /** LOCAL DEV ONLY libpq URL (docker Postgres). NOT a production secret; unset in deployed stages. */
        DATABASE_URL: z.string().url(),
    }),
    z.object({
        /** RDS endpoint host. */
        DB_HOST: z.string().min(1),
        /** RDS port. Defaults to 5432. */
        DB_PORT: z.coerce.number().int().positive().default(5432),
        /** Recipe logical database name. Defaults to `kitchensink_recipes`. */
        DB_NAME: z.string().min(1).default(RECIPE_DB_NAME),
        /** Least-privilege role. Defaults to `recipe_app`. */
        DB_USERNAME: z.string().min(1).default(RECIPE_DB_USERNAME),
        /** Region for minting the RDS IAM auth token (`@aws-sdk/rds-signer`). */
        AWS_REGION: z.string().min(1).default(DEFAULT_AWS_REGION),
    }),
]);

/** Typed database connection configuration (URL form or discrete IAM form). */
export type DatabaseConnectionConfig = z.infer<typeof databaseConnectionSchema>;

/**
 * Non-secret connection-pool tuning knobs. Kept as a plain object schema (separate from the
 * either/or {@link databaseConnectionSchema}) so it can be `.merge()`d into the composite
 * {@link apiConfigSchema}; the connection union is applied with `.and()`.
 */
export const databasePoolConfigSchema = z.object({
    /** Connection pool size. Defaults to 50. */
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(50),

    /** Connection pool idle timeout in ms. Defaults to 10000. */
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
});

/** Typed pool configuration. */
export type DatabasePoolConfig = z.infer<typeof databasePoolConfigSchema>;

/** Full typed database configuration: connection (either form) plus pool knobs. */
export type DatabaseConfig = DatabaseConnectionConfig & DatabasePoolConfig;

/**
 * Secret/non-secret metadata for database config fields. Every field is **non-secret**: there is no
 * database password anywhere under RDS-IAM. `DATABASE_URL` is a local-dev-only convenience, not a
 * production secret, so it is not marked `secret`.
 */
export const databaseConfigMeta: Record<string, ConfigFieldMeta> = {
    DATABASE_URL: {
        secret: false,
        description: 'LOCAL DEV ONLY libpq URL (docker Postgres); unset in deployed stages',
    },
    DB_HOST: { secret: false, description: 'RDS endpoint host' },
    DB_PORT: { secret: false, description: 'RDS port (default 5432)' },
    DB_NAME: { secret: false, description: 'Recipe logical database (kitchensink_recipes)' },
    DB_USERNAME: { secret: false, description: 'Least-privilege recipe_app role (RDS-IAM, passwordless)' },
    AWS_REGION: { secret: false, description: 'Region for minting RDS IAM auth tokens' },
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
 * Complete configuration schema for the recipe NestJS service (`@kitchensink/recipe-service`).
 * Merges all config domains into a single validated schema.
 *
 * Usage at app boot:
 * ```typescript
 * import { loadConfig, apiConfigSchema } from './config/index.js';
 * const config = await loadConfig(apiConfigSchema);
 * ```
 */
export const apiConfigSchema = baseConfigSchema
    .merge(databasePoolConfigSchema)
    .merge(clerkConfigSchema)
    .merge(storageConfigSchema)
    .merge(rateLimitConfigSchema)
    // The DB connection is an either/or (URL vs discrete IAM parts), so it is intersected in rather
    // than merged — a union is not a ZodObject and cannot be `.merge()`d.
    .and(databaseConnectionSchema);

/** Typed full API configuration. */
export type ApiConfig = z.infer<typeof apiConfigSchema>;

// ---------------------------------------------------------------------------
// Composite: Photo Processor Lambda Config
// ---------------------------------------------------------------------------

/**
 * Configuration schema for the photo processor Lambda.
 *
 * S3-only: no database, no Clerk, no rate limits. The processor is **not** VPC-attached and never
 * touches RDS (preserves ADR-0004 minimize-NAT/VPC). It resizes, writes to S3, and emits an SQS
 * `photo-processed` message; the in-VPC Fargate recipe API consumes that message and performs the
 * `recipe_photos` completion `UPDATE`. Hence the deliberate absence of the database connection/pool
 * schemas here.
 */
export const photoProcessorConfigSchema = baseConfigSchema.merge(storageConfigSchema);

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
 * // In the recipe service's NestJS main.ts
 * import { loadConfig, apiConfigSchema } from './config/index.js';
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
 * // In the photo-processor Lambda handler (its own config/ module)
 * import { loadConfig, photoProcessorConfigSchema } from './config/index.js';
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
