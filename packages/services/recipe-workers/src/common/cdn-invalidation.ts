/**
 * The recipe-workers CloudFront adapter behind `CdnInvalidationPort` (`@kitchensink/recipe-core`),
 * HAZ-051/067/039 — purging the CDN edge cache for an owner's media prefix as part of GDPR account
 * erasure.
 *
 * Wraps `@aws-sdk/client-cloudfront`'s `CreateInvalidationCommand`, mirroring how
 * `account-erasure-worker.ts` wraps `@aws-sdk/client-s3` directly (this package is plain Lambda handlers,
 * not a NestJS DI app, so there is no shared adapter/port registry — each infra call is wrapped locally).
 * Deliberately a SEPARATE implementation from `recipe-service/src/photos/cdn-invalidation.ts` rather than
 * a shared adapter package: the two packages are different runtimes with different construction/logging
 * conventions, the same reason each package already wraps `@aws-sdk/client-s3` independently. Both
 * implement the SAME `CdnInvalidationPort` contract (`@kitchensink/recipe-core`), so the two packages can
 * never drift on WHAT an invalidation call means — only on how each constructs the client.
 *
 * **No `Distribution` construct exists anywhere in this repo's CDK** — the distribution is provisioned
 * outside it, so `CLOUDFRONT_DISTRIBUTION_ID` is genuinely OPTIONAL. When absent/blank, this factory
 * returns a documented NO-OP port (logs a warning, never throws) rather than a port that fails erasure or
 * crashes the Lambda — see `account-erasure-worker.ts` for how a REAL (configured) adapter's failure is
 * treated differently: it is allowed to throw, and that throw is what keeps the erasure job non-terminal
 * until the invalidation request has actually been submitted.
 */
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { randomUUID } from 'node:crypto';
import type { CdnInvalidationPort } from '@kitchensink/recipe-core';

import { logger } from './logger.js';

/** Config the CloudFront adapter needs. */
export interface CloudFrontInvalidationConfig {
    /** The CloudFront distribution id (`CLOUDFRONT_DISTRIBUTION_ID`). Unset/blank → the no-op adapter. */
    readonly distributionId?: string;
    /** AWS region for the CloudFront control-plane client. Defaults to `us-east-1`. */
    readonly region?: string;
}

/**
 * Build a {@link CdnInvalidationPort}: a real adapter over `CloudFrontClient` when `distributionId` is
 * set, or a logging no-op when it is unset/blank. No `CloudFrontClient` is constructed at all in the
 * no-op case — there is nothing to configure it against.
 */
export function createCloudFrontInvalidation(config: CloudFrontInvalidationConfig): CdnInvalidationPort {
    const distributionId = config.distributionId?.trim();

    if (distributionId === undefined || distributionId === '') {
        return {
            async invalidate(paths: string[]): Promise<void> {
                logger.warn('CLOUDFRONT_DISTRIBUTION_ID unset — skipping CDN invalidation', {
                    pathCount: paths.length,
                });
            },
        };
    }

    const client = new CloudFrontClient({ region: config.region ?? 'us-east-1' });

    return {
        async invalidate(paths: string[]): Promise<void> {
            if (paths.length === 0) {
                return;
            }

            await client.send(
                new CreateInvalidationCommand({
                    DistributionId: distributionId,
                    InvalidationBatch: {
                        // A fresh reference per call, as required by CreateInvalidation (see the matching
                        // note in recipe-service's adapter): a stable reference would make a genuinely new
                        // request silently no-op against a stale prior invalidation.
                        CallerReference: randomUUID(),
                        Paths: { Quantity: paths.length, Items: paths },
                    },
                }),
            );
        },
    };
}
