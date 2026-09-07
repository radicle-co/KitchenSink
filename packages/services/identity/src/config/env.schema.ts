import { z } from 'zod';
import { hasExactlyOneAzpMode } from '@kitchensink/clerk-verify';

/**
 * Parse a comma-separated env value into a trimmed, non-empty list. Shared by the
 * `CLERK_AUTHORIZED_PARTIES` schema transform and `ClerkAuthService` so the two cannot drift.
 */
export function parseCommaList(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

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

const QueueConfigSchema = z.object({
    DELETION_QUEUE_URL: z.string().url(),
});

const AppConfigSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).pipe(z.number().int().positive()).default(3001),
    // Permissive: deploy stages include `prod` and `sandbox-*`/`mr-*`/`pr-*`, which a fixed enum
    // would reject now that STAGE is injected into the running container (U8).
    STAGE: z.string().min(1).default('dev'),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
});

// Clerk session-token verification (read-through auth). CLERK_JWT_KEY is the instance's *public*
// JWT verification key (PEM) — networkless verification, no Clerk secret key. CLERK_AUTHORIZED_PARTIES
// is the allowlist of origins checked against the token `azp` claim. Both are required on deployed
// stages (see superRefine below); optional in dev/test where verification is mocked.
const ClerkConfigSchema = z.object({
    CLERK_JWT_KEY: z.string().optional(),
    CLERK_AUTHORIZED_PARTIES: z
        .string()
        .optional()
        .transform((value) => parseCommaList(value)),
    // Preview-subdomain base domain (e.g. `sandbox.commise.app`). When set, azp is validated against an
    // anchored per-PR pattern instead of the exact-match list. Mutually exclusive with the list; forbidden
    // on prod (see superRefine). Non-prod only.
    CLERK_AZP_PATTERN: z.string().optional(),
});

// Local/test sentinels where Clerk verification is not required (verification is mocked in tests
// and unused locally). Every other STAGE is a deployed environment that must verify real tokens.
const NON_DEPLOYED_STAGES = new Set(['dev', 'test', 'local']);

/**
 * Whether `stage` names a DEPLOYED environment (`prod`, `sandbox`, `pr-{N}`, …) as opposed to one of the
 * local/test sentinels. Exported because three security-relevant decisions must agree on it — this schema's
 * "Clerk config is required" refinement, `config/cors.ts`'s fail-closed branch, and `observability/authTrace.ts`'s
 * sink selection. Each used to carry its own copy of the set. Pure.
 *
 * @param stage - The raw `STAGE` value.
 * @returns `true` unless `stage` is one of `dev` / `test` / `local`.
 */
export function isDeployedStage(stage: string): boolean {
    return !NON_DEPLOYED_STAGES.has(stage);
}

export const EnvironmentSchema = z
    .object({
        ...AppConfigSchema.shape,
        ...QueueConfigSchema.shape,
        ...ClerkConfigSchema.shape,
    })
    .and(DatabaseConfigSchema)
    .superRefine((env, ctx) => {
        if (!isDeployedStage(env.STAGE)) {
            return;
        }

        if (!env.CLERK_JWT_KEY) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `CLERK_JWT_KEY is required on deployed stage '${env.STAGE}'`,
                path: ['CLERK_JWT_KEY'],
            });
        }

        const hasList = env.CLERK_AUTHORIZED_PARTIES.length > 0;
        const hasPattern = (env.CLERK_AZP_PATTERN ?? '').trim().length > 0;

        if (env.STAGE === 'prod' && hasPattern) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `CLERK_AZP_PATTERN is not allowed on the 'prod' stage — prod uses exact-match CLERK_AUTHORIZED_PARTIES`,
                path: ['CLERK_AZP_PATTERN'],
            });
        }

        // Exactly one azp mode on a deployed stage: both is ambiguous, neither skips the azp check entirely.
        if (!hasExactlyOneAzpMode(hasList, hasPattern)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `exactly one of CLERK_AUTHORIZED_PARTIES or CLERK_AZP_PATTERN must be set on deployed stage '${env.STAGE}'`,
                path: ['CLERK_AUTHORIZED_PARTIES'],
            });
        }
    });

export type Environment = z.infer<typeof EnvironmentSchema>;

export function resolveEnvironment(): Environment {
    return EnvironmentSchema.parse(process.env);
}
