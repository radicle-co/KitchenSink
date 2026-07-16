/**
 * T041 — the Collections HTTP controller (`/v1/collections`).
 *
 * A thin adapter: it validates the request (body/query → 400 on malformed input), reads the OWNER from
 * the verified `req.principal.userId` (NEVER from the body or a client header — the `AuthMiddleware`
 * has already fail-closed populated it), delegates to {@link CollectionsService}, and maps results to
 * the OpenAPI response shapes/status codes. Domain errors thrown by the service (NOT_OWNER,
 * RECIPE_NOT_FOUND, INVALID_VISIBILITY) and framework `NotFoundException`s are translated to HTTP by
 * the global `ApiExceptionFilter`.
 */
import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UnauthorizedException,
} from '@nestjs/common';
import type { PaginatedResponse } from '@kitchensink/recipe-core';
import type { ZodType } from 'zod';

import type { AuthenticatedRequest, Principal } from '../auth/principal.js';
import { CollectionsService } from './collections.service.js';
import {
    addRecipeSchema,
    cloneCollectionSchema,
    createCollectionSchema,
    pageQuerySchema,
    updateCollectionSchema,
} from './collections.schemas.js';
import type {
    CollectionRecipeMembershipResponse,
    CollectionResponse,
    CollectionWithRecipesResponse,
    PullFromSourceResult,
} from './collections.types.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

/** Validate `input` with `schema`, throwing a 400 `BadRequestException` on failure. */
function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);

    if (!result.success) {
        throw new BadRequestException(result.error.issues.map((issue) => issue.message));
    }

    return result.data;
}

@Controller('v1/collections')
export class CollectionsController {
    public constructor(private readonly collections: CollectionsService) {}

    /** Create a collection owned by the caller. */
    @Post()
    @WriteRateLimit()
    public async create(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<CollectionResponse> {
        const owner = this.requirePrincipal(req);
        const input = parseOrThrow(createCollectionSchema, body);

        return this.collections.createCollection(owner.userId, input);
    }

    /** List the caller's own collections (paginated). */
    @Get()
    public async list(
        @Req() req: AuthenticatedRequest,
        @Query() query: unknown,
    ): Promise<PaginatedResponse<CollectionResponse>> {
        const owner = this.requirePrincipal(req);
        const { page, pageSize } = parseOrThrow(pageQuerySchema, query);

        return this.collections.listCollections(owner.userId, { page, pageSize });
    }

    /** Get one owned collection with its (non-tombstoned) recipes. */
    @Get(':id')
    public async getById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
    ): Promise<CollectionWithRecipesResponse> {
        const owner = this.requirePrincipal(req);

        return this.collections.getCollection(owner.userId, id);
    }

    /** Update an owned collection (name/description/visibility). */
    @Patch(':id')
    @WriteRateLimit()
    public async update(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() body: unknown,
    ): Promise<CollectionResponse> {
        const owner = this.requirePrincipal(req);
        const patch = parseOrThrow(updateCollectionSchema, body);

        return this.collections.updateCollection(owner.userId, id, patch);
    }

    /** Delete an owned collection (no-cascade w.r.t. its recipes). */
    @Delete(':id')
    @HttpCode(204)
    @WriteRateLimit()
    public async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
        const owner = this.requirePrincipal(req);

        await this.collections.deleteCollection(owner.userId, id);
    }

    /** Add a recipe to an owned collection. */
    @Post(':id/recipes')
    @WriteRateLimit()
    public async addRecipe(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() body: unknown,
    ): Promise<CollectionRecipeMembershipResponse> {
        const owner = this.requirePrincipal(req);
        const { recipeId } = parseOrThrow(addRecipeSchema, body);

        return this.collections.addRecipe(owner.userId, id, recipeId);
    }

    /**
     * Clone a collection into the caller's account (FR-011) — 201 with the new collection.
     *
     * The body is optional (`CloneCollectionRequest`: both fields optional), so a plain clone needs no
     * payload; when present it overrides the clone's own name/description.
     */
    @Post(':id/clone')
    @HttpCode(201)
    @WriteRateLimit()
    public async clone(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() body: unknown,
    ): Promise<CollectionResponse> {
        const owner = this.requirePrincipal(req);
        // An absent body arrives as `{}` (or undefined) — both parse to "no overrides".
        const overrides = parseOrThrow(cloneCollectionSchema, body ?? {});

        return this.collections.cloneCollection(owner.userId, id, overrides);
    }

    /**
     * Pull new recipes from a clone's source (FR-011) — 200 with the collection + the ids this pull
     * added. Opt-in per invocation: nothing reconciles until the owner asks.
     */
    @Post(':id/pull-from-source')
    @HttpCode(200)
    @WriteRateLimit()
    public async pullFromSource(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
    ): Promise<PullFromSourceResult> {
        const owner = this.requirePrincipal(req);

        return this.collections.pullFromSource(owner.userId, id);
    }

    /** Remove a recipe from an owned collection. */
    @Delete(':id/recipes/:recipeId')
    @HttpCode(204)
    @WriteRateLimit()
    public async removeRecipe(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Param('recipeId') recipeId: string,
    ): Promise<void> {
        const owner = this.requirePrincipal(req);

        await this.collections.removeRecipe(owner.userId, id, recipeId);
    }

    /** The `AuthMiddleware` guarantees `principal`; this defends the type boundary (→ 401 if absent). */
    private requirePrincipal(req: AuthenticatedRequest): Principal {
        if (!req.principal) {
            throw new UnauthorizedException('Missing authenticated principal');
        }

        return req.principal;
    }
}
