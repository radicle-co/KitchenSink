/**
 * T032 — the `/api/v1/recipes/{recipeId}/versions` REST surface (recipe version history).
 *
 * Thin controller: the `@OwnerId()` decorator reads the authenticated owner key from `req.principal`
 * (set by the fail-closed `AuthMiddleware` — the app-user ULID, never the Clerk `sub`) and the
 * controller delegates every decision to {@link VersionsService}. Domain failures thrown by the service
 * (`RECIPE_NOT_FOUND` / `NOT_OWNER` / `VERSION_CONFLICT`) are translated to HTTP by the global
 * `ApiExceptionFilter`.
 *
 * THERE IS DELIBERATELY NO CONTROLLER-SCOPED VALIDATION PIPE, and its absence is correct rather than an
 * omission. One used to sit here — `@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))` — with
 * a docstring claiming it "enforces the params". It enforced nothing: this controller has no `@Body()` and no
 * `@Query()`, and every parameter is a primitive (`string`/`number`) that Nest's `ValidationPipe.toValidate()`
 * skips by design. It was inert decoration that read as a validation boundary, which is the more dangerous of
 * the two failure modes — a reviewer looking for "is this route validated?" found a pipe and stopped.
 *
 * What actually validates these params is per-parameter and visible at each use site: `ParseUUIDPipe` on
 * `recipeId`, `ParseIntPipe` on `versionNumber`. If a body is ever added to this controller, it needs
 * `nestjs-zod`'s `ZodValidationPipe` over a `createZodDto` — NOT Nest's, which would silently validate nothing
 * against a zod DTO. `packages/infra/global/__tests__/service-security-invariants.test.ts` (G5) enforces that
 * for every service the moment a `@Body()`/`@Query()` appears.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Post } from '@nestjs/common';
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
