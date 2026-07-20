import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { AvatarUploadController } from './avatar-upload.controller.js';
import { UsersService } from './users.service.js';
import { ResolveUserService } from './resolveUser.js';
import {
    HANDLE_SYNC_PUBLISHER,
    createSnsHandleSyncPublisher,
    noopHandleSyncPublisher,
    type HandleSyncPublisher,
} from './handle-sync.publisher.js';

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
    ],
    exports: [UsersService, ResolveUserService],
})
export class UsersModule {}
