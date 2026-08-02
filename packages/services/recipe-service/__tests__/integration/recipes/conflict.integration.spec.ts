/**
 * T045 — optimistic-concurrency conflict integration test (T033 behavior over real HTTP + Postgres).
 *
 * Verifies that a stale `expectedVersion` on `PATCH /api/v1/recipes/{id}` is rejected with `409` +
 * `VERSION_CONFLICT` carrying `details.currentVersion`. Booted against the harness with a dev-auth
 * owner; skipped when the harness DB is not configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates and mutates recipes as. */
const OWNER = '01JCONFLICT0OWNER0000000BB';

interface RecipeBody {
    id: string;
    currentVersion: number;
}

interface ErrorBody {
    code: string;
    message: string;
    details?: { currentVersion?: number; conflictingVersion?: number };
}

const CREATE_PAYLOAD = {
    title: 'Conflict Recipe',
    servings: 1,
    prepTimeMinutes: 1,
    cookTimeMinutes: 1,
    totalTimeMinutes: 2,
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000bb', name: 'Salt', quantity: 1 }],
    steps: [{ instruction: 'Season.' }],
};

describe.skipIf(!hasDatabaseUrl)('recipe update version conflict (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('rejects a stale expectedVersion with 409 VERSION_CONFLICT and the current version', async () => {
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_PAYLOAD),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody;
        expect(created.currentVersion).toBe(1);

        // First update succeeds and bumps the version to 2.
        const firstPatch = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Conflict Recipe v2' }),
        });
        expect(firstPatch.status).toBe(200);

        // Second update reuses the now-stale expectedVersion 1 → conflict.
        const stalePatch = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Conflict Recipe stale' }),
        });
        expect(stalePatch.status).toBe(409);
        const error = (await stalePatch.json()) as ErrorBody;
        expect(error.code).toBe('VERSION_CONFLICT');
        expect(error.details?.currentVersion).toBe(2);
    });
});
