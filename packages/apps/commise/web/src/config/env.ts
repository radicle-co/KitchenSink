/**
 * @module config/env — the ONE place the web app learns which backends to call.
 *
 * Every endpoint the browser talks to is declared here and validated at module load. There are
 * deliberately **no defaults**: a build that was not told its endpoints fails loudly instead of shipping
 * a bundle that quietly points somewhere useless.
 *
 * ## Why no fallback (this is the bug this module exists to make impossible)
 *
 * The base URLs used to be read inline as `process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000'`.
 * `NEXT_PUBLIC_*` is inlined by the bundler at BUILD time, so when the Vercel preview build ran without
 * those variables, `http://localhost:3000` was compiled into the shipped JavaScript. Every signed-in
 * visitor's browser then called its OWN machine and every data-backed surface failed with
 * ERR_CONNECTION_REFUSED — while the code looked correct and every test passed, because the fallback
 * made it "work" in exactly the places tests run.
 *
 * ## Where the values come from (empty by default, set per stage)
 *
 * | stage | source                                                                 |
 * |-------|------------------------------------------------------------------------|
 * | local | the committed `.env.development` — loaded by Next ONLY when `NODE_ENV` is `development` (i.e. `next dev`), never during `next build` |
 * | PR    | resolved PER DEPLOYMENT by `scripts/previewEndpoints.ts` from the `*_SANDBOX_TEMPLATE` variables and the build's PR number: this PR's own recipe service plus the shared sandbox identity host |
 * | prod  | the production pipeline's environment                                   |
 *
 * The PR row is per-DEPLOYMENT, not per-environment, and that distinction is the point: every PR deploys its
 * own recipe service, while a Vercel variable is scoped to the Preview environment as a whole. A single
 * project-wide value therefore names one PR's backend for all of them. See `scripts/previewEndpoints.ts`.
 *
 * That split is what lets local development stay zero-config while a deployed build still cannot silently
 * fall back to a developer's laptop: `.env.development` is invisible to `next build`, so the only way a
 * deployed bundle gets an endpoint is for whoever built it to have supplied one.
 *
 * ## Why `runtimeEnv` repeats each name literally
 *
 * Next's bundler only inlines `process.env.X` when it can see that exact static member expression.
 * A dynamic lookup (`process.env[name]`) is NOT inlined and would be `undefined` in the browser. T3 Env
 * enforces the literal mapping at the type level, which is precisely the discipline whose absence caused
 * the original defect — so the repetition below is load-bearing, not boilerplate to "clean up".
 */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { findStageIncoherence } from './clerkStageCoherence.js';

/** An absolute http(s) base URL. Relative values would resolve against the page and fail only in a browser. */
const endpointUrl = z.url({ protocol: /^https?$/ });

export const env = createEnv({
    /**
     * Browser-visible by design: these are public API origins, not secrets. `NEXT_PUBLIC_` is what makes
     * them reachable from client components, and T3 Env enforces that prefix on everything in `client`.
     */
    client: {
        NEXT_PUBLIC_RECIPE_API_URL: endpointUrl,
        NEXT_PUBLIC_IDENTITY_API_URL: endpointUrl,
        /**
         * Declared here after the 2026-08-07 outage, in which Vercel's Production environment held a
         * SANDBOX key (`pk_test_…` → `nice-fowl-6.clerk.accounts.dev`) while the endpoints above pointed at
         * PRODUCTION. Identity verifies tokens against the production PEM, so every request 401'd and the
         * redirect-to-sign-in handler turned that into an infinite loop.
         *
         * The reason this module did not prevent it: the key was in NO schema and read by NO source file
         * (`@clerk/nextjs` picks it up implicitly), so its only existence was a string in a dashboard.
         * Shape is validated here; the cross-field stage rule is asserted below, because it needs the
         * endpoints too.
         */
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
            .string()
            .regex(/^pk_(test|live)_[A-Za-z0-9+/=_-]+$/, 'must be a Clerk publishable key (pk_test_… or pk_live_…)'),
    },

    runtimeEnv: {
        NEXT_PUBLIC_RECIPE_API_URL: process.env.NEXT_PUBLIC_RECIPE_API_URL,
        NEXT_PUBLIC_IDENTITY_API_URL: process.env.NEXT_PUBLIC_IDENTITY_API_URL,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    },

    /**
     * A blank dashboard field or an unset CI variable arrives as `''`, which would otherwise satisfy a
     * bare string check and produce requests against the page's own origin. Treat it as absent.
     */
    emptyStringAsUndefined: true,

    /**
     * Name the offending variables. The default message ("Invalid environment variables") sends the reader
     * to the console; this sends them to the fix.
     */
    onValidationError: (issues) => {
        const names = [...new Set(issues.map((issue) => issue.path?.join('.')).filter(Boolean))].join(', ');

        throw new Error(
            `Invalid environment variables: ${names}. ` +
                'The API URLs must be absolute http(s) URLs; the Clerk key must be a publishable key ' +
                '(pk_test_… or pk_live_…). There is no default for any of them — set them for this stage ' +
                '(local: .env.development; preview/prod: the build environment). See src/config/env.ts.',
        );
    },
});

/**
 * Every endpoint the coherence rule covers, DERIVED from what this module declares rather than hand-listed.
 *
 * A hand-written list is a second place to remember: add an endpoint to the schema above, forget to add it
 * here, and the variable is shape-validated but stage-UNCHECKED — quietly outside the guard. That is the
 * same shape as the gap that let the outage through (the Clerk key was in no schema at all), so the set is
 * derived and a new endpoint is covered by existing.
 *
 * Concretely pending: feature 005 adds `NEXT_PUBLIC_AI_API_URL`, and its Vercel records are currently scoped
 * to preview AND production simultaneously — one value serving two stages, the misconfiguration shape this
 * guard exists for. It will be checked the moment it is declared, with no edit here.
 *
 * The `_API_URL` suffix is the convention every endpoint in this app follows; a differently-named endpoint
 * would escape the pattern, which is why `__tests__/env.test.ts` asserts this derived set EQUALS the set of
 * declared endpoint keys rather than trusting the regex.
 */
export const STAGE_CHECKED_ENDPOINT_KEYS: readonly string[] = Object.keys(env).filter((key) =>
    /^NEXT_PUBLIC_[A-Z0-9_]+_API_URL$/.test(key),
);

/**
 * The cross-field rule: the Clerk instance and the API endpoints must belong to the SAME stage.
 *
 * Shape validation above cannot catch this — a sandbox key and a production URL are each individually
 * valid. Only their COMBINATION is wrong, and that combination is what took production down on
 * 2026-08-07. Asserted at module load, which means `next build` fails rather than shipping a bundle
 * whose auth can never succeed. See `./clerkStageCoherence.ts` for why the rule is coherence rather
 * than "production must use pk_live".
 *
 * @sideEffect Throws at module evaluation (i.e. fails the build) when the configuration is incoherent.
 */
const stageProblems = findStageIncoherence({
    clerkPublishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    endpoints: Object.fromEntries(
        STAGE_CHECKED_ENDPOINT_KEYS.map((key) => [key, (env as Record<string, string | undefined>)[key]]),
    ),
});

if (stageProblems.length > 0) {
    throw new Error(
        `Clerk instance and API endpoints disagree about which stage this build is for:\n` +
            stageProblems.map((problem) => `  - ${problem}`).join('\n') +
            '\nSet a matched pair for this stage. See src/config/clerkStageCoherence.ts.',
    );
}
