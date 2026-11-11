/**
 * The one door to the LOCAL-ONLY seed writes: a database row written straight into the recipe database, which no deployed
 * stage may ever receive.
 *
 * `reset --mode needsReview` has to store a verification verdict, and the only writer of that table is a worker the local
 * stack does not run. So it inserts the row itself, and this module is what makes that safe: {@link requireLocalSeedTarget}
 * answers a {@link LocalSeedTarget}, and nothing that writes the database can be built without one.
 *
 * ⛔ THE RULE IS THE HOST, NEVER A FLAG. A flag (`MAESTRO_LOCAL`, `E2E_POOL_NAMESPACE`, `CI`) is what a job sets for its own
 * reasons, and a remote database with a "local" flag beside it is the failure this exists to stop. So the guard reads three
 * URLs and nothing else, and every one of them must name a loopback host (`isLoopbackHost`, the harness's one rule for "this
 * address can only mean this machine"): the database it writes, and the recipe and food APIs it creates through.
 *
 * ⛔ LOOPBACK ONLY: not a compose service name (the seed runs on the host, and a bare name is a DNS lookup that resolves to
 * whatever the resolver says), not `0.0.0.0`, not a private IP. A database URL with a query string is refused outright,
 * because `pg` lets `?host=` override the authority — the URL would read as local and connect elsewhere.
 *
 * @pattern Specification — a pure predicate over the environment, returning the branded value its one consumer requires
 *   (parse, don't validate)
 */
import { isLoopbackHost } from '@kitchensink/service-test-harness/loopback-host';

/** The recipe database the seed writes to. Set by `local_maestro_seed_env`, from the running recipe container. */
export const RECIPE_DATABASE_URL = 'E2E_SEED_RECIPE_DATABASE_URL';

const RECIPE_ORIGIN = 'E2E_SEED_RECIPE_URL';
const FOOD_ORIGIN = 'E2E_SEED_FOOD_URL';

/** The slice of the environment the guard reads. */
export type LocalSeedEnvironment = Readonly<Record<string, string | undefined>>;

declare const localSeedTargetBrand: unique symbol;

/**
 * A database the seed may write: proven loopback, with the recipe and food APIs it creates through. Branded, so only
 * {@link requireLocalSeedTarget} can make one: a bare `{ databaseUrl }` does not type-check.
 */
export type LocalSeedTarget = { readonly databaseUrl: string } & { readonly [localSeedTargetBrand]: true };

/** Raised when a seed write is aimed at anything but the local stack. Matching guard: {@link isNonLocalSeedTargetError}. */
export class NonLocalSeedTargetError extends Error {
    public constructor(message: string) {
        super(`e2e-seed: refusing a local-only seed write — ${message}`);
        this.name = 'NonLocalSeedTargetError';
        Object.setPrototypeOf(this, NonLocalSeedTargetError.prototype);
    }
}

/**
 * Type guard for {@link NonLocalSeedTargetError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the refusal. Pure.
 */
export function isNonLocalSeedTargetError(error: unknown): error is NonLocalSeedTargetError {
    return error instanceof NonLocalSeedTargetError;
}

/** One variable as a parsed URL, or the refusal that names it. The URL's password is never put in a message. */
function parseOrRefuse(env: LocalSeedEnvironment, name: string, schemes: readonly string[]): URL {
    const raw = (env[name] ?? '').trim();

    if (raw === '') {
        throw new NonLocalSeedTargetError(`${name} is not set, so the target cannot be proven local`);
    }

    let url: URL;

    try {
        url = new URL(raw);
    } catch {
        throw new NonLocalSeedTargetError(`${name} is not a parseable URL`);
    }

    if (!schemes.includes(url.protocol)) {
        throw new NonLocalSeedTargetError(`${name} must be a ${schemes.join(' or ')} URL, not ${url.protocol}`);
    }

    if (!isLoopbackHost(url.hostname)) {
        throw new NonLocalSeedTargetError(`${name} names host '${url.hostname}', which is not loopback`);
    }

    return url;
}

/**
 * Prove the environment names the local stack, or refuse. Pure.
 *
 * @param env - `process.env`, or a fake.
 * @returns The target the database writer requires.
 * @throws {NonLocalSeedTargetError} For a missing, unparseable or non-loopback database, recipe origin or food origin.
 */
export function requireLocalSeedTarget(env: LocalSeedEnvironment): LocalSeedTarget {
    parseOrRefuse(env, RECIPE_ORIGIN, ['http:', 'https:']);
    parseOrRefuse(env, FOOD_ORIGIN, ['http:', 'https:']);

    const database = parseOrRefuse(env, RECIPE_DATABASE_URL, ['postgres:', 'postgresql:']);

    if (database.search !== '') {
        throw new NonLocalSeedTargetError(
            `${RECIPE_DATABASE_URL} carries a query string, and pg lets \`?host=\` override the host this check read`,
        );
    }

    // Cast reason: this is the one place the brand is asserted, after the loopback proof above.
    return { databaseUrl: (env[RECIPE_DATABASE_URL] ?? '').trim() } as LocalSeedTarget;
}
