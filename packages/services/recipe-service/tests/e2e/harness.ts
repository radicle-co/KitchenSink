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

import { SEED_ERASURE_QUEUE_URL, SEED_PARSE_QUEUE_URL, SEED_VERIFICATION_QUEUE_URL } from '../support/localHarness.js';
import { RECIPE_APP_ENV_DEFAULTS } from '../support/recipeAppEnv.js';

/** Options for {@link bootRecipeApp}. */
export interface BootRecipeAppOptions {
    /**
     * The SERVICE-role connection the app is booted against, `recipeDb().appUrl`. Required, so each suite names the
     * connection its app reads and no default picks one for it.
     */
    readonly databaseUrl: string;
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
 * @throws {NonDisposableAdminServerError} when no admin server is configured.
 * @sideEffect Mutates `process.env`, opens a Postgres pool, and starts an HTTP listener.
 */
export async function bootRecipeApp(options: BootRecipeAppOptions): Promise<BootedRecipeApp> {
    const forcedEnv: Record<string, string> = {
        // The recipe environment enum is development/staging/production (vitest sets 'test'), and
        // 'development' also keeps the dev-auth bypass usable.
        NODE_ENV: 'development',
        // Forced (not defaulted): the app's config schema reads `DATABASE_URL`, and what it gets is the
        // SERVICE role's connection the CALLER named — the privileges the deployed service runs with.
        DATABASE_URL: options.databaseUrl,
    };

    if (options.devAuthUserId !== undefined) {
        forcedEnv['RECIPE_DEV_AUTH_USER_ID'] = options.devAuthUserId;
    }

    return bootServiceApp({
        loadAppModule: () => import('../../src/app.module.js'),
        forcedEnv,
        envDefaults: {
            ...RECIPE_APP_ENV_DEFAULTS,
            // The queue the global setup actually provisions — one definition, so the booted app and the
            // specs draining the queue can never address different queues.
            ACCOUNT_ERASURE_QUEUE_URL: SEED_ERASURE_QUEUE_URL,
            // The verification gate's queue (plan U11 / ADR-0024). REQUIRED like the food origin (`recipeAppEnv.ts`) and
            // for the same reason: `ingredientVerificationConfigSchema` refuses to boot without it, because
            // U11 shipped the gate's consumer with nothing producing a message and every check stayed green.
            INGREDIENT_VERIFICATION_QUEUE_URL: SEED_VERIFICATION_QUEUE_URL,
            RECIPE_PARSE_QUEUE_URL: SEED_PARSE_QUEUE_URL,
        },
    });
}
