/**
 * T026 — the `/v1/recipes` REST surface (US1 recipe CRUD).
 *
 * Thin controller: it reads the authenticated owner key from `req.principal.userId` (set by the
 * fail-closed `AuthMiddleware` — the app-user ULID, never the Clerk `sub`) and delegates every decision
 * to {@link RecipesService}. Domain failures thrown by the service (`RECIPE_NOT_FOUND` / `NOT_OWNER` /
 * `VERSION_CONFLICT`) are translated to HTTP by the global `ApiExceptionFilter`. A controller-scoped
 * `ValidationPipe` enforces the DTOs (the app registers no global pipe).
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
    Req,
    UnauthorizedException,
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
import type { AuthenticatedRequest, Principal } from '../auth/principal.js';

/** Read the verified owner key (app-user ULID) or reject — the middleware guarantees it on this route. */
function ownerIdOf(req: AuthenticatedRequest): string {
    return principalOf(req).userId;
}

/** Read the full verified principal or reject — needed where premium (permissions) gates behavior. */
function principalOf(req: AuthenticatedRequest): Principal {
    if (!req.principal) {
        throw new UnauthorizedException('Missing authenticated principal');
    }

    return req.principal;
}

@Controller('v1/recipes')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class RecipesController {
    public constructor(private readonly recipesService: RecipesService) {}

    /** `POST /v1/recipes` — create a recipe owned by the caller. */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    public async create(@Req() req: AuthenticatedRequest, @Body() body: CreateRecipeDto): Promise<RecipeResponse> {
        return this.recipesService.create(principalOf(req), body);
    }

    /** `GET /v1/recipes` — list the caller's recipes with pagination. */
    @Get()
    public async list(
        @Req() req: AuthenticatedRequest,
        @Query() query: ListRecipesQueryDto,
    ): Promise<PaginatedRecipesResponse> {
        return this.recipesService.list(ownerIdOf(req), query);
    }

    /** `GET /v1/recipes/{id}` — fetch one recipe (owner, or any public recipe). */
    @Get(':id')
    public async getById(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<RecipeResponse> {
        return this.recipesService.getById(ownerIdOf(req), id);
    }

    /** `PATCH /v1/recipes/{id}` — update a recipe the caller owns (optimistic concurrency). */
    @Patch(':id')
    public async update(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.update(ownerIdOf(req), id, body);
    }

    /** `DELETE /v1/recipes/{id}` — soft-delete (tombstone) a recipe the caller owns. */
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    public async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
        await this.recipesService.delete(ownerIdOf(req), id);
    }

    /** `POST /v1/recipes/{id}/clone` — clone a recipe (public, or the caller's own) into a new owned recipe. */
    @Post(':id/clone')
    @HttpCode(HttpStatus.CREATED)
    public async clone(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() _body: CloneRecipeDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.clone(ownerIdOf(req), id);
    }

    /** `PATCH /v1/recipes/{id}/visibility` — set visibility (C-004 policy, gated on premium + provenance). */
    @Patch(':id/visibility')
    public async setVisibility(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SetVisibilityDto,
    ): Promise<RecipeResponse> {
        return this.recipesService.setVisibility(principalOf(req), id, body.visibility);
    }
}
