/**
 * The CDN-invalidation seam for avatars (ADR-0064): purge the CloudFront edge cache after an avatar object is deleted
 * or replaced, so a erased or superseded photograph stops being served.
 *
 * ⚠️ A LOCAL port, structurally the same one-method contract as `@kitchensink/recipe-core`'s `CdnInvalidationPort`, on
 * purpose. That package is the recipe domain's (it also owns recipe object keys); identity sits upstream of recipe and
 * must not acquire a dependency on it, in its source or in its container image, for one interface. Each service already
 * implements its own adapter against this shape.
 *
 * @pattern Adapter — over `@aws-sdk/client-cloudfront`
 * @module
 */
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { randomUUID } from 'node:crypto';

/** The narrow "invalidate these CloudFront paths" seam. */
export interface CdnInvalidationPort {
    /**
     * Invalidate paths (each leading-slash-anchored; a path may end in `*`). REJECTS when CloudFront refuses: a caller
     * that erases a user's photograph must know the edge copy was not purged.
     *
     * @sideEffect Issues a CloudFront `CreateInvalidation` request.
     */
    invalidate(paths: readonly string[]): Promise<void>;
}

/**
 * The CloudFront-backed port.
 *
 * @param distributionId - The media distribution id.
 * @returns The port.
 */
export function createCloudFrontInvalidation(distributionId: string): CdnInvalidationPort {
    // The CloudFront control plane is global and signs in us-east-1.
    const client = new CloudFrontClient({ region: 'us-east-1' });

    return {
        async invalidate(paths) {
            if (paths.length === 0) {
                return;
            }

            await client.send(
                new CreateInvalidationCommand({
                    DistributionId: distributionId,
                    InvalidationBatch: {
                        // A fresh reference per call: a reused one would silently no-op a genuinely new request.
                        CallerReference: randomUUID(),
                        Paths: { Quantity: paths.length, Items: [...paths] },
                    },
                }),
            );
        },
    };
}

/**
 * The port for a process with no distribution (local development, tests): it invalidates nothing and says so.
 *
 * @returns A no-op port. Never constructed on a deployed stage, where the configuration requires a distribution.
 */
export function noopCdnInvalidation(): CdnInvalidationPort {
    return {
        invalidate() {
            return Promise.resolve();
        },
    };
}
