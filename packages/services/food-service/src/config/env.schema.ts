import { createPrivateKey } from 'node:crypto';

import { z } from 'zod';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { apiAccessOf } from '../sources/sourceRegister.js';
import { parseLimitOverrides, type SourceLimitOverrides } from '../sources/transport/limitOverride.js';

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
 * per-source limits are DECLARED in the source register (`sources/sourceRegister.ts`, ADR-0053 §1), and the only
 * knob is `FOOD_SOURCE_LIMIT_OVERRIDES`, which may lower a declared limit and never raise one.
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
        DB_USERNAME: z.string().default(DATABASE_ROLES.food.app),
        // Optional: deployed stages authenticate `food_app` via an RDS IAM token (no password); only
        // local docker Postgres supplies a static `DB_PASSWORD`. See src/database/poolConfig.ts.
        DB_PASSWORD: z.string().optional(),
    }),
]);

/**
 * Source-adapter credentials — the ONLY source-named config, confined to the USDA adapter boundary
 * (no USDA term leaks into the canonical service config). `USDA_API_KEY` is required (a secret from
 * Secrets Manager in prod); the base URL defaults to the one the source register declares.
 */
const SourceAdapterConfigSchema = z.object({
    USDA_API_KEY: z.string().min(1, 'USDA_API_KEY is required'),
    USDA_API_BASE_URL: z.string().url().default(apiAccessOf('usda').baseUrl),
});

/**
 * Source-agnostic operational knobs for the queue, limiter, drain fairness, lifecycle TTLs, and
 * worker scaling. All carry documented defaults so a minimal env (DB + source key) boots.
 *
 * Every field here is ALSO the authoritative definition for the standalone {@link settingFromEnv} reader —
 * these declarations are the single place a food setting's default and validation rule exist.
 */
const FoodOperationalConfigSchema = z.object({
    // Per-source limit overrides (ADR-0053 §6), a JSON object keyed by register id:
    // `{"usda":{"requests":15,"windowSeconds":60}}`. Each source's limit is DECLARED in the source register; this
    // exists so a load test can watch a window fill and drain without spending a real one. An override that could
    // admit more calls than the declared limit in one of the publisher's windows is refused here, at boot. Unset,
    // every source runs at its declared limit.
    FOOD_SOURCE_LIMIT_OVERRIDES: z
        .string()
        .optional()
        .transform((raw, context): SourceLimitOverrides => {
            const parsed = parseLimitOverrides(raw);

            if (!parsed.ok) {
                context.addIssue({ code: 'custom', message: parsed.reason });

                return z.NEVER;
            }

            return parsed.overrides;
        }),
    // Worker drain concurrency. The fan-out is ~80% USDA network I/O, so the drainer processes several
    // foods in-flight for ~K× throughput. Unset → sized off the task's vCPUs (availableParallelism ×
    // FOOD_WORKER_CONCURRENCY_PER_CPU, clamped [2,8]); set to force an exact value. The upper bound is
    // conservative because each in-flight food is ~2 USDA requests, so a wide burst from one IP drove
    // USDA latency past the client timeout. The rolling-window limiter still caps the actual call rate.
    FOOD_WORKER_CONCURRENCY: z.coerce.number().int().positive().optional(),
    FOOD_WORKER_CONCURRENCY_PER_CPU: z.coerce.number().positive().default(2),
    // Per-`sub` pending threshold above which a requester is DEMOTED at drain time (FR-043). Demotion
    // changes drain ORDER and never rejects; the near-ceiling shed that used to read the same number is
    // retired (FR-043b, owner ruling 2026-09-15 — no intake caps).
    FOOD_DEMOTE_THRESHOLD: z.coerce.number().int().positive().default(50),
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
    //
    // ⛔ 250, NOT the 30 FR-018 originally fixed — because 30 was SHORTER THAN THE WORK IT LEASED. One
    // food's fan-out may issue a name search, a batch chunk and one recovery request per key, each of
    // which may hang for the client timeout; the lease expired mid-fetch on the ordinary slow path, the
    // reaper reverted the row, and a second claim loop fetched the same food again (U5/R16).
    //
    // The number is DERIVED — `worker/leaseWindow.ts` computes it from the wired adapter's page size,
    // batch cap and request timeout — but it is written here as a literal on purpose, and the reason is
    // DEPENDENCY DIRECTION: this module is the most stable one in the service (every DAO and composition
    // root reads it), while `@kitchensink/usda-client` is a volatile external adapter, and config
    // depending on an adapter inverts that gradient. `env.schema.test.ts` binds the two, so the derivation
    // moving fails a test instead of silently shortening every lease.
    FOOD_LEASE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(250),
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
    // How many trusted proxies append to `X-Forwarded-For` in front of this task: 1 behind the ALB alone, 2 behind
    // CloudFront and the ALB. The auth shedder counts this many entries from the right to find the client, so the
    // value is set by the stack that builds the chain (`FoodServiceStack`). Digits only, because `z.coerce.number()`
    // would read '' as 0. Optional here; `authShedderConfigFromEnv` refuses a deployed stage without it.
    FOOD_TRUSTED_PROXY_HOPS: z
        .string()
        .regex(/^(?:0|[1-9]\d*)$/u, 'must be a whole number of proxies')
        .transform(Number)
        .optional(),
});

