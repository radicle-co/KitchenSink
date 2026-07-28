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
 * | PR    | the preview build's environment: the PR-scoped recipe host plus the shared sandbox identity host |
 * | prod  | the production pipeline's environment                                   |
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
    },

    runtimeEnv: {
        NEXT_PUBLIC_RECIPE_API_URL: process.env.NEXT_PUBLIC_RECIPE_API_URL,
        NEXT_PUBLIC_IDENTITY_API_URL: process.env.NEXT_PUBLIC_IDENTITY_API_URL,
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
                'Each must be an absolute http(s) URL. There is no default — set them for this stage ' +
                '(local: .env.development; preview/prod: the build environment). See src/config/env.ts.',
        );
    },
});
