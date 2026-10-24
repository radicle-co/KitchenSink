/**
 * The avatar media configuration (ADR-0064): the bucket the objects live in, the CDN they are served from, and the
 * distribution to invalidate when one is deleted or replaced.
 *
 * ⛔ NO DEFAULT BUCKET. A deployed stage THROWS at boot when any of the three is missing, and an undeployed process with
 * no bucket gets an avatar path that refuses every call (`unconfiguredAvatarMedia` in `users/avatarMedia.ts`). A guessed
 * bucket would presign uploads into one nobody owns and answer 200.
 *
 * @module
 */
import { isDeployedStage } from './env.schema.js';

/** The resolved media configuration. */
export interface MediaConfig {
    readonly bucket: string;
    /** The CDN base URL a stored key is served from, e.g. `https://media.commise.app`. */
    readonly cdnUrl: string;
    /** The distribution to invalidate. Absent only off a deployed stage, where invalidation is a logged no-op. */
    readonly distributionId?: string;
    /** A custom S3 endpoint (LocalStack). Never set on a deployed stage. */
    readonly endpoint?: string;
}

/** Raised when a deployed stage is missing a media setting. */
export class MediaConfigError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'MediaConfigError';
        Object.setPrototypeOf(this, MediaConfigError.prototype);
    }
}

/** Type guard for {@link MediaConfigError}. */
export function isMediaConfigError(error: unknown): error is MediaConfigError {
    return error instanceof MediaConfigError;
}

const present = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();

    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

/**
 * Resolve the media configuration from the environment. Pure.
 *
 * @param env - The environment (injected, so every branch is testable).
 * @returns The configuration, or `undefined` off a deployed stage when no bucket is set.
 * @throws {MediaConfigError} on a deployed stage when `MEDIA_BUCKET_NAME`, `MEDIA_CDN_URL` or `MEDIA_DISTRIBUTION_ID` is
 *   missing or blank.
 */
export function resolveMediaConfig(env: Readonly<Record<string, string | undefined>>): MediaConfig | undefined {
    const bucket = present(env['MEDIA_BUCKET_NAME']);
    const cdnUrl = present(env['MEDIA_CDN_URL']);
    const distributionId = present(env['MEDIA_DISTRIBUTION_ID']);

    if (isDeployedStage(env['STAGE'] ?? 'dev')) {
        const missing = (
            [
                ['MEDIA_BUCKET_NAME', bucket],
                ['MEDIA_CDN_URL', cdnUrl],
                ['MEDIA_DISTRIBUTION_ID', distributionId],
            ] as const
        )
            .filter(([, value]) => value === undefined)
            .map(([name]) => name);

        if (bucket === undefined || cdnUrl === undefined || distributionId === undefined) {
            throw new MediaConfigError(
                `${missing.join(', ')} must be set on deployed stage '${env['STAGE'] ?? ''}': there is no default bucket or CDN`,
            );
        }

        return { bucket, cdnUrl, distributionId };
    }

    if (bucket === undefined) {
        return undefined;
    }

    const endpoint = present(env['S3_ENDPOINT']);

    return {
        bucket,
        cdnUrl: cdnUrl ?? (endpoint === undefined ? `https://${bucket}.s3.amazonaws.com` : `${endpoint}/${bucket}`),
        ...(distributionId === undefined ? {} : { distributionId }),
        ...(endpoint === undefined ? {} : { endpoint }),
    };
}
