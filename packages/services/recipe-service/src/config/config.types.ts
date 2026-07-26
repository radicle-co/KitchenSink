/**
 * @module recipes/config — Configuration contract for the recipe service, living in its own
 * `config/` module at `packages/services/recipe-service/src/config/`.
 *
 * There is **no** shared `@kitchensink/shared-config` package: like the identity and food services,
 * each service owns its config module (schemas + loader). This file documents the recipe service's
 * config contract; the schemas below are defined and validated inside that service's `config/` module.
 */

import { z } from 'zod';
import { hasExactlyOneAzpMode } from '@kitchensink/clerk-verify';

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

    /** Comma-separated `azp` allowlist (exact-match mode). Exactly one of this or `CLERK_AZP_PATTERN`. */
    CLERK_AUTHORIZED_PARTIES: z.string().min(1).optional(),

    /**
     * Preview-subdomain base domain (pattern mode, e.g. `sandbox.commise.app`). When set, `azp` is
     * validated against an anchored per-PR pattern instead of the exact-match list. Mutually exclusive
     * with the list and forbidden in `production` — enforced by {@link apiConfigSchema}'s `superRefine`.
     */
    CLERK_AZP_PATTERN: z.string().min(1).optional(),
});

/** Typed Clerk configuration. */
export type ClerkConfig = z.infer<typeof clerkConfigSchema>;

/** Secret/non-secret metadata for Clerk config fields. */
export const clerkConfigMeta: Record<keyof ClerkConfig, ConfigFieldMeta> = {
    CLERK_JWT_KEY: { secret: false, description: 'Clerk instance public JWT key (PEM)' },
    CLERK_AUTHORIZED_PARTIES: { secret: false, description: 'Authorized parties (azp) allowlist' },
    CLERK_AZP_PATTERN: { secret: false, description: 'Preview-subdomain base domain (azp pattern mode)' },
};

// ---------------------------------------------------------------------------
// Service-principal auth Config (CR-002 / U4a)
// ---------------------------------------------------------------------------

/**
 * Config for the GREENFIELD service-principal account-erasure path (CR-002 / U4a). The deletion-worker
 * Lambda signs a short-lived, single-target erasure token with a PRIVATE key; this service verifies it
 * networklessly with the corresponding PUBLIC key — mirroring the Clerk public-key posture (no secret on
 * this public-ALB service, no network round-trip).
 *
 * `RECIPE_SERVICE_PRINCIPAL_JWT_KEY` is OPTIONAL: a stage that has not yet provisioned the key (or local
 * dev) simply has no service-principal path — {@link import('../auth/service-erasure-auth.service.js').ServiceErasureAuthService}
 * fails CLOSED (rejects every service token) rather than failing to boot. This lets U4b provision the key
 * without a lockstep deploy. Non-secret: it is a PUBLIC verification key, not a signing secret.
 */
export const serviceAuthConfigSchema = z.object({
    /** Public SPKI PEM (EdDSA) used to verify the deletion-worker's erasure token. Absent ⇒ service path fails closed. */
    RECIPE_SERVICE_PRINCIPAL_JWT_KEY: z.string().min(1).optional(),
});

/** Typed service-principal auth configuration. */
export type ServiceAuthConfig = z.infer<typeof serviceAuthConfigSchema>;

/** Secret/non-secret metadata for service-principal auth config fields. */
export const serviceAuthConfigMeta: Record<keyof ServiceAuthConfig, ConfigFieldMeta> = {
    RECIPE_SERVICE_PRINCIPAL_JWT_KEY: {
        secret: false,
        description: 'Public EdDSA SPKI PEM verifying the deletion-worker service-erasure token (CR-002 / U4a)',
    },
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

    /**
     * CloudFront distribution id, for issuing invalidations on photo delete + GDPR erasure
     * (HAZ-051/067/039). OPTIONAL: no `Distribution` construct exists in this repo's CDK (the
     * distribution is provisioned outside it), so a stage without one yet — or local/dev — simply omits
     * this. When unset, invalidation degrades to a logged no-op rather than failing to boot or failing a
     * delete request; see `photos/cdn-invalidation.ts`.
     */
    CLOUDFRONT_DISTRIBUTION_ID: z.string().min(1).optional(),

    /** Presigned URL expiry in seconds. Defaults to 900 (15 min). */
    PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900),

    /**
     * Cover-thumbnail rendition — longest-edge bound in px (FOLLOW-UP-CR-001-A). The confirm path resizes
     * the uploaded original into a JPEG bounded to this size and serves it as `coverPhotoUrl`. Default 400
     * (comfortably covers a ~300px card tile at 1–1.5× density). Tunable per stage; format is fixed JPEG.
     */
    THUMBNAIL_MAX_PX: z.coerce.number().int().positive().default(400),

    /** Cover-thumbnail JPEG quality (1–100). Default 80 — the size/quality trade-off for a card tile. */
    THUMBNAIL_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
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
    CLOUDFRONT_DISTRIBUTION_ID: {
        secret: false,
        description: 'CloudFront distribution id for invalidations (HAZ-051/067/039); optional',
    },
    PRESIGNED_URL_EXPIRY_SECONDS: { secret: false, description: 'Presigned URL TTL' },
    THUMBNAIL_MAX_PX: { secret: false, description: 'Cover-thumbnail longest-edge bound (px)' },
    THUMBNAIL_QUALITY: { secret: false, description: 'Cover-thumbnail JPEG quality (1–100)' },
};

