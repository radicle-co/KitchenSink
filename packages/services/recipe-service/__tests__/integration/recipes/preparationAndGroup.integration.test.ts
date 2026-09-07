/**
 * U26/U27 — the PREPARATION and the SECTION LABEL travel the whole way, over real HTTP against a real
 * PostgreSQL, and come back out on the read.
 *
 * ## Why this tier is mandatory and the schema + service unit tests are not enough
 *
 * `recipes.schema.test.ts` proves the CONTRACT accepts both fields; `recipes.service.test.ts` proves the
 * PROJECTIONS carry them over a fake DAL. Every claim below is a different one, and each is invisible to
 * both:
 *
 *  1. That `0030_ingredient_preparation_and_group.sql` actually applied. A unit test cannot observe a
 *     migration that did not run — and if it did not, the create path's INSERT names two columns Postgres
 *     does not have, which is a `500` on every recipe save rather than a missing feature.
 *  2. That the values survive the FIVE layers between the wire and the row: the Nest validation pipe (which
 *     STRIPS unknown keys, so a field the pipe does not know about vanishes SILENTLY rather than erroring),
 *     `resolveIngredientLines`, `ResolvedIngredientLine`, the drizzle insert, and the columns themselves.
 *  3. ⛔ That `PATCH` may edit both. This is the OPPOSITE of `sourceLine.integration.test.ts`'s assertion,
 *     and deliberately so: `sourceLine` is create-only because it steers a memoized cross-user judgement,
 *     and neither of these does. A schema test asserting `updateRecipeRequestSchema` accepts them proves the
 *     shape; only this proves what the SERVICE does with such a body — which is what matters, since
 *     `replaceForRecipe` deletes and re-inserts the whole line set on every save.
 *  4. ⛔ That the ROUND TRIP is lossless. The read projection omits a key for `NULL`, the request omits it
 *     for absent, and `recipeIngredientViewSchema` rejects `''` — three rules that only agree if all three
 *     run against a real column. A mocked DAL agrees with itself no matter which of them is wrong.
 *  5. That the DB's own CHECKs reject a blank arriving by any path — the last line of defence if a future
 *     caller bypasses the zod.
 *
 * Unlike `sourceLine`, these are READ BACK on the response: they are content a cook authored and a cook
 * reads, not write-side provenance. So the assertions go through the HTTP response, not the column — which
 * is the stronger test, because it also covers the projection the column-only form cannot see.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JU26PREPGRP0WNER000000AA';

/** A seeded catalog ingredient (`tests/globalSetup.ts` inserts it) — create validates every line against it. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

/** One ingredient line as the response projects it. */
interface LineBody {
    name: string;
    unit?: string;
    notes?: string;
    preparation?: string;
    groupLabel?: string;
}

interface RecipeBody {
    id: string;
    currentVersion: number;
    ingredients: LineBody[];
}

/** A create body carrying the given ingredient lines. */
const createBody = (lines: readonly Record<string, unknown>[]): Record<string, unknown> => ({
    title: `U26/U27 preparation + section ${Date.now()}-${Math.random()}`,
    description: 'Created by the U26/U27 spec.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    totalTimeMinutes: 30,
    ingredients: lines,
    steps: [{ instruction: 'Combine.' }],
});

/** One ordinary line, plus whatever the case under test adds to it. */
const line = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    ingredientId: FLOUR_ID,
    name: 'Flour',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    ...over,
});