/**
 * The `STAGE` values that mean a developer machine or a test run. Every deployed task runs `prod`, `sandbox` or
 * `pr-{N}` (`infra/lib/FoodServiceStack.ts`), and the schema's default is `dev`.
 */
const NON_DEPLOYED_STAGES: ReadonlySet<string> = new Set(['dev', 'test', 'local']);

/**
 * Whether `stage` names a deployed environment rather than a developer machine or a test run. Unknown values count
 * as deployed, which is the fail-closed direction. Pure.
 *
 * @param stage - The raw `STAGE` value.
 * @returns `false` only for exactly `dev`, `test` or `local`.
 */
export function isDeployedStage(stage: string): boolean {
    return !NON_DEPLOYED_STAGES.has(stage);
}

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
 * comparison against `NaN` is `false`, so `pending > NaN` (the FR-043 drain-time demotion) simply stops
 * firing, with no error and no log. A process that cannot know its own
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

/** The remote search settings: absent, or every value parsed (ADR-0055 points 3, 7 and 10). */
export type RemoteSearchSettings =
    | { readonly kind: 'absent' }
    | {
          readonly kind: 'configured';
          /** The search service's CDN origin, `https://` with no path: every request is built on it. */
          readonly origin: string;
          /** The CloudFront public key id the signing key belongs to. */
          readonly keyPairId: string;
          /** The RSA private key, PEM, that signs every request URL. */
          readonly signingKey: string;
          /** The 32-byte key that seals and opens a remote hit's reference. */
          readonly referenceKey: Uint8Array;
      };

/** The hosts on which a local stand-in for the CDN may answer over plain `http`. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A CloudFront origin: `https://`, a host, and nothing after it. Plain `http` only on a loopback host, where a local
 * stand-in for the distribution answers (local development and the LOCAL e2e tier); a CloudFront origin is never one.
 */
const remoteSearchOriginSchema = z.url({ protocol: /^https?$/u }).transform((value, context) => {
    const url = new URL(value);

    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
        context.addIssue({ code: 'custom', message: 'must be https, or http on a loopback host' });

        return z.NEVER;
    }

    if (url.origin !== value.replace(/\/$/u, '')) {
        context.addIssue({ code: 'custom', message: 'must be an origin with no path or query' });

        return z.NEVER;
    }

    return url.origin;
});

/**
 * Why a PEM is not an RSA private key, or `undefined` when it is one. `createPrivateKey` throws on anything that is not
 * a key; its message names the decoder's complaint and never the key material. Pure.
 *
 * @param pem - The value.
 * @returns The reason it is refused, or `undefined`.
 */
