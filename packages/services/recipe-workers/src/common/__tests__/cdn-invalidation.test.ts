/**
 * Unit tests for {@link createCloudFrontInvalidation} — the recipe-workers CloudFront adapter behind
 * `CdnInvalidationPort` (HAZ-051/067/039), consumed by the GDPR account-erasure worker.
 *
 * Mirrors `recipe-service/src/photos/__tests__/cdn-invalidation.test.ts`'s two behaviours (real
 * invalidation when a distribution id is configured; a documented, never-throwing no-op when it is not) —
 * the SAME contract, a separately-constructed adapter (this package is plain Lambda handlers, not a
 * NestJS DI app, so it builds its own client/logger rather than sharing recipe-service's).
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

describe('createCloudFrontInvalidation (recipe-workers)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cloudFrontSend.mockResolvedValue({});
    });

    describe('with a distribution id', () => {
        it('issues a CreateInvalidation request for the given paths, batched into ONE call', async () => {
            const port = createCloudFrontInvalidation({ distributionId: 'E1234567890' });

            await port.invalidate(['/recipes/01JOWNER/*']);

            expect(cloudFrontSend).toHaveBeenCalledTimes(1);
            const [call] = cloudFrontSend.mock.calls[0] as [{ command: string; input: Record<string, unknown> }];
            expect(call.command).toBe('CreateInvalidation');
            expect(call.input).toMatchObject({
                DistributionId: 'E1234567890',
                InvalidationBatch: { Paths: { Quantity: 1, Items: ['/recipes/01JOWNER/*'] } },
            });
        });

        it('does not call CloudFront at all for an empty path list', async () => {
            const port = createCloudFrontInvalidation({ distributionId: 'E1234567890' });

            await port.invalidate([]);

            expect(cloudFrontSend).not.toHaveBeenCalled();
        });

        it('propagates a CloudFront failure — the erasure worker relies on this to retry via SQS', async () => {
            cloudFrontSend.mockRejectedValueOnce(new Error('CloudFront throttled'));
            const port = createCloudFrontInvalidation({ distributionId: 'E1234567890' });

            await expect(port.invalidate(['/recipes/01JOWNER/*'])).rejects.toThrow('CloudFront throttled');
        });
    });

    describe('without a distribution id (documented no-op)', () => {
        it('never constructs a CloudFront client when unset', async () => {
            const port = createCloudFrontInvalidation({ distributionId: undefined });

            await port.invalidate(['/recipes/01JOWNER/*']);

            expect(cloudFrontClientCtor).not.toHaveBeenCalled();
            expect(cloudFrontSend).not.toHaveBeenCalled();
        });

        it('never constructs a CloudFront client when blank', async () => {
            const port = createCloudFrontInvalidation({ distributionId: '' });

            await port.invalidate(['/a']);

            expect(cloudFrontClientCtor).not.toHaveBeenCalled();
        });

        it('resolves cleanly (NEVER throws) so an unconfigured stage never breaks erasure', async () => {
            const port = createCloudFrontInvalidation({});

            await expect(port.invalidate(['/recipes/01JOWNER/*'])).resolves.toBeUndefined();
        });
    });
});
