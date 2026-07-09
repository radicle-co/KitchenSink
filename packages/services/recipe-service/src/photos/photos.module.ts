import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { DEFAULT_AWS_REGION } from '../config/config.types.js';
import { PhotosController } from './photos.controller.js';
import { PhotosService, PHOTOS_CONFIG, PHOTOS_DAL, PHOTOS_STORAGE, type PhotosConfig } from './photos.service.js';
import { PhotosDal } from './dal/photos.dal.js';
import { createS3PhotoStorage } from './photos.storage.js';

/**
 * Photos module (recipe photos vertical). Owns the presign → upload → confirm flow and the
 * `recipe_photos` metadata rows. Wires the {@link PhotosDal} over the global Drizzle client, the S3
 * storage port ({@link createS3PhotoStorage} — the real `S3Client` + presigner, adapted to
 * `PhotoStoragePort`), the CloudFront base config, the {@link PhotosService}, and the
 * {@link PhotosController} REST surface. Mirrors `RecipesModule`. The global `AuthMiddleware` populates
 * `req.principal`; the global `ApiExceptionFilter` maps thrown errors to HTTP.
 */
@Module({
    imports: [RecipesModule],
    controllers: [PhotosController],
    providers: [
        {
            provide: PHOTOS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): PhotosDal => new PhotosDal(db),
        },
        {
            provide: PHOTOS_STORAGE,
            inject: [ConfigService],
            useFactory: (config: ConfigService) =>
                createS3PhotoStorage({
                    bucket: config.getOrThrow<string>('S3_BUCKET_PHOTOS'),
                    region: config.get<string>('AWS_REGION') ?? DEFAULT_AWS_REGION,
                    endpoint: config.get<string>('S3_ENDPOINT'),
                    forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE') ?? false,
                    presignExpirySeconds: config.get<number>('PRESIGNED_URL_EXPIRY_SECONDS') ?? 900,
                }),
        },
        {
            provide: PHOTOS_CONFIG,
            inject: [ConfigService],
            useFactory: (config: ConfigService): PhotosConfig => ({
                cloudfrontUrl: config.getOrThrow<string>('CLOUDFRONT_URL'),
            }),
        },
        PhotosService,
    ],
    exports: [PhotosService],
})
export class PhotosModule {}
