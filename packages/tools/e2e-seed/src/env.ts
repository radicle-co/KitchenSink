/**
 * The environment the three commands read — parsed once, in one place, and REFUSED when incomplete.
 *
 * Every value here is required with no default. A default would let a misconfigured job address the wrong
 * instance or the wrong stage and report success, which is the whole class of failure the deployed tier
 * exists to detect. `RecipeServiceClient` makes the same call about its own `baseUrl`, deliberately.
 */

/** What every command needs to reach the stage. */
export interface SeedEnvironment {
    readonly clerkSecretKey: string;
    readonly clerkPublishableKey: string;
    /** The recipe API origin for THIS stage — e.g. `https://recipe-pr-91.commise.app`. */
    readonly recipeOrigin: string;
    /** The web origin Clerk stamps as `azp`, which `CLERK_AZP_PATTERN` is anchored against (ADR-0033). */
    readonly webOrigin: string;
}

const REQUIRED = {
    clerkSecretKey: 'CLERK_SECRET_KEY',
    clerkPublishableKey: 'CLERK_PUBLISHABLE_KEY',
    recipeOrigin: 'E2E_SEED_RECIPE_URL',
    webOrigin: 'E2E_SEED_WEB_ORIGIN',
} as const;

/**
 * Read and validate. Pure over the env slice it is given.
 *
 * ⛔ Reports EVERY missing variable at once. Failing on the first means a misconfigured job is fixed one
 * variable per fifty-minute run.
 */
export function readSeedEnvironment(env: Readonly<Record<string, string | undefined>>): SeedEnvironment {
    const missing = Object.values(REQUIRED).filter((name) => (env[name] ?? '').trim() === '');

    if (missing.length > 0) {
        throw new Error(`e2e-seed: missing required environment: ${missing.join(', ')}`);
    }

    return {
        clerkSecretKey: env[REQUIRED.clerkSecretKey] ?? '',
        clerkPublishableKey: env[REQUIRED.clerkPublishableKey] ?? '',
        recipeOrigin: (env[REQUIRED.recipeOrigin] ?? '').replace(/\/+$/, ''),
        webOrigin: (env[REQUIRED.webOrigin] ?? '').replace(/\/+$/, ''),
    };
}

/** The food origin variable — required only by the commands that talk to food-service. */
const FOOD_ORIGIN = 'E2E_SEED_FOOD_URL';

/**
 * Read the stage's food-service origin, for the commands that need one (`seed-catalog`, `resetPool`).
 *
 * Kept out of {@link readSeedEnvironment} on purpose: `provision` and `reset` never talk to food-service, and making
 * it required there would fail jobs that have no reason to resolve it. Refused, with no default, for the same reason
 * every value above is. Pure over the env slice it is given.
 *
 * @param env - The environment.
 * @returns The origin, without trailing slashes.
 * @throws {Error} When the variable is absent or blank.
 */
export function readFoodOrigin(env: Readonly<Record<string, string | undefined>>): string {
    const origin = (env[FOOD_ORIGIN] ?? '').trim().replace(/\/+$/, '');

    if (origin === '') {
        throw new Error(`e2e-seed: missing required environment: ${FOOD_ORIGIN}`);
    }

    return origin;
}
