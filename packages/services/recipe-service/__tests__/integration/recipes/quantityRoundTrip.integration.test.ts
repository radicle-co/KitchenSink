/**
 * U8 — a RANGE and an ABSENT quantity survive the whole round trip, over real HTTP against a real database.
 *
 * ## Why this tier, on top of the migration spec next door
 *
 * `database/quantityRange.integration.test.ts` proves the COLUMNS behave. This proves the SYSTEM does, and
 * the two are not the same claim. Between a request body and a rendered recipe sit the Nest validation pipe,
 * `resolveIngredientLines`, `quantityColumns`, an INSERT, a SELECT, `quantityFromColumns`, and the response
 * projection — seven places a value object can be flattened back to a scalar, and a mocked test at any one
 * of them would happily agree with whatever that layer believed.
 *
 * Every assertion below was IMPOSSIBLE to state before this unit: the wire field was a required positive
 * number, so `2 to 3 cups` could only be sent as `2` and `butter the size of an egg` could not be sent at
 * all (R36, R40, R41).
 *
 * ⚠️ The version snapshot is asserted too, because it is a SECOND persisted representation — a JSONB
 * document assembled by `aggregateToSnapshot` rather than read back through the column mapper. A range that
 * round-tripped through the columns but flattened in the snapshot would corrupt version history silently
 * while every read of the live recipe looked correct.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IngredientQuantity } from '@kitchensink/recipe-core';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JU8QTYRT0WNER000000000AA';

/** A seeded catalog ingredient (`tests/globalSetup.ts` inserts it) — create validates every line against it. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

interface IngredientLineBody {
    ingredientId: string;
    name: string;
    quantity: IngredientQuantity;
    unit?: string;
}

interface RecipeBody {
    id: string;
    currentVersion: number;
    ingredients: IngredientLineBody[];
}

/** One row of `GET /api/v1/recipes/{id}/versions`, which answers a BARE ARRAY (no page envelope). */
interface VersionBody {
    versionNumber: number;
    snapshot: { ingredients: { quantity: IngredientQuantity }[] };
}

/** A create body carrying exactly one ingredient line with the given quantity. */
const bodyWith = (quantity: IngredientQuantity, unit?: string): Record<string, unknown> => ({
    title: `U8 quantity round trip ${Date.now()}-${Math.random()}`,
    description: 'Created by the U8 quantity round-trip spec.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    totalTimeMinutes: 30,
    ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity, ...(unit === undefined ? {} : { unit }) }],
    steps: [{ instruction: 'Combine.' }],
});

describe.skipIf(!hasDatabaseUrl)('an ingredient quantity round-trips in every member (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    /** Create a recipe with one line of the given quantity and return the CREATED response body. */
    async function create(quantity: IngredientQuantity, unit?: string): Promise<RecipeBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyWith(quantity, unit)),
        });

        expect(response.status).toBe(201);

        return (await response.json()) as RecipeBody;
    }

    /** Read a recipe's version history — a BARE ARRAY, newest first. */
    async function listVersions(id: string): Promise<VersionBody[]> {
        const response = await fetch(`${baseUrl}/api/v1/recipes/${id}/versions`);

        expect(response.status).toBe(200);

        return (await response.json()) as VersionBody[];
    }

    /** Read a recipe back through `GET /api/v1/recipes/{id}`. */
    async function read(id: string): Promise<RecipeBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes/${id}`);

        expect(response.status).toBe(200);

        return (await response.json()) as RecipeBody;
    }

    it('persists and returns a RANGE with BOTH bounds intact (R36)', async () => {
        const range: IngredientQuantity = { kind: 'range', low: 2, high: 3 };
        const created = await create(range, 'cup');

        expect(created.ingredients[0]?.quantity).toEqual(range);
        expect((await read(created.id)).ingredients[0]?.quantity).toEqual(range);
    });

    it('keeps a range’s fractional upper bound at the column’s scale', async () => {
        const range: IngredientQuantity = { kind: 'range', low: 0.5, high: 0.75 };
        const created = await create(range, 'tsp');

        expect((await read(created.id)).ingredients[0]?.quantity).toEqual(range);
    });

    // ⛔ R40 — the case the old contract could not express AT ALL. `{ kind: 'absent' }` must come back as
    // itself, never as `0`, never as a fabricated `1`, and the line must not be dropped from the recipe.
    it('persists and returns an ABSENT quantity as absent, with the line still present', async () => {
        const created = await create({ kind: 'absent' });
        const readBack = await read(created.id);

        expect(readBack.ingredients).toHaveLength(1);
        expect(readBack.ingredients[0]?.quantity).toEqual({ kind: 'absent' });
        expect(readBack.ingredients[0]?.name).toBe('Flour');
    });

    it('still round-trips an EXACT quantity, the member every existing recipe uses', async () => {
        const created = await create({ kind: 'exact', value: 2.5 }, 'cup');

        expect((await read(created.id)).ingredients[0]?.quantity).toEqual({ kind: 'exact', value: 2.5 });
    });

    // The SECOND persisted representation: `recipe_versions.snapshot` is JSONB assembled by
    // `aggregateToSnapshot`, not read back through the column mapper, so it can flatten independently.
    it('writes the range into the version SNAPSHOT too, not only the live columns', async () => {
        const range: IngredientQuantity = { kind: 'range', low: 2, high: 3 };
        const created = await create(range, 'cup');

        const versions = await listVersions(created.id);

        expect(versions.length).toBeGreaterThan(0);
        expect(versions[0]?.snapshot.ingredients[0]?.quantity).toEqual(range);
    });

    it('writes an ABSENT quantity into the version snapshot as absent', async () => {
        const created = await create({ kind: 'absent' });
        const versions = await listVersions(created.id);

        expect(versions[0]?.snapshot.ingredients[0]?.quantity).toEqual({ kind: 'absent' });
    });

    // The pipe's refusals, over real HTTP — a `400`, never the `500` an out-of-range value used to produce
    // when it reached the INSERT.
    it('answers 400 for an incoherent range rather than letting it reach the INSERT', async () => {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(bodyWith({ kind: 'range', low: 3, high: 2 } as IngredientQuantity, 'cup')),
        });

        expect(response.status).toBe(400);
    });

    it('answers 400 for the PRE-U8 bare number, so an un-migrated client fails loudly', async () => {
        const body = bodyWith({ kind: 'exact', value: 2 }, 'cup');
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ...body,
                ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: 2, unit: 'cup' }],
            }),
        });

        expect(response.status).toBe(400);
    });
});
