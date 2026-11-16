/**
 * THE ONE HTTP SETUP of the food service: how the app is created and which Express middleware it registers, in order.
 * `main.ts` applies it, and so do the mocked integration tier (`tests/support/mockedFoodsApi.ts`) and the e2e tier (`tests/e2e/harness.ts`), so every tier serves requests through the stack production does.
 *
 * ⛔ THE ORDER (CORS, then the JSON parser, then the refusal strip link), the reason the service parses its own JSON
 * (`bodyParser: false`), and the fact that form bodies are no longer parsed, are written ONCE in `jsonBodyHttpSetup`
 * (`@kitchensink/nest-error-envelope`). This file supplies only what is the service's own: its CORS policy.
 *
 * The CORS allowlist is the Clerk `azp` boundary the token check uses (`cors.ts`, ADR-0047), and it DENIES when nothing is configured. The resolved mode is logged because "which posture is live" must be readable off a deployed task.
 *
 * @pattern Template Method — the shared setup fixes the order, this service supplies the CORS policy
 * @module
 */
import { jsonBodyHttpSetup } from '@kitchensink/nest-error-envelope';

import { corsPolicyFromEnv } from './cors.js';

/** How the app is created and prepared, besides `listen`. */
export const FOOD_HTTP_SETUP = jsonBodyHttpSetup(corsPolicyFromEnv);
