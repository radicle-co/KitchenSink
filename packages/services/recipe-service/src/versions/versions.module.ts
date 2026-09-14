import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { VersionsController } from './versions.controller.js';
import { VersionsService, VERSIONS_DAL } from './versions.service.js';
import { VersionsDal } from './dal/versions.dal.js';
import { PendingArchivesDal } from './dal/pendingArchives.dal.js';
import {
    VERSION_ARCHIVE_READER,
    createS3VersionArchiveReader,
    type VersionArchiveReader,
} from './versionArchive.storage.js';

/**
 * Versions module (FR-007b). Owns recipe version history: snapshot writes, the last-10 Postgres
 * retention window, and the S3-archive OUTBOX for pruned versions. Wires the {@link VersionsDal} and the
 * {@link PendingArchivesDal} over the global Drizzle client, the
 * {@link VersionsService} (which reuses {@link RecipesModule}'s `RecipesService` for read authorization
 * and restore), and the {@link VersionsController} REST surface. The global `AuthMiddleware` populates
 * `req.principal`; the global `ApiExceptionFilter` maps thrown `RecipeDomainError`s to HTTP.
 */
@Module({
    imports: [forwardRef(() => RecipesModule)],
    controllers: [VersionsController],
    providers: [
        {
            provide: VERSIONS_DAL,
            inject: [DrizzleProvider],
            useFactory: (db: RecipeDrizzle): VersionsDal => new VersionsDal(db),
        },
        PendingArchivesDal,
        {
            // W8-a.7: reads pruned version snapshots back from the S3 archive bucket for a transparent
            // fallback in get/compare/restore. LocalStack endpoint + path-style in dev (per config docs).
            provide: VERSION_ARCHIVE_READER,
            inject: [ConfigService],
            useFactory: (config: ConfigService): VersionArchiveReader =>
                createS3VersionArchiveReader({
                    bucket: config.getOrThrow<string>('S3_BUCKET_VERSIONS'),
                    region: config.get<string>('AWS_REGION') ?? 'us-east-1',
                    forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE') ?? false,
                    ...(config.get<string>('S3_ENDPOINT') !== undefined
                        ? { endpoint: config.getOrThrow<string>('S3_ENDPOINT') }
                        : {}),
                }),
        },
        VersionsService,
    ],
    exports: [VersionsService],
})
export class VersionsModule {}
