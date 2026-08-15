/**
 * The version-archive READ port (W8-a.7) — reads an immutable version snapshot back from the S3 archive
 * bucket for versions evicted past the last-`VERSION_RETENTION_LIMIT` DB retention window, so
 * `GET …/versions/{n}` (and compare/restore) work for ALL versions, not just the DB window. The user never
 * sees S3: the endpoint returns the archived object in the SAME `RecipeVersion` shape a DB row would.
 *
 * The version-archive WORKER (recipe-workers) writes these objects; this is the read side. Keyed by the
 * shared `recipeVersionArchiveKey` scheme so both address the identical object.
 *
 * @module
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { RecipeVersion } from '@kitchensink/recipe-core';

/** DI token for the {@link VersionArchiveReader}. */
export const VERSION_ARCHIVE_READER = 'VERSION_ARCHIVE_READER';

/** Reads a version snapshot object from the archive bucket, or `undefined` when the key is absent. */
export interface VersionArchiveReader {
    /**
     * Read the archived {@link RecipeVersion} at `key`, or `undefined` when no object exists there (the
     * version was never archived, or the id/number is bogus — the caller then surfaces a 404).
     */
    read(key: string): Promise<RecipeVersion | undefined>;
}

/** Config for {@link createS3VersionArchiveReader}. */
export interface S3VersionArchiveConfig {
    /** The archive bucket name (`S3_BUCKET_VERSIONS`). */
    readonly bucket: string;
    /** AWS region. */
    readonly region: string;
    /** Custom endpoint (LocalStack) — omit for real AWS. */
    readonly endpoint?: string;
    /** Force path-style addressing (LocalStack). */
    readonly forcePathStyle: boolean;
}

/**
 * Build a {@link VersionArchiveReader} over a real `S3Client`. A missing object (`NoSuchKey` / 404) resolves
 * to `undefined` rather than throwing — "not archived" is an ordinary outcome the caller maps to a 404.
 */
export function createS3VersionArchiveReader(config: S3VersionArchiveConfig): VersionArchiveReader {
    const client = new S3Client({
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        ...(config.endpoint !== undefined
            ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
            : {}),
    });

    return {
        async read(key: string): Promise<RecipeVersion | undefined> {
            try {
                const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));

                if (response.Body === undefined) {
                    return undefined;
                }

                return JSON.parse(await response.Body.transformToString()) as RecipeVersion;
            } catch (error) {
                if (isNotFound(error)) {
                    return undefined;
                }

                throw error;
            }
        },
    };
}

/** Whether an S3 error is a "no such key" (404) — the "not archived" case, distinct from a real fault. */
function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
        return false;
    }

    const name = (error as { name?: unknown }).name;
    const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;

    return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}
