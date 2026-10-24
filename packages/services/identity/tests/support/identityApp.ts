/**
 * In-process e2e bootstrap for `@kitchensink/identity-service`.
 *
 * Thin wrapper over the shared {@link bootServiceApp} template (`@kitchensink/service-test-harness`,
 * promoted here from identity in T6 / CP-9) that supplies the identity `AppModule` loader and the env its
 * config schema + database module require. Auth: passing `devAuthUserId` sets `IDENTITY_DEV_AUTH_USER_ID`,
 * so protected routes resolve to that fixed synthetic principal with NO Clerk token and NO DB
 * read-through (see the dev bypass in `auth.middleware.ts`).
 *
 * Two kinds of spec use it. Most `vi.mock` the `pg` pool and the SQS client, because their assertions exercise
 * the request pipeline (global `ValidationPipe`, routing), which short-circuits before any DB/queue call — DB-isolation
 * strategy 1 of the contract documented on {@link bootServiceApp}. A real-database spec passes `databaseUrl` instead,
 * against the tier's own `identity_e2e_test` that `tests/e2e/globalSetup.ts` provisions — strategy 2. See
 * `@kitchensink/service-test-harness`'s `bootServiceApp.ts` module doc for the full contract.
 *
 * @module
 */
import { bootServiceApp, type BootedServiceApp } from '@kitchensink/service-test-harness';

/** Options for {@link bootIdentityApp}. */
export interface BootIdentityAppOptions {
    /**
     * The SERVICE-role connection a real-database suite boots against (`identityDb().appUrl`). Omitted by the
     * mocked-`pg` suites, which keep the placeholder default.
     */
    readonly databaseUrl?: string;
    /**
     * When set, injects a fixed dev-bypass principal (`IDENTITY_DEV_AUTH_USER_ID`) so protected routes
     * authenticate as this app-user ULID without a Clerk bearer token. Non-production only (this harness
     * forces `NODE_ENV=development`).
     */
    readonly devAuthUserId?: string;
}

/**
 * Boot the identity Nest app in-process on an ephemeral port and return an HTTP handle + teardown.
 *
 * @param options - Optional dev-auth bypass configuration.
 * @returns The booted app's base URL, Nest handle, and `close()`.
 * @sideEffect Mutates `process.env`, and starts an HTTP listener.
 */
export async function bootIdentityApp(options: BootIdentityAppOptions = {}): Promise<BootedServiceApp> {
    const forcedEnv: Record<string, string> = { NODE_ENV: 'development' };

    if (options.devAuthUserId !== undefined) {
        forcedEnv['IDENTITY_DEV_AUTH_USER_ID'] = options.devAuthUserId;
    }

    if (options.databaseUrl !== undefined) {
        forcedEnv['DATABASE_URL'] = options.databaseUrl;
    }

    return bootServiceApp({
        loadAppModule: () => import('../../src/app.module.js'),
        forcedEnv,
        envDefaults: {
            // `dev` is a NON_DEPLOYED_STAGE, so the schema does not require real Clerk config.
            // PORT is intentionally left to the schema default — the harness listens on an ephemeral
            // port via `app.listen(0)`, so the configured value is never used.
            STAGE: 'dev',
            DATABASE_URL: 'postgresql://identity:identity@localhost:5432/kitchensink_identity',
            DB_HOST: 'localhost',
            DB_PORT: '5432',
            DB_NAME: 'kitchensink_identity',
            DB_USERNAME: 'identity',
            DB_PASSWORD: 'identity',
            DELETION_QUEUE_URL: 'https://sqs.localhost/000000000000/identity-deletion',
            CLERK_JWT_KEY: 'e2e-harness-placeholder-key',
            CLERK_AUTHORIZED_PARTIES: 'http://localhost:3000',
        },
    });
}
