/**
 * W8-a.7 — e2e proof of the transparent S3 version-load fallback through the fully ASSEMBLED recipe app,
 * against the real Postgres + LocalStack S3 harness. A version pruned past the last-10 DB retention window
 * must still be readable via `GET …/versions/{n}`: the endpoint reads the snapshot back from the S3 archive
 * and returns it in the SAME shape — the user never sees S3, so Preview/Compare work for ALL versions.
 *
 * Setup: create a recipe (v1) via the API; DELETE its recipe_versions row (simulating the archive worker's
 * prune); PUT the snapshot object to the archive bucket at the shared key; then GET the version. Skips
 * without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { recipeVersionArchiveKey } from '@kitchensink/recipe-core';
import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const S3_ENDPOINT = process.env['S3_ENDPOINT'] ?? 'http://localhost:4566';
const VERSIONS_BUCKET = process.env['S3_BUCKET_VERSIONS'] ?? 'commise-versions';

const OWNER = '01JARCHIVEE2E00OWNER00000A';

describe.skipIf(!hasDatabaseUrl)('transparent S3 version fallback (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;
    let s3: S3Client;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
        s3 = new S3Client({
            region: 'us-east-1',
            endpoint: S3_ENDPOINT,
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
        await pool.end();
        s3.destroy();
        await booted?.close();
    });

    it('reads a pruned version back from the S3 archive instead of 404', async () => {
        // 1) Create a recipe → v1, with a real recipe_versions row.
        const create = await fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Archive Fallback E2E',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1 }],
                steps: [{ instruction: 'Mix.' }],
            }),
        });
        expect(create.status).toBe(201);
        const recipeId = ((await create.json()) as { id: string }).id;

        // 2) Simulate the archive worker having pruned v1 from the DB (evicted past the retention window).
        await pool.query('DELETE FROM recipe_versions WHERE recipe_id = $1 AND version_number = 1', [recipeId]);

        // Sanity: the DB no longer has it, so without the fallback this would be a 404.
        // 3) PUT the archived snapshot object to S3 at the shared key.
        const key = recipeVersionArchiveKey({ ownerId: OWNER, recipeId, versionNumber: 1 });
        const archivedVersion = {
            id: '00000000-0000-4000-8000-0000000000e1',
            recipeId,
            versionNumber: 1,
            snapshot: {
                version: 1,
                title: 'Archive Fallback E2E',
                description: '',
                steps: [{ stepNumber: 1, instruction: 'Mix.' }],
                ingredients: [],
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
            },
            createdBy: OWNER,
            createdAt: '2026-07-19T00:00:00.000Z',
        };
        await s3.send(
            new PutObjectCommand({
                Bucket: VERSIONS_BUCKET,
                Key: key,
                ContentType: 'application/json',
                Body: JSON.stringify(archivedVersion),
            }),
        );

        // 4) GET the version → the endpoint transparently falls back to S3 (200, not 404).
        const res = await fetch(`${booted.baseUrl}/api/v1/recipes/${recipeId}/versions/1`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { versionNumber: number; snapshot: { title: string } };
        expect(body.versionNumber).toBe(1);
        expect(body.snapshot.title).toBe('Archive Fallback E2E');
    });
});
