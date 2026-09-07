/**
 * Contract-conformance test for the PHOTOS vertical (DIVERGENCE #1).
 *
 * Drives the REAL, hand-written `@kitchensink/recipe-service-client` against the REAL booted Nest app
 * (Docker Postgres + LocalStack S3), so the client's assumed wire contract and the server's actual
 * responses are proven to AGREE end to end. This is the missing test class that let the photo vertical
 * drift invisibly: the client sends `{ key, contentType }` and expects `{ uploadUrl, key, expiresIn,
 * maxBytes }` + a `RecipePhoto` of `{ id, recipeId, key, url, contentType, order, createdAt }`, while the
 * server historically required `s3Key` and returned `{ s3KeyOrig, cdnUrlBase, processingStatus, sortOrder }`
 * with a `201` on `upload-url` — so the presign 201'd through the client's `200` guard and the confirm
 * 400'd on the missing `s3Key`. The full presign → PUT → confirm → list flow was broken end to end.
 *
 * Because it uses the real client, every field name, HTTP status, and envelope shape is asserted by
 * construction (a drift re-breaks this test), and the response is validated against the canonical
 * `recipePhotoSchema` from `@kitchensink/recipe-core`.
 *
 * Runs only when the harness DB is configured — skipped in lockstep with the global setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { recipePhotoSchema } from '@kitchensink/recipe-core';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes + photos as. */
const OWNER = '01JPHOTOCONTRACT000000000A';

/** A REAL minimal 1×1 PNG (base64) — `file-type` parses the IHDR chunk, so a full image is the honest fixture. */
const PNG_BYTES = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    ),
);

describe.skipIf(!hasDatabaseUrl)('photos vertical — client ↔ server contract conformance', () => {
    let booted: BootedRecipeApp;
    let client: RecipeServiceClient;
    let recipeId: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        client = new RecipeServiceClient({ baseUrl: booted.baseUrl });

        // Seed the parent recipe through the typed client end to end (create now fully conforms — #5 + #8).
        const recipe = await client.createRecipe({
            title: 'Photo Contract Recipe',
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
            tags: ['contract'],
            dietaryFlags: [],
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-0000000000bb',
                    name: 'Flour',
                    quantity: { kind: 'exact', value: 1 },
                },
            ],
            steps: [{ instruction: 'Mix.' }],
        });
        recipeId = recipe.id;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('presigns, uploads, confirms, and lists a photo entirely through the typed client', async () => {
        // 1. Presign — the client sends { fileName, contentType, fileSize } and expects a 200 with
        //    { uploadUrl, key, expiresIn, maxBytes }.
        const presigned = await client.createPhotoUploadUrl(recipeId, {
            fileName: 'dish.png',
            contentType: 'image/png',
            fileSize: PNG_BYTES.byteLength,
        });
        expect(presigned.uploadUrl).toContain('http');
        expect(presigned.key).toContain(recipeId);
        expect(presigned.expiresIn).toBeGreaterThan(0);
        expect(presigned.maxBytes).toBe(5 * 1024 * 1024);

        // 2. Upload the PNG bytes straight to LocalStack via the presigned URL.
        const putRes = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: PNG_BYTES,
        });
        expect(putRes.ok).toBe(true);

        // 3. Confirm — the client sends { key, contentType }; the server sniffs the bytes and persists.
        const photo = await client.confirmPhotoUpload(recipeId, {
            key: presigned.key,
            contentType: 'image/png',
        });

        // The response is the canonical RecipePhoto contract, exactly.
        expect(recipePhotoSchema.safeParse(photo).success).toBe(true);
        expect(photo.recipeId).toBe(recipeId);
        expect(photo.key).toBe(presigned.key);
        expect(photo.contentType).toBe('image/png');
        expect(photo.order).toBe(1); // 1-based display position (first photo)
        expect(photo.url.endsWith(presigned.key)).toBe(true); // server-resolved CDN url

        // 4. It appears in the recipe's photo list, same shape.
        const list = await client.listRecipePhotos(recipeId);
        const listed = list.find((entry) => entry.id === photo.id);
        expect(listed).toBeDefined();
        expect(recipePhotoSchema.safeParse(listed).success).toBe(true);

        // 5. And it is EMBEDDED in the recipe detail (#10) — one round-trip renders the recipe + its photos.
        const detail = await client.getRecipeById(recipeId);
        expect(detail.photos.some((entry) => entry.id === photo.id)).toBe(true);
    });
});
