/**
 * `FoodsController` (ARCH-001, MOD-001) — the source-agnostic `/api/v1/foods/*` HTTP surface. Validates input at
 * the boundary, delegates to {@link FoodsService}, and otherwise gets out of the way.
 *
 * ── IT NO LONGER MAPS DOMAIN ERRORS TO STATUS CODES, AND THAT IS A DELETION, NOT AN OMISSION ──
 *
 * It used to: `mapReadError` / `mapResolveError` / `mapWriteError` turned each {@link FoodsService} error into a
 * `NotFoundException` / `ConflictException` / `ServiceUnavailableException` with a `{ error, …extras }` body. Every
 * one of those decisions was ALREADY made, exhaustively and in one table, by `ApiExceptionFilter` +
 * `FOOD_ERROR_STATUS` — which the same errors reached anyway whenever they escaped a `try` block. So one piece of
 * knowledge ("a `CandidateMismatchError` is a 409") had two authors that nothing forced to agree, and the
 * controller's copy was also the one emitting the second of this service's three legacy error shapes.
 *
 * The domain errors now simply propagate. The FR-051 precedence `401 → 403 → 400 → 404/202/200` is unchanged and
 * still asserted end-to-end (`tests/foodsApi.integration.test.ts`); what changed is that only ONE place decides
 * it. Do not re-add a `catch` that re-raises a domain error as an `HttpException`.
 *
 * What genuinely belongs here, and stays:
 *
 *  - **`202` on the pending READ.** `GET /{id}` answering a `FoodPendingError` with the `PendingResponse` body is
 *    a SUCCESS shape (`{ id, status, estimatedWaitSeconds? }`), not an error envelope, so the controller is the
 *    only layer that can produce it.
 *  - **Boundary rejections** — a malformed `{id}`, and the batch cap. Both raised through {@link apiError}, so the
 *    status still comes from the one table.
 *  - **The `403` scope check on `/refetch`**, deliberately BEFORE id validation so `403` precedes `400` (FR-051).
 *
 * The `401` (authn) layer is the `FoodAuthGuard` middleware mounted ahead of this controller; it sets
 * `req.user` from the verified Clerk `sub` only. Internal/DB errors are never leaked — they reach the filter's
 * generic `500`.
 *
 * @implements FR-002 FR-003 FR-004 FR-005 FR-006 FR-007 FR-008 FR-012 FR-039 FR-045 FR-046 FR-051 FR-RES-1 FR-RES-2
 */
import {
    Body,
    Controller,
    Get,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    Req,
    Res,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import {
    FOOD_ADMIN_SCOPE,
    hasScope,
    IDENTITY_SYNC_PENDING_CODE,
    resolveRequesterId,
    type AuthenticatedPrincipal,
    type AuthenticatedRequest,
} from '../auth/authenticatedPrincipal.js';
import { apiError } from '../common/apiError.js';
import type { Environment } from '../config/env.schema.js';
import { isFoodId } from '../db/ulid.js';
import { isFoodPendingError } from './foods.errors.js';
import { FoodsService } from './foods.service.js';
// The AUTHORED wire contract (CODING_STANDARDS §15.2): the request schemas below are the validators this
// controller runs AND the definitions `@kitchensink/schema-food` publishes to every client, so there is one
// representation of each shape instead of a server-side check and a client-side belief about it.
import { AddFoodBodyDto, BatchAddFoodBodyDto, ResolveFoodBodyDto, SearchFoodQueryDto } from './dto/foods.dto.js';
import type {
    AddResponse,
    BatchResponse,
    CandidatesResponse,
    FoodResponse,
    PendingResponse,
    ResolveResponse,
    SearchResponse,
    StatusResponse,
} from './foods.schema.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/foods', 'v1/foods'])
export class FoodsController {
    public constructor(
        private readonly foodsService: FoodsService,
        private readonly config: ConfigService<Environment, true>,
    ) {}

