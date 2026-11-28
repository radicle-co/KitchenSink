/**
 * ADR-0105, LOCAL e2e (real Postgres, real app): a recipe HELD FROM READERS (here: cook-captured book evidence on a public,
 * published recipe) is read only by its owner on EVERY non-owner read path, and answers exactly as a private or a missing
 * recipe answers. Every assertion carries both controls: a clean public recipe IS readable by the same cook on the same path,
 * and the owner still reads the held one.
 *
 * Also runs the shared literal readability table through the real `readableBy` and `communityOf` (search scopes).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { READABILITY_TABLE } from '../../support/readabilityTable.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JHELDREADERSOWNER00000001';
const READER = '01JHELDREADERSREADER0000001';
const PREFIX = '99999999-9999-4999-8999-0000003';
const rid = (n: number): string => `${PREFIX}${String(n).padStart(5, '0')}`;
const HELD = rid(1);
const CLEAN = rid(2);
const PRIVATE = rid(3);
const MISSING = rid(99);
const CURATOR = rid(4);
const TOKEN = 'zzheldfromreaders';

describe('held from readers: every non-owner read path (ADR-0105)', () => {
    let booted: BootedRecipeApp;
    let food: FoodFake;
    let pool: pg.Pool;

    async function seed(
        id: string,
        row: {
            visibility: string;
            status: string;
            held: boolean;
            /** Held by the correction-hold column alone (migration 0099 lets it be public). */
            correctionHold?: boolean;
            deleted?: boolean;
            sourceType?: string;
            title: string;
        },
    ): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                      total_time_minutes, servings, visibility, status, source_type, deleted_at,
                                      source_correction_hold)
                 VALUES ($1, $2, $3, '', 1, 1, 2, 4, $4, $5, $6, $7, $8)`,
                [
                    id,
                    OWNER,
                    row.title,
                    row.visibility,
                    row.status,
                    row.sourceType ?? 'user_created',
                    row.deleted === true ? new Date() : null,
                    row.correctionHold === true,
                ],
            );

            if (row.held) {
                await client.query(
                    `INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
                     VALUES ($1, 'editorCitation', 'book', 'A Cookbook, p. 3')`,
                    [id],
                );
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /** The default headers, overridden by the caller's own (a `Headers` merge, never a spread of a `HeadersInit`). */
    function headersOf(as: string, init: RequestInit): Headers {
        const headers = new Headers({ 'content-type': 'application/json', authorization: bearerFor(as) });

        new Headers(init.headers).forEach((value, name) => {
            headers.set(name, value);
        });

        return headers;
    }

    function api(path: string, as: string, init: RequestInit = {}): Promise<Response> {
        return asPrincipal(as, () => fetch(`${booted.baseUrl}${path}`, { ...init, headers: headersOf(as, init) }));
    }

    beforeAll(async () => {
        food = await startFoodFake();
        process.env['FOOD_SERVICE_URL'] = food.origin;
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: READER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM collections WHERE owner_id = $1`, [READER]);
        // One statement: a clone made by the reader points at a seeded recipe, and the foreign key is checked at its end.
        await pool.query(`DELETE FROM recipes WHERE owner_id = ANY($1)`, [[OWNER, READER]]);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
        await food.close();
    });

    async function seedTrio(): Promise<void> {
        await seed(HELD, { visibility: 'public', status: 'published', held: true, title: `${TOKEN} held` });
        await seed(CLEAN, { visibility: 'public', status: 'published', held: false, title: `${TOKEN} clean` });
        await seed(PRIVATE, { visibility: 'private', status: 'published', held: false, title: `${TOKEN} private` });
    }

    /** The response of a path, replaced so only differences the reader can see remain. */
    async function shape(response: Response, id: string): Promise<string> {
        return `${String(response.status)} ${(await response.text()).replaceAll(id, 'ID')}`;
    }

    it.each([
        ['detail', (id: string) => `/api/v1/recipes/${id}`, 'GET'],
        ['versions list', (id: string) => `/api/v1/recipes/${id}/versions`, 'GET'],
        ['photos list', (id: string) => `/api/v1/recipes/${id}/photos`, 'GET'],
    ] as const)('%s: a held recipe answers cook B as a private and a missing id do', async (_name, path, method) => {
        await seedTrio();

        const held = await shape(await api(path(HELD), READER, { method }), HELD);
        const priv = await shape(await api(path(PRIVATE), READER, { method }), PRIVATE);
        const missing = await shape(await api(path(MISSING), READER, { method }), MISSING);

        expect(held.startsWith('404 ')).toBe(true);
        expect(held).toBe(priv);
        expect(held).toBe(missing);
        // Controls: a clean public recipe is readable by B on this path, and the owner reads the held one.
        expect((await api(path(CLEAN), READER, { method })).status).toBe(200);
        expect((await api(path(HELD), OWNER, { method })).status).toBe(200);
    });

    it('one version: a held recipe answers cook B as a private and a missing id do; a readable one is read', async () => {
        await seedTrio();

        for (const id of [HELD, CLEAN, PRIVATE]) {
            await pool.query(
                `INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
                 VALUES ($1, 1, '{"title":"v1"}'::jsonb, $2)`,
                [id, OWNER],
            );
        }

        const path = (id: string): string => `/api/v1/recipes/${id}/versions/1`;
        const held = await shape(await api(path(HELD), READER), HELD);

        expect(held.startsWith('404 ')).toBe(true);
        expect(held).toBe(await shape(await api(path(PRIVATE), READER), PRIVATE));
        expect(held).toBe(await shape(await api(path(MISSING), READER), MISSING));
        // Controls: every one has a version row, so the 404 above is the hold; a clean public recipe's version is read, and
        // the owner reads the held recipe's version.
        expect((await api(path(CLEAN), READER)).status).toBe(200);
        expect((await api(path(HELD), OWNER)).status).toBe(200);
    });

    it('photo upload: cook B gets the held recipe as a private and a missing id (404), and a readable one as not-owner (403)', async () => {
        await seedTrio();
        const upload = (id: string, as: string): Promise<Response> =>
            api(`/api/v1/recipes/${id}/photos/upload-url`, as, {
                method: 'POST',
                body: JSON.stringify({ fileName: 'dish.png', contentType: 'image/png', fileSize: 1024 }),
            });
        const held = await shape(await upload(HELD, READER), HELD);

        expect(held.startsWith('404 ')).toBe(true);
        expect(held).toBe(await shape(await upload(PRIVATE, READER), PRIVATE));
        expect(held).toBe(await shape(await upload(MISSING, READER), MISSING));
        // Controls: a readable recipe of another cook is a 403 (visible, not owned); the owner may upload to the held one.
        expect((await upload(CLEAN, READER)).status).toBe(403);
        expect((await upload(HELD, OWNER)).status).toBe(200);
    });

    it('a PUBLIC recipe held by the correction hold alone answers cook B as a private and a missing id do, on every path', async () => {
        const HOLD = rid(5);

        await seedTrio();
        await seed(HOLD, {
            visibility: 'public',
            status: 'published',
            held: false,
            correctionHold: true,
            title: `${TOKEN} hold`,
        });

        const paths = [`/api/v1/recipes/${HOLD}`, `/api/v1/recipes/${HOLD}/versions`, `/api/v1/recipes/${HOLD}/photos`];

        for (const path of paths) {
            const held = await shape(await api(path, READER), HOLD);

            expect(held.startsWith('404 ')).toBe(true);
            expect(held).toBe(await shape(await api(path.replace(HOLD, PRIVATE), READER), PRIVATE));
            expect(held).toBe(await shape(await api(path.replace(HOLD, MISSING), READER), MISSING));
            // Controls: the owner reads it, and a clean public recipe is read on the same path.
            expect((await api(path, OWNER)).status).toBe(200);
            expect((await api(path.replace(HOLD, CLEAN), READER)).status).toBe(200);
        }

        expect((await api(`/api/v1/recipes/${HOLD}/clone`, READER, { method: 'POST', body: '{}' })).status).toBe(404);

        const params = new URLSearchParams({ query: TOKEN, scope: 'community' });
        const body = (await (await api(`/api/v1/search/recipes?${params.toString()}`, READER)).json()) as {
            results: { recipe: { id: string } }[];
        };

        expect(body.results.map((hit) => hit.recipe.id)).toEqual([CLEAN]);
    });

    it('AE3b: a curator public-domain recipe (imported_public, no kind) is readable by B on detail and search', async () => {
        await seed(CURATOR, {
            visibility: 'public',
            status: 'published',
            held: false,
            sourceType: 'imported_public',
            title: `${TOKEN} curator`,
        });

        expect((await api(`/api/v1/recipes/${CURATOR}`, READER)).status).toBe(200);

        const params = new URLSearchParams({ query: TOKEN, scope: 'community' });
        const body = (await (await api(`/api/v1/search/recipes?${params.toString()}`, READER)).json()) as {
            results: { recipe: { id: string } }[];
        };

        expect(body.results.map((hit) => hit.recipe.id)).toEqual([CURATOR]);
    });

    it('rating: B cannot rate a held recipe (404), can rate a clean one', async () => {
        await seedTrio();
        const put = (id: string): Promise<Response> =>
            api(`/api/v1/recipes/${id}/rating`, READER, { method: 'PUT', body: JSON.stringify({ stars: 4 }) });

        expect((await put(HELD)).status).toBe(404);
        expect((await put(CLEAN)).status).toBe(200);
    });

    it('clone: B cannot clone a held recipe (404), can clone a clean one', async () => {
        await seedTrio();
        const post = (id: string): Promise<Response> =>
            api(`/api/v1/recipes/${id}/clone`, READER, { method: 'POST', body: JSON.stringify({}) });

        expect((await post(HELD)).status).toBe(404);
        expect((await post(CLEAN)).status).toBe(201);
        expect((await api(`/api/v1/recipes/${HELD}/clone`, OWNER, { method: 'POST', body: '{}' })).status).toBe(201);
    });

    it('nutrition batch: a held id is absent for B, present for the clean id and for the owner', async () => {
        await seedTrio();

        const batch = async (as: string): Promise<string[]> => {
            const res = await api('/api/v1/recipes/nutrition-batch', as, {
                method: 'POST',
                body: JSON.stringify({ recipeIds: [HELD, CLEAN] }),
            });
            const body = (await res.json()) as { nutrition: Record<string, unknown> };

            return Object.keys(body.nutrition).sort((a, b) => a.localeCompare(b));
        };

        expect(await batch(READER)).toEqual([CLEAN]);
        expect(await batch(OWNER)).toEqual([CLEAN, HELD].sort((a, b) => a.localeCompare(b)));
    });

    it('collections: B cannot add a held recipe, and a held member is absent from the list', async () => {
        await seedTrio();
        const created = await api('/api/v1/collections', READER, {
            method: 'POST',
            body: JSON.stringify({ name: 'Mine' }),
        });
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as { id: string };
        const add = (recipeId: string): Promise<Response> =>
            api(`/api/v1/collections/${id}/recipes`, READER, { method: 'POST', body: JSON.stringify({ recipeId }) });

        expect((await add(HELD)).status).toBe(404);
        expect((await add(CLEAN)).status).toBeLessThan(300);

        const members = async (): Promise<string[]> => {
            const response = await api(`/api/v1/collections/${id}`, READER);

            expect(response.status).toBe(200);

            const body = (await response.json()) as { recipes: { id: string }[] };

            return body.recipes.map((member) => member.id);
        };

        // Control: while it is readable the member is listed, so the absence below is the hold and nothing else.
        expect(await members()).toContain(CLEAN);

        // A member that BECOMES held after it was added is hidden from the list (readableBy on the join).
        await pool.query(
            `INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
             VALUES ($1, 'editorCitation', 'book', 'A Cookbook, p. 9')`,
            [CLEAN],
        );

        expect(await members()).not.toContain(CLEAN);
    });

    it('the shared literal readability table, through the real readableBy and communityOf (search)', async () => {
        for (const [index, row] of READABILITY_TABLE.entries()) {
            await seed(rid(10 + index), { ...row, title: `${TOKEN} ${row.label}` });
        }

        const titles = async (as: string, scope?: string): Promise<string[]> => {
            const params = new URLSearchParams({ query: TOKEN, ...(scope === undefined ? {} : { scope }) });
            const res = await api(`/api/v1/search/recipes?${params.toString()}`, as);
            const body = (await res.json()) as { results: { recipe: { title: string } }[] };

            return body.results
                .map((hit) => hit.recipe.title.replace(`${TOKEN} `, ''))
                .sort((a, b) => a.localeCompare(b));
        };

        const expectedFor = (pick: 'ownerReads' | 'otherReads'): string[] =>
            READABILITY_TABLE.filter((row) => row[pick])
                .map((row) => row.label)
                .sort((a, b) => a.localeCompare(b));

        expect(await titles(OWNER)).toEqual(expectedFor('ownerReads'));
        expect(await titles(READER)).toEqual(expectedFor('otherReads'));
        expect(await titles(READER, 'community')).toEqual(expectedFor('otherReads'));
        // Discover is what readers see: a held recipe is absent from it for its own owner too (it is the owner's, so none).
        expect(await titles(OWNER, 'community')).toEqual([]);
    });
});
