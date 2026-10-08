/**
 * ADR-0058 — a never-published draft is overwritten in place and records NO version; versions start at the first
 * publish. Through the fully assembled app, a real Postgres and a food-service fake (LOCAL e2e,
 * `docs/CODING_STANDARDS.md` §7.1a).
 *
 * What a mocked tier cannot prove and these cases do:
 *
 * - that migration 0053 applied, and that its trigger, not application code, sets `first_published_at` on the first
 *   publish and refuses to change it after;
 * - that the version history really holds no row for a draft's saves, while `current_version` still moves, so a stale
 *   save of a draft is still refused with a 409;
 * - that the first publish writes exactly one row, numbered at the version the publish produced;
 * - ⛔ that a published recipe set back to draft keeps versioning — the case a rule keyed on `status` gets wrong;
 * - that a rebind, which saves through the same update path (ADR-0045), records no version on a draft and one on a
 *   published recipe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { asPrincipal } from '../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-draft-versions';
const COOK = '01JDRAFTVERSIONSE2E0000COOK';
const BRISKET = `${SCOPE}-brisket`;
const SHOULDER = `${SCOPE}-shoulder`;

interface RecipeBody {
    readonly id: string;
    readonly status: string;
    readonly currentVersion: number;
}

interface VersionRow {
    readonly version_number: number;
    readonly change_summary: string | null;
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let brisketLookup: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(COOK), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
}

async function json<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

/** A draft with one line and one step, so it can be published without resending them. */
async function createDraft(title: string): Promise<RecipeBody> {
    return json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} ${title}`,
        status: 'draft',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [{ ingredientId: brisketLookup, quantity: { kind: 'exact', value: 500 }, unit: 'g' }],
        steps: [{ instruction: 'Cook.' }],
    });
}

async function save(recipe: RecipeBody, patch: Record<string, unknown>): Promise<RecipeBody> {
    return json<RecipeBody>('PATCH', `/api/v1/recipes/${recipe.id}`, 200, {
        expectedVersion: recipe.currentVersion,
        ...patch,
    });
}

async function versionsOf(recipeId: string): Promise<readonly VersionRow[]> {
    const { rows } = await pool.query<VersionRow>(
        'SELECT version_number, change_summary FROM recipe_versions WHERE recipe_id = $1 ORDER BY version_number',
        [recipeId],
    );

    return rows;
}

async function firstPublishedAt(recipeId: string): Promise<Date | null> {
    const { rows } = await pool.query<{ first_published_at: Date | null }>(
        'SELECT first_published_at FROM recipes WHERE id = $1',
        [recipeId],
    );

    return rows[0]?.first_published_at ?? null;
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set(BRISKET, { name: 'Beef brisket', status: 'RESOLVED' });
    food.foods.set(SHOULDER, { name: 'Pork shoulder', status: 'RESOLVED' });
    process.env['FOOD_SERVICE_URL'] = food.origin;

    booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
    pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    brisketLookup = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: BRISKET })).id;
});

afterAll(async () => {
    if (pool !== undefined) {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [COOK]);
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE user_id = $1', [COOK]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
    }

    await booted?.close();
    await food?.close();
});

describe('a never-published draft records no version (ADR-0058, e2e)', () => {
    it('a draft create and its saves write no version row, while the version number moves', async () => {
        const created = await createDraft('saves');
        const once = await save(created, { title: `${SCOPE} saves, once` });
        const twice = await save(once, { title: `${SCOPE} saves, twice` });

        expect([created.currentVersion, once.currentVersion, twice.currentVersion]).toStrictEqual([1, 2, 3]);
        expect(twice.status).toBe('draft');
        expect(await versionsOf(created.id)).toStrictEqual([]);
        expect(await firstPublishedAt(created.id)).toBeNull();
    });

    it('⛔ a stale save of a draft is still refused with a 409, carrying no base it does not have', async () => {
        const created = await createDraft('stale');
        await save(created, { title: `${SCOPE} stale, winner` });

        const stale = await call('PATCH', `/api/v1/recipes/${created.id}`, {
            expectedVersion: created.currentVersion,
            title: `${SCOPE} stale, loser`,
        });
        const body = (await stale.json()) as { code?: string; details?: { currentVersion?: number; base?: unknown } };

        expect(stale.status).toBe(409);
        expect(body.code).toBe('VERSION_CONFLICT');
        expect(body.details?.currentVersion).toBe(2);
        expect(body.details?.base).toBeUndefined();
    });

    it('⛔ the first publish writes exactly one row, numbered at the version it produced, and later saves version', async () => {
        const created = await createDraft('publish');
        const edited = await save(created, { title: `${SCOPE} publish, edited` });
        const published = await save(edited, { status: 'published' });

        expect(published.currentVersion).toBe(3);
        expect((await versionsOf(created.id)).map((row) => row.version_number)).toStrictEqual([3]);
        expect(await firstPublishedAt(created.id)).not.toBeNull();

        const later = await save(published, { title: `${SCOPE} publish, after` });

        expect((await versionsOf(created.id)).map((row) => row.version_number)).toStrictEqual([3, 4]);
        expect(later.currentVersion).toBe(4);
    });

    it('⛔ a published recipe set back to draft keeps versioning, and keeps its first-publish instant', async () => {
        const published = await save(await createDraft('redraft'), { status: 'published' });
        const publishedAt = await firstPublishedAt(published.id);
        const redrafted = await save(published, { status: 'draft' });
        const savedAsDraft = await save(redrafted, { title: `${SCOPE} redraft, edited` });

        expect(savedAsDraft.status).toBe('draft');
        expect((await versionsOf(published.id)).map((row) => row.version_number)).toStrictEqual([2, 3, 4]);
        expect(await firstPublishedAt(published.id)).toStrictEqual(publishedAt);
    });

    it('a published create records its first version, as before', async () => {
        const created = await json<RecipeBody>('POST', '/api/v1/recipes', 201, {
            title: `${SCOPE} published create`,
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
            ingredients: [{ ingredientId: brisketLookup, quantity: { kind: 'exact', value: 1 }, unit: 'g' }],
            steps: [{ instruction: 'Cook.' }],
        });

        expect(await versionsOf(created.id)).toStrictEqual([{ version_number: 1, change_summary: 'Created' }]);
    });

    it('a rebind records no version on a draft, and one on a published recipe (ADR-0045)', async () => {
        const draft = await createDraft('rebind');
        const reboundDraft = await json<RecipeBody>('POST', `/api/v1/recipes/${draft.id}/ingredients/0/rebind`, 200, {
            expectedVersion: draft.currentVersion,
            target: { kind: 'catalogFood', foodId: SHOULDER },
        });

        expect(reboundDraft.currentVersion).toBe(draft.currentVersion + 1);
        expect(await versionsOf(draft.id)).toStrictEqual([]);

        const published = await save(reboundDraft, { status: 'published' });
        const reboundPublished = await json<RecipeBody>(
            'POST',
            `/api/v1/recipes/${published.id}/ingredients/0/rebind`,
            200,
            { expectedVersion: published.currentVersion, target: { kind: 'catalogFood', foodId: BRISKET } },
        );

        expect((await versionsOf(draft.id)).map((row) => row.change_summary)).toStrictEqual([
            'Updated',
            'Changed ingredient',
        ]);
        expect(reboundPublished.currentVersion).toBe(published.currentVersion + 1);
    });
});

describe('recipes.first_published_at is owned by the database (migration 0053, e2e)', () => {
    const RAW_ID = '77777777-7777-4777-8777-000000000058';

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE id = $1', [RAW_ID]);
    });

    async function insertRaw(status: string): Promise<void> {
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes, servings,
                                  status)
             VALUES ($1, $2, 'raw', 0, 0, 0, 1, $3)`,
            [RAW_ID, COOK, status],
        );
    }

    it('sets it for a writer that never names it, on insert and on the publishing update', async () => {
        await insertRaw('draft');
        expect(await firstPublishedAt(RAW_ID)).toBeNull();

        await pool.query(`UPDATE recipes SET status = 'published' WHERE id = $1`, [RAW_ID]);
        expect(await firstPublishedAt(RAW_ID)).not.toBeNull();

        await pool.query('DELETE FROM recipes WHERE id = $1', [RAW_ID]);
        await insertRaw('published');
        expect(await firstPublishedAt(RAW_ID)).not.toBeNull();
    });

    it('⛔ refuses to clear or move it once set', async () => {
        await pool.query('DELETE FROM recipes WHERE id = $1', [RAW_ID]);
        await insertRaw('published');
        await pool.query(`UPDATE recipes SET status = 'draft' WHERE id = $1`, [RAW_ID]);

        await expect(
            pool.query('UPDATE recipes SET first_published_at = NULL WHERE id = $1', [RAW_ID]),
        ).rejects.toThrow(/first_published_at/);
        await expect(
            pool.query(`UPDATE recipes SET first_published_at = now() + interval '1 day' WHERE id = $1`, [RAW_ID]),
        ).rejects.toThrow(/first_published_at/);
        expect(await firstPublishedAt(RAW_ID)).not.toBeNull();
    });
});
