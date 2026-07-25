/**
 * W8-b Task 7 — e2e proof of the Collections CRUD surface (`/v1/collections`) through the fully
 * ASSEMBLED recipe app against the real Postgres harness. The unit/integration tiers already exhaust
 * `CollectionsService`'s branches; this pins the client-visible HTTP contract: status codes, response
 * shapes, real pagination over the actual DAL `ORDER BY created_at DESC` + `LIMIT`/`OFFSET`, and the
 * ownership boundary a caller actually receives.
 *
 * **Ownership boundary (verified against `CollectionsService.requireOwned` / `collectionNotOwnedError`,
 * `src/collections/collections.service.ts` + `collections.errors.ts`):** unlike the recipe/rating IDOR
 * rule (private + not-owned → 404, existence never revealed), a collection owned by someone else is
 * `403 NOT_OWNER` for GET/PATCH/DELETE by id — REGARDLESS of its visibility. This is deliberate and
 * documented ("existence is only revealed to the owner ... per the OpenAPI contract's 403/404 split");
 * there is no `COLLECTION_NOT_FOUND` code precisely so a missing id and a private-not-yours id both stay
 * indistinguishable from each other, while an id that DOES belong to someone else is confirmed via 403.
 * This suite asserts the REAL 403 behaviour, not a 404 IDOR pattern that does not apply to this endpoint.
 *
 * The booted app authenticates as OWNER (dev bypass). OTHER's collection is seeded directly via a raw
 * pg pool (mirroring `ratings.e2e.spec.ts` / `pull-from-source.e2e.spec.ts`) — OTHER never needs their
 * own authenticated session, since the ownership check is symmetric: OWNER's authenticated attempt to
 * touch OTHER's row is a full proof of the boundary. Skips cleanly without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JCOLE2E00000OWNER000000A';
const OTHER = '01JCOLE2E00000OTHER000000B';

interface CollectionBody {
    id: string;
    ownerId: string;
    name: string;
    description?: string;
    visibility: string;
    recipeCount?: number;
    createdAt: string;
    updatedAt: string;
}

interface CollectionPageBody {
    data: CollectionBody[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

interface ApiErrorBody {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

describe.skipIf(!hasDatabaseUrl)('collections CRUD (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM collections WHERE owner_id = ANY($1)', [[OWNER, OTHER]]);
        await pool.end();
        await booted?.close();
    });

    async function createCollection(name: string, description?: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/v1/collections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, ...(description !== undefined ? { description } : {}) }),
        });
    }

    async function seedOtherCollection(name: string): Promise<string> {
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO collections (owner_id, name, visibility) VALUES ($1, $2, 'private') RETURNING id`,
            [OTHER, name],
        );

        return rows[0]!.id;
    }

    it('full CRUD lifecycle over real HTTP: create (201) -> get (200) -> rename (200) -> delete (204) -> get (404)', async () => {
        const created = await createCollection('CRUD E2E collection', 'a description');
        expect(created.status).toBe(201);
        const createdBody = (await created.json()) as CollectionBody;
        expect(createdBody.id).toBeTruthy();
        expect(createdBody.ownerId).toBe(OWNER);
        expect(createdBody.name).toBe('CRUD E2E collection');
        expect(createdBody.description).toBe('a description');
        // Visibility defaults to private (FR-010) when not requested.
        expect(createdBody.visibility).toBe('private');
        const id = createdBody.id;

        const got = await fetch(`${booted.baseUrl}/v1/collections/${id}`);
        expect(got.status).toBe(200);
        const gotBody = (await got.json()) as CollectionBody & { recipes: unknown[] };
        expect(gotBody.id).toBe(id);
        expect(gotBody.recipeCount).toBe(0);
        expect(gotBody.recipes).toEqual([]);

        const renamed = await fetch(`${booted.baseUrl}/v1/collections/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed E2E collection' }),
        });
        expect(renamed.status).toBe(200);
        const renamedBody = (await renamed.json()) as CollectionBody;
        expect(renamedBody.name).toBe('Renamed E2E collection');
        // The description survives a name-only PATCH (partial update, not a full replace).
        expect(renamedBody.description).toBe('a description');

        const deleted = await fetch(`${booted.baseUrl}/v1/collections/${id}`, { method: 'DELETE' });
        expect(deleted.status).toBe(204);

        // Delete actually removes the row — a subsequent GET is 404, not a stale 200.
        const afterDelete = await fetch(`${booted.baseUrl}/v1/collections/${id}`);
        expect(afterDelete.status).toBe(404);
    });

    it('pagination: page 1 and page 2 are disjoint, together cover every created collection, newest first', async () => {
        // Force a known zero baseline for OWNER regardless of sibling-test/file ordering, so `total` and
        // the page math below are exact rather than assumed.
        await pool.query('DELETE FROM collections WHERE owner_id = $1', [OWNER]);

        const names = ['Page E2E 1', 'Page E2E 2', 'Page E2E 3', 'Page E2E 4', 'Page E2E 5'];
        const ids: string[] = [];

        for (const name of names) {
            // Sequential (not Promise.all): each create must commit before the next, so `created_at DESC`
            // ordering (the DAL's real ORDER BY) is deterministic — the last name created is page 1's first row.
            const res = await createCollection(name);
            expect(res.status).toBe(201);
            ids.push(((await res.json()) as CollectionBody).id);
        }
        // ids[4] ("Page E2E 5") is newest; ids[0] ("Page E2E 1") is oldest.

        const page1Res = await fetch(`${booted.baseUrl}/v1/collections?page=1&pageSize=3`);
        expect(page1Res.status).toBe(200);
        const page1 = (await page1Res.json()) as CollectionPageBody;
        expect(page1.total).toBe(5);
        expect(page1.page).toBe(1);
        expect(page1.pageSize).toBe(3);
        expect(page1.hasMore).toBe(true);
        expect(page1.data).toHaveLength(3);

        const page2Res = await fetch(`${booted.baseUrl}/v1/collections?page=2&pageSize=3`);
        expect(page2Res.status).toBe(200);
        const page2 = (await page2Res.json()) as CollectionPageBody;
        expect(page2.total).toBe(5);
        expect(page2.hasMore).toBe(false);
        expect(page2.data).toHaveLength(2);

        const page1Ids = page1.data.map((c) => c.id);
        const page2Ids = page2.data.map((c) => c.id);

        // Adversarial: pages are DISJOINT (a broken offset that repeats or skips rows would fail this),
        // and their UNION is exactly the 5 rows created above (no row lost, none duplicated).
        expect(page1Ids.filter((id) => page2Ids.includes(id))).toEqual([]);
        expect(new Set([...page1Ids, ...page2Ids])).toEqual(new Set(ids));

        // Newest-first: the most recently created row leads page 1; the oldest trails page 2.
        expect(page1Ids[0]).toBe(ids[4]);
        expect(page2Ids[page2Ids.length - 1]).toBe(ids[0]);
    });

    it("ownership boundary: another user's collection is 403 NOT_OWNER for get/rename/delete (not 404, not leaked-through), and is left untouched", async () => {
        const otherId = await seedOtherCollection('Not yours');

        const got = await fetch(`${booted.baseUrl}/v1/collections/${otherId}`);
        expect(got.status).toBe(403);
        const gotBody = (await got.json()) as ApiErrorBody;
        expect(gotBody.code).toBe('NOT_OWNER');

        const renamed = await fetch(`${booted.baseUrl}/v1/collections/${otherId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'hacked' }),
        });
        expect(renamed.status).toBe(403);
        expect(((await renamed.json()) as ApiErrorBody).code).toBe('NOT_OWNER');

        const deleted = await fetch(`${booted.baseUrl}/v1/collections/${otherId}`, { method: 'DELETE' });
        expect(deleted.status).toBe(403);
        expect(((await deleted.json()) as ApiErrorBody).code).toBe('NOT_OWNER');

        // The mutations were REJECTED, not silently no-op'd: the row survives, unrenamed.
        const row = await pool.query<{ name: string }>('SELECT name FROM collections WHERE id = $1', [otherId]);
        expect(row.rows).toHaveLength(1);
        expect(row.rows[0]!.name).toBe('Not yours');
    });
});
