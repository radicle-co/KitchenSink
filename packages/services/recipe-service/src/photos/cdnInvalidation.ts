/**
 * The real CloudFront adapter behind {@link CdnInvalidationPort} (HAZ-051/067/039).
 *
 * Wraps `@aws-sdk/client-cloudfront`'s `CreateInvalidationCommand`, mirroring how `photos.storage.ts`
 * wraps `@aws-sdk/client-s3` into `PhotoStoragePort` — each infra dependency gets its own thin
 * adapter isolated behind the port the service depends on, so `PhotosService` stays unit-testable against
 * a mock port with no network.
 *
 * **No `Distribution` construct exists anywhere in this repo's CDK** (see `photos.module.ts`'s
 * `cloudfrontUrl` doc) — the distribution is provisioned and owned OUTSIDE this repo, so the only thing
 * this service can be handed is its id, via `CLOUDFRONT_DISTRIBUTION_ID`. That id is genuinely OPTIONAL
 * (local/dev and any stage without a provisioned distribution yet have none), so this factory returns a
 * documented NO-OP port — never a port that throws — when the id is absent or blank: a delete/erasure
 * request must never fail, and a stage must never fail to BOOT, merely because the CDN side of a
 * best-effort privacy mitigation isn't wired up yet. See `PhotosService.invalidateDeletedPhoto` for
 * how the caller treats a real (configured) adapter's failure, which is different from — and stricter
 * than — this unset-id case.
 */
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';

import type { CdnInvalidationPort } from '@kitchensink/recipe-core';

/** Config the CloudFront adapter needs (sourced from the service's storage config). */
export interface CloudFrontInvalidationConfig {
    /** The CloudFront distribution id (`CLOUDFRONT_DISTRIBUTION_ID`). Unset/blank → the no-op adapter. */
    readonly distributionId?: string;
    /** AWS region for the CloudFront control-plane client. Defaults to `us-east-1`. */
    readonly region?: string;
}

const logger = new Logger('CloudFrontInvalidation');

/**
 * Build a {@link CdnInvalidationPort}: a real adapter over `CloudFrontClient` when `distributionId` is
 * set, or a logging no-op when it is unset/blank.
 *
 * The no-op branch constructs NO `CloudFrontClient` at all (not merely one that is never called) — there
 * is nothing to configure it against, and skipping construction keeps an unconfigured stage from paying
 * even the cost of an idle AWS SDK client.
 */
export function createCloudFrontInvalidation(config: CloudFrontInvalidationConfig): CdnInvalidationPort {
    const distributionId = config.distributionId?.trim();

    if (distributionId === undefined || distributionId === '') {
        return {
            async invalidate(paths: string[]): Promise<void> {
                logger.warn(
                    `CLOUDFRONT_DISTRIBUTION_ID is unset — skipping CDN invalidation for ${paths.length} path(s). ` +
                        'A deleted/erased photo may remain reachable via a CloudFront edge cache until TTL expiry.',
                );
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
                        // A fresh, unique reference per call — CreateInvalidation is idempotent PER
                        // CallerReference (a retried reference returns the SAME invalidation rather than
                        // creating a duplicate), so a stable value here would make a genuinely NEW
                        // invalidation request silently no-op against a stale prior one.
                        CallerReference: randomUUID(),
                        Paths: { Quantity: paths.length, Items: paths },
                    },
                }),
            );
        },
    };
}
