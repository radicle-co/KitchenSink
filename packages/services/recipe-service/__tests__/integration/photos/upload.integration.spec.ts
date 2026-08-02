/**
 * T100 — recipe-photo upload lifecycle integration test (real Nest app + Docker Postgres + LocalStack S3).
 *
 * Drives the full presign → upload → confirm flow end to end against the harness (booted by
 * `bootRecipeApp`, migrated + seeded — including the `commise-photos` bucket — by `tests/global-setup.ts`):
 *   1. create a recipe (photos FK-reference `recipes.id`),
 *   2. `POST …/photos/upload-url` → presigned S3 PUT (returns `200` + `{ uploadUrl, key, expiresIn, maxBytes }`),
 *   3. PUT real PNG bytes to LocalStack via that URL,
 *   4. `POST …/photos/confirm` → the service sniffs magic bytes (PNG) + HEADs size (≤ 5 MB) and inserts
 *      the `recipe_photos` row, returning the `RecipePhoto` `{ id, recipeId, key, url, contentType, order }`,
 *   5. the photo appears in `GET …/photos`.
 * A second pass uploads NON-image bytes and asserts `confirm` rejects them (422) with no row inserted.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup
 * (`describe.skipIf(!hasDatabaseUrl)`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { recipePhotoThumbnailKey } from '@kitchensink/recipe-core';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes + photos as. */
const OWNER = '01JPHOTO0OWNER0000000000AA';

/**
 * A REAL, decodable 1×1 PNG (base64) — the ONE valid-image fixture the upload flow is driven with. The
 * confirm path validates by structure via the `file-type` library (NOT a bare 8-byte signature check), so
 * a mere PNG signature padded with zero bytes is correctly rejected (verified: `file-type` returns
 * `undefined` for it → 422). This is a genuine PNG that `file-type` recognizes AND `sharp` can decode, so
 * it drives both the happy-path confirm and the thumbnail-rendition path. The graceful thumbnail-degrade
 * case (magic-valid but non-decodable → confirm still succeeds, no thumbnail) is covered by the service
 * unit tests (`photos.service.test.ts` "DEGRADES when the image cannot be resized").
 */
const REAL_PNG_BYTES = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
    ),
);

/** Bytes that are NOT a supported image (no JPEG/PNG/WebP signature) — `confirm` must reject these. */
const GARBAGE_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

const RECIPE_PAYLOAD = {
    title: 'Photo Integration Recipe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: ['integration'],
    dietaryFlags: [],
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000bb', name: 'Flour', quantity: 1 }],
    steps: [{ instruction: 'Mix.' }],
};

interface RecipeBody {
    id: string;
}

interface UploadUrlBody {
    uploadUrl: string;
    key: string;
    expiresIn: number;
    maxBytes: number;
}

interface PhotoBody {
    id: string;
    recipeId: string;
    key: string;
    url: string;
    contentType: string;
    order: number;
}

/** A valid `upload-url` request body for a PNG of the given size. */
function pngUploadRequest(fileSize: number): { fileName: string; contentType: string; fileSize: number } {
    return { fileName: 'dish.png', contentType: 'image/png', fileSize };
}

/** A recipe row as returned by the metadata list, carrying the derived cover URL when it has a cover. */
interface ListedRecipe {
    id: string;
    coverPhotoUrl?: string;
}

