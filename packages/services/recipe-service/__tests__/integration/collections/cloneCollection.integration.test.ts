/**
 * T103 + T129 + W5 Task 2 — collection-clone integration test (real Nest app + Docker Postgres).
 *
 * Drives `POST /api/v1/collections/{id}/clone` end to end and proves what a mocked DAL cannot:
 *   1. **The access boundary is real SQL** (T103) — a public collection holding one public and one
 *      PRIVATE recipe (owned by the source owner, not the cloner) clones with the public recipe only.
 *      The unit spec pins that the cloner is passed as the viewer; this pins that the viewer-scoped
 *      predicate actually excludes the row in Postgres.
 *   2. **Provenance is persisted** (T129) — the clone row carries `source_collection_id` and every
 *      seeded membership lands with `added_via = 'clone_seed'`, read back from the DB rather than
 *      inferred from a mock call.
 *   3. **Source attribution is frozen at clone time, for real** (W5 Task 2 / CR-003) — the clone's
 *      `sourceOwnerHandle`/`sourceCollectionName` are resolved from the live `author_handles` table at
 *      clone time; a SUBSEQUENT rename of the source owner's handle in that table must NOT change what
 *      a re-read of the clone reports — the frozen columns, not a live join, are the source of truth.
 *
 * Two identities are needed (cloner ≠ source owner), but the dev-auth bypass fixes ONE principal per
 * booted app, so the source's rows are seeded directly via the app's Drizzle client and the HTTP calls
 * run as the cloner. Runs only when the harness DB is configured.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { collections, recipeCollections } from '../../../src/database/schema/collections.js';
import { recipes } from '../../../src/database/schema/recipes.js';
import { authorHandles } from '../../../src/database/schema/authorHandles.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { CollectionsService } from '../../../src/collections/collections.service.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The dev-bypass principal every HTTP call below authenticates as. */
const CLONER = '01JCLONE00CLONER000000000A';
/** The source collection's owner — a different user, whose private recipe must NOT be cloned. */
const SOURCE_OWNER = '01JCLONE00SRCOWNER0000000B';
/** The source owner's display handle, seeded BEFORE any clone — what attribution should freeze onto. */
const SOURCE_OWNER_HANDLE = 'clara';

interface CollectionBody {
    id: string;
    ownerId: string;
    name: string;
    sourceCollectionId?: string;
    sourceOwnerHandle?: string;
    sourceCollectionName?: string;
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

        // The source owner's CURRENT handle, resolvable at clone time (W5 Task 2).
        await db
            .insert(authorHandles)
            .values({ userId: SOURCE_OWNER, displayName: SOURCE_OWNER_HANDLE, sourceTimestamp: new Date() });
    });

    afterAll(async () => {
        await db.delete(collections).where(eq(collections.ownerId, CLONER));
        await db.delete(collections).where(eq(collections.ownerId, SOURCE_OWNER));
        await db.delete(recipes).where(eq(recipes.ownerId, SOURCE_OWNER));
        await db.delete(authorHandles).where(eq(authorHandles.userId, SOURCE_OWNER));
        await booted.close();
    });

    it("clones a public collection with the source's PUBLIC recipe only, never its private one", async () => {
        const res = await fetch(`${baseUrl}/api/v1/collections/${sourceId}/clone`, { method: 'POST' });
        expect(res.status).toBe(201);
        const clone = (await res.json()) as CollectionBody;

        // Provenance + ownership (T129), read back from the row the API returned.
        expect(clone.ownerId).toBe(CLONER);
        expect(clone.sourceCollectionId).toBe(sourceId);
        // Frozen attribution (W5 Task 2): the source's name + its owner's handle, resolved via the real
        // `author_handles` table (not mocked).
        expect(clone.sourceCollectionName).toBe('Shared Favourites');
        expect(clone.sourceOwnerHandle).toBe(SOURCE_OWNER_HANDLE);

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
        const res = await fetch(`${baseUrl}/api/v1/collections/${sourceId}/clone`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'My Own Name' }),
        });

        expect(res.status).toBe(201);
        expect(((await res.json()) as CollectionBody).name).toBe('My Own Name');
    });

    it(
        "freezes source attribution at clone time — a LATER rename of the source owner's handle does " +
            'not change what a re-read of the clone reports (CR-003: deliberately not synced)',
        async () => {
            const cloneRes = await fetch(`${baseUrl}/api/v1/collections/${sourceId}/clone`, { method: 'POST' });
            expect(cloneRes.status).toBe(201);
            const clone = (await cloneRes.json()) as CollectionBody;
            expect(clone.sourceOwnerHandle).toBe(SOURCE_OWNER_HANDLE);
            expect(clone.sourceCollectionName).toBe('Shared Favourites');

            // Rename the source owner's handle AFTER the clone exists.
            await db
                .update(authorHandles)
                .set({ displayName: 'clara-renamed', sourceTimestamp: new Date() })
                .where(eq(authorHandles.userId, SOURCE_OWNER));

            const getRes = await fetch(`${baseUrl}/api/v1/collections/${clone.id}`);
            expect(getRes.status).toBe(200);
            const reread = (await getRes.json()) as CollectionBody;

            // Still the FROZEN handle from clone time — never the live/renamed value.
            expect(reread.sourceOwnerHandle).toBe(SOURCE_OWNER_HANDLE);
            expect(reread.sourceOwnerHandle).not.toBe('clara-renamed');
            expect(reread.sourceCollectionName).toBe('Shared Favourites');
            expect(reread.sourceCollectionId).toBe(sourceId);

            // Restore the seeded handle so this test's ordering doesn't leak into later assertions in
            // this file that read `SOURCE_OWNER_HANDLE` off a fresh clone.
            await db
                .update(authorHandles)
                .set({ displayName: SOURCE_OWNER_HANDLE, sourceTimestamp: new Date() })
                .where(eq(authorHandles.userId, SOURCE_OWNER));
        },
    );

    it('404s cloning a PRIVATE collection owned by someone else (existence is not revealed)', async () => {
        const [priv] = await db
            .insert(collections)
            .values({ ownerId: SOURCE_OWNER, name: 'Not Yours', visibility: 'private' })
            .returning({ id: collections.id });

        const res = await fetch(`${baseUrl}/api/v1/collections/${priv!.id}/clone`, { method: 'POST' });

        expect(res.status).toBe(404);
        // And nothing was created for the caller off the back of it.
        const created = await db
            .select({ id: collections.id })
            .from(collections)
            .where(and(eq(collections.ownerId, CLONER), eq(collections.sourceCollectionId, priv!.id)));
        expect(created).toEqual([]);
    });
});

