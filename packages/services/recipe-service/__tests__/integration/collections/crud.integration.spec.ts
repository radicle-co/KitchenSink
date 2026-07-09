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
import { isCollectionError } from '../../../src/collections/collections.errors.js';

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
        .values({ ownerId, title, ingredientNamesText: title.toLowerCase(), visibility })
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
        service = new CollectionsService(new CollectionsDal(db));
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
            (err: unknown) => isCollectionError(err) && err.code === 'NOT_OWNER',
        );

        const recipeId = await insertRecipe(db, OWNER, 'Locked');
        await expect(service.addRecipe(OTHER_OWNER, collection.id, recipeId)).rejects.toSatisfy(
            (err: unknown) => isCollectionError(err) && err.code === 'NOT_OWNER',
        );
    });

    // ADV-4 membership-IDOR: a user must not be able to pull another user's PRIVATE recipe into their
    // own collection and read its body back. Fail-fast half — the add itself is refused as
    // RECIPE_NOT_FOUND (existence not disclosed), and no membership row is written.
    it("refuses to add another user's PRIVATE recipe to your own collection (RECIPE_NOT_FOUND, no membership)", async () => {
        const myCollection = await service.createCollection(OWNER, { name: 'Mine' });
        const othersPrivate = await insertRecipe(db, OTHER_OWNER, "Someone Else's Secret", 'private');

        await expect(service.addRecipe(OWNER, myCollection.id, othersPrivate)).rejects.toSatisfy(
            (err: unknown) => isCollectionError(err) && err.code === 'RECIPE_NOT_FOUND',
        );

        // No membership was written, and the collection stays empty.
        const rows = await db
            .select()
            .from(recipeCollections)
            .where(eq(recipeCollections.collectionId, myCollection.id));
        expect(rows).toHaveLength(0);
        expect((await service.getCollection(OWNER, myCollection.id)).recipes).toHaveLength(0);
    });

    // ADV-4 authoritative (read-side) half — the case add-time validation CANNOT catch: a member that
    // was PUBLIC when added but is later made PRIVATE by its owner must drop out of the listing. If the
    // read filter is missing, the now-private foreign recipe leaks through getCollection.
    it("hides a member that goes PRIVATE after being added (stale-visibility read filter)", async () => {
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
