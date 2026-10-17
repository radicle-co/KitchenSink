/**
 * AvatarMedia — the one object the avatar flow talks to (ADR-0064): storage, the CDN that serves it, and the rule that
 * a removal is only DONE once the edge copy is purged too.
 *
 * @pattern Facade — over {@link AvatarStoragePort} and {@link CdnInvalidationPort}
 * @module
 */
import { avatarKeyPrefix } from '@kitchensink/identity-core';

import type { AvatarStoragePort } from './avatarStorage.js';
import type { CdnInvalidationPort } from './cdnInvalidation.js';

/** DI token for {@link AvatarMediaPort}. */
export const AVATAR_MEDIA = 'AVATAR_MEDIA';

/** What `UsersService` and the presign controller need. */
export interface AvatarMediaPort {
    /** The CDN base URL a stored key is served from; composed with the key at read time. */
    readonly cdnUrl: string;
    presignUpload: AvatarStoragePort['presignUpload'];
    exists: AvatarStoragePort['exists'];
    /**
     * After a replacement committed: delete every OTHER object under the user's prefix, then invalidate it.
     *
     * @throws when the delete or the invalidation fails (the caller decides whether that is fatal).
     * @sideEffect Deletes S3 objects and issues a CloudFront invalidation.
     */
    removeSuperseded(userId: string, keepKey: string): Promise<void>;
    /**
     * Delete every avatar object of the user, then invalidate the prefix.
     *
     * @throws when the delete or the invalidation fails. An erasure treats that as non-terminal.
     * @sideEffect Deletes S3 objects and issues a CloudFront invalidation.
     */
    removeAll(userId: string): Promise<void>;
}

export class AvatarMedia implements AvatarMediaPort {
    public constructor(
        private readonly storage: AvatarStoragePort,
        private readonly cdn: CdnInvalidationPort,
        public readonly cdnUrl: string,
    ) {}

    public presignUpload(input: Parameters<AvatarStoragePort['presignUpload']>[0]): Promise<string> {
        return this.storage.presignUpload(input);
    }

    public exists(key: string): Promise<boolean> {
        return this.storage.exists(key);
    }

    public async removeSuperseded(userId: string, keepKey: string): Promise<void> {
        await this.storage.deleteUnder(avatarKeyPrefix(userId), keepKey);
        await this.cdn.invalidate([`/${avatarKeyPrefix(userId)}*`]);
    }

    public async removeAll(userId: string): Promise<void> {
        await this.storage.deleteUnder(avatarKeyPrefix(userId), undefined);
        await this.cdn.invalidate([`/${avatarKeyPrefix(userId)}*`]);
    }
}

/**
 * The avatar path of a process with no media configuration (local development, most tests): it refuses every call. A
 * guessed bucket would presign uploads into a bucket nobody owns and answer 200.
 *
 * @returns A port whose every operation rejects.
 */
export function unconfiguredAvatarMedia(): AvatarMediaPort {
    const refuse = (): Promise<never> =>
        Promise.reject(
            new Error('Avatar media is not configured: set MEDIA_BUCKET_NAME (and MEDIA_CDN_URL when deployed)'),
        );

    return {
        cdnUrl: '',
        presignUpload: refuse,
        exists: refuse,
        removeSuperseded: refuse,
        removeAll: refuse,
    };
}
