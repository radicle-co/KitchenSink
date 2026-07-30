/**
 * T126 — C-007 / FR-002 soft-delete tombstone integration test (real Nest app + Docker Postgres +
 * LocalStack S3).
 *
 * Proves the guarantee that separates a soft delete from a hard one: `DELETE /v1/recipes/{id}` hides the
 * recipe from every normal API, but the ROW SURVIVES with `deleted_at` stamped, retained indefinitely
 * until an explicit GDPR erasure (C-007). Nothing else in the suite pins that: `recipes/crud` asserts
 * only 204-then-404, which a hard `DELETE FROM recipes` would satisfy identically — so a regression to a
 * destructive delete would ship green while silently destroying the retention guarantee (and the
 * distinction the erasure flow depends on). Hence the raw, filter-bypassing row read below.
 *
 * REQ-019a/b/c (DB row + S3 archive retention, no auto-purge): `RecipesDal.softDelete` is a plain
 * `UPDATE ... SET deleted_at = now()` (`recipes.dal.ts`) — never a `DELETE FROM recipes` — so the
 * `recipe_photos.recipe_id` FK's `ON DELETE CASCADE` never fires (cascades trigger on row deletion, not
 * on an update), and the photo row + its S3 object are left completely untouched. `recipe-service`
 * itself contains no automatic/scheduled process that purges S3 objects at all: the only S3-delete code
 * path is `PhotosService.delete()` (`DELETE /v1/recipes/{id}/photos/{photoId}`, an explicit per-photo
 * user action this suite never invokes), and the actual GDPR hard-purge (DB rows + the dual-bucket S3
 * sweep) lives entirely in the DOWNSTREAM `@kitchensink/recipe-workers` erasure worker — see
 * `erasure.integration.spec.ts`'s scope note ("recipe-service does not, and must not, depend on its own
 * downstream consumer"). So the S3-retention proof below needs nothing from recipe-workers: it is
 * enough to show that soft-delete's only observable effect is the tombstone stamp.
 *
 * Scope note (DRY — one authoritative spec per rule): the sibling exclusion rules already have homes and
 * are NOT re-asserted here — search exclusion in `integration/search/search.integration.spec.ts`
 * ("excludes tombstoned (soft-deleted) recipes from results"), collection-membership exclusion in
 * `integration/collections/crud.integration.spec.ts` ("...excluding tombstoned recipes from the
 * listing"), and GET-after-delete → 404 in `integration/recipes/crud.integration.spec.ts`. What is left —
 * and covered here — is retention (DB row AND S3 object), owner-list exclusion, and re-delete idempotency.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { recipes } from '../../../src/database/schema/recipes.js';
import { recipePhotos } from '../../../src/database/schema/photos.js';

/** The dev-bypass owner ULID this suite creates and tombstones recipes as. */
const OWNER = '01JSOFTDELETE0OWNER000000DD';

interface RecipeBody {
    id: string;
    title: string;
}

interface PaginatedBody {
    data: RecipeBody[];
    total: number;
}

const CREATE_PAYLOAD = {
    title: 'Tombstone Test Recipe',
    description: 'Created by the C-007 soft-delete integration spec.',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: ['integration'],
    dietaryFlags: [],
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1, unit: 'cup' }],
    steps: [{ instruction: 'Mix.' }],
};

/** A REAL, decodable 1×1 PNG (base64) — see `photos/upload.integration.spec.ts` for why a genuine image is used. */
const REAL_PNG_BYTES = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
    ),
);

interface UploadUrlBody {
    uploadUrl: string;
    key: string;
}

interface PhotoBody {
    id: string;
    key: string;
}

