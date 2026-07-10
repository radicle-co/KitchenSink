/**
 * Integration spec for the atomic photo-reorder guard (ADV-5 / verticals-5) against real Postgres.
 *
 * Reorder rewrites each listed photo's `sort_order` to its index. A partial, duplicate, or foreign-id
 * list would leave some rows at their old positions and collide — corrupting the display order. The DAL
 * validates that the request is an EXACT permutation of the recipe's current photos INSIDE the same
 * `FOR UPDATE` transaction as the rewrite, returning `null` (→ the service maps 400) and writing nothing
 * otherwise. Only a real database exercises the lock + in-transaction validation, so it is proven here.
 *
 * Photos are seeded directly (no S3) — this covers the reorder SQL, not the upload flow. Guarded with
 * `describe.skipIf(!hasDatabaseUrl)` so it is a no-op when the harness is not up.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes } from '../../../src/database/schema/recipes.js';
import { recipePhotos } from '../../../src/database/schema/photos.js';
import { PhotosDal } from '../../../src/photos/dal/photos.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const OWNER = '01JPHOTOREORDEROWNERAAAAAAA';

/** Insert a recipe and return its id. */
async function seedRecipe(db: RecipeDrizzle): Promise<string> {
    const [row] = await db
        .insert(recipes)
        .values({
            ownerId: OWNER,
            title: 'Photo Subject',
            ingredientNamesText: 'photo subject',
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

/** Insert a photo at a given sort order and return its id. */
async function seedPhoto(db: RecipeDrizzle, recipeId: string, sortOrder: number): Promise<string> {
    const [row] = await db
        .insert(recipePhotos)
        .values({
            recipeId,
            s3Key: `recipes/${OWNER}/${recipeId}/photos/p${sortOrder}.png`,
            contentType: 'image/png',
            sortOrder,
        })
        .returning({ id: recipePhotos.id });

    if (!row) {
        throw new Error('photo insert returned no row');
    }

    return row.id;
}

/** Read the recipe's photos as `[id, sortOrder]` pairs, ordered by sort order. */
async function orderOf(db: RecipeDrizzle, recipeId: string): Promise<[string, number][]> {
    const rows = await db
        .select({ id: recipePhotos.id, sortOrder: recipePhotos.sortOrder })
        .from(recipePhotos)
        .where(eq(recipePhotos.recipeId, recipeId))
        .orderBy(asc(recipePhotos.sortOrder));

    return rows.map((row) => [row.id, row.sortOrder]);
}

describe.skipIf(!hasDatabaseUrl)('PhotosDal.reorder atomic permutation guard (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: PhotosDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        dal = new PhotosDal(db);
    });

    afterAll(async () => {
        await pool.end();
    });

    beforeEach(async () => {
        await db.delete(recipes).where(sql`${recipes.ownerId} = ${OWNER}`); // photos cascade via FK
    });

    it('applies a full permutation: sort_order becomes the requested index order', async () => {
        const recipeId = await seedRecipe(db);
        const a = await seedPhoto(db, recipeId, 0);
        const b = await seedPhoto(db, recipeId, 1);
        const c = await seedPhoto(db, recipeId, 2);

        const result = await dal.reorder(recipeId, [c, a, b]);

        expect(result).not.toBeNull();
        expect(await orderOf(db, recipeId)).toEqual([
            [c, 0],
            [a, 1],
            [b, 2],
        ]);
    });

    it('rejects a PARTIAL list (null) and leaves every sort_order untouched — no collision', async () => {
        const recipeId = await seedRecipe(db);
        const a = await seedPhoto(db, recipeId, 0);
        await seedPhoto(db, recipeId, 1);
        const c = await seedPhoto(db, recipeId, 2);

        const before = await orderOf(db, recipeId);
        // Only one of three ids — the pre-fix bug would set c=0 and leave a=0, colliding at 0.
        const result = await dal.reorder(recipeId, [c]);

        expect(result).toBeNull();
        // Unchanged: a is still 0, c is still 2 — no duplicate sort orders were written.
        expect(await orderOf(db, recipeId)).toEqual(before);
        expect(before.find(([id]) => id === a)?.[1]).toBe(0);
        expect(before.find(([id]) => id === c)?.[1]).toBe(2);
    });

    it('rejects a list with a FOREIGN id (null), writing nothing', async () => {
        const recipeId = await seedRecipe(db);
        const a = await seedPhoto(db, recipeId, 0);
        const b = await seedPhoto(db, recipeId, 1);

        const before = await orderOf(db, recipeId);
        const result = await dal.reorder(recipeId, [a, b, '00000000-0000-4000-8000-0000000000ff']);

        expect(result).toBeNull();
        expect(await orderOf(db, recipeId)).toEqual(before);
    });
});
