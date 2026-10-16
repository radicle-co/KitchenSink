import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { AvatarUploadController } from './avatarUpload.controller.js';
import { UsersService } from './users.service.js';
import { ResolveUserService } from './resolveUser.js';
import { resolveMediaConfig } from '../config/mediaConfig.js';
import { AVATAR_MEDIA, AvatarMedia, unconfiguredAvatarMedia, type AvatarMediaPort } from './avatarMedia.js';
import { createS3AvatarStorage } from './avatarStorage.js';
import { createCloudFrontInvalidation, noopCdnInvalidation } from './cdnInvalidation.js';
import {
    HANDLE_SYNC_PUBLISHER,
    createSnsHandleSyncPublisher,
    noopHandleSyncPublisher,
    type HandleSyncPublisher,
} from './handleSync.publisher.js';
import { paidFeaturesGateProvider } from './paidFeaturesGate.provider.js';

@Module({
    controllers: [UsersController, AvatarUploadController],
    providers: [
        UsersService,
        ResolveUserService,
        paidFeaturesGateProvider,
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
            // The avatar media path (ADR-0064): S3 storage + the CDN that serves it + invalidation. Configuration is
            // resolved ONCE from the environment: a deployed stage THROWS at boot when a setting is missing, and an
            // undeployed process with no bucket gets a path that refuses every call. There is no default bucket.
            // The ECS task role holds s3:*Object/List on the media bucket via `grantReadWrite` and
            // `cloudfront:CreateInvalidation` on the media distribution only.
            provide: AVATAR_MEDIA,
            useFactory: (): AvatarMediaPort => {
                const config = resolveMediaConfig(process.env);

                if (config === undefined) {
                    return unconfiguredAvatarMedia();
                }

                const local = config.endpoint !== undefined;

                return new AvatarMedia(
                    createS3AvatarStorage({
                        bucket: config.bucket,
                        ...(process.env['AWS_REGION'] === undefined ? {} : { region: process.env['AWS_REGION'] }),
                        ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
                        // LocalStack only: static test credentials, so presigning is self-contained.
                        ...(local ? { credentials: { accessKeyId: 'test', secretAccessKey: 'test' } } : {}),
                    }),
                    config.distributionId === undefined
                        ? noopCdnInvalidation()
                        : createCloudFrontInvalidation(config.distributionId),
                    config.cdnUrl,
                );
            },
        },
    ],
    exports: [UsersService, ResolveUserService],
})
export class UsersModule {}
