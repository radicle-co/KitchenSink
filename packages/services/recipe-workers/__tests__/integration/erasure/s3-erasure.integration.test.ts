import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    CreateBucketCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';

import { recipeMediaPrefix, recipePhotoThumbnailKey } from '@kitchensink/recipe-core';

import { eraseRecipeObjects, ownerMediaPrefix } from '../../../src/handlers/account-erasure-worker.js';
import { snapshotObjectKey } from '../../../src/handlers/version-archive-worker.js';

/**
 * S3-backed integration coverage for the recipe workers, exercised against a real S3 API (LocalStack
 * from the repo test harness). Unlike the unit suites (which mock `send`), this proves the list →
 * delete → recount loop and the archive key round-trip against genuine S3 semantics — including
 * prefix scoping (one owner's erase never touches another's) and idempotent replay.
 *
 * Runs only when `S3_ENDPOINT` is set (CI provides LocalStack); otherwise skipped in lockstep. Docker
 * is required, so it does not run on a bare `npm test` — see `npm run test:integration`.
 */

const S3_ENDPOINT = process.env['S3_ENDPOINT'];
const hasS3Endpoint = Boolean(S3_ENDPOINT);

const OWNER_A = '01JOWNERA000000000000000AA';
const OWNER_B = '01JOWNERB000000000000000BB';
const OWNER_C = '01JOWNERC000000000000000CC';

const makeClient = (): S3Client =>
    new S3Client({
        endpoint: S3_ENDPOINT,
        region: process.env['AWS_REGION'] ?? 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

const putObject = (client: S3Client, bucket: string, key: string, body: string): Promise<unknown> =>
    client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));

const listKeys = async (client: S3Client, bucket: string, prefix: string): Promise<string[]> => {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));

    return (listed.Contents ?? []).flatMap((entry) => (entry.Key ? [entry.Key] : []));
};

describe.skipIf(!hasS3Endpoint)('recipe-workers S3 integration', () => {
    let client: S3Client;
    let bucket: string;

    beforeAll(async () => {
        client = makeClient();
        bucket = `recipe-workers-it-${Date.now()}`;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
    });

    afterAll(() => {
        client?.destroy();
    });

    it('erases only the target REMOVED recipe’s media and reports the deleted count, idempotently', async () => {
        // Two objects of OWNER_A's removed recipe `r1`, plus an object of OWNER_B's recipe `r9`.
        await putObject(client, bucket, `${recipeMediaPrefix(OWNER_A, 'r1')}cover.jpg`, 'a1');
        await putObject(client, bucket, `${recipeMediaPrefix(OWNER_A, 'r1')}step-1.jpg`, 'a2');
        await putObject(client, bucket, `${recipeMediaPrefix(OWNER_B, 'r9')}cover.jpg`, 'b1');

        const deleted = await eraseRecipeObjects(client, bucket, OWNER_A, 'r1');

        expect(deleted).toBe(2);
        expect(await listKeys(client, bucket, recipeMediaPrefix(OWNER_A, 'r1'))).toEqual([]);
        // Per-recipe scoping: the other owner's recipe object is untouched.
        expect(await listKeys(client, bucket, ownerMediaPrefix(OWNER_B))).toEqual([
            `${recipeMediaPrefix(OWNER_B, 'r9')}cover.jpg`,
        ]);

        // Idempotent replay over an already-swept recipe deletes nothing.
        expect(await eraseRecipeObjects(client, bucket, OWNER_A, 'r1')).toBe(0);
    });

    it('erases the cover-thumbnail rendition together with its recipe (FOLLOW-UP-CR-001-A containment)', async () => {
        // The thumbnail is a NEW recipe-scoped object. Its right-to-erasure guarantee is structural: the
        // key is derived by `recipePhotoThumbnailKey` (append), so it lives under the SAME per-recipe prefix
        // the scoped sweep lists. This proves that through the REAL sweep — plant an original photo AND its
        // thumbnail, sweep the removed recipe, and assert BOTH are gone.
        const originalKey = `${recipeMediaPrefix(OWNER_C, 'r1')}photos/00000000-0000-4000-8000-0000000000c1`;
        const thumbnailKey = recipePhotoThumbnailKey(originalKey);

        expect(thumbnailKey.startsWith(recipeMediaPrefix(OWNER_C, 'r1'))).toBe(true);

        await putObject(client, bucket, originalKey, 'original-bytes');
        await putObject(client, bucket, thumbnailKey, 'thumbnail-bytes');

        const deleted = await eraseRecipeObjects(client, bucket, OWNER_C, 'r1');

        // Both the original and its derived thumbnail were swept.
        expect(deleted).toBe(2);
        expect(await listKeys(client, bucket, recipeMediaPrefix(OWNER_C, 'r1'))).toEqual([]);
    });

    it('writes and reads back a version snapshot at the deterministic key', async () => {
        // ARCH-BE-3: the archive is keyed by the client-facing versionNumber, not the internal
        // versionId, and the body is the RecipeVersion wire contract.
        const message = {
            ownerId: OWNER_A,
            recipeId: 'rec-1',
            versionId: 'ver-1',
            versionNumber: 4,
            requestedAt: '2026-07-10T00:00:00.000Z',
        };
        const key = snapshotObjectKey(message);
        const snapshot = {
            id: 'ver-1',
            recipeId: 'rec-1',
            versionNumber: 4,
            snapshot: { version: 4, title: 'Soup', description: '', steps: [], ingredients: [] },
            createdBy: OWNER_A,
            createdAt: '2026-07-10T00:00:00.000Z',
        };

        await putObject(client, bucket, key, JSON.stringify(snapshot));

        const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await got.Body?.transformToString();

        expect(key).toBe(`recipes/${OWNER_A}/rec-1/versions/4.json`);
        expect(JSON.parse(body ?? '{}')).toEqual(snapshot);
    });
});
