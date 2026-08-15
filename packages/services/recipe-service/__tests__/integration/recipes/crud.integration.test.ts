/**
 * T098 — recipe CRUD lifecycle integration test (real Nest app + Docker Postgres + LocalStack).
 *
 * Drives the `/api/v1/recipes` HTTP surface end to end against the harness (booted by `bootRecipeApp`,
 * migrated + seeded by `tests/globalSetup.ts`). The dev-auth bypass injects a fixed owner ULID so the
 * routes authenticate without a Clerk token. Runs only when the harness DB is configured — otherwise
 * skipped in lockstep with the global setup (`describe.skipIf(!hasDatabaseUrl)`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates and mutates recipes as. */
const OWNER = '01JCRUD0OWNER00000000000AA';

interface RecipeBody {
    id: string;
    ownerId: string;
    title: string;
    currentVersion: number;
    steps: { stepNumber: number; instruction: string; timerSeconds?: number }[];
    deletedAt?: string | null;
}

interface PaginatedBody {
    data: RecipeBody[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

const CREATE_PAYLOAD = {
    title: 'Integration CRUD Recipe',
    description: 'Created by the CRUD lifecycle integration spec.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    totalTimeMinutes: 30,
    tags: ['integration'],
    dietaryFlags: [],
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 2, unit: 'cup' }],
    steps: [{ instruction: 'Combine the dry ingredients.' }, { instruction: 'Bake.', timerSeconds: 1800 }],
};

describe.skipIf(!hasDatabaseUrl)('recipes CRUD lifecycle (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('creates, reads, lists, updates, and soft-deletes a recipe', async () => {
        // Create
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_PAYLOAD),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody;
        expect(created.ownerId).toBe(OWNER);
        expect(created.currentVersion).toBe(1);
        expect(created.steps).toHaveLength(2);
        expect(created.steps[0]?.stepNumber).toBe(1);

        // Read
        const getRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`);
        expect(getRes.status).toBe(200);
        const fetched = (await getRes.json()) as RecipeBody;
        expect(fetched.id).toBe(created.id);

        // List
        const listRes = await fetch(`${baseUrl}/api/v1/recipes?page=1&pageSize=50`);
        expect(listRes.status).toBe(200);
        const list = (await listRes.json()) as PaginatedBody;
        expect(list.data.some((recipe) => recipe.id === created.id)).toBe(true);

        // Update (optimistic concurrency: expectedVersion must match)
        const patchRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: 1, title: 'Integration CRUD Recipe (edited)' }),
        });
        expect(patchRes.status).toBe(200);
        const updated = (await patchRes.json()) as RecipeBody;
        expect(updated.title).toBe('Integration CRUD Recipe (edited)');
        expect(updated.currentVersion).toBe(2);

        // Soft-delete
        const deleteRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, { method: 'DELETE' });
        expect(deleteRes.status).toBe(204);

        // Gone from reads
        const goneRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`);
        expect(goneRes.status).toBe(404);
    });

    it('rejects a create with 101 ingredients (REQ-003a — cap is 100)', async () => {
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ...CREATE_PAYLOAD,
                ingredients: Array.from({ length: 101 }, (_, i) => ({
                    ingredientId: '00000000-0000-4000-8000-0000000000aa',
                    name: `Ingredient ${i}`,
                    quantity: 1,
                })),
            }),
        });
        expect(res.status).toBe(400);
    });

    it('rejects a create with 51 tags (REQ-007 — cap is 50)', async () => {
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ...CREATE_PAYLOAD,
                tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`),
            }),
        });
        expect(res.status).toBe(400);
    });

    it('rejects a create with a negative prepTimeMinutes (REQ-005a)', async () => {
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_PAYLOAD, prepTimeMinutes: -1 }),
        });
        expect(res.status).toBe(400);
    });

    it('rejects a create with zero servings (REQ-006 — servings must be positive)', async () => {
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_PAYLOAD, servings: 0 }),
        });
        expect(res.status).toBe(400);
    });

    it('allows PATCH to modify a recipe description, and the change persists (REQ-002b)', async () => {
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_PAYLOAD, title: 'Description Update Recipe', description: 'Original.' }),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody & { description?: string };

        const patchRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: created.currentVersion, description: 'Updated description.' }),
        });
        expect(patchRes.status).toBe(200);
        const updated = (await patchRes.json()) as RecipeBody & { description?: string };
        expect(updated.description).toBe('Updated description.');

        // Persisted — not just echoed on the response.
        const getRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`);
        const fetched = (await getRes.json()) as RecipeBody & { description?: string };
        expect(fetched.description).toBe('Updated description.');
    });
});
