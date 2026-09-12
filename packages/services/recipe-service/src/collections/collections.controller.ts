/**
 * T041 — the Collections HTTP controller (`/api/v1/collections`).
 *
 * A thin adapter: it reads the OWNER from the verified `req.principal.userId` (NEVER from the body or a
 * client header — the `AuthMiddleware` has already fail-closed populated it), delegates to
 * {@link CollectionsService}, and returns the AUTHORED wire shapes from `./collections.schema.ts`. Domain
 * errors thrown by the service (NOT_OWNER, RECIPE_NOT_FOUND, INVALID_VISIBILITY) and framework
 * `NotFoundException`s are translated to HTTP by the global `ApiExceptionFilter`.
 *
 * VALIDATION IS `nestjs-zod`'s CONTROLLER-SCOPED PIPE, over DTOs that ARE the published contract. That
 * replaced a per-parameter, hand-rolled `new ZodValidationPipe(schema)` — the last user of a bespoke
 * `PipeTransform` this repo carried alongside the library that already does it. Two consequences worth
 * stating, because they are the reason the swap is an improvement and not a lateral move:
 *
 *  - **The shape enforced here and the shape `@kitchensink/schema-recipe` publishes are ONE object**
 *    (`Dto.schema === …RequestSchema`, asserted in `dto/__tests__/collectionDtos.test.ts`). With the
 *    hand-rolled pipe the schema was passed in at the call site, so nothing structurally tied the
 *    validated shape to the published one.
 *  - **The `optionalBody` helper is gone.** Its whole job was folding an absent body to `{}` for the two
 *    wholly-optional bodies (`clone`, `pull-from-source`); that now lives on the schemas themselves as
 *    `.default({})`, so the tolerance is part of the CONTRACT rather than a local pipe trick — and it is
 *    representable in the published `openapi.yaml`, which a `z.preprocess` would not have been.
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
    UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import type { AuthenticatedRequest, Principal } from '../auth/principal.js';
import { CollectionsService } from './collections.service.js';
import { AddRecipeToCollectionDto } from './dto/addRecipeToCollection.dto.js';
import { CloneCollectionDto } from './dto/cloneCollection.dto.js';
import { CreateCollectionDto } from './dto/createCollection.dto.js';
import { ListCollectionsQueryDto } from './dto/listCollections.query.dto.js';
import { PullFromSourceDto } from './dto/pullFromSource.dto.js';
import { UpdateCollectionDto } from './dto/updateCollection.dto.js';
import type {
    CollectionListResponse,
    CollectionRecipeMembershipResponse,
    CollectionResponse,
    CollectionWithRecipesResponse,
    PullDiff,
    PullFromSourceResponse,
} from './collections.schema.js';
import { WriteRateLimit } from '../common/throttle/throttle.decorators.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/collections', 'v1/collections'])
@UsePipes(ZodValidationPipe)
export class CollectionsController {
    public constructor(private readonly collections: CollectionsService) {}

    /** Create a collection owned by the caller. */
    @Post()
    @WriteRateLimit()
    public async create(
        @Req() req: AuthenticatedRequest,
        @Body() body: CreateCollectionDto,
    ): Promise<CollectionResponse> {
        const owner = this.requirePrincipal(req);

        return this.collections.createCollection(owner.userId, body);
    }

    /** List the caller's own collections (paginated). */
    @Get()
    public async list(
        @Req() req: AuthenticatedRequest,
        @Query() query: ListCollectionsQueryDto,
    ): Promise<CollectionListResponse> {
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
        @Body() body: UpdateCollectionDto,
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
        @Body() body: AddRecipeToCollectionDto,
    ): Promise<CollectionRecipeMembershipResponse> {
        const owner = this.requirePrincipal(req);

        return this.collections.addRecipe(owner.userId, id, body.recipeId);
    }

    /**
     * Clone a collection into the caller's account (FR-011) — 201 with the new collection.
     *
     * The body is optional (`CloneCollectionRequest`: both fields optional), so a plain clone needs no
     * payload; when present it overrides the clone's own name/description. The schema's `.default({})` is
     * what makes an absent body legal.
     */
    @Post(':id/clone')
    @HttpCode(201)
    @WriteRateLimit()
    public async clone(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() body: CloneCollectionDto,
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
        @Body() body: PullFromSourceDto,
    ): Promise<PullFromSourceResponse> {
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
