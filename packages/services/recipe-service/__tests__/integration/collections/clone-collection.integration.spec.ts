/**
 * T103 + T129 — collection-clone integration test (real Nest app + Docker Postgres).
 *
 * Drives `POST /v1/collections/{id}/clone` end to end and proves the two things a mocked DAL cannot:
 *   1. **The access boundary is real SQL** (T103) — a public collection holding one public and one
 *      PRIVATE recipe (owned by the source owner, not the cloner) clones with the public recipe only.
 *      The unit spec pins that the cloner is passed as the viewer; this pins that the viewer-scoped
 *      predicate actually excludes the row in Postgres.
 *   2. **Provenance is persisted** (T129) — the clone row carries `source_collection_id` and every
 *      seeded membership lands with `added_via = 'clone_seed'`, read back from the DB rather than
 *      inferred from a mock call.
 *
 * Two identities are needed (cloner ≠ source owner), but the dev-auth bypass fixes ONE principal per
 * booted app, so the source's rows are seeded directly via the app's Drizzle client and the HTTP calls
 * run as the cloner. Runs only when the harness DB is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { collections, recipeCollections } from '../../../src/database/schema/collections.js';
import { recipes } from '../../../src/database/schema/recipes.js';

/** The dev-bypass principal every HTTP call below authenticates as. */
const CLONER = '01JCLONE00CLONER000000000A';
/** The source collection's owner — a different user, whose private recipe must NOT be cloned. */
const SOURCE_OWNER = '01JCLONE00SRCOWNER0000000B';

interface CollectionBody {
    id: string;
    ownerId: string;
    name: string;
    sourceCollectionId?: string;
    recipeCount?: number;
}

describe.skipIf(!hasDatabaseUrl)('collection clone (FR-011 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;
    let sourceId: string;
    let publicRecipeId: string;
    let privateRecipeId: string;

    /** Insert a recipe owned by `ownerId` at the given visibility; returns its id. */
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

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CLONER });
        baseUrl = booted.baseUrl;
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);

        // A PUBLIC collection owned by someone else, holding one public + one private recipe.
        const [source] = await db
            .insert(collections)
            .values({ ownerId: SOURCE_OWNER, name: 'Shared Favourites', visibility: 'public' })
            .returning({ id: collections.id });
        sourceId = source!.id;

        publicRecipeId = await insertRecipe(SOURCE_OWNER, 'Public Paella', 'public');
        privateRecipeId = await insertRecipe(SOURCE_OWNER, 'Secret Sauce', 'private');

        await db.insert(recipeCollections).values([
            { collectionId: sourceId, recipeId: publicRecipeId, addedVia: 'manual' },
            { collectionId: sourceId, recipeId: privateRecipeId, addedVia: 'manual' },
        ]);
    });

    afterAll(async () => {
        await db.delete(collections).where(eq(collections.ownerId, CLONER));
        await db.delete(collections).where(eq(collections.ownerId, SOURCE_OWNER));
        await db.delete(recipes).where(eq(recipes.ownerId, SOURCE_OWNER));
        await booted.close();
    });

    it("clones a public collection with the source's PUBLIC recipe only, never its private one", async () => {
        const res = await fetch(`${baseUrl}/v1/collections/${sourceId}/clone`, { method: 'POST' });
        expect(res.status).toBe(201);
        const clone = (await res.json()) as CollectionBody;

        // Provenance + ownership (T129), read back from the row the API returned.
        expect(clone.ownerId).toBe(CLONER);
        expect(clone.sourceCollectionId).toBe(sourceId);

        const members = await db
            .select({ recipeId: recipeCollections.recipeId, addedVia: recipeCollections.addedVia })
            .from(recipeCollections)
            .where(eq(recipeCollections.collectionId, clone.id));

        // THE access assertion (T103): the source owner's private recipe never crosses into a
        // stranger's clone. Asserting the private id is absent (not just the count) means a mutation
        // that clones everything fails here rather than passing on a coincidental length.
        expect(members.map((m) => m.recipeId)).toEqual([publicRecipeId]);
        expect(members.map((m) => m.recipeId)).not.toContain(privateRecipeId);

        // Every seeded membership is marked clone_seed (T129) — never the 'manual' default, which is
        // what a later pull relies on to tell seeded rows from the cloner's own additions.
        expect(members.every((m) => m.addedVia === 'clone_seed')).toBe(true);
    });

    it('applies the optional name override from CloneCollectionRequest', async () => {
        const res = await fetch(`${baseUrl}/v1/collections/${sourceId}/clone`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'My Own Name' }),
        });

        expect(res.status).toBe(201);
        expect(((await res.json()) as CollectionBody).name).toBe('My Own Name');
    });

    it('404s cloning a PRIVATE collection owned by someone else (existence is not revealed)', async () => {
        const [priv] = await db
            .insert(collections)
            .values({ ownerId: SOURCE_OWNER, name: 'Not Yours', visibility: 'private' })
            .returning({ id: collections.id });

        const res = await fetch(`${baseUrl}/v1/collections/${priv!.id}/clone`, { method: 'POST' });

        expect(res.status).toBe(404);
        // And nothing was created for the caller off the back of it.
        const created = await db
            .select({ id: collections.id })
            .from(collections)
            .where(and(eq(collections.ownerId, CLONER), eq(collections.sourceCollectionId, priv!.id)));
        expect(created).toEqual([]);
    });
});