function rsaPrivateKeyRefusal(pem: string): string | undefined {
    try {
        return createPrivateKey(pem).asymmetricKeyType === 'rsa' ? undefined : 'it is not an RSA key';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** An RSA private key in PEM, the only kind a CloudFront signed URL accepts. */
const rsaPrivateKeyPemSchema = z.string().superRefine((pem, context) => {
    const refusal = rsaPrivateKeyRefusal(pem);

    if (refusal !== undefined) {
        context.addIssue({ code: 'custom', message: `must be an RSA private key in PEM (${refusal})` });
    }
});

/** 32 bytes as unpadded base64url: an AES-256 key. */
const referenceKeySchema = z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/u, 'must be 32 bytes as unpadded base64url')
    .transform((value) => new Uint8Array(Buffer.from(value, 'base64url')));

/**
 * Each remote search variable's rule. Not in {@link FOOD_SETTING_SCHEMAS}: the four are one setting, all or none, and
 * two of them are secrets that `settingFromEnv`'s refusal would quote.
 */
const REMOTE_SEARCH_SCHEMAS = {
    REMOTE_SEARCH_ORIGIN: remoteSearchOriginSchema,
    REMOTE_SEARCH_KEY_PAIR_ID: z.string().regex(/^[A-Z0-9]+$/u, 'must be a CloudFront public key id'),
    REMOTE_SEARCH_SIGNING_KEY: rsaPrivateKeyPemSchema,
    FOOD_REMOTE_REFERENCE_KEY: referenceKeySchema,
} as const;

/** The four variables a deployed stage sets together, or not at all. */
export const REMOTE_SEARCH_VARIABLES = Object.freeze(
    Object.keys(REMOTE_SEARCH_SCHEMAS) as (keyof typeof REMOTE_SEARCH_SCHEMAS)[],
);

/**
 * Parse the remote search settings. All four unset (or blank) is `absent`: no remote source is asked, and each
 * answers `unavailable`. A partial set is a deploy fault and is refused, so a stage is never silently left without
 * remote search. Pure.
 *
 * @param env - The environment to read.
 * @returns The settings.
 * @throws {Error} naming each missing or malformed variable. It never quotes a value: two are secrets.
 */
export function parseRemoteSearchSettings(env: Readonly<Record<string, string | undefined>>): RemoteSearchSettings {
    const present = REMOTE_SEARCH_VARIABLES.filter((name) => (env[name] ?? '') !== '');

    if (present.length === 0) {
        return { kind: 'absent' };
    }

    const missing = REMOTE_SEARCH_VARIABLES.filter((name) => !present.includes(name));

    if (missing.length > 0) {
        throw new Error(`Remote search is partly configured: set ${missing.join(', ')}, or unset all four.`);
    }

    const parsed = z.object(REMOTE_SEARCH_SCHEMAS).safeParse(env);

    if (!parsed.success) {
        const reasons = parsed.error.issues.map((issue) => `${String(issue.path[0])} ${issue.message}`);

        throw new Error(`Invalid remote search settings: ${reasons.join('; ')}.`);
    }

    return {
        kind: 'configured',
        origin: parsed.data.REMOTE_SEARCH_ORIGIN,
        keyPairId: parsed.data.REMOTE_SEARCH_KEY_PAIR_ID,
        signingKey: parsed.data.REMOTE_SEARCH_SIGNING_KEY,
        referenceKey: parsed.data.FOOD_REMOTE_REFERENCE_KEY,
    };
}

/**
 * The remote search settings of this process.
 *
 * @returns The settings.
 * @throws {Error} the {@link parseRemoteSearchSettings} refusals.
 * @sideEffect Reads `process.env`.
 */
export function remoteSearchSettingsFromEnv(): RemoteSearchSettings {
    return parseRemoteSearchSettings(process.env);
}
