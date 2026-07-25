/**
 * T101 — Collections CRUD + membership integration spec (Docker Postgres via `tests/global-setup.ts`).
 *
 * Drives the real {@link CollectionsService} + {@link CollectionsDal} against a live database to assert
 * the invariants the fake-db unit tests cannot: real ownership rows, `ON CONFLICT` idempotency,
 * tombstone exclusion from membership listings, many-to-many membership, and the NO-CASCADE delete
 * (dropping a collection leaves its recipes intact and their other collection memberships untouched).
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so it is a no-op when the harness is not up, matching
 * the food/identity integration ethos.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { collections, recipeCollections } from '../../../src/database/schema/collections.js';
import { recipes } from '../../../src/database/schema/recipes.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { CollectionsService } from '../../../src/collections/collections.service.js';
import { isRecipeDomainError } from '../../../src/recipes/recipe.error.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/author-handles.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const OWNER = '01JCOLLECTIONOWNERAAAAAAAAA';
const OTHER_OWNER = '01JCOLLECTIONOWNERBBBBBBBBB';

/** Insert a minimal recipe directly and return its id. Visibility defaults to public (the schema default). */
async function insertRecipe(
    db: RecipeDrizzle,
    ownerId: string,
    title: string,
    visibility: 'public' | 'private' = 'public',
): Promise<string> {
    const [row] = await db
        .insert(recipes)
        .values({
            ownerId,
            title,
            ingredientNamesText: title.toLowerCase(),
            visibility,
            servings: 1,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
        })
        .returning({ id: recipes.id });

    if (!row) {
        throw new Error('recipe insert returned no row');
    }

    return row.id;
}

