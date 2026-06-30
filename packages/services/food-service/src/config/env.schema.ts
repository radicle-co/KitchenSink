import { z } from 'zod';

/**
 * Environment configuration for `@kitchensink/food-service` (the NestJS API, the Fargate fetch
 * worker, and the lambdas). Mirrors the identity service's Zod schema: a permissive `STAGE`, an
 * either/or database block (`DATABASE_URL` or discrete `DB_*` vars), and the USDA-specific knobs
 * from plan §2A.8 / FR-019 / FR-031.
 *
 * @implements FR-019 FR-031
 */

/** Database connection: a single URL or the discrete `DB_*` parts (food-service connects to `kitchensink_food`). */
const DatabaseConfigSchema = z.union([
    z.object({
        DATABASE_URL: z.string().url(),
    }),
    z.object({
        DB_HOST: z.string(),
        DB_PORT: z.string().transform(Number).pipe(z.number().int().positive()),
        DB_NAME: z.string(),
        DB_USERNAME: z.string(),
        DB_PASSWORD: z.string(),
    }),
]);

/** USDA FoodData Central integration knobs. `USDA_API_KEY` is the only required value. */
const UsdaConfigSchema = z.object({
    USDA_API_KEY: z.string().min(1, 'USDA_API_KEY is required'),
    USDA_API_BASE_URL: z.string().url().default('https://api.nal.usda.gov/fdc/v1'),
    // Rolling-60-min-window cap (FR-019); the worker pauses draining at 90% of this.
    USDA_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(1000),
    USDA_STALE_THRESHOLD_DAYS: z.coerce.number().int().positive().default(30),
    // `not_found` tombstone TTL after which a lookup may re-attempt (FR-025).
    USDA_TOMBSTONE_TTL_DAYS: z.coerce.number().int().positive().default(30),
    USDA_WORKER_DESIRED_COUNT: z.coerce.number().int().nonnegative().default(1),
    USDA_LEASE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
    // UNRESOLVED candidate-set TTL (FR-025a): the change-refresh task expires a food's `food_candidates`
    // set this many days after `created_at`; the food stays UNRESOLVED and the next add re-fans-out.
    FOOD_UNRESOLVED_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

/** Process/runtime configuration shared across NestJS and the Fargate worker. */
const AppConfigSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).pipe(z.number().int().positive()).default('3002'),
    // Permissive: deploy stages include `prod` and `sandbox-*`/`mr-*`/`pr-*`, which a fixed enum would reject.
    STAGE: z.string().min(1).default('dev'),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
});

/**
 * The full validated environment for the food service.
 *
 * Intersected with {@link DatabaseConfigSchema} so a caller may supply either `DATABASE_URL` or
 * the discrete `DB_*` parts.
 */
export const EnvironmentSchema = z
    .object({
        ...AppConfigSchema.shape,
        ...UsdaConfigSchema.shape,
    })
    .and(DatabaseConfigSchema);

/** The validated, fully-typed food-service environment. */
export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Parse and validate `process.env`.
 *
 * @returns The validated environment.
 * @throws {z.ZodError} when a required variable (e.g. `USDA_API_KEY`) is missing or invalid.
 */
export function resolveEnvironment(): Environment {
    return EnvironmentSchema.parse(process.env);
}
