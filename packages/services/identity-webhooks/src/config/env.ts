import { z } from 'zod';

/**
 * IdP (Clerk) credentials/config. Only `IDP_SECRET_KEY`/`AUTH_SECRET_ARN` are enforced (either-or, via
 * the refine below) — the rest are optional here because not every Lambda's deployed env carries every
 * field (e.g. `IDP_PUBLISHABLE_KEY` is a browser-side credential never injected into any of these
 * server-side functions; see `infra/lib/webhooks-stack.ts`'s `commonEnv`/`clerkBackendEnv`).
 */
const IdpConfigSchema = z.object({
    IDP_SECRET_KEY: z.string().startsWith('sk_').optional(),
    AUTH_SECRET_ARN: z.string().min(1).optional(),
    IDP_PUBLISHABLE_KEY: z.string().startsWith('pk_').optional(),
    IDP_WEBHOOK_SECRET: z.string().min(1).optional(),
    IDP_JWKS_URL: z.string().url().optional(),
    IDP_ISSUER: z.string().url().optional(),
});

/**
 * The rest of the env surface the identity-webhooks Lambdas read (S-I5 audit: every `process.env` /
 * `requireEnv` access across `src/handlers/*.ts` + `src/common/db.ts`). `DB_SECRET_ARN` is the one
 * field every handler needs (all four touch RDS) so it is the only field required unconditionally;
 * everything else here is used by a subset of handlers (e.g. `DELETION_QUEUE_URL`/`IDP_WEBHOOK_SECRET`
 * are webhook-only) and is tightened to required by that handler's own schema below via `.required()`,
 * rather than forcing every Lambda's cold start to depend on env vars its CDK function definition never
 * sets.
 */
const LambdaConfigSchema = z.object({
    DB_SECRET_ARN: z.string().min(1),
    DELETION_QUEUE_URL: z.string().min(1).optional(),
    HANDLE_SYNC_TOPIC_ARN: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
    SNS_ENDPOINT: z.string().min(1).optional(),
    STAGE: z.string().min(1).default('dev'),
    DB_POOL_MAX: z.coerce.number().int().positive().default(5),
});

const BaseEnvironmentObject = z.object({
    ...IdpConfigSchema.shape,
    ...LambdaConfigSchema.shape,
});

/** The knowledge behind the `.refine` below: at least one form of the Clerk backend secret is present. */
const hasIdpSecret = (data: { IDP_SECRET_KEY?: string; AUTH_SECRET_ARN?: string }): boolean =>
    Boolean(data.IDP_SECRET_KEY || data.AUTH_SECRET_ARN);

const IDP_SECRET_REFINEMENT = {
    message: 'Either IDP_SECRET_KEY or AUTH_SECRET_ARN must be provided',
    path: ['IDP_SECRET_KEY'],
};

/** General-purpose schema: what deletion-worker, reconciliation, and migrate all need. */
export const EnvironmentSchema = BaseEnvironmentObject.refine(hasIdpSecret, IDP_SECRET_REFINEMENT);

export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Stable, grep-able code stamped on every {@link ConfigError}. Ops greps this ONE string across the
 * webhook Lambdas' logs to find a cold-start misconfiguration, regardless of which var was missing.
 */
export const CONFIG_ERROR_CODE = 'IDENTITY_WEBHOOKS_INVALID_ENV';

/**
 * Thrown at a Lambda's cold start when `process.env` fails validation against its env schema. Wraps the
 * raw `ZodError` in a typed, coded error so a genuine misconfiguration surfaces as a single grep-able
 * ops signal ({@link CONFIG_ERROR_CODE}) that NAMES the offending var(s) — rather than a bare `ZodError`
 * whose class/message ops can't reliably alert on. Aggregates every failing var at once (not
 * one-at-a-time) and retains the underlying issues for structured logging. Fail-fast is preserved: the
 * memoized accessors ({@link getConfig}/{@link getWebhookConfig}) throw this on their first call.
 */
export class ConfigError extends Error {
    /** The stable, grep-able ops code — always {@link CONFIG_ERROR_CODE}. */
    public readonly code: typeof CONFIG_ERROR_CODE = CONFIG_ERROR_CODE;
    /** The distinct top-level env-var names implicated by the failure (the vars to fix). */
    public readonly invalidVars: string[];
    /** The underlying zod issues, retained for structured logging. */
    public readonly issues: z.ZodError['issues'];

    constructor(error: z.ZodError) {
        const invalidVars = ConfigError.varsFromError(error);
        const detail = error.issues
            .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('\n');
        super(`${CONFIG_ERROR_CODE}: invalid identity-webhooks environment [${invalidVars.join(', ')}]:\n${detail}`);
        this.name = 'ConfigError';
        this.invalidVars = invalidVars;
        this.issues = error.issues;
        Object.setPrototypeOf(this, ConfigError.prototype);
    }

    /** The distinct top-level keys implicated by a zod error (`(root)` for refinements without a path). Pure. */
    private static varsFromError(error: z.ZodError): string[] {
        const vars = new Set<string>();

        for (const issue of error.issues) {
            const [first] = issue.path;
            vars.add(typeof first === 'string' && first.length > 0 ? first : '(root)');
        }

        return [...vars];
    }
}