describe.skipIf(!hasDatabaseUrl)('Collections CRUD + membership (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let service: CollectionsService;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        service = new CollectionsService(new CollectionsDal(db), new AuthorHandlesDal(db));
    });

    afterAll(async () => {
        await pool.end();
    });

    beforeEach(async () => {
        // Isolate each test: clear this suite's owners' data (memberships cascade from collections).
        await db.delete(collections).where(sql`${collections.ownerId} IN (${OWNER}, ${OTHER_OWNER})`);
        await db.delete(recipes).where(sql`${recipes.ownerId} IN (${OWNER}, ${OTHER_OWNER})`);
    });

    it('creates, reads, updates, and lists a collection', async () => {
        const created = await service.createCollection(OWNER, { name: 'Weeknight Dinners' });
        expect(created.visibility).toBe('private');
        expect(created.ownerId).toBe(OWNER);

        const fetched = await service.getCollection(OWNER, created.id);
        expect(fetched.name).toBe('Weeknight Dinners');
        expect(fetched.recipes).toEqual([]);
        expect(fetched.recipeCount).toBe(0);

        const renamed = await service.updateCollection(OWNER, created.id, {
            name: 'Fast Dinners',
            visibility: 'public',
        });
        expect(renamed.name).toBe('Fast Dinners');
        expect(renamed.visibility).toBe('public');

        const page = await service.listCollections(OWNER, { page: 1, pageSize: 10 });
        expect(page.total).toBe(1);
        expect(page.data[0]?.id).toBe(created.id);
    });

    it(
        'enforces the 50-collection-per-owner cap (REQ-049b): the 50th succeeds, the 51st is ' +
            'rejected COLLECTION_LIMIT_REACHED, and a DIFFERENT owner is unaffected',
        async () => {
            for (let index = 0; index < 50; index += 1) {
                const created = await service.createCollection(OWNER, { name: `Cap ${index}` });
                expect(created.id).toBeTruthy();
            }

            const page = await service.listCollections(OWNER, { page: 1, pageSize: 1 });
            expect(page.total).toBe(50);

            await expect(service.createCollection(OWNER, { name: 'Cap 51' })).rejects.toSatisfy(
                (err: unknown) => isRecipeDomainError(err) && err.code === 'COLLECTION_LIMIT_REACHED',
            );

            // The rejected 51st attempt did not write a row: the count stays at exactly 50.
            const pageAfterRejection = await service.listCollections(OWNER, { page: 1, pageSize: 1 });
            expect(pageAfterRejection.total).toBe(50);

            // Per-owner isolation: OWNER being at the cap must not block a DIFFERENT owner's create.
            const otherCreated = await service.createCollection(OTHER_OWNER, { name: 'Other owner unaffected' });
            expect(otherCreated.id).toBeTruthy();
            const otherPage = await service.listCollections(OTHER_OWNER, { page: 1, pageSize: 1 });
            expect(otherPage.total).toBe(1);
        },
    );

    it('adds and removes recipes (idempotent add), excluding tombstoned recipes from the listing', async () => {
        const collection = await service.createCollection(OWNER, { name: 'Mains' });
        const recipeId = await insertRecipe(db, OWNER, 'Soup');

        const membership = await service.addRecipe(OWNER, collection.id, recipeId);
        expect(membership).toMatchObject({ collectionId: collection.id, recipeId, addedVia: 'manual' });

        // Idempotent: re-adding returns the same membership, not a duplicate.
        await service.addRecipe(OWNER, collection.id, recipeId);
        const afterReAdd = await service.getCollection(OWNER, collection.id);
        expect(afterReAdd.recipes).toHaveLength(1);
        expect(afterReAdd.recipeCount).toBe(1);

        // Tombstone the recipe → it drops out of the membership listing (junction row remains).
        await db.update(recipes).set({ deletedAt: new Date() }).where(eq(recipes.id, recipeId));
        const afterTombstone = await service.getCollection(OWNER, collection.id);
        expect(afterTombstone.recipes).toHaveLength(0);
        expect(afterTombstone.recipeCount).toBe(0);

        const junctionRows = await db
            .select()
            .from(recipeCollections)
            .where(and(eq(recipeCollections.collectionId, collection.id), eq(recipeCollections.recipeId, recipeId)));
        expect(junctionRows).toHaveLength(1);

        // Remove clears the junction row.
        await db.update(recipes).set({ deletedAt: null }).where(eq(recipes.id, recipeId));
        await service.removeRecipe(OWNER, collection.id, recipeId);
        const afterRemove = await service.getCollection(OWNER, collection.id);
        expect(afterRemove.recipes).toHaveLength(0);
    });

    it('supports many-to-many membership (one recipe in multiple collections)', async () => {
        const collectionA = await service.createCollection(OWNER, { name: 'A' });
        const collectionB = await service.createCollection(OWNER, { name: 'B' });
        const recipeId = await insertRecipe(db, OWNER, 'Shared');

        await service.addRecipe(OWNER, collectionA.id, recipeId);
        await service.addRecipe(OWNER, collectionB.id, recipeId);

        expect((await service.getCollection(OWNER, collectionA.id)).recipes).toHaveLength(1);
        expect((await service.getCollection(OWNER, collectionB.id)).recipes).toHaveLength(1);
    });

    it('no-cascade delete: dropping a collection leaves the recipe and its other memberships intact', async () => {
        const keep = await service.createCollection(OWNER, { name: 'Keep' });
        const drop = await service.createCollection(OWNER, { name: 'Drop' });
        const recipeId = await insertRecipe(db, OWNER, 'Survivor');

        await service.addRecipe(OWNER, keep.id, recipeId);
        await service.addRecipe(OWNER, drop.id, recipeId);

        await service.deleteCollection(OWNER, drop.id);

        // The recipe still exists.
        const recipeRows = await db.select().from(recipes).where(eq(recipes.id, recipeId));
        expect(recipeRows).toHaveLength(1);

        // Its membership in the OTHER collection is untouched.
        const surviving = await service.getCollection(OWNER, keep.id);
        expect(surviving.recipes).toHaveLength(1);

        // The dropped collection is gone.
        await expect(service.getCollection(OWNER, drop.id)).rejects.toThrow();
    });

    it('enforces ownership: a non-owner gets NOT_OWNER, a stranger add is refused', async () => {
        const collection = await service.createCollection(OWNER, { name: 'Private' });

        await expect(service.getCollection(OTHER_OWNER, collection.id)).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === 'NOT_OWNER',
        );

        const recipeId = await insertRecipe(db, OWNER, 'Locked');
        await expect(service.addRecipe(OTHER_OWNER, collection.id, recipeId)).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === 'NOT_OWNER',
        );
    });

    // ADV-4 membership-IDOR: a user must not be able to pull another user's PRIVATE recipe into their
    // own collection and read its body back. Fail-fast half — the add itself is refused as
    // RECIPE_NOT_FOUND (existence not disclosed), and no membership row is written.
    it("refuses to add another user's PRIVATE recipe to your own collection (RECIPE_NOT_FOUND, no membership)", async () => {
        const myCollection = await service.createCollection(OWNER, { name: 'Mine' });
        const othersPrivate = await insertRecipe(db, OTHER_OWNER, "Someone Else's Secret", 'private');

        await expect(service.addRecipe(OWNER, myCollection.id, othersPrivate)).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === 'RECIPE_NOT_FOUND',
        );

        // No membership was written, and the collection stays empty.
        const rows = await db
            .select()
            .from(recipeCollections)
            .where(eq(recipeCollections.collectionId, myCollection.id));
        expect(rows).toHaveLength(0);
        expect((await service.getCollection(OWNER, myCollection.id)).recipes).toHaveLength(0);
    });

    // W5 Task 4: the source-indicator checkbox (C3) needs each member's provenance on the collection
    // embed. Seed the three provenance kinds directly through the DAL (clone_seed/pull are normally only
    // written internally by cloneCollection/pullFromSource, not a public "add with provenance" endpoint)
    // and assert `GET /v1/collections/:id` (service.getCollection, the controller's exact call) reports
    // each member's addedVia correctly.
    it("exposes each member's addedVia matching how it entered the collection", async () => {
        const collection = await service.createCollection(OWNER, { name: 'Provenance' });
        const manualRecipeId = await insertRecipe(db, OWNER, 'Manual Add');
        const cloneRecipeId = await insertRecipe(db, OWNER, 'Clone Seed');
        const pullRecipeId = await insertRecipe(db, OWNER, 'Pulled');

        await service.addRecipe(OWNER, collection.id, manualRecipeId);

        const dal = new CollectionsDal(db);
        await dal.addRecipe(collection.id, cloneRecipeId, 'clone_seed');
        await dal.addRecipe(collection.id, pullRecipeId, 'pull');

        const fetched = await service.getCollection(OWNER, collection.id);

        const addedViaById = new Map(fetched.recipes.map((recipe) => [recipe.id, recipe.addedVia]));
        expect(addedViaById.get(manualRecipeId)).toBe('manual');
        expect(addedViaById.get(cloneRecipeId)).toBe('clone_seed');
        expect(addedViaById.get(pullRecipeId)).toBe('pull');
        expect(fetched.recipes).toHaveLength(3);
    });

    // REQ-056b characterization: a member recipe's soft-delete must NOT cascade-delete the collection
    // itself. The recipe simply drops from the membership/read view (already exercised above for the
    // idempotent-add case); this test isolates the assertion the gap analysis flagged as untested — the
    // COLLECTION survives and stays fully retrievable (by id AND in the owner's list) after one of its
    // members is tombstoned.
    it('REQ-056b: the collection survives (and stays retrievable) after a member recipe is soft-deleted', async () => {
        const collection = await service.createCollection(OWNER, { name: 'Outlives Its Members' });
        const recipeId = await insertRecipe(db, OWNER, 'Doomed Soup');

        await service.addRecipe(OWNER, collection.id, recipeId);
        const beforeDelete = await service.getCollection(OWNER, collection.id);
        expect(beforeDelete.recipes.map((recipe) => recipe.id)).toContain(recipeId);

        // Soft-delete the member recipe (tombstone, not a hard delete — matches C-007).
        await db.update(recipes).set({ deletedAt: new Date() }).where(eq(recipes.id, recipeId));

        // The collection itself is untouched: still resolvable by id, with its identity intact.
        const afterDelete = await service.getCollection(OWNER, collection.id);
        expect(afterDelete.id).toBe(collection.id);
        expect(afterDelete.name).toBe('Outlives Its Members');
        // The deleted recipe is gone from the membership view; the collection is not itself deleted.
        expect(afterDelete.recipes.map((recipe) => recipe.id)).not.toContain(recipeId);
        expect(afterDelete.recipes).toHaveLength(0);

        // It also still appears in the owner's collection list (not silently removed there either).
        const page = await service.listCollections(OWNER, { page: 1, pageSize: 10 });
        expect(page.data.map((c) => c.id)).toContain(collection.id);
    });

    // ADV-4 authoritative (read-side) half — the case add-time validation CANNOT catch: a member that
    // was PUBLIC when added but is later made PRIVATE by its owner must drop out of the listing. If the
    // read filter is missing, the now-private foreign recipe leaks through getCollection.
    it('hides a member that goes PRIVATE after being added (stale-visibility read filter)', async () => {
        const myCollection = await service.createCollection(OWNER, { name: 'Curated' });
        const othersRecipe = await insertRecipe(db, OTHER_OWNER, 'Was Public', 'public');

        // Legitimately add it while public.
        await service.addRecipe(OWNER, myCollection.id, othersRecipe);
        const whilePublic = await service.getCollection(OWNER, myCollection.id);
        expect(whilePublic.recipes.map((recipe) => recipe.id)).toContain(othersRecipe);

        // The owner flips it to private — the membership row still exists, but it must no longer be seen.
        await db.update(recipes).set({ visibility: 'private' }).where(eq(recipes.id, othersRecipe));
        const afterPrivate = await service.getCollection(OWNER, myCollection.id);
        expect(afterPrivate.recipes).toHaveLength(0);
        expect(afterPrivate.recipeCount).toBe(0);

        // The junction row is untouched — the recipe is hidden by visibility, not removed.
        const junction = await db
            .select()
            .from(recipeCollections)
            .where(eq(recipeCollections.collectionId, myCollection.id));
        expect(junction).toHaveLength(1);
    });
});
