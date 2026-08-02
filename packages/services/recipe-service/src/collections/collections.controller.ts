/**
 * T041 — the Collections HTTP controller (`/api/v1/collections`).
 *
 * A thin adapter: it validates the request (body/query → 400 on malformed input), reads the OWNER from
 * the verified `req.principal.userId` (NEVER from the body or a client header — the `AuthMiddleware`
 * has already fail-closed populated it), delegates to {@link CollectionsService}, and maps results to
 * the OpenAPI response shapes/status codes. Domain errors thrown by the service (NOT_OWNER,
 * RECIPE_NOT_FOUND, INVALID_VISIBILITY) and framework `NotFoundException`s are translated to HTTP by
 * the global `ApiExceptionFilter`.
 */
import {
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
import { z } from 'zod';
import type { ZodType } from 'zod';

import type { AuthenticatedRequest, Principal } from '../auth/principal.js';
import { CollectionsService } from './collections.service.js';
import {
    addRecipeSchema,
    cloneCollectionSchema,
    createCollectionSchema,
    pageQuerySchema,
    pullCommitSchema,
    updateCollectionSchema,
} from './collections.schemas.js';
import type { AddRecipeBody, CreateCollectionBody, PageQuery, UpdateCollectionBody } from './collections.schemas.js';
import type { PullDiff } from './domain/pull-diff.js';
import type {
    CollectionRecipeMembershipResponse,
    CollectionResponse,
    CollectionWithRecipesResponse,
    PullFromSourceResult,
} from './collections.types.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

/**
 * `cloneCollectionSchema` / `pullCommitSchema` bodies are wholly-optional objects — an absent body
 * arrives at the pipe as `undefined` (or `{}`, depending on whether a `Content-Type` header was sent);
 * both mean "no overrides" (FR-011 / W8-a.8). `z.preprocess` folds `undefined` to `{}` BEFORE the schema
 * (which requires an object) runs, so the pipe still applies at the framework seam for these two routes.
 */
function optionalBody<T>(schema: ZodType<T>): ZodType<T> {
    return z.preprocess((value) => value ?? {}, schema);
}

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/collections', 'v1/collections'])
export class CollectionsController {
    public constructor(private readonly collections: CollectionsService) {}

    /** Create a collection owned by the caller. */
    @Post()
    @WriteRateLimit()
    public async create(
        @Req() req: AuthenticatedRequest,
        @Body(new ZodValidationPipe(createCollectionSchema)) body: CreateCollectionBody,
    ): Promise<CollectionResponse> {
        const owner = this.requirePrincipal(req);

        return this.collections.createCollection(owner.userId, body);
    }

    /** List the caller's own collections (paginated). */
    @Get()
    public async list(
        @Req() req: AuthenticatedRequest,
        @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
    ): Promise<PaginatedResponse<CollectionResponse>> {
        const owner = this.requirePrincipal(req);

        return this.collections.listCollections(owner.userId, query);
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
        @Body(new ZodValidationPipe(updateCollectionSchema)) body: UpdateCollectionBody,
    ): Promise<CollectionResponse> {
        const owner = this.requirePrincipal(req);

        return this.collections.updateCollection(owner.userId, id, body);
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
        @Body(new ZodValidationPipe(addRecipeSchema)) body: AddRecipeBody,
    ): Promise<CollectionRecipeMembershipResponse> {
        const owner = this.requirePrincipal(req);

        return this.collections.addRecipe(owner.userId, id, body.recipeId);
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
        @Body(new ZodValidationPipe(optionalBody(cloneCollectionSchema))) body: z.infer<typeof cloneCollectionSchema>,
    ): Promise<CollectionResponse> {
        const owner = this.requirePrincipal(req);

        return this.collections.cloneCollection(owner.userId, id, body);
    }

    /**
     * PREVIEW a pull without mutating (W8-a.8 / decision 7) — 200 with the `{ added, removed, unchanged }`
     * diff the client shows before committing, then echoes back on commit as the drift baseline. A distinct,
     * read-only endpoint (the service runs it in a READ-ONLY transaction) rather than a `?dryRun` flag on the
     * mutating handler — so a preview is structurally incapable of writing.
     */
    @Post(':id/pull-from-source/preview')
    @HttpCode(200)
    public async previewPull(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<PullDiff> {
        const owner = this.requirePrincipal(req);

        return this.collections.previewPull(owner.userId, id);
    }

    /**
     * Pull new recipes from a clone's source (FR-011 / W8-a.8) — 200 with the collection + the ids this pull
     * added. Opt-in per invocation: nothing reconciles until the owner asks. When the body echoes the
     * `previewedDiff`, the server re-derives the diff live and returns 409 PULL_DRIFT (with the fresh diff)
     * if it changed — so the user never silently gets a different set than they confirmed.
     */
    @Post(':id/pull-from-source')
    @HttpCode(200)
    @WriteRateLimit()
    public async pullFromSource(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body(new ZodValidationPipe(optionalBody(pullCommitSchema))) body: z.infer<typeof pullCommitSchema>,
    ): Promise<PullFromSourceResult> {
        const owner = this.requirePrincipal(req);

        return this.collections.pullFromSource(owner.userId, id, body.previewedDiff);
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
