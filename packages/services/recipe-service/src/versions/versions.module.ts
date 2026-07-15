import { forwardRef, Module } from '@nestjs/common';
import { DrizzleProvider } from '../database/database.module.js';
import type { RecipeDrizzle } from '../database/client.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { VersionsController } from './versions.controller.js';
import { VersionsService, VERSIONS_DAL } from './versions.service.js';
import { VersionsDal } from './dal/versions.dal.js';
import { PendingArchivesDal } from './dal/pending-archives.dal.js';

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
        VersionsService,
    ],
    exports: [VersionsService],
})
export class VersionsModule {}
