/**
 * Build a `RecipeServiceClient` that authenticates as one of the run's identities.
 *
 * One function, so the three commands cannot each answer "how does a seeder talk to the recipe service"
 * slightly differently.
 */
import { remintFromSession } from '@kitchensink/e2e-fixtures';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import type { SessionHandle } from '@kitchensink/e2e-fixtures';

import { memoizingTokenSource } from './tokenSource.js';

/**
 * A client bound to `handle`'s identity.
 *
 * @sideEffect The returned client mints Clerk tokens on demand and makes HTTP calls.
 */
export function clientFor(baseUrl: string, handle: SessionHandle): RecipeServiceClient {
    return new RecipeServiceClient({
        baseUrl,
        token: memoizingTokenSource(handle, { remint: remintFromSession }),
        // ⚠️ Longer than the client's 10s default. A `pr-{N}` preview runs ONE 0.5-vCPU Fargate Spot task
        // against a shared `db.t4g.micro`, and the first write after an idle period meets a cold pool — a
        // timeout there would fail a whole emulator job for a latency figure nobody is measuring.
        timeoutMs: 30_000,
    });
}

/**
 * A food-service client bound to `handle`'s identity — `clientFor`'s sibling, for the same reason: the commands that
 * talk to food-service must not each answer "how does a seeder talk to it" slightly differently.
 *
 * @sideEffect The returned client mints Clerk tokens on demand and makes HTTP calls.
 */
export function foodClientFor(baseUrl: string, handle: SessionHandle): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl,
        token: memoizingTokenSource(handle, { remint: remintFromSession }),
        // The recipe client's cold-preview allowance, for the same stage shape (one Spot task, a shared micro RDS).
        timeoutMs: 30_000,
    });
}