/** Type guard for {@link ConfigError}. */
export function isConfigError(error: unknown): error is ConfigError {
    return error instanceof ConfigError;
}

/** Parse `process.env` against `schema`, throwing a typed {@link ConfigError} (not a bare `ZodError`) on failure. */
function parseEnvOrThrow<Schema extends z.ZodTypeAny>(schema: Schema): z.infer<Schema> {
    const result = schema.safeParse(process.env);

    if (!result.success) {
        throw new ConfigError(result.error);
    }

    return result.data;
}

/** Parses `process.env` against {@link EnvironmentSchema}. Throws a {@link ConfigError} on a missing/invalid var. */
export function resolveEnvironment(): Environment {
    return parseEnvOrThrow(EnvironmentSchema);
}

/**
 * The webhook Lambda's stricter surface: on top of the general schema, it additionally needs the
 * deletion queue URL (to enqueue `user.deleted`) and the svix signing secret (to verify inbound
 * webhooks) — both of which only the webhook function's CDK env block sets.
 */
export const WebhookEnvironmentSchema = BaseEnvironmentObject.required({
    DELETION_QUEUE_URL: true,
    IDP_WEBHOOK_SECRET: true,
}).refine(hasIdpSecret, IDP_SECRET_REFINEMENT);

export type WebhookEnvironment = z.infer<typeof WebhookEnvironmentSchema>;

/** Parses `process.env` against {@link WebhookEnvironmentSchema}. Throws a {@link ConfigError} on a missing/invalid var. */
export function resolveWebhookEnvironment(): WebhookEnvironment {
    return parseEnvOrThrow(WebhookEnvironmentSchema);
}

let cachedEnvironment: Environment | undefined;
let cachedWebhookEnvironment: WebhookEnvironment | undefined;

/**
 * Memoized {@link resolveEnvironment}: parses `process.env` once per Lambda execution environment
 * (cold start) and reuses the result for every later warm invocation, so a genuine misconfig fails
 * fast on the FIRST call into the handler — not per-request, and not silently re-validated request
 * after request. Call this as the first statement of a handler (deletion-worker, reconciliation,
 * migrate); env vars are immutable for the lifetime of a Lambda execution environment, so caching
 * after the first successful parse is safe.
 */
export function getConfig(): Environment {
    cachedEnvironment ??= resolveEnvironment();

    return cachedEnvironment;
}

/** {@link getConfig}'s webhook-handler counterpart, backed by {@link WebhookEnvironmentSchema}. */
export function getWebhookConfig(): WebhookEnvironment {
    cachedWebhookEnvironment ??= resolveWebhookEnvironment();

    return cachedWebhookEnvironment;
}

/**
 * The resolved cross-service erasure fan-out config (CR-002 / U4b): the EdDSA signing key + the recipe and
 * food base URLs. Read from `process.env` DIRECTLY — deliberately NOT through the base
 * {@link EnvironmentSchema} — so an absent/empty value (before ops provisions the keypair + URLs) affects ONLY the
 * erasure fan-out, never the closure/reactivation paths that share the deletion-worker's `getConfig()`.
 *
 * Demanded ALL-OR-NOTHING at the point of use: a fan-out consumer missing any of the three fails LOUD (the
 * SQS message DLQs and the erasure-reconciliation surfaces the gap) rather than silently skipping the
 * recipe/food legs and leaving a half-erased account (R7).
 *
 * @returns The signing key + recipe/food base URLs.
 * @throws {ConfigError} When any of the three fan-out vars is missing or empty.
 */
export function getErasureFanoutConfig(): {
    signingKeyPem: string;
    recipeBaseUrl: string;
    foodBaseUrl: string;
} {
    const signingKeyPem = process.env['SERVICE_ERASURE_SIGNING_KEY'];
    const recipeBaseUrl = process.env['RECIPE_SERVICE_BASE_URL'];
    const foodBaseUrl = process.env['FOOD_SERVICE_BASE_URL'];

    const missing: string[] = [];

    if (!signingKeyPem) {
        missing.push('SERVICE_ERASURE_SIGNING_KEY');
    }

    if (!recipeBaseUrl) {
        missing.push('RECIPE_SERVICE_BASE_URL');
    }

    if (!foodBaseUrl) {
        missing.push('FOOD_SERVICE_BASE_URL');
    }

    if (missing.length > 0) {
        throw new ConfigError(
            new z.ZodError(
                missing.map((name) => ({
                    code: 'custom' as const,
                    path: [name],
                    message: 'required for the CR-002 erasure fan-out but not set',
                })),
            ),
        );
    }

    return { signingKeyPem: signingKeyPem!, recipeBaseUrl: recipeBaseUrl!, foodBaseUrl: foodBaseUrl! };
}

/**
 * Test-only: clears both memoized caches so the next {@link getConfig}/{@link getWebhookConfig} call
 * re-parses `process.env`. Production code MUST NOT call this — a real Lambda execution environment
 * never needs its config cache invalidated (env vars don't change without a fresh cold start, which
 * gets a fresh module instance for free); it exists solely so tests can simulate a new cold start
 * (a new env combination) without paying for a full module re-import per test.
 *
 * @sideEffect Mutates the module-level config cache.
 */
export function resetConfigCacheForTests(): void {
    cachedEnvironment = undefined;
    cachedWebhookEnvironment = undefined;
}
