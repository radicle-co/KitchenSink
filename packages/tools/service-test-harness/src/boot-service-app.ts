/**
 * Generic in-process e2e bootstrap for any NestJS service in this monorepo (T6 / CP-9).
 *
 * Boots a service's REAL Nest app (`NestFactory.create(AppModule)`) on an ephemeral port and hands back
 * an HTTP base URL plus a teardown. The caller supplies (a) a loader that dynamically imports the
 * service's `AppModule`, (b) `forcedEnv` always applied (e.g. `NODE_ENV`), and (c) `envDefaults` applied
 * only-if-absent so CI/local overrides always win.
 *
 * Originally lived inside `@kitchensink/identity-service` (`tests/e2e/service-harness.ts`) so it could be
 * verified against a real consumer before the extraction; it is now the shared template
 * `@kitchensink/identity-service` (via `tests/e2e/harness.ts`) and `@kitchensink/recipe-service` (via
 * `tests/e2e/harness.ts`) both build their service-specific `bootXApp` on top of.
 *
 * The service's config module validates `process.env` during `NestFactory.create`, and its database
 * module opens its pool at init — so every required var MUST be present BEFORE `AppModule` is imported.
 * This module therefore applies env FIRST and imports both `NestFactory` and `AppModule` DYNAMICALLY.
 *
 * ## DB-isolation contract (the single source of truth for how e2e harnesses handle their database)
 *
 * `bootServiceApp` itself is DB-lifecycle-agnostic — it only boots the Nest app on an ephemeral port. It
 * never touches a database. Every consumer MUST bring its own database (if any) to a known, deterministic
 * state BEFORE calling `bootServiceApp`, because the service's DB pool opens synchronously during
 * `NestFactory.create`. Two isolation strategies are in use across this monorepo's services today; a new
 * service's e2e harness MUST pick exactly one, not mix them:
 *
 * 1. **Mock the DB entirely (identity).** `@kitchensink/identity-service`'s e2e specs `vi.mock` the `pg`
 *    pool and the SQS client, so the request pipeline under test (routing, the global `ValidationPipe`,
 *    auth) short-circuits before any real DB/queue call. `envDefaults` still supplies a plausible
 *    `DATABASE_URL`/`DB_*`/`DELETION_QUEUE_URL` purely so the config schema's Zod validation passes at
 *    boot — those values are never dialed. No Postgres/LocalStack needed; the suite runs everywhere.
 * 2. **Reset + migrate (+ seed) a real database before boot (recipe-service, food-service).** Both boot
 *    against a real Docker Postgres (`docker-compose.test.yml` / `infra/localstack/docker-compose.yml`).
 *    They differ in WHEN the reset happens, and that difference is itself part of the contract:
 *    - `recipe-service` resets **once per vitest process**, via `globalSetup: ['./tests/global-setup.ts']`
 *      in `vitest.e2e.config.ts`: drop/recreate the `public` schema, apply the ordered
 *      `src/database/migrations/*.sql` files, then run the deterministic, idempotent `seed()`
 *      (`ON CONFLICT DO NOTHING`). Every e2e file in that run shares the one migrated+seeded database, so
 *      specs MUST coexist with the shared seed (or use per-test unique IDs, e.g. `ulid()`) rather than
 *      assuming an empty table.
 *    - `food-service` resets **per spec file**, inline in that file's own `beforeAll` (drop/recreate
 *      `public`, apply `src/db/migrations/*.sql`) — there is no shared `globalSetup`/`harness.ts` for it
 *      yet, so each of its e2e files currently duplicates the same reset+migrate block. This is a known
 *      gap, not a design choice: a follow-up should extract a `tests/e2e/harness.ts` for food-service
 *      (mirroring recipe-service's) that also consumes `bootServiceApp`. It was left untouched by T6
 *      because there is no existing harness for it to migrate onto the shared template without inventing
 *      new e2e infrastructure.
 *    Either way, `fileParallelism: false` in the service's `vitest.e2e.config.ts` is REQUIRED so two
 *    vitest workers never race a schema reset against the same Postgres instance.
 *
 * When adding a new service's e2e harness: if the request pipeline under test never needs to reach the
 * DB, prefer strategy 1 (fast, no infra). If it does, prefer strategy 2 with a `globalSetup`-driven
 * once-per-run reset (cheaper than food-service's per-file duplication) unless a spec specifically needs a
 * guaranteed-empty schema.
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
