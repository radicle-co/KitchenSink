/**
 * Photo-delete lifecycle integration test (HAZ-051/067/039) — real Nest app + Docker Postgres +
 * LocalStack S3.
 *
 * Drives `DELETE …/photos/{photoId}` through the REAL app (real DB, real S3) and proves:
 *   1. the S3 original AND its thumbnail rendition are actually removed from LocalStack (a HEAD 404s);
 *   2. the photo no longer appears in the recipe's photo list;
 *   3. the app's REAL, DI-resolved {@link CdnInvalidationPort} (`PHOTOS_CDN`) is invoked with BOTH the
 *      original's and the thumbnail's CDN paths.
 *
 * (3) spies on the port `booted.app` actually resolves rather than injecting a fake via a testing-module
 * override: `bootRecipeApp`/`bootServiceApp` boots the real `AppModule` with no override hook, so this is
 * the one way to observe the REAL production wiring (module → service → port) end to end. Because
 * `CLOUDFRONT_DISTRIBUTION_ID` is unset in this harness (LocalStack Community has no CloudFront support —
 * `docker-compose.test.yml`'s `SERVICES` is `s3,sqs` only), the resolved port is the logging no-op
 * adapter; spying its `invalidate` method still proves the WIRING and the exact paths it is called with,
 * which is the part a real CloudFront distribution cannot be exercised against in this harness anyway.
 * `src/photos/__tests__/cdnInvalidation.test.ts` separately proves the real (`CLOUDFRONT_DISTRIBUTION_ID`
 * SET) adapter branch issues the correct `CreateInvalidationCommand` against a mocked AWS SDK client.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup
 * (`describe.skipIf(!hasDatabaseUrl)`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3';
import { recipePhotoThumbnailKey } from '@kitchensink/recipe-core';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { PHOTOS_CDN, type CdnInvalidationPort } from '../../../src/photos/photos.service.js';

/** The dev-bypass owner ULID this suite creates recipes + photos as. */
const OWNER = '01JPHOTODELETEOWNER00000AA';

/** A REAL, decodable 1×1 PNG (base64) — see `upload.integration.test.ts` for why a genuine image is used. */
const REAL_PNG_BYTES = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    ),
);

const RECIPE_PAYLOAD = {
    title: 'Photo Delete Integration Recipe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: ['integration'],
    dietaryFlags: [],
    ingredients: [
        { ingredientId: '00000000-0000-4000-8000-0000000000bb', name: 'Flour', quantity: { kind: 'exact', value: 1 } },
    ],
    steps: [{ instruction: 'Mix.' }],
};

interface RecipeBody {
    id: string;
}

interface UploadUrlBody {
    uploadUrl: string;
    key: string;
}

interface PhotoBody {
    id: string;
    key: string;
}

/** True once an S3 HEAD on `key` resolves as "not found" (a `NotFound` throw) — the object is gone. */
async function isDeleted(s3: S3Client, bucket: string, key: string): Promise<boolean> {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

        return false;
    } catch (error) {
        return error instanceof NotFound;
    }
}

describe.skipIf(!hasDatabaseUrl)('recipe photo delete lifecycle — S3 delete + CDN invalidation (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let recipeId: string;
    let s3: S3Client;
    let photosBucket: string;
    let cdn: CdnInvalidationPort;
    let invalidateSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;

        photosBucket = process.env['S3_BUCKET_PHOTOS'] ?? 'commise-photos';
        s3 = new S3Client({
            endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:4566',
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        // The REAL, DI-resolved port the app wires photo-delete against (see module docstring above).
        cdn = booted.app.get(PHOTOS_CDN);

        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(RECIPE_PAYLOAD),
        });
        expect(createRes.status).toBe(201);
        recipeId = ((await createRes.json()) as RecipeBody).id;
    });

    afterAll(async () => {
        s3?.destroy();
        await booted.close();
    });

    it('deletes the S3 original + thumbnail, invalidates BOTH CDN paths, and drops the photo from the list', async () => {
        // Upload + confirm a real, decodable PNG so confirm's thumbnail generation actually produces a
        // second stored object — this test needs BOTH keys to exist so the delete path has two to clean up.
        const presignRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                fileName: 'dish.png',
                contentType: 'image/png',
                fileSize: REAL_PNG_BYTES.byteLength,
            }),
        });
        const presigned = (await presignRes.json()) as UploadUrlBody;

        const putRes = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: REAL_PNG_BYTES,
        });
        expect(putRes.ok).toBe(true);

        const confirmRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/confirm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: presigned.key, contentType: 'image/png' }),
        });
        expect(confirmRes.status).toBe(201);
        const photo = (await confirmRes.json()) as PhotoBody;
        const thumbnailKey = recipePhotoThumbnailKey(photo.key);

        // Both objects genuinely exist in LocalStack before delete.
        expect(await isDeleted(s3, photosBucket, photo.key)).toBe(false);
        expect(await isDeleted(s3, photosBucket, thumbnailKey)).toBe(false);

        invalidateSpy = vi.spyOn(cdn, 'invalidate');

        const deleteRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/${photo.id}`, { method: 'DELETE' });
        expect(deleteRes.status).toBe(204);

        // 1. Both S3 objects are genuinely gone (real HEAD 404s, not a mocked assertion).
        expect(await isDeleted(s3, photosBucket, photo.key)).toBe(true);
        expect(await isDeleted(s3, photosBucket, thumbnailKey)).toBe(true);

        // 2. The real production wiring invoked the CDN port with BOTH paths, in ONE call.
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expect(invalidateSpy).toHaveBeenCalledWith(expect.arrayContaining([`/${photo.key}`, `/${thumbnailKey}`]));

        // 3. The photo no longer appears in the recipe's list.
        const listRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos`);
        const list = (await listRes.json()) as PhotoBody[];
        expect(list.some((entry) => entry.id === photo.id)).toBe(false);
    });

    it('404s deleting an already-deleted (or unknown) photo id', async () => {
        const deleteRes = await fetch(
            `${baseUrl}/api/v1/recipes/${recipeId}/photos/00000000-0000-4000-8000-00000000dead`,
            {
                method: 'DELETE',
            },
        );
        expect(deleteRes.status).toBe(404);
    });
});
