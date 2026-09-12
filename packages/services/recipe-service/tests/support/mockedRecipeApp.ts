/**
 * The integration tier's boot: the REAL `AppModule` — auth middleware, pipes, guards and the exception filter — with
 * its dependencies mocked (`docs/CODING_STANDARDS.md` §7.1a).
 *
 * A suite replaces data access with provider doubles, and fakes food at the network (`foodFake.ts`), so the real food
 * client still serializes, forwards the bearer and parses. Every other dependency address is FORCED to a closed port,
 * so a call a suite forgot to mock fails instead of reaching the LocalStack or Postgres the tier's global setup starts.
 */
import { bootServiceApp, type BootedServiceApp, type ProviderDouble } from '@kitchensink/service-test-harness';

import { RECIPE_APP_ENV_DEFAULTS } from './recipeAppEnv.js';

/** An address nothing listens on. */
const CLOSED = 'http://127.0.0.1:9';

/** Options for {@link bootMockedRecipeApp}. */
export interface MockedRecipeAppOptions {
    /** The providers to replace, typically the DALs a route reads. */
    readonly doubles: readonly ProviderDouble[];
    /** Where food answers: a `startFoodFake()` origin. Absent, food is unreachable. */
    readonly foodServiceUrl?: string;
}

/**
 * Boot the app for the mocked integration tier. Authenticate a request with `asPrincipal` (`tests/e2e/harness.ts`);
 * a request outside it has no principal and answers `401`.
 *
 * @param options - The doubles and the food origin.
 * @returns The booted app's base URL, Nest handle, and `close()`.
 * @sideEffect Mutates `process.env` and starts an HTTP listener.
 */
export async function bootMockedRecipeApp(options: MockedRecipeAppOptions): Promise<BootedServiceApp> {
    return bootServiceApp({
        loadAppModule: () => import('../../src/app.module.js'),
        forcedEnv: {
            NODE_ENV: 'development',
            // The config schema requires a URL; with no credentials and a closed port, no query can land anywhere.
            DATABASE_URL: 'postgres://127.0.0.1:9/mocked-tier',
            S3_ENDPOINT: CLOSED,
            SQS_ENDPOINT: CLOSED,
            ACCOUNT_ERASURE_QUEUE_URL: `${CLOSED}/000000000000/mocked-tier-erasure`,
            INGREDIENT_VERIFICATION_QUEUE_URL: `${CLOSED}/000000000000/mocked-tier-verification`,
            RECIPE_PARSE_QUEUE_URL: `${CLOSED}/000000000000/mocked-tier-parse`,
            FOOD_SERVICE_URL: options.foodServiceUrl ?? CLOSED,
        },
        envDefaults: RECIPE_APP_ENV_DEFAULTS,
        doubles: options.doubles,
    });
}