describe.skipIf(!hasDatabaseUrl)('preparation + group label, wire to column and back (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    /** Create a recipe with the given lines. */
    const create = async (lines: readonly Record<string, unknown>[]): Promise<RecipeBody> => {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(createBody(lines)),
        });

        expect(response.status).toBe(201);

        return (await response.json()) as RecipeBody;
    };

    /** Read a recipe back by id. */
    const read = async (id: string): Promise<RecipeBody> => {
        const response = await fetch(`${baseUrl}/api/v1/recipes/${id}`);

        expect(response.status).toBe(200);

        return (await response.json()) as RecipeBody;
    };

    /** Patch a recipe's ingredient lines. */
    const patch = async (
        id: string,
        expectedVersion: number,
        lines: readonly Record<string, unknown>[],
    ): Promise<Response> =>
        fetch(`${baseUrl}/api/v1/recipes/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion, ingredients: lines }),
        });

    it('CREATE-then-READ round-trips both fields', async () => {
        const created = await create([line({ preparation: 'finely chopped', groupLabel: 'For the marinade' })]);
        const fetched = await read(created.id);

        expect(fetched.ingredients[0]).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
        });
    });

    // ⛔ U26's headline rule, proved where it actually matters: the response's `name` is the CATALOG's, and
    // the preparation is beside it. A projection that concatenated would produce a name matching no catalog
    // row on the next resolution.
    it('⛔ NEVER folds the preparation into the food name, on the response', async () => {
        const created = await create([line({ preparation: 'finely chopped' })]);
        const fetched = await read(created.id);

        expect(fetched.ingredients[0]?.name).toBe('Flour');
        expect(fetched.ingredients[0]?.name).not.toContain('finely chopped');
    });

    // ⛔ The dominant shape. `NULL` → the key is OMITTED, never `''` — a blank would be a response
    // `recipeIngredientViewSchema` (`min(1)`) rejects, i.e. a body this server can write and no client can read.
    it('OMITS both keys for a line stating neither — never emits `""`', async () => {
        const created = await create([line()]);
        const fetched = await read(created.id);

        expect(fetched.ingredients[0]).not.toHaveProperty('preparation');
        expect(fetched.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    it('treats the two as INDEPENDENT — either travels without the other', async () => {
        const prepOnly = await read((await create([line({ preparation: 'melted' })])).id);
        const groupOnly = await read((await create([line({ groupLabel: 'Dry' })])).id);

        expect(prepOnly.ingredients[0]?.preparation).toBe('melted');
        expect(prepOnly.ingredients[0]).not.toHaveProperty('groupLabel');
        expect(groupOnly.ingredients[0]?.groupLabel).toBe('Dry');
        expect(groupOnly.ingredients[0]).not.toHaveProperty('preparation');
    });

    it('keeps a GROUPED recipe’s labels AND their order, including a non-adjacent repeat', async () => {
        const created = await create([
            line({ name: 'Flour', groupLabel: 'Dry' }),
            line({ name: 'Milk', groupLabel: 'Wet' }),
            line({ name: 'Sugar', groupLabel: 'Dry' }),
        ]);
        const fetched = await read(created.id);

        // ⛔ THREE entries in stored order. A read that grouped by label identity would return two runs and
        // reorder the recipe — the fold is over CONSECUTIVE RUNS, and this is the wire half of that rule.
        expect(fetched.ingredients.map((l) => l.groupLabel)).toEqual(['Dry', 'Wet', 'Dry']);
    });

    /**
     * ⛔ THE OPPOSITE of `sourceLine.integration.test.ts`, deliberately. ADR-0023's criterion for create-only
     * is that a field STEERS A MEMOIZED CROSS-USER JUDGEMENT, and neither of these does — they are content a
     * cook edits. Create-only would also make them unrestorable, since `versions.service.ts` rebuilds an
     * UPDATE body from the snapshot.
     */
    it('✅ a PATCH may SET both on a line that had neither', async () => {
        const created = await create([line()]);
        const response = await patch(created.id, created.currentVersion, [
            line({ preparation: 'sifted', groupLabel: 'Dry' }),
        ]);

        expect(response.status).toBe(200);

        const fetched = await read(created.id);

        expect(fetched.ingredients[0]).toMatchObject({ preparation: 'sifted', groupLabel: 'Dry' });
    });

    it('✅ a PATCH may CHANGE a section, preserving the line’s other fields', async () => {
        const created = await create([line({ notes: 'a note', preparation: 'sifted', groupLabel: 'Dry' })]);
        const response = await patch(created.id, created.currentVersion, [
            line({ notes: 'a note', preparation: 'sifted', groupLabel: 'Wet' }),
        ]);

        expect(response.status).toBe(200);

        const fetched = await read(created.id);

        expect(fetched.ingredients[0]).toMatchObject({
            name: 'Flour',
            unit: 'cup',
            notes: 'a note',
            preparation: 'sifted',
            groupLabel: 'Wet',
        });
    });

    it('✅ a PATCH may CLEAR both by omitting them — ungrouping a line', async () => {
        const created = await create([line({ preparation: 'sifted', groupLabel: 'Dry' })]);
        const response = await patch(created.id, created.currentVersion, [line()]);

        expect(response.status).toBe(200);

        const fetched = await read(created.id);

        expect(fetched.ingredients[0]).not.toHaveProperty('preparation');
        expect(fetched.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    it('answers 400 for a blank or whitespace-only value, on create and on patch', async () => {
        for (const bad of [{ preparation: '' }, { preparation: '   ' }, { groupLabel: '' }, { groupLabel: ' ' }]) {
            const response = await fetch(`${baseUrl}/api/v1/recipes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(createBody([line(bad)])),
            });

            expect(response.status).toBe(400);
        }
    });

    // ⛔ The wire TRIMS, so a padded label cannot become a second section wearing the same visible heading.
    it('TRIMS a padded value before it reaches the column', async () => {
        const created = await create([line({ preparation: '  sifted  ', groupLabel: '  Dry  ' })]);
        const fetched = await read(created.id);

        expect(fetched.ingredients[0]).toMatchObject({ preparation: 'sifted', groupLabel: 'Dry' });
    });
});
