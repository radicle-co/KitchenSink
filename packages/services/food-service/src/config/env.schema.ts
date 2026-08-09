import { z } from 'zod';

/**
 * Environment configuration for `@kitchensink/food-service` (the NestJS API, the Fargate fetch worker,
 * the change-refresh scheduled task, and the lambdas). Mirrors the identity service's Zod schema: a
 * permissive `STAGE`, an either/or database block (`DATABASE_URL` or discrete `DB_*` vars), and the
 * full operational + auth config surface consumed across the service.
 *
 * **Source-agnostic (re-baseline 2026-06-21).** Operational knobs are named for the food domain, not a
 * source — there is **no USDA-specific operational config**. The ONLY source-named values are the USDA
 * adapter's credentials (`USDA_API_KEY` / `USDA_API_BASE_URL`), which live at the adapter boundary and
 * are read by the adapter only; when a second source is wired it gets its own `<SOURCE>_API_KEY`. The
 * per-source rolling-window cap is configured generically (`FOOD_SOURCE_RATE_LIMIT_PER_HOUR`); USDA is
 * the wired source whose cap defaults to 1,000/hr (worker pauses at 90% = 900, FR-019).
 *
 * @implements FR-019 FR-025 FR-025a FR-032 FR-039 FR-042 FR-043 FR-046 FR-052
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
        // Defaults to the least-privilege `food_app` role, mirroring `FOOD_DB_USERNAME` in
        // src/database/pool-config.ts (the runtime default at the pool seam) — so the schema and the pool
        // agree on the default rather than the schema requiring what the pool already defaults.
        DB_USERNAME: z.string().default('food_app'),
        // Optional: deployed stages authenticate `food_app` via an RDS IAM token (no password); only
        // local docker Postgres supplies a static `DB_PASSWORD`. See src/database/pool-config.ts.
        DB_PASSWORD: z.string().optional(),
    }),
]);

/**
 * Source-adapter credentials — the ONLY source-named config, confined to the USDA adapter boundary
 * (no USDA term leaks into the canonical service config). `USDA_API_KEY` is required (a secret from
 * Secrets Manager in prod); the base URL has a sensible default.
 */
const SourceAdapterConfigSchema = z.object({
    USDA_API_KEY: z.string().min(1, 'USDA_API_KEY is required'),
    USDA_API_BASE_URL: z.string().url().default('https://api.nal.usda.gov/fdc/v1'),
});

/**
 * The `FOOD_DEMOTE_THRESHOLD` field, hoisted out of {@link FoodOperationalConfigSchema} so the boot-time
 * validation and the standalone {@link demoteThresholdFromEnv} reader share ONE default and ONE
 * validation rule (FR-043/FR-043b). Both halves of fairness — the API's near-ceiling flood-shed and the
 * worker's drain-time demotion — must agree on this number, so it gets exactly one representation.
 */
const DemoteThresholdSchema = z.coerce.number().int().positive().default(50);

/**
 * Source-agnostic operational knobs for the queue, limiter, fairness/backpressure, lifecycle TTLs, and
 * worker scaling. All carry documented defaults so a minimal env (DB + source key) boots.
 */
const FoodOperationalConfigSchema = z.object({
    // Per-source rolling-60-min-window cap (FR-019); the worker pauses draining at 90% of this. USDA's
    // wired cap is 1,000/hr → pause at 900. A future source overrides its own cap via the adapter.
    FOOD_SOURCE_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(1000),
    // Trailing rolling-window length in seconds (default 3,600 = 60 min). Lowerable on a preview so the
    // rate-limit stall→resume is observable under load without waiting an hour; prod keeps the default.
    FOOD_SOURCE_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
    // Worker drain concurrency. The fan-out is ~80% USDA network I/O, so the drainer processes several
    // foods in-flight for ~K× throughput. Unset → sized off the task's vCPUs (availableParallelism ×
    // FOOD_WORKER_CONCURRENCY_PER_CPU, clamped [2,8]); set to force an exact value. The upper bound is
    // conservative because each in-flight food is ~2 USDA requests, so a wide burst from one IP drove
    // USDA latency past the client timeout. The rolling-window limiter still caps the actual call rate.
    FOOD_WORKER_CONCURRENCY: z.coerce.number().int().positive().optional(),
    FOOD_WORKER_CONCURRENCY_PER_CPU: z.coerce.number().positive().default(2),
    // Per-`sub` pending threshold above which a requester is demoted at drain time / flood-shed near the
    // queue ceiling (FR-043/FR-043b).
    FOOD_DEMOTE_THRESHOLD: DemoteThresholdSchema,
    // Hard `fetch_queue` depth ceiling; new enqueues fail closed with 503 at/above it (FR-046).
    FOOD_MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(10_000),
    // Max names accepted in one `POST /api/v1/foods/batch` (FR-045); over → 400.
    FOOD_MAX_BATCH_NAMES: z.coerce.number().int().positive().default(100),
    // NOT_FOUND tombstone TTL (FR-025): an add after this many days may re-attempt the fan-out.
    FOOD_NOT_FOUND_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // UNRESOLVED candidate-set TTL (FR-025a): the change-refresh task expires a food's `food_candidates`
    // set this many days after `created_at`; the food stays UNRESOLVED and the next add re-fans-out.
    FOOD_UNRESOLVED_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // Change-driven-refresh staleness threshold in days (FR-032) — how old a RESOLVED food may be before
    // the scheduled refresh re-checks it for upstream changes.
    FOOD_STALE_THRESHOLD_DAYS: z.coerce.number().int().positive().default(30),
    // Worker lease window in seconds (FR-018): the reaper reverts `in_flight` rows whose lease lapsed.
    FOOD_LEASE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
    // Desired count of Fargate fan-out worker tasks (single-drainer invariant holds regardless; FR-022).
    FOOD_WORKER_DESIRED_COUNT: z.coerce.number().int().nonnegative().default(1),
});

