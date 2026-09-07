/**
 * U7/U11 — the measure the SOURCE printed reaches the database, survives an edit, and cannot be asserted on
 * `PATCH`, over real HTTP against a real PostgreSQL.
 *
 * ## The defect this closes
 *
 * The importer restates a historical measure at parse time: `one gill of milk` is persisted as
 * `quantity 0.5, unit 'cup'`, because the USDA household-portion table the nutrition path matches against has
 * never heard of a gill. U11's verification gate builds its question from the PERSISTED pair, so the model
 * was shown a source line reading `one gill of milk` beside a parse claiming `0.5 cup` and asked whether they
 * agree. They do not — and the model is RIGHT to say so, about a line we parsed correctly. U11 names the
 * false-disagree rate as the number that triggers a rethink, because a wrong AGREE passes data that would
 * have shipped anyway while a wrong DISAGREE withholds nutrition from a correct line.
 *
 * ## ⛔ Why this tier, and what a schema or unit test structurally cannot prove
 *
 *  1. That `0027_ingredient_stated_measure.sql` APPLIED. A unit test cannot observe a migration that did not
 *     run — and if it did not, the create path's INSERT names three columns Postgres does not have, which is
 *     a `500` on every recipe save rather than a missing feature.
 *  2. That the value survives every layer between the wire and the row, including the Nest validation pipe,
 *     which STRIPS unknown keys: a field the pipe does not know about vanishes SILENTLY rather than erroring,
 *     which is exactly how `sourceLine` shipped inert once already.
 *  3. That `recipe_ingredients_stated_measure_coherent` does not reject a body the contract accepts. The
 *     CHECK and the zod are two independently-written statements of one rule, and only a real INSERT can
 *     prove they agree — a disagreement is a 500 on a legitimate save.
 *  4. ⛔ That the restatement SURVIVES an edit that did not change the line, and is dropped by one that did.
 *     `replaceForRecipe` deletes and re-inserts the whole set on every save and both shipped clients send
 *     `ingredients` on every save, so without the carry-forward a title edit would silently return the gate
 *     to comparing `one gill of milk` against `0.5 cup`. The rule is
 *     `domain/transcriptionCarryForward.ts`, running against rows read back out of Postgres.
 *  5. ⛔ That a CLONE carries it. `verificationKey` v2 hashes the stated measure, so a clone that dropped it
 *     would compute a DIFFERENT key from its source — and `toResolvedIngredientLine`'s own comment claims the
 *     clone deliberately enqueues nothing because "the judgement is content-identical to the source's". That
 *     sentence is only true if this holds.
 *
 * The assertions read the COLUMNS directly, because nothing reads the stated measure back out yet: U11's gate
 * is the only consumer and it ships observe-only. A test written against the response body would assert
 * nothing at all — the value is write-only in this release, by design, exactly as `source_line` is.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JU7STATEDM0WNER00000000AA';

/** A seeded catalog ingredient (`tests/globalSetup.ts` inserts it) — create validates every line against it. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

/** The line the book printed, and the restatement the importer made of it. */
const SOURCE_LINE = 'one gill of milk';
const STATED = { quantity: { kind: 'exact', value: 1 }, unit: 'gill' } as const;

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

interface RecipeBody {
    id: string;
    currentVersion: number;
}

/** The three stated columns of one persisted line. */
interface StatedRow {
    stated_quantity: string | null;
    stated_quantity_high: string | null;
    stated_unit: string | null;
}

/** A create body carrying one RESTATED line: the row holds cups, the source printed a gill. */
const createBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: `U7 stated measure ${Date.now()}-${Math.random()}`,
    description: 'Created by the U7 stated-measure spec.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    totalTimeMinutes: 30,
    ingredients: [
        {
            ingredientId: FLOUR_ID,
            name: 'Flour',
            quantity: { kind: 'exact', value: 0.5 },
            unit: 'cup',
            sourceLine: SOURCE_LINE,
            statedMeasure: STATED,
            ...overrides,
        },
    ],
    steps: [{ instruction: 'Combine.' }],
});

