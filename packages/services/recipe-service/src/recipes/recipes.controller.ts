/**
 * T026 — the `/v1/recipes` REST surface (US1 recipe CRUD).
 *
 * Thin controller: the `@OwnerId()` / `@CurrentPrincipal()` decorators read the authenticated identity
 * from `req.principal` (set by the fail-closed `AuthMiddleware` — the owner key is the app-user ULID,
 * never the Clerk `sub`) and the controller delegates every decision to {@link RecipesService}. Domain
 * failures thrown by the service (`RECIPE_NOT_FOUND` / `NOT_OWNER` / `VERSION_CONFLICT`) are translated
 * to HTTP by the global `ApiExceptionFilter`. A controller-scoped `ValidationPipe` enforces the DTOs
 * (the app registers no global pipe).
 */
import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';

import { RecipesService } from './recipes.service.js';
import { CreateRecipeDto } from './dto/create-recipe.dto.js';
import { UpdateRecipeDto } from './dto/update-recipe.dto.js';
import { ListRecipesQueryDto } from './dto/list-recipes.query.dto.js';
import { CloneRecipeDto } from './dto/clone-recipe.dto.js';
import { SetVisibilityDto } from './dto/set-visibility.dto.js';
import type { PaginatedRecipesResponse, RecipeResponse } from './dto/recipe-response.dto.js';
import { CurrentPrincipal, OwnerId } from '../auth/current-principal.decorator.js';
import type { Principal } from '../auth/principal.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

@Controller('v1/recipes')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class RecipesController {
    public constructor(private readonly recipesService: RecipesService) {}

    /** `POST /v1/recipes` — create a recipe owned by the caller. */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async create(
        @CurrentPrincipal() principal: Principal,
        @Body() body: CreateRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.create(principal, body);
    }

    /** `GET /v1/recipes` — list the caller's recipes with pagination. */
    @Get()
    public async list(
        @OwnerId() ownerId: string,
        @Query() query: ListRecipesQueryDto,
    ): Promise<PaginatedRecipesResponse> {
        return this.recipesService.list(ownerId, query);
    }

    /** `GET /v1/recipes/{id}` — fetch one recipe (owner, or any public recipe). */
    @Get(':id')
    public async getById(@OwnerId() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<RecipeResponse> {
        return this.recipesService.getById(ownerId, id);
    }

    /** `PATCH /v1/recipes/{id}` — update a recipe the caller owns (optimistic concurrency). */
    @Patch(':id')
    @WriteRateLimit()
    public async update(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.update(principal, id, body);
    }

    /** `DELETE /v1/recipes/{id}` — soft-delete (tombstone) a recipe the caller owns. */
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @WriteRateLimit()
    public async remove(@OwnerId() ownerId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
        await this.recipesService.delete(ownerId, id);
    }

    /** `POST /v1/recipes/{id}/clone` — clone a recipe (public, or the caller's own) into a new owned recipe. */
    @Post(':id/clone')
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async clone(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() _body: CloneRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.clone(principal, id);
    }

    /** `PATCH /v1/recipes/{id}/visibility` — set visibility (C-004 policy, gated on premium + provenance). */
    @Patch(':id/visibility')
    @WriteRateLimit()
    public async setVisibility(
        @CurrentPrincipal() principal: Principal,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SetVisibilityDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.setVisibility(principal, id, body.visibility);
    }
}