/**
 * Auth + auth-layer DoS config (FR-039/FR-042/FR-052). `CLERK_JWT_KEY` (public PEM) and
 * `CLERK_AUTHORIZED_PARTIES` (azp allowlist) are NON-secret and OPTIONAL at the schema level: the
 * `FoodAuthGuard` fails closed (401) when the key is absent, and the unauthenticated `/health` probe
 * must still boot — so they are validated-when-present, never boot-required. The `FOOD_AUTH_*` shedder
 * knobs are optional positive integers; the guard falls back to its built-in defaults when unset.
 */
const AuthConfigSchema = z.object({
    CLERK_JWT_KEY: z.string().min(1).optional(),
    CLERK_AUTHORIZED_PARTIES: z.string().optional(),
    // CR-002 / U4b / R11 — the PUBLIC EdDSA verification key (SPKI PEM) for the service-principal internal
    // erasure route. NON-secret and OPTIONAL at the schema level: FoodServiceErasureAuthService reads it
    // from process.env and FAILS CLOSED (401 on every service token) when absent, exactly like CLERK_JWT_KEY.
    FOOD_SERVICE_PRINCIPAL_JWT_KEY: z.string().min(1).optional(),
    // Preview-subdomain base domain (pattern mode). Mutually exclusive with the list; forbidden on prod.
    // Like the list, optional at the schema level — the guard fails closed at runtime when the key is absent.
    CLERK_AZP_PATTERN: z.string().optional(),
    FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS: z.coerce.number().int().positive().optional(),
    FOOD_AUTH_SHED_THRESHOLD: z.coerce.number().int().positive().optional(),
    FOOD_AUTH_SHED_WINDOW_MS: z.coerce.number().int().positive().optional(),
});

/** Process/runtime configuration shared across NestJS and the Fargate worker. */
const AppConfigSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).pipe(z.number().int().positive()).default(3002),
    // Permissive: deploy stages include `prod` and `sandbox-*`/`mr-*`/`pr-*`, which a fixed enum would reject.
    STAGE: z.string().min(1).default('dev'),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
});

/**
 * The full validated environment for the food service.
 *
 * Intersected with {@link DatabaseConfigSchema} so a caller may supply either `DATABASE_URL` or the
 * discrete `DB_*` parts. The schema is deliberately NON-strict (unknown env vars are stripped, not
 * rejected) so the ambient process environment (`PATH`, `HOME`, …) does not fail validation.
 */
export const EnvironmentSchema = z
    .object({
        ...AppConfigSchema.shape,
        ...SourceAdapterConfigSchema.shape,
        ...FoodOperationalConfigSchema.shape,
        ...AuthConfigSchema.shape,
    })
    .and(DatabaseConfigSchema)
    // azp coherence: the list and the preview pattern are mutually exclusive, and pattern mode is
    // non-prod only. Food keeps azp OPTIONAL by design (the guard fails closed at runtime), so this does
    // NOT require one — it only rejects the ambiguous "both" and a prod pattern.
    .superRefine((env, ctx) => {
        const hasList = (env.CLERK_AUTHORIZED_PARTIES ?? '').trim().length > 0;
        const hasPattern = (env.CLERK_AZP_PATTERN ?? '').trim().length > 0;

        if (hasList && hasPattern) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'CLERK_AUTHORIZED_PARTIES and CLERK_AZP_PATTERN are mutually exclusive — set only one',
                path: ['CLERK_AZP_PATTERN'],
            });
        }

        if (env.STAGE === 'prod' && hasPattern) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    "CLERK_AZP_PATTERN is not allowed on the 'prod' stage — prod uses exact-match CLERK_AUTHORIZED_PARTIES",
                path: ['CLERK_AZP_PATTERN'],
            });
        }
    });

/** The validated, fully-typed food-service environment. */
export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Parse and validate `process.env`.
 *
 * @returns The validated environment.
 * @throws {z.ZodError} when a required variable (`USDA_API_KEY`, the DB block) is missing or invalid.
 */
export function resolveEnvironment(): Environment {
    return EnvironmentSchema.parse(process.env);
}

/**
 * Read the per-`sub` pending demotion threshold (`FOOD_DEMOTE_THRESHOLD`, FR-043/FR-043b) from the
 * ambient environment, validated by the SAME {@link DemoteThresholdSchema} the boot-time
 * {@link EnvironmentSchema} check uses.
 *
 * Exists because the value is consumed OUTSIDE the NestJS injector: the drain-time demotion lives in
 * `FetchQueueDao`, which the Fargate worker constructs with `new` and which has no `ConfigService`.
 * Mirrors `sourceCapsFromEnv` at the rolling-window-limiter seam. Fails fast rather than coercing with a
 * bare `Number()`, because `NaN` would silently disable the guard — every `pending > NaN` is `false`.
 *
 * @returns The configured threshold (50 when unset).
 * @throws {Error} when the configured value is not a positive integer.
 * @sideEffect Reads `process.env`.
 */
export function demoteThresholdFromEnv(): number {
    const raw = process.env['FOOD_DEMOTE_THRESHOLD'];
    const parsed = DemoteThresholdSchema.safeParse(raw);

    if (!parsed.success) {
        throw new Error(`Invalid FOOD_DEMOTE_THRESHOLD "${raw}" — expected a positive integer.`);
    }

    return parsed.data;
}
