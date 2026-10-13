/**
 * W-11 — the collection LIST read's member count and cover mosaic against REAL Postgres (LOCAL e2e tier,
 * `docs/CODING_STANDARDS.md` §7.1a).
 *
 * `collections.dal.memberSummaries.test.ts` pins the emitted SQL; only a database shows that the predicate really
 * EXCLUDES what the viewer may not read — the privacy half of this feature: a card must never count, or show the
 * photo of, a member the open collection would hide.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { collections, recipeCollections } from '../../../src/database/schema/collections.js';
import { recipePhotos } from '../../../src/database/schema/photos.js';
import { recipes } from '../../../src/database/schema/recipes.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { CollectionsService } from '../../../src/collections/collections.service.js';
import { AnalyticsService } from '../../../src/analytics/analytics.service.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JMEMBERSUMMARYOWNER0000A';
const STRANGER = '01JMEMBERSUMMARYSTRANGER00B';
const CDN = 'https://cdn.e2e.test';

describe('Collection list member summary (e2e)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let service: CollectionsService;
    let collectionId: string;

    /** Insert a recipe (optionally with one photo) and add it to the collection. Returns the recipe id. */
    async function member(
        ownerId: string,
        title: string,
        options: {
            visibility?: 'public' | 'private';
            status?: 'draft' | 'published';
            photoKey?: string;
            thumbnailKey?: string;
            deleted?: boolean;
        } = {},
    ): Promise<string> {
        const [row] = await db
            .insert(recipes)
            .values({
                ownerId,
                title,
                ingredientNamesText: title.toLowerCase(),
                visibility: options.visibility ?? 'public',
                status: options.status ?? 'published',
                servings: 1,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ...(options.deleted === true ? { deletedAt: new Date() } : {}),
            })
            .returning({ id: recipes.id });
        const id = row!.id;

        if (options.photoKey !== undefined) {
            await db.insert(recipePhotos).values({
                recipeId: id,
                s3Key: options.photoKey,
                thumbnailKey: options.thumbnailKey ?? null,
                contentType: 'image/jpeg',
            });
        }

        await db.insert(recipeCollections).values({ collectionId, recipeId: id });

        return id;
    }

    /** The one collection's list element, read as the OWNER. */
    async function listed(): Promise<{ recipeCount: number; coverPhotoUrls: readonly string[] }> {
        const page = await service.listCollections(OWNER, { page: 1, pageSize: 10 });
        const element = page.data.find((c) => c.id === collectionId);

        return { recipeCount: element!.recipeCount, coverPhotoUrls: element!.coverPhotoUrls };
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
        service = new CollectionsService(
            new CollectionsDal(db),
            new AuthorHandlesDal(db),
            new AnalyticsService(db),
            CDN,
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    beforeEach(async () => {
        await db.delete(collections).where(sql`${collections.ownerId} IN (${OWNER}, ${STRANGER})`);
        await db.delete(recipes).where(sql`${recipes.ownerId} IN (${OWNER}, ${STRANGER})`);
        const [row] = await db
            .insert(collections)
            .values({ ownerId: OWNER, name: 'Mosaic' })
            .returning({ id: collections.id });
        collectionId = row!.id;
    });

    it('an empty collection is zero recipes and no covers', async () => {
        expect(await listed()).toEqual({ recipeCount: 0, coverPhotoUrls: [] });
    });

    it('counts members, and shows the thumbnail when there is one and the original otherwise', async () => {
        await member(OWNER, 'With thumb', { photoKey: 'o/1.jpg', thumbnailKey: 't/1.jpg' });
        await member(OWNER, 'Original only', { photoKey: 'o/2.jpg' });
        await member(OWNER, 'No photo');

        expect(await listed()).toEqual({
            recipeCount: 3,
            coverPhotoUrls: [`${CDN}/t/1.jpg`, `${CDN}/o/2.jpg`],
        });
    });

    it("never counts or shows another cook's private or draft recipe, nor a deleted one", async () => {
        await member(OWNER, 'Mine', { photoKey: 'o/mine.jpg' });
        await member(STRANGER, 'Their public', { photoKey: 'o/public.jpg' });
        await member(STRANGER, 'Their private', { visibility: 'private', photoKey: 'o/private.jpg' });
        await member(STRANGER, 'Their draft', { status: 'draft', photoKey: 'o/draft.jpg' });
        await member(OWNER, 'Deleted', { deleted: true, photoKey: 'o/deleted.jpg' });

        const summary = await listed();

        expect(summary.recipeCount).toBe(2);
        expect(summary.coverPhotoUrls).toEqual([`${CDN}/o/mine.jpg`, `${CDN}/o/public.jpg`]);
    });

    it("counts the owner's OWN private and draft members (the owner may read them)", async () => {
        await member(OWNER, 'Own private', { visibility: 'private', photoKey: 'o/a.jpg' });
        await member(OWNER, 'Own draft', { status: 'draft' });

        expect((await listed()).recipeCount).toBe(2);
    });

    it('caps the mosaic at four covers while the count stays whole, and skips photo-less members', async () => {
        await member(OWNER, 'No photo first');

        for (let index = 1; index <= 6; index += 1) {
            await member(OWNER, `Photo ${index}`, { photoKey: `o/${index}.jpg` });
        }

        const summary = await listed();

        expect(summary.recipeCount).toBe(7);
        expect(summary.coverPhotoUrls).toEqual([1, 2, 3, 4].map((n) => `${CDN}/o/${n}.jpg`));
    });
});
