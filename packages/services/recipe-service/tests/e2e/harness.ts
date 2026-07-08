/**
 * Reusable in-process e2e bootstrap for `@kitchensink/recipe-service` (Phase-1 harness).
 *
 * Boots the REAL Nest app (`NestFactory.create(AppModule)`) against the Docker Postgres + LocalStack S3
 * harness (migrated + seeded by `tests/global-setup.ts`) on an ephemeral port, and hands back an HTTP
 * base URL plus a teardown. Phase-3 e2e specs import {@link bootRecipeApp} to drive real endpoints.
 *
 * The recipe `AppConfigModule` validates `process.env` against `apiConfigSchema` during
 * `NestFactory.create` (NestJS `ConfigModule.forRoot({ validate })`), and `DatabaseModule` opens its `pg`
 * pool from `DATABASE_URL` at init — so every required var MUST be present BEFORE `AppModule` is
 * imported. This module therefore sets safe defaults and imports `AppModule` DYNAMICALLY (not a
 * top-of-file static import).
 *
 * Auth: `NODE_ENV` is forced to `development` (vitest defaults it to `test`, which the recipe
 * environment enum rejects, and which would also disable the dev-auth bypass). Passing
 * `devAuthUserId` sets `RECIPE_DEV_AUTH_USER_ID`, so protected routes resolve to that fixed owner ULID
 * with NO Clerk token — the intended way to exercise authenticated endpoints in e2e without minting
 * real session tokens.
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';

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
export interface BootedRecipeApp {
    /** e.g. `http://127.0.0.1:54321` — the ephemeral origin the app is listening on. */
    readonly baseUrl: string;
    /** The underlying Nest application (for DI access in advanced specs). */
    readonly app: INestApplication;
    /** Close the HTTP listener and the app. Always call in `afterAll`. */
    readonly close: () => Promise<void>;
}

/** Set `key` only when it is not already present, so CI/env overrides always win. */
function setDefault(key: string, value: string): void {
    if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
    }
}

/**
 * Populate the environment the recipe `apiConfigSchema` + `DatabaseModule` require, without clobbering
 * anything the caller/CI already set. `NODE_ENV` and `DATABASE_URL` are forced (see module docstring).
 */
function applyHarnessEnv(options: BootRecipeAppOptions): void {
    // Forced: the recipe environment enum is development/staging/production (vitest sets 'test'), and
    // 'development' also keeps the dev-auth bypass usable.
    process.env['NODE_ENV'] = 'development';

    if (DATABASE_URL !== undefined) {
        process.env['DATABASE_URL'] = DATABASE_URL;
    }

    setDefault('CLERK_JWT_KEY', 'e2e-harness-placeholder-key');
    setDefault('CLERK_AUTHORIZED_PARTIES', 'http://localhost:3000');
    setDefault('S3_ENDPOINT', 'http://localhost:4566');
    setDefault('S3_FORCE_PATH_STYLE', 'true');
    setDefault('S3_BUCKET_PHOTOS', 'commise-photos');
    setDefault('S3_BUCKET_VERSIONS', 'commise-versions');
    setDefault('CLOUDFRONT_URL', 'http://localhost:4566/commise-photos');

    if (options.devAuthUserId !== undefined) {
        process.env['RECIPE_DEV_AUTH_USER_ID'] = options.devAuthUserId;
    }
}

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

    applyHarnessEnv(options);

    // Dynamic import AFTER env is set — the config module validates env at module init.
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../../src/app.module.js');

    const app = await NestFactory.create(AppModule, { logger: false });
    // Ephemeral port — no fixed-port collisions across parallel CI jobs.
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    return {
        baseUrl,
        app,
        close: async (): Promise<void> => {
            await app.close();
        },
    };
}
