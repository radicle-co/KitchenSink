/**
 * One S3 object is one `recipe_photos` row (audit finding 11), against a real PostgreSQL.
 *
 * A retried confirm used to insert a second row for the same object; deleting either row then deleted the
 * shared S3 object and broke the other. Migration 0062 adds a unique index on `s3_key`, and `PhotosDal.create`
 * answers a key it has already stored with that row. A unit test cannot see the index: only a real database
 * can show that a migration applied and that a duplicate is refused.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes } from '../../../src/database/schema/recipes.js';
import { recipePhotos } from '../../../src/database/schema/photos.js';
import { PhotosDal } from '../../../src/photos/dal/photos.dal.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JPHOTOUNIQUEKEYOWNERAAAA';

describe('recipe_photos.s3_key is unique (integration)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let dal: PhotosDal;
    let recipeId: string;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
        dal = new PhotosDal(db);
        const [row] = await db
            .insert(recipes)
            .values({
                ownerId: OWNER,
                title: 'Unique Key Subject',
                ingredientNamesText: 'unique key subject',
                servings: 1,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                cuisine: 'Italian',
            })
            .returning({ id: recipes.id });
        recipeId = row!.id;
    });

    afterEach(async () => {
        await db.delete(recipePhotos).where(eq(recipePhotos.recipeId, recipeId));
    });

    afterAll(async () => {
        await db.delete(recipes).where(sql`${recipes.ownerId} = ${OWNER}`);
        await pool.end();
    });

    it('has a unique index on s3_key', async () => {
        const { rows } = await pool.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes WHERE tablename = 'recipe_photos' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(s3_key)%'`,
        );

        expect(rows).toHaveLength(1);
    });

    it('refuses a second row for the same key at the database, whatever the caller does', async () => {
        const key = `recipes/${OWNER}/${recipeId}/photos/raw`;
        await db.insert(recipePhotos).values({ recipeId, s3Key: key, contentType: 'image/png' });

        await expect(
            db.insert(recipePhotos).values({ recipeId, s3Key: key, contentType: 'image/png' }),
        ).rejects.toThrow();
    });

    it('a retried create returns the SAME row and stores one', async () => {
        const input = {
            recipeId,
            s3Key: `recipes/${OWNER}/${recipeId}/photos/retried`,
            contentType: 'image/png',
            sizeBytes: 10,
        };

        const first = await dal.create(input);
        const second = await dal.create(input);

        expect(second.id).toBe(first.id);
        expect(await db.select().from(recipePhotos).where(eq(recipePhotos.recipeId, recipeId))).toHaveLength(1);
    });

    it('a retry records the thumbnail when the first confirm stored none, and never changes an existing one', async () => {
        const s3Key = `recipes/${OWNER}/${recipeId}/photos/degraded`;
        const first = await dal.create({ recipeId, s3Key, contentType: 'image/png', sizeBytes: 10 });
        expect(first.thumbnailKey).toBeNull();

        const retry = await dal.create({
            recipeId,
            s3Key,
            thumbnailKey: `${s3Key}.thumb`,
            contentType: 'image/png',
            sizeBytes: 10,
        });
        const third = await dal.create({
            recipeId,
            s3Key,
            thumbnailKey: `${s3Key}.other`,
            contentType: 'image/png',
            sizeBytes: 10,
        });

        expect(retry.id).toBe(first.id);
        expect(retry.thumbnailKey).toBe(`${s3Key}.thumb`);
        expect(third.thumbnailKey).toBe(`${s3Key}.thumb`);
    });

    it('a retry at the 10-photo cap still answers, instead of failing as over the cap', async () => {
        const keys = Array.from({ length: 10 }, (_k, i) => `recipes/${OWNER}/${recipeId}/photos/cap${i}`);
        for (const s3Key of keys) {
            await dal.create({ recipeId, s3Key, contentType: 'image/png', sizeBytes: 10 });
        }

        const again = await dal.create({ recipeId, s3Key: keys[9]!, contentType: 'image/png', sizeBytes: 10 });

        expect(again.s3Key).toBe(keys[9]);
        expect(await db.select().from(recipePhotos).where(eq(recipePhotos.recipeId, recipeId))).toHaveLength(10);
    });
});
