/**
 * T032 — the `/api/v1/recipes/{recipeId}/versions` REST surface (recipe version history).
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
    ParseIntPipe,
    ParseUUIDPipe,
    Post,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import type { RecipeVersion } from '@kitchensink/recipe-core';

import { VersionsService, type RestoreVersionResult } from './versions.service.js';
import { CurrentPrincipal, OwnerId } from '../auth/current-principal.decorator.js';
import type { Principal } from '../auth/principal.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/recipes/:recipeId/versions', 'v1/recipes/:recipeId/versions'])
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class VersionsController {
    public constructor(private readonly versionsService: VersionsService) {}

    /** `GET /api/v1/recipes/{recipeId}/versions` — list a recipe's version history, newest-first. */
    @Get()
    public async list(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
    ): Promise<RecipeVersion[]> {
        return this.versionsService.list(ownerId, recipeId);
    }

    /** `GET /api/v1/recipes/{recipeId}/versions/{versionNumber}` — fetch one version by its 1-based number. */
    @Get(':versionNumber')
    public async getByVersionNumber(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('versionNumber', ParseIntPipe) versionNumber: number,
    ): Promise<RecipeVersion> {
        return this.versionsService.get(ownerId, recipeId, versionNumber);
    }

    /** `POST /api/v1/recipes/{recipeId}/versions/{versionNumber}/restore` — restore a version as the new current. */
    @Post(':versionNumber/restore')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async restore(
        @CurrentPrincipal() principal: Principal,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('versionNumber', ParseIntPipe) versionNumber: number,
    ): Promise<RestoreVersionResult> {
        return this.versionsService.restore(principal, recipeId, versionNumber);
    }
}
