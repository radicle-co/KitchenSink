/**
 * Foundation e2e smoke for `@kitchensink/recipe-service` (Phase-1 harness proof).
 *
 * Proves the harness SHAPE end to end — the reusable `bootRecipeApp` bootstrap boots the real Nest app
 * against the Docker Postgres + LocalStack S3 harness (migrated + seeded by `tests/global-setup.ts`) and
 * serves live HTTP. It intentionally covers only the public `/health` route: real feature endpoints are
 * the subject of Phase-3 e2e specs that build on this same harness.
 *
 * Skips cleanly when no test database is configured (`DATABASE_URL` / `TEST_DATABASE_URL` unset).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

describe.skipIf(!hasDatabaseUrl)('recipe-service e2e harness (booted app + Docker Postgres)', () => {
    let booted: BootedRecipeApp;

    beforeAll(async () => {
        booted = await bootRecipeApp();
    });

    afterAll(async () => {
        await booted?.close();
    });

    it('serves GET /health with 200 and the live health body', async () => {
        const response = await fetch(`${booted.baseUrl}/health`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'recipe' });
    });
});
