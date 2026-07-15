/**
 * T129 — pull-from-source integration test (real Nest app + Docker Postgres).
 *
 * Drives `POST /v1/collections/{id}/pull-from-source` end to end over a real clone. Proves the FR-011
 * reconciliation rules against actual rows rather than a mocked DAL:
 *   - a recipe added to the SOURCE after the clone arrives with `added_via = 'pull'`;
 *   - a recipe the cloner added themselves keeps its `manual` provenance (never overwritten);
 *   - a recipe the source owner REMOVED from the source stays in the clone (data-model.md);
 *   - a recipe that has since gone PRIVATE is not pulled, and disappears from the clone's read —
 *     FR-011's "no longer accessible" clause, satisfied by the read-time membership-IDOR guard rather
 *     than by deleting rows;
 *   - a collection with no source is a 400 `COLLECTION_NOT_CLONED`, not a silent no-op.
 *
 * Runs only when the harness DB is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { collections, recipeCollections } from '../../../src/database/schema/collections.js';
import { recipes } from '../../../src/database/schema/recipes.js';

const CLONER = '01JPULL000CLONER000000000A';
const SOURCE_OWNER = '01JPULL000SRCOWNER0000000B';

interface CollectionBody {
    id: string;
    sourceCollectionId?: string;
}

interface PullBody {
    collection: CollectionBody;
    addedRecipeIds: string[];
}

interface CollectionWithRecipesBody {
    recipes: { id: string }[];
}

describe.skipIf(!hasDatabaseUrl)('collection pull-from-source (FR-011 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;
    let sourceId: string;

    async function insertRecipe(ownerId: string, title: string, visibility: 'public' | 'private'): Promise<string> {
        const [row] = await db
            .insert(recipes)
            .values({
                ownerId,
                title,
                visibility,
                ingredientNamesText: title.toLowerCase(),
                servings: 1,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
            })
            .returning({ id: recipes.id });

        return row!.id;
    }

    /** Clone the shared source as the dev-bypass principal and return the new collection's id. */
    async function cloneSource(): Promise<string> {
        const res = await fetch(`${baseUrl}/v1/collections/${sourceId}/clone`, { method: 'POST' });
        expect(res.status).toBe(201);

        return ((await res.json()) as CollectionBody).id;
    }

    async function pull(collectionId: string): Promise<Response> {
        return fetch(`${baseUrl}/v1/collections/${collectionId}/pull-from-source`, { method: 'POST' });
    }

    async function membershipsOf(collectionId: string): Promise<{ recipeId: string; addedVia: string }[]> {
        return db
            .select({ recipeId: recipeCollections.recipeId, addedVia: recipeCollections.addedVia })
            .from(recipeCollections)
            .where(eq(recipeCollections.collectionId, collectionId));
    }

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CLONER });
        baseUrl = booted.baseUrl;
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);

        const [source] = await db
            .insert(collections)
            .values({ ownerId: SOURCE_OWNER, name: 'Evolving Source', visibility: 'public' })
            .returning({ id: collections.id });
        sourceId = source!.id;
    });

    afterAll(async () => {
        await db.delete(collections).where(eq(collections.ownerId, CLONER));
        await db.delete(collections).where(eq(collections.ownerId, SOURCE_OWNER));
        await db.delete(recipes).where(eq(recipes.ownerId, SOURCE_OWNER));
        await db.delete(recipes).where(eq(recipes.ownerId, CLONER));
        await booted.close();
    });

    it("pulls the source's newly-added recipe as added_via='pull', leaving clone_seed rows alone", async () => {
        const seeded = await insertRecipe(SOURCE_OWNER, 'Seeded Stew', 'public');
        await db.insert(recipeCollections).values({ collectionId: sourceId, recipeId: seeded, addedVia: 'manual' });
        const cloneId = await cloneSource();

        // The source gains a recipe AFTER the clone — the snapshot must not have it yet.
        const added = await insertRecipe(SOURCE_OWNER, 'Added Later', 'public');
        await db.insert(recipeCollections).values({ collectionId: sourceId, recipeId: added, addedVia: 'manual' });

        const res = await pull(cloneId);
        expect(res.status).toBe(200);
        const body = (await res.json()) as PullBody;
        expect(body.addedRecipeIds).toEqual([added]);

        const members = await membershipsOf(cloneId);
        expect(members.find((m) => m.recipeId === added)?.addedVia).toBe('pull');
        // The originally-seeded row keeps its clone_seed provenance — a pull must not restamp it.
        expect(members.find((m) => m.recipeId === seeded)?.addedVia).toBe('clone_seed');

        await db.delete(recipeCollections).where(eq(recipeCollections.collectionId, sourceId));
    });

    it('never overwrites a recipe the cloner added manually, and is a no-op when nothing is new', async () => {
        const shared = await insertRecipe(SOURCE_OWNER, 'Shared Soup', 'public');
        // Order matters, and getting it wrong makes this test prove nothing: clone while the source is
        // still EMPTY, so the cloner's own row is the only one for `shared`. Seeding the source first
        // would make it a clone_seed row and the "don't overwrite MY addition" case would go untested.
        const cloneId = await cloneSource();
        await fetch(`${baseUrl}/v1/collections/${cloneId}/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeId: shared }),
        });

        // NOW the source gains the very same recipe — the FR-011 collision.
        await db.insert(recipeCollections).values({ collectionId: sourceId, recipeId: shared, addedVia: 'manual' });

        const body = (await (await pull(cloneId)).json()) as PullBody;

        expect(body.addedRecipeIds).toEqual([]);
        const members = await membershipsOf(cloneId);
        expect(members.find((m) => m.recipeId === shared)?.addedVia).toBe('manual');

        await db.delete(recipeCollections).where(eq(recipeCollections.collectionId, sourceId));
    });

    it('keeps a recipe the SOURCE owner removed from the source (source curation does not reach in)', async () => {
        const doomed = await insertRecipe(SOURCE_OWNER, 'Removed From Source', 'public');
        await db.insert(recipeCollections).values({ collectionId: sourceId, recipeId: doomed, addedVia: 'manual' });
        const cloneId = await cloneSource();

        // The source owner drops it from THEIR collection. The clone is the cloner's property.
        await db.delete(recipeCollections).where(eq(recipeCollections.recipeId, doomed));
        await db.insert(recipeCollections).values({ collectionId: cloneId, recipeId: doomed, addedVia: 'clone_seed' });

        const body = (await (await pull(cloneId)).json()) as PullBody;

        expect(body.addedRecipeIds).toEqual([]);
        expect((await membershipsOf(cloneId)).map((m) => m.recipeId)).toContain(doomed);
    });

    it('does not pull a source recipe that has since gone PRIVATE, and hides it from the read', async () => {
        const wentPrivate = await insertRecipe(SOURCE_OWNER, 'Now Private', 'public');
        await db
            .insert(recipeCollections)
            .values({ collectionId: sourceId, recipeId: wentPrivate, addedVia: 'manual' });
        const cloneId = await cloneSource();
        await db.update(recipes).set({ visibility: 'private' }).where(eq(recipes.id, wentPrivate));

        const body = (await (await pull(cloneId)).json()) as PullBody;
        expect(body.addedRecipeIds).toEqual([]);

        // FR-011's "no longer accessible" clause: the recipe is gone from the clone's READ via the
        // membership-IDOR guard — no row deletion needed, and it would return if it went public again.
        const view = (await (await fetch(`${baseUrl}/v1/collections/${cloneId}`)).json()) as CollectionWithRecipesBody;
        expect(view.recipes.map((r) => r.id)).not.toContain(wentPrivate);

        await db.delete(recipeCollections).where(eq(recipeCollections.collectionId, sourceId));
    });

    it('400s COLLECTION_NOT_CLONED on a collection that was never cloned', async () => {
        const created = await fetch(`${baseUrl}/v1/collections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Authored Directly' }),
        });
        const own = (await created.json()) as CollectionBody;

        const res = await pull(own.id);

        expect(res.status).toBe(400);
        expect(((await res.json()) as { code: string }).code).toBe('COLLECTION_NOT_CLONED');
    });
});