describe.skipIf(!hasDatabaseUrl)('recipe soft-delete tombstones (C-007 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;
    let s3: S3Client;
    let photosBucket: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        // The app's own Drizzle client, resolved from the container — used ONLY to read rows the DAL's
        // `deleted_at IS NULL` filter deliberately hides, which is exactly what retention needs proven.
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);

        photosBucket = process.env['S3_BUCKET_PHOTOS'] ?? 'commise-photos';
        s3 = new S3Client({
            endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
    });

    afterAll(async () => {
        s3?.destroy();
        await db.delete(recipes).where(eq(recipes.ownerId, OWNER));
        await booted.close();
    });

    /** True while an S3 HEAD on `key` succeeds — the object genuinely still exists in the bucket. */
    async function objectExists(key: string): Promise<boolean> {
        try {
            await s3.send(new HeadObjectCommand({ Bucket: photosBucket, Key: key }));

            return true;
        } catch (error) {
            if (error instanceof NotFound) {
                return false;
            }

            throw error;
        }
    }

    /** Presign, PUT, and confirm a real PNG onto `recipeId`, returning its `recipe_photos` row + S3 key. */
    async function attachPhoto(recipeId: string): Promise<PhotoBody> {
        const presignRes = await fetch(`${baseUrl}/v1/recipes/${recipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                fileName: 'dish.png',
                contentType: 'image/png',
                fileSize: REAL_PNG_BYTES.byteLength,
            }),
        });
        expect(presignRes.status).toBe(200);
        const presigned = (await presignRes.json()) as UploadUrlBody;

        const putRes = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: REAL_PNG_BYTES,
        });
        expect(putRes.ok).toBe(true);

        const confirmRes = await fetch(`${baseUrl}/v1/recipes/${recipeId}/photos/confirm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: presigned.key, contentType: 'image/png' }),
        });
        expect(confirmRes.status).toBe(201);

        return (await confirmRes.json()) as PhotoBody;
    }

    /** Create a recipe over HTTP and return its id. */
    async function createRecipe(title: string): Promise<string> {
        const res = await fetch(`${baseUrl}/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_PAYLOAD, title }),
        });
        expect(res.status).toBe(201);

        return ((await res.json()) as RecipeBody).id;
    }

    /** Read the row straight from Postgres, bypassing every tombstone filter. */
    async function readRaw(id: string): Promise<{ id: string; deletedAt: Date | null } | undefined> {
        const [row] = await db
            .select({ id: recipes.id, deletedAt: recipes.deletedAt })
            .from(recipes)
            .where(eq(recipes.id, id))
            .limit(1);

        return row;
    }

    it('retains the row with deleted_at stamped — a tombstone, not a destructive delete', async () => {
        const id = await createRecipe('Tombstone Retention');

        const before = await readRaw(id);
        expect(before?.deletedAt).toBeNull();

        const deleteRes = await fetch(`${baseUrl}/v1/recipes/${id}`, { method: 'DELETE' });
        expect(deleteRes.status).toBe(204);

        // THE C-007 guarantee: the row is still there, now carrying a tombstone. A hard delete makes
        // `after` undefined and fails here — while leaving the 204/404 assertions elsewhere green.
        const after = await readRaw(id);
        expect(after).toBeDefined();
        expect(after?.id).toBe(id);
        expect(after?.deletedAt).toBeInstanceOf(Date);
    });

    it('retains the S3 photo object and its DB row after soft-delete — no automatic purge (REQ-019b/c)', async () => {
        const id = await createRecipe('S3 Retention');
        const photo = await attachPhoto(id);

        // The object genuinely exists in LocalStack before delete — otherwise "still there after" proves
        // nothing.
        expect(await objectExists(photo.key)).toBe(true);

        const deleteRes = await fetch(`${baseUrl}/v1/recipes/${id}`, { method: 'DELETE' });
        expect(deleteRes.status).toBe(204);

        // REQ-019a: the recipe row survives as a tombstone (re-pinned here so this test is self-contained
        // evidence of the whole retention guarantee, not just its S3 half).
        const recipeAfter = await readRaw(id);
        expect(recipeAfter?.deletedAt).toBeInstanceOf(Date);

        // REQ-019b (DB half): the photo's OWN row is untouched. `softDelete` is an UPDATE on `recipes`,
        // never a `DELETE FROM recipes` — so `recipe_photos.recipe_id`'s `ON DELETE CASCADE` FK never
        // fires. A regression to a real row delete would cascade this row away and fail here even though
        // the recipe's own tombstone assertion above still passes.
        const [photoRow] = await db
            .select({ id: recipePhotos.id, s3Key: recipePhotos.s3Key })
            .from(recipePhotos)
            .where(eq(recipePhotos.id, photo.id));
        expect(photoRow).toBeDefined();
        expect(photoRow?.s3Key).toBe(photo.key);

        // REQ-019b/c (S3 half): the object is STILL in the bucket — no automatic process purged it. The
        // only S3-delete code path in this service is the explicit `DELETE …/photos/{photoId}` endpoint
        // (proven to actually delete in `photos/delete.integration.spec.ts`), which this test never calls;
        // there is no sweep, cron, or cascade in `recipe-service` that reaches S3 on a recipe soft-delete.
        expect(await objectExists(photo.key)).toBe(true);
    });

    it("drops the tombstoned recipe from the owner's list while leaving its siblings", async () => {
        const keptId = await createRecipe('Kept In List');
        const doomedId = await createRecipe('Dropped From List');

        const before = (await (await fetch(`${baseUrl}/v1/recipes?page=1&pageSize=50`)).json()) as PaginatedBody;
        expect(before.data.map((r) => r.id)).toEqual(expect.arrayContaining([keptId, doomedId]));

        expect((await fetch(`${baseUrl}/v1/recipes/${doomedId}`, { method: 'DELETE' })).status).toBe(204);

        const after = (await (await fetch(`${baseUrl}/v1/recipes?page=1&pageSize=50`)).json()) as PaginatedBody;
        const ids = after.data.map((r) => r.id);
        expect(ids).not.toContain(doomedId);
        // Asserting the sibling SURVIVES stops a mutation that empties the list wholesale from passing,
        // and pins the paginated `total` to the active set rather than the raw row count.
        expect(ids).toContain(keptId);
        expect(after.total).toBe(before.total - 1);
    });

    it('answers a repeat DELETE with 404 and never moves the original tombstone', async () => {
        const id = await createRecipe('Idempotent Re-delete');

        expect((await fetch(`${baseUrl}/v1/recipes/${id}`, { method: 'DELETE' })).status).toBe(204);
        const firstTombstone = (await readRaw(id))?.deletedAt;
        expect(firstTombstone).toBeInstanceOf(Date);

        // The DAL's `deleted_at IS NULL` guard makes the second delete match zero rows → 404, so the
        // recorded moment of deletion stays put (a re-stamp would falsify the retention audit trail).
        expect((await fetch(`${baseUrl}/v1/recipes/${id}`, { method: 'DELETE' })).status).toBe(404);
        expect((await readRaw(id))?.deletedAt).toEqual(firstTombstone);
    });
});
