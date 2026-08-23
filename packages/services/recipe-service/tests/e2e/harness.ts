/**
 * Reusable in-process e2e bootstrap for `@kitchensink/recipe-service` (Phase-1 harness).
 *
 * Thin wrapper over the shared {@link bootServiceApp} template (`@kitchensink/service-test-harness`,
 * promoted from identity in T6 / CP-9) that supplies the recipe `AppModule` loader and the env its
 * `apiConfigSchema` + `DatabaseModule` require, against the Docker Postgres + LocalStack S3 harness
 * (migrated + seeded ONCE per run by `tests/globalSetup.ts` — DB-isolation strategy 2 of the contract
 * documented on {@link bootServiceApp}). Phase-3 e2e specs import {@link bootRecipeApp} to drive real
 * endpoints on the ephemeral-port app it hands back.
 *
 * The recipe `AppConfigModule` validates `process.env` against `apiConfigSchema` during
 * `NestFactory.create` (NestJS `ConfigModule.forRoot({ validate })`), and `DatabaseModule` opens its `pg`
 * pool from `DATABASE_URL` at init — so every required var MUST be present BEFORE `AppModule` is
 * imported. `bootServiceApp` applies env FIRST and imports `AppModule` DYNAMICALLY for exactly this
 * reason.
 *
 * Auth: `NODE_ENV` is forced to `development` (vitest defaults it to `test`, which the recipe
 * environment enum rejects, and which would also disable the dev-auth bypass). Passing
 * `devAuthUserId` sets `RECIPE_DEV_AUTH_USER_ID`, so protected routes resolve to that fixed owner ULID
 * with NO Clerk token — the intended way to exercise authenticated endpoints in e2e without minting
 * real session tokens.
 */
import { bootServiceApp, type BootedServiceApp } from '@kitchensink/service-test-harness';

import { SEED_ERASURE_QUEUE_URL, SEED_VERIFICATION_QUEUE_URL } from '../globalSetup.js';

/** The harness Postgres connection string the booted app is configured against. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** Whether a test database is configured — e2e specs use this to `describe.skipIf(!hasDatabaseUrl)`. */
export const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Options for {@link bootRecipeApp}. */
export interface BootRecipeAppOptions {
    /**
     * When set, injects a fixed dev-bypass Principal (`RECIPE_DEV_AUTH_USER_ID`) so protected routes
     * authenticate as this owner ULID without a Clerk bearer token. Ignored in production (never set
     * here — this module forces `NODE_ENV=development`).
     */
    readonly devAuthUserId?: string;
}

/** A booted recipe app: its HTTP base URL, the Nest handle, and a teardown that closes it. */
export type BootedRecipeApp = BootedServiceApp;

/**
 * Boot the recipe Nest app in-process on an ephemeral port and return an HTTP handle + teardown.
 *
 * @param options - Optional dev-auth bypass configuration.
 * @returns The booted app's base URL, Nest handle, and `close()`.
 * @throws If `DATABASE_URL` / `TEST_DATABASE_URL` is unset (the app's `DatabaseModule` needs it) — guard
 *   suites with `describe.skipIf(!hasDatabaseUrl)`.
 * @sideEffect Mutates `process.env`, opens a Postgres pool, and starts an HTTP listener.
 */
export async function bootRecipeApp(options: BootRecipeAppOptions = {}): Promise<BootedRecipeApp> {
    if (!hasDatabaseUrl) {
        throw new Error('bootRecipeApp requires DATABASE_URL (or TEST_DATABASE_URL). Is the test harness up?');
    }

    const forcedEnv: Record<string, string> = {
        // The recipe environment enum is development/staging/production (vitest sets 'test'), and
        // 'development' also keeps the dev-auth bypass usable.
        NODE_ENV: 'development',
        // Forced (not defaulted): re-homes a caller-supplied `TEST_DATABASE_URL` onto the `DATABASE_URL`
        // key the app's config schema actually reads. `hasDatabaseUrl` above guarantees this is defined.
        DATABASE_URL: DATABASE_URL as string,
    };

    if (options.devAuthUserId !== undefined) {
        forcedEnv['RECIPE_DEV_AUTH_USER_ID'] = options.devAuthUserId;
    }

    return bootServiceApp({
        loadAppModule: () => import('../../src/app.module.js'),
        forcedEnv,
        envDefaults: {
            CLERK_JWT_KEY: 'e2e-harness-placeholder-key',
            CLERK_AUTHORIZED_PARTIES: 'http://localhost:3000',
            S3_ENDPOINT: 'http://localhost:4566',
            S3_FORCE_PATH_STYLE: 'true',
            S3_BUCKET_PHOTOS: 'commise-photos',
            S3_BUCKET_VERSIONS: 'commise-versions',
            CLOUDFRONT_URL: 'http://localhost:4566/commise-photos',
            SQS_ENDPOINT: 'http://localhost:4566',
            // The queue the global setup actually provisions — one definition, so the booted app and the
            // specs draining the queue can never address different queues.
            ACCOUNT_ERASURE_QUEUE_URL: SEED_ERASURE_QUEUE_URL,
            // The verification gate's queue (plan U11 / ADR-0024). REQUIRED like the food origin above and
            // for the same reason: `ingredientVerificationConfigSchema` refuses to boot without it, because
            // U11 shipped the gate's consumer with nothing producing a message and every check stayed green.
            INGREDIENT_VERIFICATION_QUEUE_URL: SEED_VERIFICATION_QUEUE_URL,
            // REQUIRED since issue #120 — the app refuses to boot without a food origin, deliberately (the old
            // in-code `http://localhost:3002` default is what silently pointed the deployed service at itself).
            // Nothing listens here, which is what makes the F2 specs below a real absent-dependency proof.
            FOOD_SERVICE_URL: 'http://localhost:3002',
        },
    });
}

/**
 * Run `fn` authenticated as `userId` against an ALREADY-BOOTED app, then restore whatever dev-bypass
 * identity was active before.
 *
 * The dev bypass reads `RECIPE_DEV_AUTH_USER_ID` fresh on every request, so flipping it between SEQUENTIAL
 * requests is the established way to exercise two identities against one booted app (the pattern
 * `throttle.e2e.test.ts` introduced for its per-user rate-limit proof). ⚠️ It is process-global: never flip
 * it around CONCURRENT requests, and never around a request whose response is still in flight.
 *
 * Lives here — one definition — because a second and third copy had already appeared in the specs that
 * needed two principals, and a divergent restore (or a missing `finally`) leaks the flipped identity into
 * every later test in the file.
 *
 * @param userId - The app-user ULID to authenticate as for the duration of `fn`.
 * @param fn - The work to run under that identity.
 * @returns Whatever `fn` resolves to.
 * @sideEffect Temporarily mutates `process.env['RECIPE_DEV_AUTH_USER_ID']`.
 */
export async function asPrincipal<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.env['RECIPE_DEV_AUTH_USER_ID'];
    process.env['RECIPE_DEV_AUTH_USER_ID'] = userId;

    try {
        return await fn();
    } finally {
        if (previous === undefined) {
            delete process.env['RECIPE_DEV_AUTH_USER_ID'];
        } else {
            process.env['RECIPE_DEV_AUTH_USER_ID'] = previous;
        }
    }
}
