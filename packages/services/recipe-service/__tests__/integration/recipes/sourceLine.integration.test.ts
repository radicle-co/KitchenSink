/**
 * U11/U14 — the RAW SOURCE LINE reaches the database, and `PATCH` cannot assert one, over real HTTP against
 * a real PostgreSQL.
 *
 * ## Why this tier is mandatory and a schema unit test would not be enough
 *
 * `recipes.schema.test.ts` proves the CONTRACT accepts the field on create and refuses it on update. Every
 * claim below is a different claim, and each one is invisible to a schema test:
 *
 *  1. That `0024_ingredient_source_line.sql` actually applied. A unit test cannot observe a migration that
 *     did not run — and if it did not, the create path's INSERT names a column Postgres does not have, which
 *     is a `500` on every recipe save rather than a missing feature.
 *  2. That the value survives the FIVE layers between the wire and the row: the Nest validation pipe (which
 *     STRIPS unknown keys, so a field the pipe does not know about vanishes silently rather than erroring),
 *     `resolveIngredientLines`, `ResolvedIngredientLine`, the drizzle insert, and the column itself.
 *  3. ⛔ That the pipe's stripping is what a `PATCH` actually gets. The schema test asserts
 *     `updateRecipeRequestSchema.safeParse` fails; this asserts what the SERVICE does with such a body, which
 *     is the property that matters — a strict schema that some other layer pre-strips would pass the unit
 *     test and admit the field in production.
 *  4. ⛔ That the TRANSCRIPTION SURVIVES an edit that did not change the line, and is dropped by one that
 *     did. `replaceForRecipe` deletes and re-inserts the whole set on every save, and both shipped clients
 *     send `ingredients` on every save — so this is the property that decides whether renaming an imported
 *     recipe destroys its evidence. It is produced by `domain/sourceLineCarryForward.ts` running against
 *     rows read back out of Postgres, and no schema or unit test observes that round trip.
 *
 * The assertions read the COLUMN directly, because nothing reads the source line back out yet: U11's gate is
 * the only consumer and it ships observe-only. A test written against the response body would therefore
 * assert nothing at all — the value is write-only in this release, by design.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JU14SRCLINE0WNER0000000AA';

/** A seeded catalog ingredient (`tests/globalSetup.ts` inserts it) — create validates every line against it. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

/** The line a cook's source stated — deliberately unlike anything the service would RENDER for this food. */
const SOURCE_LINE = '2 heaping cups of well-sifted pastry flour, plus more for dusting';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

interface RecipeBody {
    id: string;
    currentVersion: number;
}

/** A create body carrying exactly one ingredient line, optionally with a transcribed source line. */
const createBody = (sourceLine?: string): Record<string, unknown> => ({
    title: `U14 source line ${Date.now()}-${Math.random()}`,
    description: 'Created by the U14 source-line spec.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    totalTimeMinutes: 30,
    ingredients: [
        {
            ingredientId: FLOUR_ID,
            name: 'Flour',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            ...(sourceLine === undefined ? {} : { sourceLine }),
        },
    ],
    steps: [{ instruction: 'Combine.' }],
});

