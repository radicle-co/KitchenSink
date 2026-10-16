/**
 * AvatarStoragePort — the S3 side of avatars: presigning an upload, asking whether an object exists, and deleting the
 * objects under a user's prefix. The AWS SDK stays behind this seam, so the lifecycle logic in `UsersService` and
 * `AvatarMedia` is testable with a fake and the SDK never leaks into the domain flow.
 *
 * @pattern Adapter — over `@aws-sdk/client-s3`
 * @module
 */
import {
    DeleteObjectsCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** What the avatar flow needs from object storage. */
export interface AvatarStoragePort {
    /**
     * A short-lived presigned `PUT` for exactly this object: the signature binds the key, type and byte length.
     *
     * @sideEffect Signs a URL; no bytes traverse this service.
     */
    presignUpload(input: {
        readonly key: string;
        readonly contentType: string;
        readonly size: number;
    }): Promise<string>;

    /**
     * Whether the object exists. `false` only for a not-found; any other failure REJECTS, because "I could not ask" must
     * never read as "it is not there".
     *
     * @sideEffect Issues a `HEAD`.
     */
    exists(key: string): Promise<boolean>;

    /**
     * Delete every object under `prefix` except `keepKey`, paging through the listing.
     *
     * @returns How many objects were deleted.
     * @throws when the prefix is empty (it would list the whole bucket) or any S3 call fails.
     * @sideEffect Lists and deletes S3 objects.
     */
    deleteUnder(prefix: string, keepKey?: string): Promise<number>;
}

/** Configuration of the S3 adapter. */
export interface S3AvatarStorageConfig {
    readonly bucket: string;
    readonly region?: string;
    /** A custom endpoint (LocalStack). Switches to path-style addressing. */
    readonly endpoint?: string;
    /** Static credentials, for LocalStack and tests. Absent on AWS, where the task role is used. */
    readonly credentials?: { readonly accessKeyId: string; readonly secretAccessKey: string };
    /** An injected client (tests only). */
    readonly client?: Pick<S3Client, 'send'>;
}

/** How long a presigned upload stays valid. */
const PRESIGN_EXPIRES_SECONDS = 300;

/** Whether an SDK error means "no such object". */
function isNotFound(error: unknown): boolean {
    const { name, $metadata } = (error ?? {}) as { name?: string; $metadata?: { httpStatusCode?: number } };

    return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}

/**
 * Build the S3-backed {@link AvatarStoragePort}.
 *
 * @param config - Bucket and client settings.
 * @returns The port. The client is created once and lives for the process.
 */
export function createS3AvatarStorage(config: S3AvatarStorageConfig): AvatarStoragePort {
    const client: Pick<S3Client, 'send'> =
        config.client ??
        new S3Client({
            region: config.region ?? 'us-east-1',
            // ⛔ Presigned PUTs are uploaded by a plain HTTP client (browser/mobile), not the SDK. The SDK default
            // (`WHEN_SUPPORTED`) signs `x-amz-checksum-crc32` into the query, which that client cannot reproduce, so S3
            // answers 400 and no avatar could ever be stored (D3). Attach checksums only when the operation requires.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint, forcePathStyle: true }),
            ...(config.credentials === undefined ? {} : { credentials: config.credentials }),
        });

    return {
        async presignUpload({ key, contentType, size }) {
            const command = new PutObjectCommand({
                Bucket: config.bucket,
                Key: key,
                ContentType: contentType,
                ContentLength: size,
            });

            // `getSignedUrl` needs a full client; the injected test client is only used for the other operations.
            return getSignedUrl(client as S3Client, command, { expiresIn: PRESIGN_EXPIRES_SECONDS });
        },

        async exists(key) {
            try {
                await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));

                return true;
            } catch (error) {
                if (isNotFound(error)) {
                    return false;
                }

                throw error;
            }
        },

        async deleteUnder(prefix, keepKey) {
            if (prefix.trim() === '') {
                throw new Error('deleteUnder needs a non-empty prefix: an empty one would list the whole bucket');
            }

            let continuationToken: string | undefined;
            let deleted = 0;

            do {
                const listed = await client.send(
                    new ListObjectsV2Command({
                        Bucket: config.bucket,
                        Prefix: prefix,
                        ContinuationToken: continuationToken,
                    }),
                );
                const objects = (listed.Contents ?? [])
                    .map((object) => object.Key)
                    .filter((key): key is string => key !== undefined && key !== keepKey)
                    .map((key) => ({ Key: key }));

                if (objects.length > 0) {
                    await client.send(
                        new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: objects, Quiet: true } }),
                    );
                    deleted += objects.length;
                }

                continuationToken = listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
            } while (continuationToken !== undefined);

            return deleted;
        },
    };
}