describe.skipIf(!hasDatabaseUrl)('recipe photo upload lifecycle (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let recipeId: string;
    let s3: S3Client;
    let photosBucket: string;

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

    it('presigns, uploads a PNG, confirms by magic bytes + HEAD size, and lists it', async () => {
        // 1. Presign an S3 PUT for a PNG (200 — no resource created yet).
        const presignRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(pngUploadRequest(REAL_PNG_BYTES.byteLength)),
        });
        expect(presignRes.status).toBe(200);
        const presigned = (await presignRes.json()) as UploadUrlBody;
        expect(presigned.uploadUrl).toContain('http');
        expect(presigned.key).toContain(recipeId);
        expect(presigned.expiresIn).toBeGreaterThan(0);
        expect(presigned.maxBytes).toBe(5 * 1024 * 1024);

        // 2. Upload the PNG bytes straight to S3 (LocalStack) via the presigned URL.
        const putRes = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: REAL_PNG_BYTES,
        });
        expect(putRes.ok).toBe(true);

        // 3. Confirm — the service sniffs the object (PNG) and HEADs its size, then inserts the row.
        const confirmRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/confirm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: presigned.key, contentType: 'image/png' }),
        });
        expect(confirmRes.status).toBe(201);
        const photo = (await confirmRes.json()) as PhotoBody;
        expect(photo.recipeId).toBe(recipeId);
        expect(photo.key).toBe(presigned.key);
        expect(photo.contentType).toBe('image/png'); // sniffed + surfaced
        expect(photo.url.endsWith(presigned.key)).toBe(true); // server-resolved CDN url
        expect(photo.order).toBe(1); // 1-based display position

        // 4. It appears in the recipe's photo list.
        const listRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos`);
        expect(listRes.status).toBe(200);
        const list = (await listRes.json()) as PhotoBody[];
        expect(list.some((entry) => entry.id === photo.id)).toBe(true);
    });

    it('generates a thumbnail under the owner prefix and serves it as the recipe cover (FOLLOW-UP-CR-001-A)', async () => {
        // A SECOND recipe, so its cover is unambiguously this test's photo (the first test's recipe already
        // has a photo). Upload a REAL, decodable PNG so the confirm path actually produces a rendition.
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...RECIPE_PAYLOAD, title: 'Thumbnail Cover Recipe' }),
        });
        const coverRecipeId = ((await createRes.json()) as RecipeBody).id;

        const presignRes = await fetch(`${baseUrl}/api/v1/recipes/${coverRecipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(pngUploadRequest(REAL_PNG_BYTES.byteLength)),
        });
        const presigned = (await presignRes.json()) as UploadUrlBody;

        const putRes = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: REAL_PNG_BYTES,
        });
        expect(putRes.ok).toBe(true);

        const confirmRes = await fetch(`${baseUrl}/api/v1/recipes/${coverRecipeId}/photos/confirm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: presigned.key, contentType: 'image/png' }),
        });
        expect(confirmRes.status).toBe(201);

        // 1. The thumbnail rendition object actually exists in S3, at the deterministic variant key BESIDE
        //    the original — under the owner erasure prefix (which is what makes GDPR erasure reach it).
        const thumbnailKey = recipePhotoThumbnailKey(presigned.key);
        const head = await s3.send(new HeadObjectCommand({ Bucket: photosBucket, Key: thumbnailKey }));
        expect(head.ContentType).toBe('image/jpeg');
        expect(head.ContentLength ?? 0).toBeGreaterThan(0);
        expect(thumbnailKey.startsWith(`recipes/${OWNER}/`)).toBe(true);

        // 2. The recipe LIST serves the THUMBNAIL (not the original) as the cover — the SC-009 win.
        const listRes = await fetch(`${baseUrl}/api/v1/recipes`);
        const list = (await listRes.json()) as { data: ListedRecipe[] };
        const listed = list.data.find((entry) => entry.id === coverRecipeId);
        expect(listed?.coverPhotoUrl).toBeDefined();
        expect(listed?.coverPhotoUrl?.endsWith(thumbnailKey)).toBe(true);
        expect(listed?.coverPhotoUrl).not.toBe(`${presigned.key}`); // not the full-size original key
    });

    it('rejects a confirm whose uploaded object is not a supported image (422, no row) — REQ-013 spoofed Content-Type', async () => {
        // The confirm body declares a spoofed `contentType: 'image/png'` (an allowlisted value) while the
        // OBJECT ACTUALLY UPLOADED is non-image garbage — ATP-013-C. The server must reject by the
        // object's real magic bytes, never by trusting this client-supplied header.
        const presignRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(pngUploadRequest(GARBAGE_BYTES.byteLength)),
        });
        const presigned = (await presignRes.json()) as UploadUrlBody;

        await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: GARBAGE_BYTES,
        });

        const confirmRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/confirm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: presigned.key, contentType: 'image/png' }),
        });
        expect(confirmRes.status).toBe(422);

        const listRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos`);
        const list = (await listRes.json()) as PhotoBody[];
        expect(list.some((entry) => entry.key === presigned.key)).toBe(false); // no row persisted
    });

    it('confirm persists the DETECTED content type, not a spoofed declared one (REQ-013)', async () => {
        // Presign + confirm both declare `image/jpeg`, but the object actually PUT to S3 is a real PNG —
        // proving the server's magic-byte detection (not the client-supplied Content-Type, on EITHER
        // request) is authoritative even on the accept path, not only the reject path covered above.
        const presignRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                fileName: 'dish.jpg',
                contentType: 'image/jpeg',
                fileSize: REAL_PNG_BYTES.byteLength,
            }),
        });
        const presigned = (await presignRes.json()) as UploadUrlBody;

        const putRes = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg' },
            body: REAL_PNG_BYTES,
        });
        expect(putRes.ok).toBe(true);

        const confirmRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/confirm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: presigned.key, contentType: 'image/jpeg' }),
        });
        expect(confirmRes.status).toBe(201);
        const photo = (await confirmRes.json()) as PhotoBody;
        expect(photo.contentType).toBe('image/png'); // the SNIFFED type wins, never the spoofed 'image/jpeg'
    });

    it('rejects an unsupported upload content type at presign time (415)', async () => {
        const res = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fileName: 'dish.heic', contentType: 'image/heic', fileSize: 1024 }),
        });
        expect(res.status).toBe(415);
    });
});
