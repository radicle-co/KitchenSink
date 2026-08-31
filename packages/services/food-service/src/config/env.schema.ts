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
        // src/database/poolConfig.ts (the runtime default at the pool seam) — so the schema and the pool
        // agree on the default rather than the schema requiring what the pool already defaults.
        DB_USERNAME: z.string().default('food_app'),
        // Optional: deployed stages authenticate `food_app` via an RDS IAM token (no password); only
        // local docker Postgres supplies a static `DB_PASSWORD`. See src/database/poolConfig.ts.
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
 * Source-agnostic operational knobs for the queue, limiter, fairness/backpressure, lifecycle TTLs, and
 * worker scaling. All carry documented defaults so a minimal env (DB + source key) boots.
 *
 * Every field here is ALSO the authoritative definition for the standalone {@link settingFromEnv} reader —
 * these declarations are the single place a food setting's default and validation rule exist.
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
    // queue ceiling (FR-043/FR-043b). BOTH halves of fairness read it through `settingFromEnv`, so the
    // API's shed and the worker's drain can never disagree about the number.
    FOOD_DEMOTE_THRESHOLD: z.coerce.number().int().positive().default(50),
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
    /**
     * U18: the recipe service's public origin, for the authored-food delete's reference check (R22).
     * OPTIONAL — deliberately unlike recipe's REQUIRED `FOOD_SERVICE_URL`, because absence here degrades
     * LOUDLY on one route (the delete is refused 503 naming the missing config) rather than silently:
     * every deploy sets it from the shared origin authority, and an ad-hoc environment without it loses
     * exactly one capability, visibly.
     */
    RECIPE_SERVICE_URL: z.string().url().optional(),
    PORT: z.string().transform(Number).pipe(z.number().int().positive()).default(3002),
    // Permissive: deploy stages include `prod` and `sandbox-*`/`mr-*`/`pr-*`, which a fixed enum would reject.
    STAGE: z.string().min(1).default('dev'),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
});

/**
 * **The registry of single-variable food settings** — the ONE authoritative place each setting's default
 * and validation rule exists. {@link EnvironmentSchema} validates the whole environment through it at
 * boot, and {@link settingFromEnv} resolves an individual setting through the very same schema node, so
 * the boot check and a runtime read are incapable of disagreeing.
 *
 * The database block is deliberately absent: it is an either/or union (`DATABASE_URL` OR the discrete
 * `DB_*` parts), which is not a per-variable rule — `database/poolConfig.ts` owns that contract.
 */
export const FOOD_SETTING_SCHEMAS = {
    ...AppConfigSchema.shape,
    ...SourceAdapterConfigSchema.shape,
    ...FoodOperationalConfigSchema.shape,
    ...AuthConfigSchema.shape,
} as const;

/** The name of any single-variable food setting (a key of {@link FOOD_SETTING_SCHEMAS}). */
export type FoodSettingName = keyof typeof FOOD_SETTING_SCHEMAS;

/** The validated type of one setting — `number`, `string`, or `… | undefined` for an optional one. */
export type FoodSetting<K extends FoodSettingName> = z.output<(typeof FOOD_SETTING_SCHEMAS)[K]>;

/**
 * The full validated environment for the food service.
 *
 * Intersected with {@link DatabaseConfigSchema} so a caller may supply either `DATABASE_URL` or the
 * discrete `DB_*` parts. The schema is deliberately NON-strict (unknown env vars are stripped, not
 * rejected) so the ambient process environment (`PATH`, `HOME`, …) does not fail validation.
 */
export const EnvironmentSchema = z
    .object(FOOD_SETTING_SCHEMAS)
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
 * Read ONE food setting from the ambient environment, validated by the SAME {@link FOOD_SETTING_SCHEMAS}
 * node the boot-time {@link EnvironmentSchema} check uses — so a setting's default and its rule exist in
 * exactly one place and the two can never disagree.
 *
 * **Why a standalone reader exists at all.** Most of this service's settings are consumed OUTSIDE the
 * NestJS injector, where there is no `ConfigService` and (today) no boot-time validation: both Fargate
 * entrypoints (`worker/main.ts`, `worker/change-refresh/main.ts`), and the DAOs they construct with `new`.
 * Every such site used to hand-roll `Number(process.env['X'] ?? DEFAULT)`, which restates the default and —
 * far worse — turns a malformed value into `NaN`. `NaN` does not tighten a guard, it DELETES it: every
 * comparison against `NaN` is `false`, so `depth >= NaN` (the FR-046 `503` backstop) and `pending > NaN`
 * (the FR-043b flood-shed) simply stop firing, with no error and no log. A process that cannot know its own
 * limits must not serve, so this throws instead — naming the variable and quoting the offending value.
 *
 * Pattern: a parameterized Reader over the schema's own field registry, replacing N copies of a
 * hand-rolled one. The variable name IS the key, so a caller cannot pair a name with the wrong rule.
 *
 * @param name - The setting to read (a key of {@link FOOD_SETTING_SCHEMAS}).
 * @returns The validated value: the configured one, or the schema's default when the variable is unset
 *   (`undefined` for a setting that is optional by design, e.g. `FOOD_WORKER_CONCURRENCY`).
 * @throws {Error} when the configured value violates the setting's schema, or when a setting with neither
 *   a default nor `.optional()` (e.g. `USDA_API_KEY`) is unset.
 * @sideEffect Reads `process.env`.
 */
export function settingFromEnv<K extends FoodSettingName>(name: K): FoodSetting<K> {
    const raw = process.env[name];
    // Indexing a heterogeneous record with a GENERIC key loses the name→schema correlation: TypeScript
    // cannot express "this key's schema produces this key's output" (the correlated-union limitation,
    // microsoft/TypeScript#30581), so the widening is unavoidable here. It restates nothing beyond what the
    // registry's own type already guarantees, and it is the ONLY assertion in the reader — the value it
    // returns is whatever `FOOD_SETTING_SCHEMAS[name]` itself produced, which is the type `FoodSetting<K>`
    // is derived from.
    const schema = FOOD_SETTING_SCHEMAS[name] as unknown as z.ZodType<FoodSetting<K>>;
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
        const shown = raw === undefined ? '(unset)' : `"${raw}"`;
        const reason = parsed.error.issues.map((issue) => issue.message).join('; ');

        throw new Error(`Invalid ${name} ${shown}: ${reason}`);
    }

    return parsed.data;
}