    /**
     * `GET /api/v1/foods/search?query=` — local fuzzy/crosswalk search (declared before `:id`).
     *
     * The query is now VALIDATED — trimmed, required, length-bounded — by the globally bound pipe against
     * {@link SearchFoodQueryDto}. It previously arrived as a bare `@Query('query') query?: string` and went to
     * the DAO as `query ?? ''`, so the published `searchFoodQuerySchema` described a check that never ran.
     */
    @Get('search')
    public async search(@Query() query: SearchFoodQueryDto): Promise<SearchResponse> {
        return this.foodsService.search(query.query);
    }

    /** `POST /api/v1/foods` — add by name → `202` + `id` (FR-005); empty name → `400` (FR-006). */
    @Post()
    public async addByName(
        @Body() body: AddFoodBodyDto,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AddResponse> {
        const result = await this.foodsService.addByName(body.name, this.requireRequesterId(req));
        res.status(HttpStatus.ACCEPTED);

        return result;
    }

    /** `POST /api/v1/foods/batch` — batch add-by-name; ≤100 names (`400` over) (FR-045). */
    @Post('batch')
    public async batch(@Body() body: BatchAddFoodBodyDto, @Req() req: AuthenticatedRequest): Promise<BatchResponse> {
        const names = this.boundedNames(body.names);

        return this.foodsService.batchAdd(names, this.requireRequesterId(req));
    }

    /** `GET /api/v1/foods/{id}/status` — lifecycle poll (FR-007). */
    @Get(':id/status')
    public async getStatus(@Param('id') id: string): Promise<StatusResponse> {
        this.requireId(id);

        return this.foodsService.getStatus(id);
    }

    /** `GET /api/v1/foods/{id}/candidates` — disambiguation candidate set (FR-RES-1). */
    @Get(':id/candidates')
    public async getCandidates(@Param('id') id: string): Promise<CandidatesResponse> {
        this.requireId(id);

        return this.foodsService.getCandidates(id);
    }

    /** `POST /api/v1/foods/{id}/refetch` — admin-scoped manual re-enqueue; `403` without scope (FR-039). */
    @Post(':id/refetch')
    public async refetch(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AddResponse> {
        // 403 (authz scope) precedes 400 (id validation) per FR-051.
        if (!hasScope(req.user, FOOD_ADMIN_SCOPE)) {
            throw apiError('FORBIDDEN', 'Operation requires elevated scope');
        }

        this.requireId(id);

        const result = await this.foodsService.refetch(id, this.requireRequesterId(req));
        res.status(HttpStatus.ACCEPTED);

        return result;
    }

    /**
     * `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2).
     *
     * NO REQUESTER IS PASSED, AND THAT IS THE DESIGN, not an omission. A resolve is not an enqueue: it draws
     * from the limiter's reserved headroom (DSN-6) rather than a requester's budget, and it writes no
     * `fetch_requesters` row — so there is nothing for a requester key to key. It used to receive one anyway,
     * computed by a `requesterTrace(req)` helper that fell back to the raw Clerk `sub` and then to the string
     * `'unknown'`; the callee's parameter was underscore-prefixed and read exactly nowhere, so the value was
     * derived, carried across a module boundary, and discarded. Both are deleted. Adding a requester here is a
     * deliberate decision with a privacy cost (`fetch_requesters` is the "user X asked for food Y" linkage the
     * erasure leg deletes), not a signature to restore for symmetry with the enqueue routes.
     */
    @Patch(':id')
    public async patchResolve(
        @Param('id') id: string,
        @Body() body: ResolveFoodBodyDto,
        @Res({ passthrough: true }) res: Response,
    ): Promise<ResolveResponse> {
        this.requireId(id);

        const result = await this.foodsService.patchResolve(id, body.candidateIds);
        res.status(HttpStatus.OK);

        return result;
    }

    /** `GET /api/v1/foods/{id}` — golden-record read with lifecycle status codes (FR-002/FR-003/FR-004). */
    @Get(':id')
    public async getFood(
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<FoodResponse | PendingResponse> {
        this.requireId(id);

        try {
            const food = await this.foodsService.getFood(id);
            res.status(HttpStatus.OK);

            return food;
        } catch (error) {
            // THE ONE domain error this controller still intercepts, because a `202` here is a SUCCESS body
            // (`PendingResponse`), not an error envelope — see the class doc. Everything else propagates to the
            // filter, which owns the status for it.
            if (isFoodPendingError(error)) {
                res.status(HttpStatus.ACCEPTED);

                return { id: error.id, status: error.status, estimatedWaitSeconds: error.estimatedWaitSeconds };
            }

            throw error;
        }
    }

    /**
     * Resolve the requester key to record in `fetch_requesters` for an enqueue path (CR-002/U1/R5): the
     * app-user ULID for a user principal, or the `svc_*` id for a service principal. DEFERS with a
     * `401 { code: IDENTITY_SYNC_PENDING }` when a user token's `external_id` has not synced yet — the
     * caller MUST retry with a refreshed token, and we NEVER fall back to the raw Clerk `sub` (which
     * would re-introduce the pre-U1 keying and fail provenance downstream anyway).
     *
     * @param req - The guard-authenticated request.
     * @returns The resolved requester key.
     * @throws (→ 401) when `req.user` is absent (defensive) or the app-user ULID is not yet available (the
     *   first-token sync race, `IDENTITY_SYNC_PENDING`).
     */
    private requireRequesterId(req: AuthenticatedRequest): string {
        const principal = this.requirePrincipal(req);
        const resolution = resolveRequesterId(principal);

        if (resolution.status === IDENTITY_SYNC_PENDING_CODE) {
            // `IDENTITY_SYNC_PENDING_CODE` is `auth/authenticatedPrincipal.ts`'s constant and `apiError` takes a
            // PUBLISHED `FoodErrorCode`, so the two agreeing is a `typecheck` obligation rather than a
            // convention: change the auth constant's string and this line stops compiling.
            throw apiError(
                IDENTITY_SYNC_PENDING_CODE,
                'App-user identity (external_id) not yet available; retry with a refreshed token.',
            );
        }

        return resolution.requesterId;
    }

    /** Narrow the guard-populated principal, failing closed with `401` if somehow absent. */
    private requirePrincipal(req: AuthenticatedRequest): AuthenticatedPrincipal {
        if (!req.user) {
            throw new UnauthorizedException('Valid Clerk session or M2M token required');
        }

        return req.user;
    }

    /** Validate the `id` path param is a structurally valid ULID (FR-006) → else `400`. */
    private requireId(id: string): void {
        if (!isFoodId(id)) {
            throw apiError('INVALID_ID', 'The id is not a valid food (ingredient) ULID');
        }
    }

    /**
     * Apply the two batch rules that deliberately do NOT live in the published contract.
     *
     * The array's SHAPE is validated by the pipe against {@link BatchAddFoodBodyDto}. These two are different in
     * kind and belong here:
     *  - dropping blank entries is server-side NORMALIZATION, not a shape a caller must satisfy — and as a
     *    `.transform()` it could not be represented in the published JSON Schema at all;
     *  - the cap is `FOOD_MAX_BATCH_NAMES`, a RUNTIME configuration value. A static bound in the contract would
     *    be a second representation that silently disagrees the moment the environment variable is tuned, so
     *    the configured value is enforced here and reported in the `400` body where a caller can read it.
     *
     * @param names - The trimmed names the pipe accepted.
     * @returns The non-blank names, guaranteed within the configured cap.
     * @throws (→ 400 `BATCH_TOO_LARGE`) when more names remain than the configured maximum.
     */
    private boundedNames(names: readonly string[]): string[] {
        const cleaned = names.filter((name) => name.length > 0);
        const maxNames = this.config.get('FOOD_MAX_BATCH_NAMES', { infer: true });

        if (cleaned.length > maxNames) {
            throw apiError('BATCH_TOO_LARGE', `At most ${maxNames} names per batch`, { maxNames });
        }

        return cleaned;
    }
}
