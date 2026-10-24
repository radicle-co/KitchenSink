/**
 * The recipe-workers CloudFront adapter behind `CdnInvalidationPort` (`@kitchensink/recipe-core`),
 * HAZ-051/067/039 — purging the CDN edge cache for an owner's media prefix as part of GDPR account
 * erasure.
 *
 * Wraps `@aws-sdk/client-cloudfront`'s `CreateInvalidationCommand`, mirroring how
 * `accountErasureWorker.ts` wraps `@aws-sdk/client-s3` directly (this package is plain Lambda handlers,
 * not a NestJS DI app, so there is no shared adapter/port registry — each infra call is wrapped locally).
 * Deliberately a SEPARATE implementation from `recipe-service/src/photos/cdnInvalidation.ts` rather than
 * a shared adapter package: the two packages are different runtimes with different construction/logging
 * conventions, the same reason each package already wraps `@aws-sdk/client-s3` independently. Both
 * implement the SAME `CdnInvalidationPort` contract (`@kitchensink/recipe-core`), so the two packages can
 * never drift on WHAT an invalidation call means — only on how each constructs the client.
 *
 * The media distribution (ADR-0064) is provisioned by the global app and its id reaches every erasure Lambda from SSM.
 * {@link distributionIdFromEnv} makes it REQUIRED on a deployed stage: a deployed invocation without it throws, which
 * is what keeps the erasure job non-terminal (SQS redelivers, the dead-letter alarm fires) instead of erasing the S3
 * object and leaving its photo served from the edge. This factory's no-op for an unset id is for a developer machine
 * only. See `accountErasureWorker.ts` for how a REAL adapter's failure is treated: it is allowed to throw, and that
 * throw is what keeps the erasure job non-terminal until the invalidation request has actually been submitted.
 */
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { randomUUID } from 'node:crypto';
import type { CdnInvalidationPort } from '@kitchensink/recipe-core';

import { logger } from './logger.js';

/** The stages where nothing is deployed: invalidation is a logged no-op there. Every other value is a deployed one. */
const UNDEPLOYED_STAGES = new Set(['dev', 'test', 'local']);

/**
 * The media distribution id from the Lambda's environment, REQUIRED on a deployed stage.
 *
 * An unset `STAGE` counts as deployed: an unknown environment must fail closed, not silently skip a purge.
 *
 * @param env - The environment (injected for tests).
 * @returns The id, or `undefined` on an undeployed stage with none set.
 * @throws {Error} when a deployed stage has no `MEDIA_DISTRIBUTION_ID`.
 */
export function distributionIdFromEnv(env: Readonly<Record<string, string | undefined>>): string | undefined {
    const id = env['MEDIA_DISTRIBUTION_ID']?.trim();

    if (id !== undefined && id !== '') {
        return id;
    }

    if (UNDEPLOYED_STAGES.has(env['STAGE'] ?? '')) {
        return undefined;
    }

    throw new Error(
        'MEDIA_DISTRIBUTION_ID is required on a deployed stage (ADR-0064): the media distribution id is read ' +
            'from SSM /kitchensink/{baseStage}/media/distribution-id. Refusing to erase media without purging its edge.',
    );
}

/** Config the CloudFront adapter needs. */
export interface CloudFrontInvalidationConfig {
    /** The CloudFront distribution id (`MEDIA_DISTRIBUTION_ID`). Unset/blank → the no-op adapter. */
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
                logger.warn('MEDIA_DISTRIBUTION_ID unset — skipping CDN invalidation', {
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