/**
 * S-R1 — atomicity of `cloneCollection`'s Unit-of-Work. Before the fix, `create` and the per-recipe
 * `addRecipe` loop were independent, auto-committed statements: a mid-seed failure left an ORPHANED
 * `collections` row with zero (or a partial set of) memberships. Instantiates the DAL/service directly
 * over a real pool (mirroring `photos/reorder.integration.test.ts`) and spies on the DAL's bulk seed
 * method to fail INSIDE the transaction `cloneCollection` opens, proving the created row rolls back with
 * it rather than surviving as an orphan.
 */
describe.skipIf(!hasDatabaseUrl)('CollectionsService.cloneCollection atomicity (S-R1 unit-of-work)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: CollectionsDal;
    let service: CollectionsService;
    let sourceId: string;

    const ATOMIC_CLONER = '01JATOMICCLONER00000000AA';
    const ATOMIC_SOURCE_OWNER = '01JATOMICSRCOWNER0000000B';

    async function insertRecipe(title: string): Promise<string> {
        const [row] = await db
            .insert(recipes)
            .values({
                ownerId: ATOMIC_SOURCE_OWNER,
                title,
                visibility: 'public',
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
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new CollectionsDal(db);
        service = new CollectionsService(dal, new AuthorHandlesDal(db));

        const [source] = await db
            .insert(collections)
            .values({ ownerId: ATOMIC_SOURCE_OWNER, name: 'Atomicity Source', visibility: 'public' })
            .returning({ id: collections.id });
        sourceId = source!.id;

        const recipeIds = [await insertRecipe('Atomic One'), await insertRecipe('Atomic Two')];
        await db
            .insert(recipeCollections)
            .values(recipeIds.map((recipeId) => ({ collectionId: sourceId, recipeId, addedVia: 'manual' as const })));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await db.delete(collections).where(eq(collections.ownerId, ATOMIC_CLONER));
        await db.delete(collections).where(eq(collections.ownerId, ATOMIC_SOURCE_OWNER));
        await db.delete(recipes).where(eq(recipes.ownerId, ATOMIC_SOURCE_OWNER));
        await pool.end();
    });

    it('rolls back the created clone row (no orphan) when the bulk membership seed fails mid-transaction', async () => {
        vi.spyOn(dal, 'addRecipes').mockRejectedValueOnce(new Error('simulated mid-seed failure'));

        await expect(service.cloneCollection(ATOMIC_CLONER, sourceId)).rejects.toThrow('simulated mid-seed failure');

        // THE no-orphan invariant: the collection insert and the membership seed are the SAME transaction,
        // so a failure in the seed must roll back the already-inserted collection row too.
        const orphaned = await db
            .select({ id: collections.id })
            .from(collections)
            .where(eq(collections.ownerId, ATOMIC_CLONER));
        expect(orphaned).toEqual([]);

        // And no partial membership set survives either (nothing to seed a non-existent clone with, but
        // asserted explicitly so a future refactor that decouples the two writes cannot regress silently).
        const anyMemberships = await db
            .select({ recipeId: recipeCollections.recipeId })
            .from(recipeCollections)
            .innerJoin(collections, eq(recipeCollections.collectionId, collections.id))
            .where(eq(collections.ownerId, ATOMIC_CLONER));
        expect(anyMemberships).toEqual([]);
    });

    it('a clone that succeeds normally still seeds every eligible member (bulk path is not silently lossy)', async () => {
        const result = await service.cloneCollection(ATOMIC_CLONER, sourceId);

        const members = await db
            .select({ recipeId: recipeCollections.recipeId, addedVia: recipeCollections.addedVia })
            .from(recipeCollections)
            .where(eq(recipeCollections.collectionId, result.id));

        expect(members).toHaveLength(2);
        expect(members.every((m) => m.addedVia === 'clone_seed')).toBe(true);
    });
});
