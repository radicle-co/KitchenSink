/**
 * CDN-invalidation integration coverage for the GDPR account-erasure worker (HAZ-051/067/039).
 *
 * **Why this drives the pieces directly rather than `handler`/`processRecord`.** Like the sibling
 * `s3-erasure.integration.spec.ts` and `account-erasure.integration.spec.ts`, this cannot boot the
 * handler end to end against local Postgres: the handler's own `getRecipeDb()` mints an RDS-IAM auth
 * token no local Postgres can honour. So this proves the SAME two real steps `processRecord` performs in
 * sequence, composed together against genuine backends:
 *   1. `eraseRecipeObjects` (real S3, LocalStack) actually removes every object under the owner's media
 *      prefix — re-used rather than re-asserted (the S3 sweep itself is already pinned by
 *      `s3-erasure.integration.spec.ts`); this test's own assertion is that the objects are REALLY gone.
 *   2. `createCloudFrontInvalidation` (the real adapter, `@aws-sdk/client-cloudfront` MOCKED — LocalStack
 *      Community has no CloudFront support, `docker-compose.test.yml`'s `SERVICES` is `s3,sqs` only)
 *      issues a `CreateInvalidationCommand` for EXACTLY `cdnOwnerPrefixInvalidationPath(ownerId)` — the
 *      identical prefix `eraseRecipeObjects` just swept, proving the two steps stay in lockstep rather
 *      than independently drifting onto different owner-prefix strings.
 *
 * The worker's ORCHESTRATION (invalidate after the media sweep, before the archive sweep, non-terminal on
 * failure) is pinned at the unit tier (`src/handlers/__tests__/account-erasure-worker.test.ts`, which
 * mocks `common/cdn-invalidation.js` and asserts ordering via a rendered timeline) — this tier's job is
 * proving the REAL S3 sweep and the REAL CloudFront-adapter code path (distribution-id-set branch) each
 * work, and agree on the SAME owner prefix, against genuine (or, for CloudFront, the closest-available)
 * infrastructure.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { cdnOwnerPrefixInvalidationPath } from '@kitchensink/recipe-core';

import { eraseRecipeObjects, ownerMediaPrefix } from '../../../src/handlers/account-erasure-worker.js';

const { cloudFrontSend } = vi.hoisted(() => ({ cloudFrontSend: vi.fn().mockResolvedValue({}) }));

vi.mock('@aws-sdk/client-cloudfront', () => ({
    CloudFrontClient: vi.fn(function () {
        return { send: cloudFrontSend };
    }),
    CreateInvalidationCommand: vi.fn(function (input: unknown) {
        return { command: 'CreateInvalidation', input };
    }),
}));

import { createCloudFrontInvalidation } from '../../../src/common/cdn-invalidation.js';

const S3_ENDPOINT = process.env['S3_ENDPOINT'];
const hasS3Endpoint = Boolean(S3_ENDPOINT);

const OWNER = '01JCDNERASE0000000000OWNER';

const makeClient = (): S3Client =>
    new S3Client({
        endpoint: S3_ENDPOINT,
        region: process.env['AWS_REGION'] ?? 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

describe.skipIf(!hasS3Endpoint)('account-erasure worker — CDN invalidation after the real media sweep', () => {
    let client: S3Client;
    let bucket: string;

    beforeAll(async () => {
        client = makeClient();
        bucket = `recipe-workers-cdn-it-${Date.now()}`;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
    });

    beforeEach(() => {
        cloudFrontSend.mockClear();
        cloudFrontSend.mockResolvedValue({});
    });

    afterAll(() => {
        client?.destroy();
    });

    it('invalidates the EXACT owner prefix that was just, for real, swept from S3', async () => {
        await client.send(
            new PutObjectCommand({ Bucket: bucket, Key: `${ownerMediaPrefix(OWNER)}r1/cover.jpg`, Body: 'a' }),
        );
        await client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: `${ownerMediaPrefix(OWNER)}r1/cover.jpg.thumb.jpg`,
                Body: 'b',
            }),
        );

        const deleted = await eraseRecipeObjects(client, bucket, OWNER, 'r1');
        expect(deleted).toBe(2);

        // Genuinely gone from S3 — not a mocked assertion.
        const remaining = await client.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: ownerMediaPrefix(OWNER) }),
        );
        expect(remaining.Contents ?? []).toHaveLength(0);

        const cdn = createCloudFrontInvalidation({ distributionId: 'E1234567890' });
        await cdn.invalidate([cdnOwnerPrefixInvalidationPath(OWNER)]);

        expect(cloudFrontSend).toHaveBeenCalledTimes(1);
        const [call] = cloudFrontSend.mock.calls[0] as [{ command: string; input: Record<string, unknown> }];
        expect(call.command).toBe('CreateInvalidation');
        expect(call.input).toMatchObject({
            DistributionId: 'E1234567890',
            InvalidationBatch: {
                // The SAME prefix the sweep above just emptied — proves the two steps cannot silently
                // diverge (both are derived from `ownerMediaPrefix`/`cdnOwnerPrefixInvalidationPath`).
                Paths: { Quantity: 1, Items: [`/${ownerMediaPrefix(OWNER)}*`] },
            },
        });
    });

    it('the unset-distribution no-op never calls CloudFront, even after a real S3 sweep', async () => {
        await client.send(
            new PutObjectCommand({ Bucket: bucket, Key: `${ownerMediaPrefix(OWNER)}r2/cover.jpg`, Body: 'a' }),
        );
        await eraseRecipeObjects(client, bucket, OWNER, 'r2');

        const cdn = createCloudFrontInvalidation({});
        await expect(cdn.invalidate([cdnOwnerPrefixInvalidationPath(OWNER)])).resolves.toBeUndefined();

        expect(cloudFrontSend).not.toHaveBeenCalled();
    });
});
