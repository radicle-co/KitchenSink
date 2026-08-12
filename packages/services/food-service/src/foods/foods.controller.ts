/**
 * `FoodsController` (ARCH-001, MOD-001) — the source-agnostic `/api/v1/foods/*` HTTP surface. Validates
 * input at the boundary, delegates to {@link FoodsService}, and maps the service's typed domain errors
 * to HTTP responses under the FR-051 precedence `401 → 403 → 400 → 404/202/200`:
 *
 * - `FoodPendingError` → `202` (PENDING/UNRESOLVED)
 * - `FoodNotFoundError` → `404` (NOT_FOUND/FAILED/no row; status still in the body)
 * - `CandidateMismatchError` / `NotResolvableError` → `409`
 * - `FetchUnavailableError` → `503` + `Retry-After` (backpressure / flood-shed / resolve cap; never `429`)
 *
 * The `401` (authn) layer is the {@link FoodAuthGuard} middleware mounted ahead of this controller; it
 * sets `req.user` from the verified Clerk `sub` only. Operational `/refetch` additionally requires the
 * `food:admin` scope (`403` otherwise) — checked BEFORE id validation so `403` precedes `400`. Internal/DB
 * errors are never leaked; they propagate to Nest's generic `500`.
 *
 * @implements FR-002 FR-003 FR-004 FR-005 FR-006 FR-007 FR-008 FR-012 FR-039 FR-045 FR-046 FR-051 FR-RES-1 FR-RES-2
 */
import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    ForbiddenException,
    Get,
    HttpStatus,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    Req,
    Res,
    ServiceUnavailableException,
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
} from '../auth/authenticated-principal.js';
import type { Environment } from '../config/env.schema.js';
import { isFoodId } from '../db/ulid.js';
import {
    isCandidateMismatchError,
    isFetchUnavailableError,
    isFoodNotFoundError,
    isFoodPendingError,
    isNotResolvableError,
} from './foods.errors.js';
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
        try {
            const result = await this.foodsService.addByName(body.name, this.requireRequesterId(req));
            res.status(HttpStatus.ACCEPTED);

            return result;
        } catch (error) {
            throw this.mapWriteError(error, res);
        }
    }

    /** `POST /api/v1/foods/batch` — batch add-by-name; ≤100 names (`400` over) (FR-045). */
    @Post('batch')
    public async batch(
        @Body() body: BatchAddFoodBodyDto,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<BatchResponse> {
        const names = this.boundedNames(body.names);

        try {
            return await this.foodsService.batchAdd(names, this.requireRequesterId(req));
        } catch (error) {
            throw this.mapWriteError(error, res);
        }
    }

    /** `GET /api/v1/foods/{id}/status` — lifecycle poll (FR-007). */
    @Get(':id/status')
    public async getStatus(@Param('id') id: string): Promise<StatusResponse> {
        this.requireId(id);

        try {
            return await this.foodsService.getStatus(id);
        } catch (error) {
            throw this.mapReadError(error, id);
        }
    }

    /** `GET /api/v1/foods/{id}/candidates` — disambiguation candidate set (FR-RES-1). */
    @Get(':id/candidates')
    public async getCandidates(@Param('id') id: string): Promise<CandidatesResponse> {
        this.requireId(id);

        try {
            return await this.foodsService.getCandidates(id);
        } catch (error) {
            throw this.mapReadError(error, id);
        }
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
            throw new ForbiddenException({ error: 'Forbidden', message: 'Operation requires elevated scope' });
        }

        this.requireId(id);

        try {
            const result = await this.foodsService.refetch(id, this.requireRequesterId(req));
            res.status(HttpStatus.ACCEPTED);

            return result;
        } catch (error) {
            throw this.mapReadError(this.mapWriteError(error, res), id);
        }
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

        try {
            const result = await this.foodsService.patchResolve(id, body.candidateIds);
            res.status(HttpStatus.OK);

            return result;
        } catch (error) {
            throw this.mapResolveError(this.mapWriteError(error, res), id);
        }
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
            if (isFoodPendingError(error)) {
                res.status(HttpStatus.ACCEPTED);

                return { id: error.id, status: error.status, estimatedWaitSeconds: error.estimatedWaitSeconds };
            }

            throw this.mapReadError(error, id);
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
     * @throws {UnauthorizedException} (→ 401) when `req.user` is absent (defensive) or the app-user ULID
     *   is not yet available (first-token sync race).
     */
    private requireRequesterId(req: AuthenticatedRequest): string {
        const principal = this.requirePrincipal(req);
        const resolution = resolveRequesterId(principal);

        if (resolution.status === IDENTITY_SYNC_PENDING_CODE) {
            throw new UnauthorizedException({
                code: IDENTITY_SYNC_PENDING_CODE,
                message: 'App-user identity (external_id) not yet available; retry with a refreshed token.',
            });
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
            throw new BadRequestException({ error: 'Invalid id' });
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
     * @throws {BadRequestException} (→ 400) when more names remain than the configured maximum.
     */
    private boundedNames(names: readonly string[]): string[] {
        const cleaned = names.filter((name) => name.length > 0);
        const maxNames = this.config.get('FOOD_MAX_BATCH_NAMES', { infer: true });

        if (cleaned.length > maxNames) {
            throw new BadRequestException({ error: 'Batch too large', maxNames });
        }

        return cleaned;
    }

    /** Map a read-path error: `FoodNotFoundError` → `404` with the status in the body; else rethrow. */
    private mapReadError(error: unknown, id: string): unknown {
        if (isFoodNotFoundError(error)) {
            return new NotFoundException({
                error: 'Food not found',
                id,
                status: error.status,
                message:
                    error.status === 'NOT_FOUND'
                        ? 'No source has this food; tombstoned until TTL (default 30 days)'
                        : error.status === 'FAILED'
                          ? 'All sources errored after retries; try again later'
                          : 'No such food',
            });
        }

        return error;
    }

    /** Map a resolve-path error: candidate/lifecycle conflicts → `409`; else fall through to read mapping. */
    private mapResolveError(error: unknown, id: string): unknown {
        if (isCandidateMismatchError(error)) {
            return new ConflictException({ error: "Candidate not in food's candidate set" });
        }

        if (isNotResolvableError(error)) {
            return new ConflictException({ error: 'Food is not awaiting disambiguation', status: error.status });
        }

        return this.mapReadError(error, id);
    }

    /**
     * Map a {@link FetchUnavailableError} to a `503` + `Retry-After` (backpressure / flood-shed / resolve
     * cap, never `429`): set the `Retry-After` header on `res` (it survives Nest's exception filter, which
     * reuses the same response) and return a {@link ServiceUnavailableException}. Any other error is
     * returned unchanged for the caller's read/resolve mapper (or Nest's generic `500`).
     */
    private mapWriteError(error: unknown, res: Response): unknown {
        if (isFetchUnavailableError(error)) {
            res.setHeader('Retry-After', String(error.retryAfterSeconds));

            return new ServiceUnavailableException({
                error: 'Fetch temporarily unavailable',
                retryAfterSeconds: error.retryAfterSeconds,
            });
        }

        return error;
    }
}
