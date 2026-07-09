import { Module } from '@nestjs/common';
import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { VersionsController } from './versions.controller.js';
import { VersionsService, VERSIONS_DAL, VERSIONS_S3_BUCKET, VERSIONS_S3_CLIENT } from './versions.service.js';
import { VersionsDal } from './dal/versions.dal.js';

/**
 * Build the S3 client the version-archive writer uses. Honors the `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE`
 * overrides (LocalStack in dev/test) and falls back to the ambient AWS config (region + credentials) in
 * deployed stages.
 *
 * @sideEffect none — constructs a client; connections open lazily on first `send`.
 */
function createVersionsS3Client(): S3Client {
    const endpoint = process.env['S3_ENDPOINT'];
    const config: S3ClientConfig = {};

    if (endpoint !== undefined && endpoint !== '') {
        config.endpoint = endpoint;
    }

    if (process.env['S3_FORCE_PATH_STYLE'] === 'true') {
        config.forcePathStyle = true;
    }

    return new S3Client(config);
}

/**
 * Versions module (FR-007b). Owns recipe version history: snapshot writes, the last-10 Postgres
 * retention window, and S3 archiving of pruned versions. Wires the {@link VersionsDal} over the global
 * Drizzle client, the injected {@link S3Client} + `S3_BUCKET_VERSIONS` bucket name, the
 * {@link VersionsService} (which reuses {@link RecipesModule}'s `RecipesService` for read authorization
 * and restore), and the {@link VersionsController} REST surface. The global `AuthMiddleware` populates
 * `req.principal`; the global `ApiExceptionFilter` maps thrown `RecipeDomainError`s to HTTP.
 */
@Module({
    imports: [RecipesModule],
    controllers: [VersionsController],
    providers: [
        {
            provide: VERSIONS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): VersionsDal => new VersionsDal(db),
        },
        {
            provide: VERSIONS_S3_CLIENT,
            useFactory: (): S3Client => createVersionsS3Client(),
        },
        {
            provide: VERSIONS_S3_BUCKET,
            useFactory: (): string => process.env['S3_BUCKET_VERSIONS'] ?? '',
        },
        VersionsService,
    ],
    exports: [VersionsService],
})
export class VersionsModule {}
