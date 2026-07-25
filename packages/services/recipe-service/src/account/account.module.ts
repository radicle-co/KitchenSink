/**
 * Account module (T134). The recipe service owns no users table (D2); GDPR erasure of a user's recipe
 * data therefore lives here rather than in a `users` module, and it is the ONLY path that hard-deletes
 * recipe rows, version snapshots, photos, collections, and S3-archived version blobs (C-007).
 *
 * The endpoint's job is deliberately small: durably record the request and hand the work off (D7). The
 * erasing itself is done by the SQS-triggered worker in `@kitchensink/recipe-workers` — a long-running,
 * VPC/S3-bound sweep that has no business holding an HTTP request open.
 *
 * Wires the {@link ErasureJobsDal} over the global Drizzle client, the SQS queue port
 * ({@link createSqsErasureQueue} — the real `SQSClient`, adapted to `ErasureQueuePort`), the
 * {@link ErasureService}, and the {@link AccountController}. Mirrors `PhotosModule`. The global
 * `AuthMiddleware` populates `req.principal`; the global `ApiExceptionFilter` maps thrown errors to HTTP.
 *
 * `ErasureJobsDal` is ALSO exported (not just `ErasureService`): `AppModule` registers the HAZ-052
 * {@link ErasureLockGuard} as a global `APP_GUARD`, and that guard depends on this DAL directly — a
 * guard has no HTTP request of its own to route through `ErasureService`'s C-007 state machine, it only
 * needs the read `findActiveJob` already exposes.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_AWS_REGION } from '../config/config.types.js';
import { AccountController } from './account.controller.js';
import { ErasureJobsDal } from './dal/erasure-jobs.dal.js';
import { ErasureService } from './erasure.service.js';
import { createSqsErasureQueue, ERASURE_QUEUE, type ErasureQueuePort } from './erasure.queue.js';

@Module({
    controllers: [AccountController],
    providers: [
        {
            provide: ERASURE_QUEUE,
            inject: [ConfigService],
            useFactory: (config: ConfigService): ErasureQueuePort =>
                createSqsErasureQueue({
                    // `getOrThrow` is belt-and-braces: the boot-time Zod schema already requires this, so a
                    // misconfigured stage fails at startup rather than at a user's erasure request.
                    queueUrl: config.getOrThrow<string>('ACCOUNT_ERASURE_QUEUE_URL'),
                    region: config.get<string>('AWS_REGION') ?? DEFAULT_AWS_REGION,
                    endpoint: config.get<string>('SQS_ENDPOINT'),
                }),
        },
        ErasureJobsDal,
        ErasureService,
    ],
    exports: [ErasureService, ErasureJobsDal],
})
export class AccountModule {}
