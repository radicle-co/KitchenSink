/**
 * THE ONE HTTP SETUP of the recipe service: how the app is created and which Express middleware it registers, in
 * order. `main.ts` applies it, and so do the integration tier (`bootMockedRecipeApp`) and the e2e tier
 * (`bootRecipeApp`) through the test harness's `httpSetup` option, so every tier serves requests through the stack
 * production does.
 *
 * ⛔ THE ORDER (CORS, then the JSON parser, then the refusal strip link), the reason the service parses its own JSON
 * (`bodyParser: false`), and the fact that form bodies are no longer parsed, are written ONCE in `jsonBodyHttpSetup`
 * (`@kitchensink/nest-http-setup`). This file supplies only what is the service's own: its CORS policy.
 *
 * The CORS allowlist is DERIVED from the same Clerk `azp` boundary the token check uses (`cors.ts`), per environment,
 * and DENIES when nothing is configured. The resolved mode is logged because "which posture is live" must be readable
 * off a deployed task.
 *
 * @pattern Template Method — the shared setup fixes the order, this service supplies the CORS policy
 * @module
 */
import { jsonBodyHttpSetup } from '@kitchensink/nest-http-setup';

import { buildCorsPolicy } from './cors.js';

/** How the app is created and prepared, besides `listen`. */
export const RECIPE_HTTP_SETUP = jsonBodyHttpSetup(() =>
    buildCorsPolicy({
        nodeEnv: process.env['NODE_ENV'],
        authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES'],
        previewBaseDomain: process.env['CLERK_AZP_PATTERN'],
        previewMode: process.env['CLERK_AZP_PREVIEW_MODE'],
    }),
);
