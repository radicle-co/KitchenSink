import { Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { UsersController } from './users.controller.js';
import { AvatarUploadController } from './avatarUpload.controller.js';
import { UsersService } from './users.service.js';
import { ResolveUserService } from './resolveUser.js';
import { AVATAR_OBJECT_STORE, S3AvatarObjectStore, type AvatarObjectStore } from './avatarObjectStore.js';
import {
    HANDLE_SYNC_PUBLISHER,
    createSnsHandleSyncPublisher,
    noopHandleSyncPublisher,
    type HandleSyncPublisher,
} from './handleSync.publisher.js';

@Module({
    controllers: [UsersController, AvatarUploadController],
    providers: [
        UsersService,
        ResolveUserService,
        {
            // Handle-sync producer (W8-a.2). SNS-backed when a topic is configured (deployed); a no-op in
            // local dev / tests (no topic), so a rename simply doesn't publish rather than failing. Reads
            // process.env directly, matching this service's avatar/queue provider convention.
            provide: HANDLE_SYNC_PUBLISHER,
            useFactory: (): HandleSyncPublisher => {
                const topicArn = process.env['HANDLE_SYNC_TOPIC_ARN'];

                if (topicArn === undefined || topicArn === '') {
                    return noopHandleSyncPublisher;
                }

                return createSnsHandleSyncPublisher({
                    topicArn,
                    region: process.env['AWS_REGION'] ?? 'us-east-1',
                    ...(process.env['SNS_ENDPOINT'] !== undefined ? { endpoint: process.env['SNS_ENDPOINT'] } : {}),
                });
            },
        },
        {
            // Avatar S3 deletion for account closure/erasure (reads MEDIA_BUCKET_NAME directly, matching the
            // avatar-upload controller's provider convention). The ECS task role holds s3:*Object/List on the
            // media bucket via `grantReadWrite`, so this is the S3-capable side of the lifecycle scrub.
            provide: AVATAR_OBJECT_STORE,
            useFactory: (): AvatarObjectStore =>
                new S3AvatarObjectStore(
                    new S3Client({}),
                    process.env['MEDIA_BUCKET_NAME'] ?? 'kitchensink-identity-media-dev',
                ),
        },
    ],
    exports: [UsersService, ResolveUserService],
})
export class UsersModule {}
