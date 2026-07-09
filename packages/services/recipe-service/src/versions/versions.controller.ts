/**
 * T032 — the `/v1/recipes/{recipeId}/versions` REST surface (recipe version history).
 *
 * Thin controller: the `@OwnerId()` decorator reads the authenticated owner key from `req.principal`
 * (set by the fail-closed `AuthMiddleware` — the app-user ULID, never the Clerk `sub`) and the
 * controller delegates every decision to {@link VersionsService}. Domain failures thrown by the service
 * (`RECIPE_NOT_FOUND` / `NOT_OWNER` / `VERSION_CONFLICT`) are translated to HTTP by the global
 * `ApiExceptionFilter`. A controller-scoped `ValidationPipe` enforces the params (the app registers no
 * global pipe).
 */
import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import type { RecipeVersion } from '@kitchensink/recipe-core';

import { VersionsService } from './versions.service.js';
import { OwnerId } from '../auth/current-principal.decorator.js';

@Controller('v1/recipes/:recipeId/versions')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class VersionsController {
    public constructor(private readonly versionsService: VersionsService) {}

    /** `GET /v1/recipes/{recipeId}/versions` — list a recipe's version history, newest-first. */
    @Get()
    public async list(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
    ): Promise<RecipeVersion[]> {
        return this.versionsService.list(ownerId, recipeId);
    }

    /** `GET /v1/recipes/{recipeId}/versions/{versionId}` — fetch one version. */
    @Get(':versionId')
    public async getById(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('versionId', ParseUUIDPipe) versionId: string,
    ): Promise<RecipeVersion> {
        return this.versionsService.get(ownerId, recipeId, versionId);
    }

    /** `POST /v1/recipes/{recipeId}/versions/{versionId}/restore` — restore a version as the new current. */
    @Post(':versionId/restore')
    @HttpCode(HttpStatus.OK)
    public async restore(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('versionId', ParseUUIDPipe) versionId: string,
    ): Promise<RecipeVersion> {
        return this.versionsService.restore(ownerId, recipeId, versionId);
    }
}
