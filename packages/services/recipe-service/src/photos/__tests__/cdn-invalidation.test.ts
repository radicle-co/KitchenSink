/**
 * Unit tests for {@link createCloudFrontInvalidation} — the real CloudFront adapter behind
 * {@link CdnInvalidationPort} (HAZ-051/067/039).
 *
 * Two behaviours, both load-bearing for a data-privacy boundary:
 *  - `CLOUDFRONT_DISTRIBUTION_ID` SET → issues a real `CreateInvalidationCommand` with the given paths.
 *  - `CLOUDFRONT_DISTRIBUTION_ID` UNSET (local/dev; no distribution exists in this repo's CDK — see the
 *    module docstring) → a documented NO-OP that logs a warning and NEVER throws, so an unconfigured
 *    stage can still boot and serve photo deletes/erasure without crashing.
 *
 * The `@aws-sdk/client-cloudfront` `send` call is mocked (no network); the assertions are on the exact
 * command shape, mirroring how `photos.storage.ts`'s real S3 adapter is exercised only by the LocalStack
 * integration spec — this file plays that role for the CloudFront adapter's CONSTRUCTION/no-op logic,
 * which the integration tier cannot cover (LocalStack Community has no CloudFront support).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cloudFrontSend, cloudFrontClientCtor } = vi.hoisted(() => ({
    cloudFrontSend: vi.fn().mockResolvedValue({}),
    cloudFrontClientCtor: vi.fn(),
}));

vi.mock('@aws-sdk/client-cloudfront', () => ({
    CloudFrontClient: vi.fn(function (this: unknown, config: unknown) {
        cloudFrontClientCtor(config);

        return { send: cloudFrontSend };
    }),
    CreateInvalidationCommand: vi.fn(function (input: unknown) {
        return { command: 'CreateInvalidation', input };
    }),
}));

import { createCloudFrontInvalidation } from '../cdn-invalidation.js';

describe('createCloudFrontInvalidation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cloudFrontSend.mockResolvedValue({});
    });

    describe('with CLOUDFRONT_DISTRIBUTION_ID set', () => {
        it('issues a CreateInvalidation request for the given paths, batched into ONE call', async () => {
            const port = createCloudFrontInvalidation({ distributionId: 'E1234567890' });

            await port.invalidate(['/recipes/owner/recipe/photos/a', '/recipes/owner/recipe/photos/a.thumb.jpg']);

            expect(cloudFrontSend).toHaveBeenCalledTimes(1);
            const [call] = cloudFrontSend.mock.calls[0] as [{ command: string; input: Record<string, unknown> }];
            expect(call.command).toBe('CreateInvalidation');
            expect(call.input).toMatchObject({
                DistributionId: 'E1234567890',
                InvalidationBatch: {
                    Paths: {
                        Quantity: 2,
                        Items: ['/recipes/owner/recipe/photos/a', '/recipes/owner/recipe/photos/a.thumb.jpg'],
                    },
                },
            });
        });

        it('gives every invalidation call a distinct CallerReference (CreateInvalidation requires it)', async () => {
            const port = createCloudFrontInvalidation({ distributionId: 'E1234567890' });

            await port.invalidate(['/a']);
            await port.invalidate(['/b']);

            const refs = cloudFrontSend.mock.calls.map(
                (call) =>
                    (call[0] as { input: { InvalidationBatch: { CallerReference: string } } }).input.InvalidationBatch
                        .CallerReference,
            );
            expect(refs[0]).not.toBe(refs[1]);
        });

        it('does not call CloudFront at all for an empty path list', async () => {
            const port = createCloudFrontInvalidation({ distributionId: 'E1234567890' });

            await port.invalidate([]);

            expect(cloudFrontSend).not.toHaveBeenCalled();
        });

        it('propagates a CloudFront failure to the caller (never swallowed by the adapter itself)', async () => {
            cloudFrontSend.mockRejectedValueOnce(new Error('CloudFront throttled'));
            const port = createCloudFrontInvalidation({ distributionId: 'E1234567890' });

            await expect(port.invalidate(['/a'])).rejects.toThrow('CloudFront throttled');
        });

        it('constructs the CloudFront client with the given region', () => {
            createCloudFrontInvalidation({ distributionId: 'E1234567890', region: 'eu-west-1' });

            expect(cloudFrontClientCtor).toHaveBeenCalledWith(expect.objectContaining({ region: 'eu-west-1' }));
        });
    });

    describe('with CLOUDFRONT_DISTRIBUTION_ID unset (documented no-op)', () => {
        it('never constructs a CloudFront client when the distribution id is undefined', async () => {
            const port = createCloudFrontInvalidation({ distributionId: undefined });

            await port.invalidate(['/recipes/owner/recipe/photos/a']);

            expect(cloudFrontClientCtor).not.toHaveBeenCalled();
            expect(cloudFrontSend).not.toHaveBeenCalled();
        });

        it('never constructs a CloudFront client when the distribution id is blank', async () => {
            const port = createCloudFrontInvalidation({ distributionId: '   ' });

            await port.invalidate(['/a']);

            expect(cloudFrontClientCtor).not.toHaveBeenCalled();
        });

        it('resolves cleanly (NEVER throws) so an unconfigured stage never crashes a delete/erasure', async () => {
            const port = createCloudFrontInvalidation({});

            await expect(port.invalidate(['/a', '/b'])).resolves.toBeUndefined();
        });
    });
});
