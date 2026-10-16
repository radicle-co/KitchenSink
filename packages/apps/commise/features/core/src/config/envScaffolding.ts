/**
 * @module @commise/features-core/config/envScaffolding — the two pieces of env validation both hosts declare
 * identically: what a valid endpoint IS, and how a refusal is reported.
 *
 * `web/src/config/env.ts` (T3 `env-nextjs`) and `mobile/src/config/env.ts` (T3 `env-core`) each carried a copy
 * of the zod and of a 14-line issue formatter. They are framework-neutral on purpose: the `createEnv` call
 * (prefix, `runtimeEnv` with its literal `process.env.X` expressions) stays in the app, because the bundler
 * only inlines a static member expression and that is a per-platform fact.
 */
import { z } from 'zod';

/** An absolute http(s) base URL. A relative value would resolve against the page and fail only in a browser. */
export const endpointUrl = z.url({ protocol: /^https?$/ });

/** The slice of a Standard Schema issue the formatter reads (both T3 variants hand over a superset). */
export interface EnvValidationIssue {
    /** Path segments: a key, or a `{ key }` object. */
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/**
 * Build the error a failed env validation throws: it names the offending VARIABLES (the default message
 * sends the reader to the console; this sends them to the fix) and then states what each kind must look like.
 *
 * @param issues - The validation issues T3 Env reports.
 * @param guidance - The platform-specific sentence(s) about what is expected and where to set it.
 * @returns The error to throw.
 */
export function envValidationError(issues: ReadonlyArray<EnvValidationIssue>, guidance: string): Error {
    const names = [
        ...new Set(
            issues
                .map((issue) =>
                    issue.path?.map((segment) => String(typeof segment === 'object' ? segment.key : segment)).join('.'),
                )
                .filter(Boolean),
        ),
    ].join(', ');

    return new Error(`Invalid environment variables: ${names}. ${guidance}`);
}
