/**
 * Pins `AppModule.configure`'s middleware wiring — specifically the `AuthMiddleware` EXCLUSIONS.
 *
 * The internal service-principal erasure route (CR-002 / U4a) authenticates with a signed machine token,
 * not a Clerk user session token, so the Clerk `AuthMiddleware` must not run on it — otherwise it 401s the
 * request before `ServiceErasureGuard` (its real, fail-closed enforcement point) ever sees it.
 *
 * This became a two-path problem when the versioned API moved to the canonical `/api/{version}/` prefix:
 * the controller now answers on BOTH `api/v1/internal/account/erasure` and the deprecated
 * `v1/internal/account/erasure` alias, so BOTH must be excluded. An exclusion list that covers only the
 * legacy path silently breaks erasure fan-out on the canonical path — a fail-closed 401 that looks like an
 * auth bug and blocks GDPR Art. 17 deletions. That is the regression this suite exists to catch.
 */
import { RequestMethod, type MiddlewareConsumer, type NestModule, type Type } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuthMiddleware } from '../auth/auth.middleware.js';

/**
 * `AppModule` cannot be imported statically here. Its `AppConfigModule` runs `ConfigModule.forRoot({
 * validate })` against `process.env` while the module is being DEFINED, i.e. during import evaluation — so a
 * top-level `import { AppModule }` throws before any test runs (and surfaces as an unhandled rejection that
 * fails the whole vitest process even while every test passes). Apply env FIRST, then import dynamically —
 * the same ordering, and for the same reason, as `bootServiceApp` in `@kitchensink/service-test-harness`.
 */
let AppModule: Type<NestModule>;

beforeAll(async () => {
    // Placeholders only: nothing here is dialed. These exist purely to satisfy the config schema at import,
    // and the values mirror `tests/e2e/harness.ts` so the two do not drift into different fictions.
    const env: Record<string, string> = {
        NODE_ENV: 'development',
        CLERK_JWT_KEY: 'unit-test-placeholder-key',
        CLERK_AUTHORIZED_PARTIES: 'http://localhost:3000',
        S3_BUCKET_PHOTOS: 'commise-photos',
        S3_BUCKET_VERSIONS: 'commise-versions',
        CLOUDFRONT_URL: 'http://localhost:4566/commise-photos',
        FOOD_SERVICE_URL: 'http://localhost:3002',
        ACCOUNT_ERASURE_QUEUE_URL: 'http://localhost:4566/000000000000/account-erasure',
        DATABASE_URL: 'postgres://placeholder:placeholder@127.0.0.1:5432/placeholder',
    };

    for (const [key, value] of Object.entries(env)) {
        process.env[key] = value;
    }

    ({ AppModule } = (await import('../app.module.js')) as { AppModule: Type<NestModule> });
});

/** A single recorded `.exclude(...)` argument. */
interface RecordedExclusion {
    readonly path: string;
    readonly method: RequestMethod;
}

/** What a `configure()` run did, captured from a stand-in consumer. */
interface RecordedWiring {
    readonly applied: unknown[];
    readonly exclusions: RecordedExclusion[];
    readonly routes: unknown[];
}

/** Run `AppModule.configure` against a recording stand-in for the Nest `MiddlewareConsumer`. */
function recordWiring(): RecordedWiring {
    const applied: unknown[] = [];
    const exclusions: RecordedExclusion[] = [];
    const routes: unknown[] = [];

    const proxy = {
        exclude: (...items: RecordedExclusion[]) => {
            exclusions.push(...items);

            return proxy;
        },
        forRoutes: (...items: unknown[]) => {
            routes.push(...items);

            return proxy;
        },
    };

    const consumer = {
        apply: (...middleware: unknown[]) => {
            applied.push(...middleware);

            return proxy;
        },
    } as unknown as MiddlewareConsumer;

    new AppModule().configure(consumer);

    return { applied, exclusions, routes };
}

describe('recipe-service AppModule.configure', () => {
    it('applies the Clerk AuthMiddleware to every route', () => {
        const wiring = recordWiring();

        expect(wiring.applied).toContain(AuthMiddleware);
        expect(wiring.routes).toContain('*');
    });

    it('excludes the CANONICAL internal erasure route from the Clerk AuthMiddleware', () => {
        const wiring = recordWiring();

        expect(wiring.exclusions).toContainEqual({
            path: 'api/v1/internal/account/erasure',
            method: RequestMethod.POST,
        });
    });

    it('excludes the DEPRECATED internal erasure alias from the Clerk AuthMiddleware', () => {
        const wiring = recordWiring();

        expect(wiring.exclusions).toContainEqual({
            path: 'v1/internal/account/erasure',
            method: RequestMethod.POST,
        });
    });

    it('excludes nothing else — every other route stays fail-closed behind Clerk auth', () => {
        const wiring = recordWiring();

        expect(wiring.exclusions).toHaveLength(2);
    });
});
