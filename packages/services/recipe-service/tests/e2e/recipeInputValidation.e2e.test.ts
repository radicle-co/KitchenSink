/**
 * REQ-003a / REQ-007 / REQ-006 — recipe input-validation e2e proof against the fully ASSEMBLED recipe
 * app (real Nest app + Docker Postgres, dev-auth bypass). The unit tier (`src/recipes/dto/__tests__/`)
 * already exhausts the DTO's boundary logic; this pins the client-visible HTTP contract: a cap or
 * non-positive-value violation is a `400`, mirroring `recipeCloneVisibility.e2e.test.ts`'s structure.
 * Skips cleanly without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const OWNER = '01JVALIDATE2E0000OWNER00000';

interface ApiErrorBody {
    code: string;
    message: string;
}

/** A minimal-but-valid create body; `over` layers the field under test on top. */
function createPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Input Validation E2E Recipe',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [
            {
                ingredientId: '00000000-0000-4000-8000-0000000000aa',
                name: 'Flour',
                quantity: { kind: 'exact', value: 1 },
            },
        ],
        steps: [{ instruction: 'Mix.' }],
        ...over,
    };
}

describe.skipIf(!hasDatabaseUrl)('recipe input validation caps + value rejection (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
    });

    afterAll(async () => {
        await booted?.close();
    });

    async function create(body: Record<string, unknown>): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    it('rejects 101 ingredients with 400 (REQ-003a cap is 100)', async () => {
        const res = await create(
            createPayload({
                ingredients: Array.from({ length: 101 }, (_, i) => ({
                    ingredientId: '00000000-0000-4000-8000-0000000000aa',
                    name: `Ingredient ${i}`,
                    quantity: { kind: 'exact', value: 1 },
                })),
            }),
        );

        expect(res.status).toBe(400);
        expect(((await res.json()) as ApiErrorBody).message).toBeDefined();
    });

    it('rejects 51 tags with 400 (REQ-007 cap is 50)', async () => {
        const res = await create(createPayload({ tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`) }));

        expect(res.status).toBe(400);
    });

    it('rejects a negative prepTimeMinutes with 400 (REQ-005a)', async () => {
        const res = await create(createPayload({ prepTimeMinutes: -1 }));

        expect(res.status).toBe(400);
    });

    it('rejects zero servings with 400 (REQ-006 — servings must be positive)', async () => {
        const res = await create(createPayload({ servings: 0 }));

        expect(res.status).toBe(400);
    });
});