// ---------------------------------------------------------------------------
// Rate Limiting Config
// ---------------------------------------------------------------------------

/** Rate limiting configuration per endpoint category. */
export const rateLimitConfigSchema = z.object({
    /**
     * Read endpoint limit (req/min per client) for the common path — list/detail/get, including the
     * Home widget's reads. This is the default throttler's limit: any route without a category override
     * inherits it, so it is deliberately the most generous. Defaults to 120.
     */
    RATE_LIMIT_READ: z.coerce.number().int().positive().default(120),

    /** Write endpoint limit (req/min per user). Defaults to 30. */
    RATE_LIMIT_WRITE: z.coerce.number().int().positive().default(30),

    /** Photo upload limit (req/min per user). Defaults to 10. */
    RATE_LIMIT_PHOTO_UPLOAD: z.coerce.number().int().positive().default(10),

    /** Search endpoint limit (req/min per user). Defaults to 60. */
    RATE_LIMIT_SEARCH: z.coerce.number().int().positive().default(60),

    /**
     * GDPR account-export limit (req/min per user). Defaults to 10 — the tightest category. The export
     * assembles six owner-scoped tables into one document, so it is the heaviest single read and a
     * data-egress surface; a portability download is issued rarely, so a low cap curbs abuse/exfiltration
     * without impeding a genuine "download my data" request.
     */
    RATE_LIMIT_EXPORT: z.coerce.number().int().positive().default(10),
});

/** Typed rate limiting configuration. */
export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;

// ---------------------------------------------------------------------------
// Food Service Integration Config
// ---------------------------------------------------------------------------

/**
 * Config for the outbound call to the food service (003) that the ingredients vertical resolves
 * nutrition through (`@kitchensink/food-service-client`). Both are optional: `FOOD_SERVICE_URL` falls
 * back to a local-dev default in `IngredientsModule` when unset, and `FOOD_SERVICE_TOKEN` is only
 * present where the food service requires an M2M bearer. Declaring them here means the env is validated
 * at boot instead of being read as unchecked raw `process.env` (T043b).
 */
export const foodServiceConfigSchema = z.object({
    /** Food-service origin the ingredients vertical resolves against. Local-dev default applied downstream. */
    FOOD_SERVICE_URL: z.string().url().optional(),

    /** Optional service/M2M bearer token for the food service. */
    FOOD_SERVICE_TOKEN: z.string().min(1).optional(),

    /**
     * Stage-2 rollout switch for the blended ingredient typeahead. Absent (or anything but `false`) means the
     * blend is ON; `false` makes the typeahead recipe-local-only WITHOUT any cross-service call, reported to
     * the client as `catalogAvailability: 'disabled'` (distinct from the transient `'unavailable'`, so a
     * deliberate switch-off never renders as an error). The operator escape hatch for a food-service incident
     * that the per-request timeout + fallback alone do not make cheap enough.
     */
    FOOD_CATALOG_BLEND_ENABLED: z.stringbool().optional(),

    /**
     * Per-keystroke bound (ms) on the catalog-blend request to food-service. Tunable because the right value
     * depends on observed inter-service latency, and the blast radius of a wrong one is bounded by design (too
     * low simply means the catalog section degrades to empty). `IngredientsModule` applies a default.
     */
    FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS: z.coerce.number().int().min(50).max(5_000).optional(),
});

/** Typed food-service integration configuration. */
export type FoodServiceConfig = z.infer<typeof foodServiceConfigSchema>;