describe.skipIf(!hasDatabaseUrl)('the stated measure reaches the row, and only on create (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    /** Create a recipe with one line, and return the created body. */
    async function create(overrides: Record<string, unknown> = {}): Promise<RecipeBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(createBody(overrides)),
        });

        expect(response.status).toBe(201);

        return (await response.json()) as RecipeBody;
    }

    /** The persisted stated columns for a recipe's lines, in `sort_order`. */
    async function storedStated(recipeId: string): Promise<StatedRow[]> {
        const { rows } = await pool.query<StatedRow>(
            `SELECT stated_quantity, stated_quantity_high, stated_unit
             FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
            [recipeId],
        );

        return rows;
    }

    /** `PATCH` the recipe, returning the response. */
    async function patch(recipe: RecipeBody, body: Record<string, unknown>): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes/${recipe.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: recipe.currentVersion, ...body }),
        });
    }

    /** The one ingredient line as a `PATCH` would resend it — never carrying a stated measure. */
    const resend = (quantity: unknown = { kind: 'exact', value: 0.5 }, unit = 'cup'): unknown[] => [
        { ingredientId: FLOUR_ID, name: 'Flour', quantity, unit },
    ];

    it('persists what the SOURCE printed beside the restatement the catalog can weigh', async () => {
        const recipe = await create();

        expect(await storedStated(recipe.id)).toEqual([
            { stated_quantity: '1.000', stated_quantity_high: null, stated_unit: 'gill' },
        ]);
    });

    it('persists a stated RANGE across both stated columns', async () => {
        const recipe = await create({
            quantity: { kind: 'range', low: 0.5, high: 1 },
            statedMeasure: { quantity: { kind: 'range', low: 1, high: 2 }, unit: 'gill' },
        });

        expect(await storedStated(recipe.id)).toEqual([
            { stated_quantity: '1.000', stated_quantity_high: '2.000', stated_unit: 'gill' },
        ]);
    });

    // ⛔ THE DOMINANT CASE. A line whose quantity and unit ARE what the source said must claim no
    // restatement — the field's PRESENCE is the disclosure, so a stray value would assert a conversion that
    // never happened on every ordinary recipe in the system.
    it('leaves all three columns NULL for a line that was never restated', async () => {
        const recipe = await create({ statedMeasure: undefined });

        expect(await storedStated(recipe.id)).toEqual([
            { stated_quantity: null, stated_quantity_high: null, stated_unit: null },
        ]);
    });

    // ⛔ CREATE-ONLY, for a SHARPER reason than `sourceLine`'s. A source line is what the gate checks our
    // parse AGAINST, so a lie in it is visible to the model; a stated measure IS the parse the model is
    // shown, so a lie in it is invisible — and the gate's verdicts are memoized ACROSS USERS.
    it('⛔ answers 400 to a PATCH that tries to assert a stated measure', async () => {
        const recipe = await create();
        const response = await patch(recipe, {
            ingredients: [
                {
                    ingredientId: FLOUR_ID,
                    name: 'Flour',
                    quantity: { kind: 'exact', value: 0.5 },
                    unit: 'cup',
                    statedMeasure: { quantity: { kind: 'exact', value: 99 }, unit: 'hogshead' },
                },
            ],
        });

        expect(response.status).toBe(400);
    });

    /**
     * ⛔ THE PROPERTY THAT DECIDES WHETHER THE FIX SURVIVES ITS FIRST EDIT.
     *
     * `replaceForRecipe` swaps the whole line set on every save and both shipped clients always send
     * `ingredients`, so a title edit re-inserts every line from a body that CANNOT carry a stated measure.
     * Without the carry-forward the gill would be gone and the gate would go straight back to comparing
     * `one gill of milk` against `0.5 cup` — silently, on a recipe nobody meant to change.
     */
    it('KEEPS the stated measure through an edit that changed nothing about the LINE', async () => {
        const recipe = await create();
        const response = await patch(recipe, { title: 'A corrected title', ingredients: resend() });

        expect(response.status).toBe(200);
        expect(await storedStated(recipe.id)).toEqual([
            { stated_quantity: '1.000', stated_quantity_high: null, stated_unit: 'gill' },
        ]);
    });

    // ⛔ AND DROPS IT when the judgement moves. A gill kept beside an amount the author has since edited
    // claims the source printed a gill for a quantity it never printed — a restatement whose two halves
    // describe different lines, which is worse than no restatement at all.
    it('DROPS the stated measure when the quantity changes — the restatement is now stale', async () => {
        const recipe = await create();
        const response = await patch(recipe, { ingredients: resend({ kind: 'exact', value: 3 }) });

        expect(response.status).toBe(200);
        expect(await storedStated(recipe.id)).toEqual([
            { stated_quantity: null, stated_quantity_high: null, stated_unit: null },
        ]);
    });

    it('DROPS the stated measure when the unit changes', async () => {
        const recipe = await create();
        const response = await patch(recipe, {
            ingredients: resend({ kind: 'exact', value: 0.5 }, 'tablespoon'),
        });

        expect(response.status).toBe(200);
        expect(await storedStated(recipe.id)).toEqual([
            { stated_quantity: null, stated_quantity_high: null, stated_unit: null },
        ]);
    });

    /**
     * ⛔ A CLONE IS THE SAME JUDGEMENT, and `verificationKey` v2 hashes the stated measure.
     *
     * `toResolvedIngredientLine`'s own comment says the clone deliberately enqueues no verification of its
     * own "because the judgement is content-identical to the source's, and `verificationKey` is
     * content-addressed". That sentence is FALSE if the stated measure is dropped: the clone's key would
     * differ, the source's verdict would not apply, and — because absence of a verdict PUBLISHES — the clone
     * would go permanently unverified with no signal anywhere.
     */
    it('carries the stated measure onto a CLONE, which is what makes the clone content-identical', async () => {
        const source = await create();

        // A clone is only reachable for a recipe the caller can see; the owner cloning their own is enough to
        // exercise the projection, which is the thing under test.
        const response = await fetch(`${baseUrl}/api/v1/recipes/${source.id}/clone`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        });

        expect(response.status).toBe(201);

        const clone = (await response.json()) as RecipeBody;

        expect(await storedStated(clone.id)).toEqual(await storedStated(source.id));
        expect(await storedStated(clone.id)).toEqual([
            { stated_quantity: '1.000', stated_quantity_high: null, stated_unit: 'gill' },
        ]);
    });
});
