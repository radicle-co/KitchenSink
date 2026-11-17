/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): ADR-0090's flag survives an edit and a restore, on real Postgres, as the
 * service role, through the assembled app.
 *
 * `withCarriedTranscription` writes `ingredients.source_line_transcribed_by_owner` on every update. The integration tier
 * mocks the DAL, so a carry-forward that wrote FALSE there would still pass. Only a read back through a real
 * database shows whether the OWNER still gets `sourceLine` after a save, and whether another cook still does not.
 *
 * Both shipped clients resend every ingredient on every save, so each edit below sends the line unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { recipeDb } from '../../support/roleDb.js';

const OWNER = '01JU90DISCL0SUREOWNER0000A';
const OTHER = '01JU90DISCL0SUREOTHER00000';
/** A seeded declared binding (`src/database/seed.ts`). */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const SOURCE_LINE = '2 heaping cups of well-sifted pastry flour (MY GRANDMOTHERS CARD)';

const roleDb = recipeDb();

interface RecipeBody {
    id: string;
    currentVersion: number;
    ingredients: { sourceLine?: string }[];
}

const unchangedLine = { ingredientId: FLOUR_ID, quantity: { kind: 'exact', value: 2 }, unit: 'cup' };

describe('the owner flag survives an edit and a restore (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    });

    afterAll(async () => {
        await pool?.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
        await pool?.end();
        await booted?.close();
    });

    async function call(user: string, method: string, path: string, body?: unknown): Promise<Response> {
        return asPrincipal(user, () =>
            fetch(`${booted.baseUrl}${path}`, {
                method,
                headers: { 'content-type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
        );
    }

    async function ok<T>(response: Response, expected: number): Promise<T> {
        const text = await response.text();

        expect(response.status, text).toBe(expected);

        return JSON.parse(text) as T;
    }

    /** A published recipe the owner created with a transcribed line, then made public so another cook can read it. */
    async function seedPublicTranscribed(): Promise<RecipeBody> {
        const created = await ok<RecipeBody>(
            await call(OWNER, 'POST', '/api/v1/recipes', {
                title: `U90 disclosure ${Date.now()}-${Math.random()}`,
                servings: 4,
                prepTimeMinutes: 10,
                cookTimeMinutes: 20,
                totalTimeMinutes: 30,
                cuisine: 'Italian',
                ingredients: [{ ...unchangedLine, sourceLine: SOURCE_LINE }],
                steps: [{ instruction: 'Combine.' }],
            }),
            201,
        );

        // Direct write: the read rule under test is who is SHOWN the text, not how a recipe becomes public.
        await pool.query(`UPDATE recipes SET visibility = 'public', status = 'published' WHERE id = $1`, [created.id]);

        return created;
    }

    async function sourceLineSeenBy(user: string, id: string): Promise<string | undefined> {
        const body = await ok<RecipeBody>(await call(user, 'GET', `/api/v1/recipes/${id}`), 200);

        return body.ingredients[0]?.sourceLine;
    }

    async function storedFlag(id: string): Promise<boolean[]> {
        const { rows } = await pool.query<{ flag: boolean }>(
            'SELECT source_line_transcribed_by_owner AS flag FROM ingredients WHERE recipe_id = $1 ORDER BY sort_order',
            [id],
        );

        return rows.map((row) => row.flag);
    }

    it('the baseline: the owner is shown the line and another cook is not', async () => {
        const created = await seedPublicTranscribed();

        expect(await storedFlag(created.id)).toEqual([true]);
        expect(await sourceLineSeenBy(OWNER, created.id)).toBe(SOURCE_LINE);
        expect(await sourceLineSeenBy(OTHER, created.id)).toBeUndefined();
    });

    it('⛔ a title-only PATCH that resends the line unchanged keeps it for the owner and hidden from others', async () => {
        const created = await seedPublicTranscribed();
        const version = await ok<RecipeBody>(await call(OWNER, 'GET', `/api/v1/recipes/${created.id}`), 200);

        await ok(
            await call(OWNER, 'PATCH', `/api/v1/recipes/${created.id}`, {
                expectedVersion: version.currentVersion,
                title: 'Renamed, same transcription',
                ingredients: [unchangedLine],
            }),
            200,
        );

        expect(await storedFlag(created.id)).toEqual([true]);
        expect(await sourceLineSeenBy(OWNER, created.id)).toBe(SOURCE_LINE);
        expect(await sourceLineSeenBy(OTHER, created.id)).toBeUndefined();
    });

    it('⛔ restoring an earlier version keeps the owner flag on a line whose identity did not change', async () => {
        const created = await seedPublicTranscribed();
        const first = await ok<RecipeBody>(await call(OWNER, 'GET', `/api/v1/recipes/${created.id}`), 200);
        const renamed = await ok<RecipeBody>(
            await call(OWNER, 'PATCH', `/api/v1/recipes/${created.id}`, {
                expectedVersion: first.currentVersion,
                title: 'Second title',
                ingredients: [unchangedLine],
            }),
            200,
        );

        await ok(
            await call(OWNER, 'POST', `/api/v1/recipes/${created.id}/versions/${String(first.currentVersion)}/restore`),
            200,
        );

        expect(renamed.currentVersion).toBeGreaterThan(first.currentVersion);
        expect(await storedFlag(created.id)).toEqual([true]);
        expect(await sourceLineSeenBy(OWNER, created.id)).toBe(SOURCE_LINE);
        expect(await sourceLineSeenBy(OTHER, created.id)).toBeUndefined();
    });
});