/** Secret/non-secret metadata for food-service config fields. */
export const foodServiceConfigMeta: Record<keyof FoodServiceConfig, ConfigFieldMeta> = {
    FOOD_SERVICE_URL: { secret: false, description: 'Food service (003) origin' },
    FOOD_SERVICE_TOKEN: { secret: true, description: 'Food service M2M bearer token' },
    FOOD_CATALOG_BLEND_ENABLED: {
        secret: false,
        description: 'Stage-2 blended ingredient typeahead switch (default on)',
    },
    FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS: {
        secret: false,
        description: 'Per-keystroke food-catalog search timeout (ms)',
    },
};

// ---------------------------------------------------------------------------
// Account Erasure Config
// ---------------------------------------------------------------------------

/**
 * Config for the GDPR account-erasure hand-off (C-007 / D7): the `account-erasure` SQS queue the
 * service enqueues to on `POST /v1/account/erasure`, drained by the worker in
 * `@kitchensink/recipe-workers`.
 *
 * `ACCOUNT_ERASURE_QUEUE_URL` is REQUIRED, not optional. The service can technically accept an erasure
 * request without it — the `account_erasure_jobs` row is the durable record and the cron sweeper
 * re-drains it — but a stage wired without a queue would silently degrade every "erase my data" request
 * to "whenever the next cron tick notices", with nothing but a log line to say so. A compliance path is
 * exactly where a misconfiguration should fail the deploy loudly instead of the request quietly.
 */
export const accountErasureConfigSchema = z.object({
    /** URL of the `account-erasure` SQS queue. */
    ACCOUNT_ERASURE_QUEUE_URL: z.string().url(),

    /** SQS endpoint URL. Override for LocalStack in dev/test. Omit for real AWS. */
    SQS_ENDPOINT: z.string().url().optional(),
});

/** Typed account-erasure configuration. */
export type AccountErasureConfig = z.infer<typeof accountErasureConfigSchema>;

/** Secret/non-secret metadata for account-erasure config fields. Neither is a secret: a queue URL is not. */
export const accountErasureConfigMeta: Record<keyof AccountErasureConfig, ConfigFieldMeta> = {
    ACCOUNT_ERASURE_QUEUE_URL: { secret: false, description: 'account-erasure SQS queue URL (GDPR, C-007)' },
    SQS_ENDPOINT: { secret: false, description: 'SQS endpoint (LocalStack override)' },
};

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
    .merge(serviceAuthConfigSchema)
    .merge(storageConfigSchema)
    .merge(rateLimitConfigSchema)
    .merge(foodServiceConfigSchema)
    .merge(accountErasureConfigSchema)
    // The DB connection is an either/or (URL vs discrete IAM parts), so it is intersected in rather
    // than merged — a union is not a ZodObject and cannot be `.merge()`d.
    .and(databaseConnectionSchema)
    // Exactly one azp mode: both is ambiguous, neither skips the azp check (fail-open). Pattern mode is
    // non-prod only. (A `.superRefine` here — not on `clerkConfigSchema` — because a refined schema is a
    // ZodEffects and could not be `.merge()`d into this composite.)
    .superRefine((config, ctx) => {
        const hasList = (config.CLERK_AUTHORIZED_PARTIES ?? '').trim().length > 0;
        const hasPattern = (config.CLERK_AZP_PATTERN ?? '').trim().length > 0;

        if (config.NODE_ENV === 'production' && hasPattern) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    'CLERK_AZP_PATTERN is not allowed in production — production uses exact-match CLERK_AUTHORIZED_PARTIES',
                path: ['CLERK_AZP_PATTERN'],
            });
        }

        if (!hasExactlyOneAzpMode(hasList, hasPattern)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'exactly one of CLERK_AUTHORIZED_PARTIES or CLERK_AZP_PATTERN must be set',
                path: ['CLERK_AUTHORIZED_PARTIES'],
            });
        }
    });

/** Typed full API configuration. */
export type ApiConfig = z.infer<typeof apiConfigSchema>;

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
 * // In a worker Lambda handler (its own config/ module)
 * import { loadConfig, workerConfigSchema } from './config/index.js';
 *
 * const config = await loadConfig(workerConfigSchema, {
 *   ssmFallback: true,
 *   ssm: { prefix: '/commise' },
 * });
 * ```
 */
export type LoadConfigFn = <T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    options?: LoadConfigOptions,
) => Promise<z.infer<z.ZodObject<T>>>;
