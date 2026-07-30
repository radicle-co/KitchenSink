/**
 * AvatarObjectStore — the side-effecting boundary for deleting a user's avatar objects from S3 on account
 * closure/erasure (CR-002 field-scrub Specification A). Isolated behind an interface + DI token so the
 * lifecycle logic in `UsersService.deleteUserMe` stays testable (the store is mocked in unit tests) and the
 * S3 SDK never leaks into the domain flow.
 *
 * Only the identity SERVICE (ECS, granted `s3:*Object`/`s3:List*` on the media bucket via `grantReadWrite`)
 * performs avatar S3 deletion; the identity-webhooks Lambdas have no S3 grant, which is why the 12-month sweep
 * relies on closure having already removed the object.
 */
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

import { createServiceLogger } from '../observability/sentry-logging.js';

export const AVATAR_OBJECT_STORE = 'AVATAR_OBJECT_STORE';

/** The capability `deleteUserMe` needs: remove all of a user's avatar objects. */
export interface AvatarObjectStore {
    /**
     * Delete every avatar object under `avatars/{userId}/` in the media bucket.
     *
     * @sideEffect lists and deletes S3 objects.
     */
    deleteAllForUser(userId: string): Promise<void>;
}

/** S3-backed {@link AvatarObjectStore}. Deletes the whole `avatars/{userId}/` prefix, paginating the listing. */
export class S3AvatarObjectStore implements AvatarObjectStore {
    private readonly logger = createServiceLogger(S3AvatarObjectStore.name);

    constructor(
        private readonly s3: S3Client,
        private readonly bucket: string,
    ) {}

    async deleteAllForUser(userId: string): Promise<void> {
        // The avatar key scheme is `avatars/{userId}/{timestamp}.{ext}` (see AvatarUploadController); deleting
        // the whole prefix removes every historical upload, not just the one the current avatarUrl points at.
        const prefix = `avatars/${userId}/`;
        let continuationToken: string | undefined;
        let deleted = 0;

        do {
            const listed = await this.s3.send(
                new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
            );

            const objects = (listed.Contents ?? [])
                .map((object) => object.Key)
                .filter((key): key is string => key !== undefined)
                .map((key) => ({ Key: key }));

            if (objects.length > 0) {
                await this.s3.send(
                    new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } }),
                );
                deleted += objects.length;
            }

            continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
        } while (continuationToken !== undefined);

        this.logger.log('avatar objects deleted', JSON.stringify({ userId, deleted }));
    }
}
