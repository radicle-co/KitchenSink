/**
 * The food service's LOCAL e2e boot — a thin wrapper over the shared `bootServiceApp` template
 * (`@kitchensink/service-test-harness`), as recipe's and identity's `tests/e2e/harness.ts` are.
 *
 * DB-isolation strategy 2 of that template's contract: the tier's `globalSetup.ts` provisions `food_e2e_test`
 * under the production role model (ADR-0039), and the booted app connects as `food_app` — the privileges a
 * deployed task holds, never a superuser. Auth is the REAL `FoodAuthGuard` over tokens a suite mints with
 * `../support/jwt.ts`, so the caller's public key and authorized parties are the caller's to supply.
 *
 * ⚠️ A suite must still `vi.mock('../../src/sources/usda/usda.adapter.js', …)` itself if it wants the source
 * stubbed — a mock is hoisted per test file and cannot live here.
 */
import { bootServiceApp, type BootedServiceApp } from '@kitchensink/service-test-harness';

import { foodDb } from '../support/roleDb.js';

/** Options for {@link bootFoodApp}. */
export interface BootFoodAppOptions {
    /** The SPKI public PEM the suite's tokens are signed against (`CLERK_JWT_KEY`). */
    readonly clerkJwtKey: string;
    /** Every `azp` the suite's tokens carry (`CLERK_AUTHORIZED_PARTIES`). */
    readonly authorizedParties: readonly string[];
}

/**
 * Boot the food app on an ephemeral port against the e2e tier's database, as `food_app`.
 *
 * @param options - The suite's signing key and authorized parties.
 * @returns The booted app's base URL, Nest handle and `close()`.
 * @throws {NonDisposableAdminServerError} when no admin server is configured.
 * @sideEffect Mutates `process.env`, opens a Postgres pool, and starts an HTTP listener.
 */
export async function bootFoodApp(options: BootFoodAppOptions): Promise<BootedServiceApp> {
    return bootServiceApp({
        loadAppModule: () => import('../../src/app.module.js'),
        forcedEnv: {
            // The SERVICE role's connection — what a deployed task holds.
            DATABASE_URL: foodDb().appUrl,
            NODE_ENV: 'test',
            USDA_API_KEY: 'e2e-stub-key',
            CLERK_JWT_KEY: options.clerkJwtKey,
            CLERK_AUTHORIZED_PARTIES: options.authorizedParties.join(','),
        },
    });
}

/** One HTTP answer, with the raw text kept for byte comparisons. */
export interface FoodApiResponse {
    readonly status: number;
    readonly text: string;
    readonly body: unknown;
    readonly headers: Headers;
}

/**
 * Issue one request against a booted app.
 *
 * @param baseUrl - The app's origin.
 * @param method - The HTTP method.
 * @param path - The path, beginning with `/`.
 * @param options - `token` for `Authorization: Bearer …` (omit for an anonymous call) and a JSON `body`.
 * @returns The status, raw text, parsed body and headers.
 * @sideEffect Performs an HTTP request.
 */
export async function callFoodApi(
    baseUrl: string,
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
): Promise<FoodApiResponse> {
    const headers: Record<string, string> = {};

    if (options.token !== undefined) {
        headers['authorization'] = `Bearer ${options.token}`;
    }

    if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();

    return {
        status: response.status,
        text,
        body: text.length > 0 ? (JSON.parse(text) as unknown) : undefined,
        headers: response.headers,
    };
}
