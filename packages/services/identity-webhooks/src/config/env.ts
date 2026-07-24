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

/** Parses `process.env` against {@link EnvironmentSchema}. Throws a `ZodError` on a missing/invalid var. */
export function resolveEnvironment(): Environment {
    return EnvironmentSchema.parse(process.env);
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

/** Parses `process.env` against {@link WebhookEnvironmentSchema}. Throws a `ZodError` on a missing/invalid var. */
export function resolveWebhookEnvironment(): WebhookEnvironment {
    return WebhookEnvironmentSchema.parse(process.env);
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