describe.skipIf(!hasDatabaseUrl)('the raw source line reaches the row, and only on create (integration)', () => {
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

    /** Create a recipe with one line and return the created body. */
    async function create(sourceLine?: string): Promise<RecipeBody> {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(createBody(sourceLine)),
        });

        expect(response.status).toBe(201);

        return (await response.json()) as RecipeBody;
    }

    /** The persisted `source_line` values for a recipe's lines, in `sort_order`. */
    async function storedSourceLines(recipeId: string): Promise<(string | null)[]> {
        const { rows } = await pool.query<{ source_line: string | null }>(
            'SELECT source_line FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order',
            [recipeId],
        );

        return rows.map((row) => row.source_line);
    }

    it('persists the transcribed line VERBATIM — the gate has nothing to check a parse against otherwise', async () => {
        const created = await create(SOURCE_LINE);

        expect(await storedSourceLines(created.id)).toEqual([SOURCE_LINE]);
    });

    it('⛔ stores it DISTINCT from the rendered ingredient name, which is what makes the gate non-circular', async () => {
        const created = await create(SOURCE_LINE);
        const { rows } = await pool.query<{ source_line: string | null; ingredient_name: string }>(
            'SELECT source_line, ingredient_name FROM recipe_ingredients WHERE recipe_id = $1',
            [created.id],
        );

        expect(rows[0]?.source_line).toBe(SOURCE_LINE);
        expect(rows[0]?.ingredient_name).not.toBe(rows[0]?.source_line);
    });

    it('leaves the column NULL for an AUTHORED line — absence is a statement, not a gap', async () => {
        const created = await create();

        expect(await storedSourceLines(created.id)).toEqual([null]);
    });

    it('trims before storing, so a padded transcription is not stored with its padding', async () => {
        const created = await create(`   ${SOURCE_LINE}   `);

        expect(await storedSourceLines(created.id)).toEqual([SOURCE_LINE]);
    });

    it('REJECTS a whitespace-only transcription rather than storing a source line with no content', async () => {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(createBody('   ')),
        });

        expect(response.status).toBe(400);
    });

    // ⛔ THE ESCALATION PATH, closed at the service and not only in the schema. A caller able to re-assert a
    // source line on PATCH could steer a gate verdict that is then MEMOIZED FOR EVERY USER (migration 0021).
    it('⛔ answers 400 to a PATCH that tries to assert a source line', async () => {
        const created = await create();
        const response = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                expectedVersion: created.currentVersion,
                ingredients: [
                    {
                        ingredientId: FLOUR_ID,
                        name: 'Flour',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cup',
                        sourceLine: SOURCE_LINE,
                    },
                ],
            }),
        });

        expect(response.status).toBe(400);
        expect(await storedSourceLines(created.id)).toEqual([null]);
    });

    /** PATCH the recipe with a body the caller supplies, returning the HTTP status. */
    async function patch(id: string, body: Record<string, unknown>): Promise<number> {
        const response = await fetch(`${baseUrl}/api/v1/recipes/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

        return response.status;
    }

    /** The line body both apps send on a save that changes nothing about this line. */
    const unchangedLine = { ingredientId: FLOUR_ID, name: 'Flour', quantity: { kind: 'exact', value: 2 }, unit: 'cup' };

    // ⛔ THE DEFECT THIS CARRIES: `toUpdateRecipeInput` spreads `toCreateRecipeInput`, which ALWAYS emits
    // `ingredients` — so both shipped apps send the whole line set on a title-only edit. Without the
    // carry-forward, renaming an imported recipe would destroy every transcription on it, permanently.
    it('KEEPS the source line through an edit that changed nothing about the LINE', async () => {
        const created = await create(SOURCE_LINE);

        expect(
            await patch(created.id, {
                expectedVersion: created.currentVersion,
                title: 'Renamed, same transcription',
                ingredients: [unchangedLine],
            }),
        ).toBe(200);
        expect(await storedSourceLines(created.id)).toEqual([SOURCE_LINE]);
    });

    it('KEEPS it through a PATCH that supplies no ingredients at all', async () => {
        const created = await create(SOURCE_LINE);

        expect(await patch(created.id, { expectedVersion: created.currentVersion, title: 'Metadata only' })).toBe(200);
        expect(await storedSourceLines(created.id)).toEqual([SOURCE_LINE]);
    });

    // …and the other half of the rule: the tuple a verdict is keyed on MOVED, so the old transcription now
    // describes a different judgement and must not follow the line.
    it('DROPS the source line when the quantity changes — the transcription is now stale', async () => {
        const created = await create(SOURCE_LINE);

        expect(
            await patch(created.id, {
                expectedVersion: created.currentVersion,
                ingredients: [{ ...unchangedLine, quantity: { kind: 'exact', value: 3 } }],
            }),
        ).toBe(200);
        expect(await storedSourceLines(created.id)).toEqual([null]);
    });

    it('DROPS the source line when the unit changes', async () => {
        const created = await create(SOURCE_LINE);

        expect(
            await patch(created.id, {
                expectedVersion: created.currentVersion,
                ingredients: [{ ...unchangedLine, unit: 'tablespoon' }],
            }),
        ).toBe(200);
        expect(await storedSourceLines(created.id)).toEqual([null]);
    });
});
