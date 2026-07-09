/**
 * T032 — the `/v1/recipes/{recipeId}/versions` REST surface (recipe version history).
 *
 * Thin controller: it reads the authenticated owner key from `req.principal.userId` (set by the
 * fail-closed `AuthMiddleware` — the app-user ULID, never the Clerk `sub`) and delegates every decision
 * to {@link VersionsService}. Domain failures thrown by the service (`RECIPE_NOT_FOUND` / `NOT_OWNER` /
 * `VERSION_CONFLICT`) are translated to HTTP by the global `ApiExceptionFilter`. A controller-scoped
 * `ValidationPipe` enforces the params (the app registers no global pipe).
 */
import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Req,
    UnauthorizedException,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import type { RecipeVersion } from '@kitchensink/recipe-core';

import { VersionsService } from './versions.service.js';
import type { AuthenticatedRequest } from '../auth/principal.js';

/** Read the verified owner key (app-user ULID) or reject — the middleware guarantees it on this route. */
function ownerIdOf(req: AuthenticatedRequest): string {
    const userId = req.principal?.userId;

    if (!userId) {
        throw new UnauthorizedException('Missing authenticated principal');
    }

    return userId;
}

@Controller('v1/recipes/:recipeId/versions')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class VersionsController {
    public constructor(private readonly versionsService: VersionsService) {}

    /** `GET /v1/recipes/{recipeId}/versions` — list a recipe's version history, newest-first. */
    @Get()
    public async list(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
    ): Promise<RecipeVersion[]> {
        return this.versionsService.list(ownerIdOf(req), recipeId);
    }

    /** `GET /v1/recipes/{recipeId}/versions/{versionId}` — fetch one version. */
    @Get(':versionId')
    public async getById(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('versionId', ParseUUIDPipe) versionId: string,
    ): Promise<RecipeVersion> {
        return this.versionsService.get(ownerIdOf(req), recipeId, versionId);
    }

    /** `POST /v1/recipes/{recipeId}/versions/{versionId}/restore` — restore a version as the new current. */
    @Post(':versionId/restore')
    @HttpCode(HttpStatus.OK)
    public async restore(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('versionId', ParseUUIDPipe) versionId: string,
    ): Promise<RecipeVersion> {
        return this.versionsService.restore(ownerIdOf(req), recipeId, versionId);
    }
}
