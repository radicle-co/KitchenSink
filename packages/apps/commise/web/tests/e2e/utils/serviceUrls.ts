/**
 * WHERE the app under test sends its API calls, and the ONE place the localhost default for each backend
 * is written down.
 *
 * ## Why this is a decision and not a constant
 *
 * The browser suite drives a real Next server (`webServerMode.ts` picks which one), and that server needs
 * to be told which backends to call. It used to be told nothing: `playwright.config.ts` passed only
 * `PORT`, so the origins came from whatever `.env.local` / `.env.development` happened to hold on the
 * machine running the suite. That is wrong in both directions — a run cannot be pointed at a different
 * stack without editing an untracked file, and a stale value in one silently sends every call of that
 * service into a refused connection, which surfaces as a generic assertion timeout rather than as a
 * configuration error.
 *
 * So each backend is `<variable> ?? <local default>`, resolved here, passed into the web server's
 * environment, and reported by a failing test rather than a 120s web-server timeout when it is malformed.
 *
 * ## Why these variable names and not `E2E_*` ones
 *
 * These are the variables the APP itself reads (`src/config/env.ts`). A suite-private alias would be a
 * second spelling of one fact plus a mapping between them, and every existing override path — a shell
 * export, CI, `.env.local` — would have to learn the new name. Precedence follows from that and is
 * deliberate: an explicit variable (including one `@next/env` has loaded out of `.env.local`) beats the
 * default below, and the default is what a machine with no configuration at all gets.
 *
 * ## Why there is no `food` origin here
 *
 * The web app never calls the food service: it has no food endpoint in `src/config/env.ts` and no
 * reference to one anywhere in `src/` or `tests/`. Ingredient data reaches the browser THROUGH the recipe
 * service, which holds its own `FOOD_SERVICE_URL`. Declaring a food origin the suite passes to a server
 * that reads it nowhere would be configuration that looks live and is dead — the trap, not the feature.
 * If the web app ever grows a direct food call, add it to both records below: they are typed over one
 * union, so a service added to one and not the other is a compile error.
 *
 * Every function in this module is pure.
 */
import { z } from 'zod';

/** The backends the web app is configured to call. */
export type ServiceName = 'recipe' | 'identity';

/** The resolved origin for every backend, keyed by service. */
export type ServiceUrls = Readonly<Record<ServiceName, string>>;

/**
 * The environment variable that names each backend's origin — the app's own names, from
 * `src/config/env.ts`, so there is exactly one spelling of each.
 */
export const SERVICE_URL_ENV_VARS: Readonly<Record<ServiceName, string>> = {
    recipe: 'NEXT_PUBLIC_RECIPE_API_URL',
    identity: 'NEXT_PUBLIC_IDENTITY_API_URL',
};

/**
 * The default origin for each backend: the port that service's OWN schema binds when run locally
 * (`recipe-service/src/config/config.types.ts` → 3000, `identity/src/config/env.schema.ts` → 3001), which
 * is what `npm run local:up` publishes on the host.
 *
 * ⛔ These must stay local. A default naming a deployed host would let an unconfigured run mutate shared
 * data; `__tests__/serviceUrls.test.ts` asserts that it cannot.
 */
export const SERVICE_URL_DEFAULTS: ServiceUrls = {
    recipe: 'http://localhost:3000',
    identity: 'http://localhost:3001',
};

/**
 * The same rule `src/config/env.ts` applies to these variables at build time, applied here at suite-config
 * time so a bad value is reported where it was set rather than from inside the spawned server. A relative
 * value would resolve against the page in a browser and fail only there.
 */
const endpointUrl = z.url({ protocol: /^https?$/ });

/** Raised when a service-origin variable holds something that is not an absolute http(s) URL. */
export class InvalidServiceUrlError extends Error {
    public constructor(variable: string, value: string) {
        super(
            `${variable}='${value}' is not an absolute http(s) URL. It names the origin the app under test ` +
                'calls for that service — a relative value resolves against the page and fails only in a ' +
                `browser. Leave it unset to use the local default. See tests/e2e/utils/serviceUrls.ts.`,
        );
        this.name = 'InvalidServiceUrlError';
        Object.setPrototypeOf(this, InvalidServiceUrlError.prototype);
    }
}

/**
 * Type guard for {@link InvalidServiceUrlError}.
 *
 * @param error - Any thrown value.
 * @returns Whether it is an {@link InvalidServiceUrlError}.
 */
export function isInvalidServiceUrlError(error: unknown): error is InvalidServiceUrlError {
    return error instanceof InvalidServiceUrlError;
}

/**
 * Resolve one service's origin from the environment, falling back to its local default.
 *
 * @param env - The process environment to read.
 * @param service - Which backend to resolve.
 * @returns The absolute origin to use.
 * @throws {InvalidServiceUrlError} When the variable is set to something that is not an http(s) URL.
 */
function resolveOne(env: Readonly<Record<string, string | undefined>>, service: ServiceName): string {
    const variable = SERVICE_URL_ENV_VARS[service];
    // A declared-but-empty CI variable, and a `KEY=` line in a dotenv file, both arrive as ''. Neither is
    // a choice of origin, so both mean "unset" rather than "the empty origin".
    const configured = env[variable]?.trim() ?? '';

    if (configured === '') {
        return SERVICE_URL_DEFAULTS[service];
    }

    if (!endpointUrl.safeParse(configured).success) {
        throw new InvalidServiceUrlError(variable, configured);
    }

    return configured;
}

/**
 * Resolve every backend origin the app under test should call.
 *
 * @param env - The process environment to read (see {@link SERVICE_URL_ENV_VARS}).
 * @returns The resolved origin for each service.
 * @throws {InvalidServiceUrlError} When any variable is set to something that is not an http(s) URL.
 */
export function resolveServiceUrls(env: Readonly<Record<string, string | undefined>>): ServiceUrls {
    return {
        recipe: resolveOne(env, 'recipe'),
        identity: resolveOne(env, 'identity'),
    };
}

/**
 * Project resolved origins onto the environment variables the web server reads.
 *
 * Derived from {@link SERVICE_URL_ENV_VARS} rather than hand-listed, so a service added to that record
 * reaches the spawned server without a second edit somebody has to remember.
 *
 * @param urls - The resolved origins, from {@link resolveServiceUrls}.
 * @returns Variable name → origin, ready to spread into Playwright's `webServer.env`.
 */
export function serviceUrlEnv(urls: ServiceUrls): Readonly<Record<string, string>> {
    return Object.fromEntries(
        (Object.keys(SERVICE_URL_ENV_VARS) as ServiceName[]).map((service) => [
            SERVICE_URL_ENV_VARS[service],
            urls[service],
        ]),
    );
}
