/**
 * T035 — the real S3 adapter behind {@link PhotoStoragePort}.
 *
 * Wraps an `@aws-sdk/client-s3` `S3Client` and `getSignedUrl` (`@aws-sdk/s3-request-presigner`) into the
 * narrow port the {@link PhotosService} depends on. Isolating the SDK here keeps the service unit-testable
 * against a mock port (no network), while this adapter is exercised by the LocalStack integration spec.
 *
 * @sideEffect Every method issues an S3 request (presign is offline; reads/HEAD hit S3).
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { PhotoStoragePort, PresignedUpload, PresignUploadInput } from './photos.service.js';

/** Config the S3 adapter needs (sourced from the service's storage config). */
export interface S3PhotoStorageConfig {
    /** The photos bucket name (`S3_BUCKET_PHOTOS`). */
    readonly bucket: string;
    /** AWS region for the client. */
    readonly region: string;
    /** Custom endpoint (LocalStack) — omit for real AWS. */
    readonly endpoint?: string;
    /** Force path-style addressing (required for LocalStack). */
    readonly forcePathStyle: boolean;
    /** Presigned URL TTL in seconds (`PRESIGNED_URL_EXPIRY_SECONDS`). */
    readonly presignExpirySeconds: number;
}

/**
 * Build a {@link PhotoStoragePort} over a real `S3Client`. The client is created once and closed by the
 * process lifecycle (Nest never disposes singletons mid-run).
 */
export function createS3PhotoStorage(config: S3PhotoStorageConfig): PhotoStoragePort {
    const client = new S3Client({
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        // Presigned PUTs are uploaded by a plain HTTP client (the browser/mobile app), NOT the SDK, so the
        // aws-sdk v3 default flexible-checksum behavior bakes an `x-amz-checksum-crc32` header into the
        // signed request that the uploader can't reproduce → S3/LocalStack reject it with 400. Only attach
        // checksums when the operation strictly requires them, so the presigned PUT is uploadable as-is.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        // A custom endpoint means LocalStack (per config docs: "omit for real AWS"). Pin static test
        // credentials so presigning is deterministic and self-contained rather than depending on ambient
        // host/CI AWS config. Real AWS keeps the default credential chain (task role).
        ...(config.endpoint !== undefined
            ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
            : {}),
    });

    return {
        async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
            // A presigned PUT signs the object key + content type; the 5 MB bound is enforced
            // authoritatively at `confirm` (S3 HEAD), since a presigned PUT cannot carry a size range.
            const command = new PutObjectCommand({
                Bucket: config.bucket,
                Key: input.s3Key,
                ContentType: input.contentType,
            });

            const uploadUrl = await getSignedUrl(client, command, { expiresIn: config.presignExpirySeconds });

            return { uploadUrl, expiresIn: config.presignExpirySeconds };
        },

        async readMagicBytes(s3Key: string, byteCount: number): Promise<Uint8Array> {
            const response = await client.send(
                new GetObjectCommand({ Bucket: config.bucket, Key: s3Key, Range: `bytes=0-${byteCount - 1}` }),
            );

            if (response.Body === undefined) {
                return new Uint8Array();
            }

            return response.Body.transformToByteArray();
        },

        async headSize(s3Key: string): Promise<number | undefined> {
            const response = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: s3Key }));

            return response.ContentLength;
        },
    };
}
