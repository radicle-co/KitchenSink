/**
 * Generic in-process e2e bootstrap for any NestJS service in this monorepo.
 *
 * Boots a service's REAL Nest app (`NestFactory.create(AppModule)`) on an ephemeral port and hands back
 * an HTTP base URL plus a teardown. The caller supplies (a) a loader that dynamically imports the
 * service's `AppModule`, (b) `forcedEnv` always applied (e.g. `NODE_ENV`), and (c) `envDefaults` applied
 * only-if-absent so CI/local overrides always win.
 *
 * DESIGN NOTE (T6 / CP-8): this is the generic template that recipe-service's `bootRecipeApp` and the
 * food-service harness are to be refactored onto — the shared `@kitchensink/service-test-harness`
 * package. It lives in the identity test tree for now so it can be verified against a real consumer
 * (identity e2e) with zero monorepo-wide blast radius; the extraction is a pure move once all three
 * services' e2e suites can be verified together (recipe's is Docker-gated).
 *
 * The service's config module validates `process.env` during `NestFactory.create`, and its database
 * module opens its pool at init — so every required var MUST be present BEFORE `AppModule` is imported.
 * This module therefore applies env FIRST and imports both `NestFactory` and `AppModule` DYNAMICALLY.
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';

/** Options for {@link bootServiceApp}. */
export interface BootServiceAppOptions {
    /** Dynamically import the service's `AppModule` (deferred until AFTER env is applied). */
    readonly loadAppModule: () => Promise<{ AppModule: unknown }>;
    /** Env applied unconditionally before boot (e.g. `NODE_ENV=development`). */
    readonly forcedEnv?: Readonly<Record<string, string>>;
    /** Env applied only when the key is absent/empty, so CI/local overrides always win. */
    readonly envDefaults?: Readonly<Record<string, string>>;
}

/** A booted service app: its HTTP base URL, the Nest handle, and a teardown that closes it. */
export interface BootedServiceApp {
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
 * Boot a Nest service in-process on an ephemeral port and return an HTTP handle + teardown.
 *
 * @param options - The AppModule loader plus the env to force / default.
 * @returns The booted app's base URL, Nest handle, and `close()`.
 * @sideEffect Mutates `process.env`, and starts an HTTP listener.
 */
export async function bootServiceApp(options: BootServiceAppOptions): Promise<BootedServiceApp> {
    for (const [key, value] of Object.entries(options.forcedEnv ?? {})) {
        process.env[key] = value;
    }

    for (const [key, value] of Object.entries(options.envDefaults ?? {})) {
        setDefault(key, value);
    }

    // Dynamic import AFTER env is set — config validates and the DB pool builds at module init.
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await options.loadAppModule();

    const app = await NestFactory.create(AppModule as never, { logger: false });
    // Ephemeral port — no fixed-port collisions across parallel test jobs.
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
