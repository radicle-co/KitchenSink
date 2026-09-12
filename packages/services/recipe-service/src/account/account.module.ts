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
 * `ErasureLockGuard` as a global `APP_GUARD`, and that guard depends on this DAL directly — a
 * guard has no HTTP request of its own to route through `ErasureService`'s C-007 state machine, it only
 * needs the read `findActiveJob` already exposes.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';

import { DEFAULT_AWS_REGION } from '../config/config.types.js';
import { AuthModule } from '../auth/auth.module.js';
import { AccountController } from './account.controller.js';
import { ServiceErasureController } from './serviceErasure.controller.js';
import { ErasureJobsDal } from './dal/erasureJobs.dal.js';
import { ErasureService } from './erasure.service.js';
import { ServicePrincipalErasureMetrics } from './erasureMetrics.js';
import { AccountExportDal } from './dal/export.dal.js';
import { AccountExportService, ACCOUNT_EXPORT_CONFIG, type AccountExportConfig } from './export.service.js';
import { createSqsErasureQueue, ERASURE_QUEUE, type ErasureQueuePort } from './erasure.queue.js';

@Module({
    // AuthModule supplies ServiceErasureGuard + ServiceErasureAuthService for the internal erasure route.
    imports: [AuthModule],
    controllers: [AccountController, ServiceErasureController],
    providers: [
        // Detective control for the greenfield service-principal erasure path (U4a): one CloudWatch metric
        // per service-attributed erasure, watched by a volume alarm (CDK seam — see the emitter docstring).
        // Provided via a factory (not a bare class) because the emitter is a plain class with defaulted
        // constructor args and no `@Injectable()` — a factory instantiates it unambiguously (defaults: stage
        // from env, sink = console.log) rather than relying on Nest reflecting an empty dependency list.
        {
            // U18 — the internal food-references route's read (embedded-DAL pattern; no module import).
            provide: IngredientsDal,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): IngredientsDal => new IngredientsDal(db),
        },
        {
            provide: ServicePrincipalErasureMetrics,
            useFactory: (): ServicePrincipalErasureMetrics => new ServicePrincipalErasureMetrics(),
        },
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
        AccountExportDal,
        {
            provide: ACCOUNT_EXPORT_CONFIG,
            inject: [ConfigService],
            // The CDN base URL photo/thumbnail keys are resolved against. `getOrThrow` mirrors PhotosModule:
            // the boot-time Zod schema already requires CLOUDFRONT_URL, so a misconfigured stage fails at
            // startup rather than at a user's export request.
            useFactory: (config: ConfigService): AccountExportConfig => ({
                cloudfrontUrl: config.getOrThrow<string>('CLOUDFRONT_URL'),
            }),
        },
        AccountExportService,
    ],
    exports: [ErasureService, ErasureJobsDal],
})
export class AccountModule {}
