/**
 * `FoodsController` (ARCH-001, MOD-001) — the source-agnostic `/v1/foods/*` HTTP surface. Validates
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
} from '@nestjs/common';
import type { Response } from 'express';

import { FOOD_ADMIN_SCOPE, hasScope, type AuthenticatedRequest } from '../auth/authenticated-principal.js';
import { isFoodId } from '../db/ulid.js';
import {
    isCandidateMismatchError,
    isFetchUnavailableError,
    isFoodNotFoundError,
    isFoodPendingError,
    isNotResolvableError,
} from './foods.errors.js';
import { FoodsService, MAX_BATCH_NAMES } from './foods.service.js';
import type {
    AddResponse,
    BatchResponse,
    CandidatesResponse,
    FoodResponse,
    PendingResponse,
    ResolveResponse,
    SearchResponse,
    StatusResponse,
} from './foods.types.js';

@Controller('v1/foods')
export class FoodsController {
    public constructor(private readonly foodsService: FoodsService) {}

    /** `GET /v1/foods/search?query=` — local fuzzy/crosswalk search (declared before `:id`). */
    @Get('search')
    public async search(@Query('query') query?: string): Promise<SearchResponse> {
        return this.foodsService.search(query ?? '');
    }

    /** `POST /v1/foods` — add by name → `202` + `id` (FR-005); empty name → `400` (FR-006). */
    @Post()
    public async addByName(
        @Body() body: unknown,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AddResponse> {
        const name = this.requireName(body);

        try {
            const result = await this.foodsService.addByName(name, this.sub(req));
            res.status(HttpStatus.ACCEPTED);

            return result;
        } catch (error) {
            throw this.mapWriteError(error, res);
        }
    }

    /** `POST /v1/foods/batch` — batch add-by-name; ≤100 names (`400` over) (FR-045). */
    @Post('batch')
    public async batch(
        @Body() body: unknown,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<BatchResponse> {
        const names = this.requireNames(body);

        try {
            return await this.foodsService.batchAdd(names, this.sub(req));
        } catch (error) {
            throw this.mapWriteError(error, res);
        }
    }

    /** `GET /v1/foods/{id}/status` — lifecycle poll (FR-007). */
    @Get(':id/status')
    public async getStatus(@Param('id') id: string): Promise<StatusResponse> {
        this.requireId(id);

        try {
            return await this.foodsService.getStatus(id);
        } catch (error) {
            throw this.mapReadError(error, id);
        }
    }

    /** `GET /v1/foods/{id}/candidates` — disambiguation candidate set (FR-RES-1). */
    @Get(':id/candidates')
    public async getCandidates(@Param('id') id: string): Promise<CandidatesResponse> {
        this.requireId(id);

        try {
            return await this.foodsService.getCandidates(id);
        } catch (error) {
            throw this.mapReadError(error, id);
        }
    }

    /** `POST /v1/foods/{id}/refetch` — admin-scoped manual re-enqueue; `403` without scope (FR-039). */
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
            const result = await this.foodsService.refetch(id, this.sub(req));
            res.status(HttpStatus.ACCEPTED);

            return result;
        } catch (error) {
            throw this.mapReadError(this.mapWriteError(error, res), id);
        }
    }

    /** `PATCH /v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2). */
    @Patch(':id')
    public async patchResolve(
        @Param('id') id: string,
        @Body() body: unknown,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<ResolveResponse> {
        this.requireId(id);
        const candidateIds = this.requireCandidateIds(body);

        try {
            const result = await this.foodsService.patchResolve(id, candidateIds, this.sub(req));
            res.status(HttpStatus.OK);

            return result;
        } catch (error) {
            throw this.mapResolveError(this.mapWriteError(error, res), id);
        }
    }

    /** `GET /v1/foods/{id}` — golden-record read with lifecycle status codes (FR-002/FR-003/FR-004). */
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

    /** Resolve the verified requester (the guard guarantees `req.user`; default never reached in prod). */
    private sub(req: AuthenticatedRequest): string {
        return req.user?.sub ?? 'unknown';
    }

    /** Validate the `id` path param is a structurally valid ULID (FR-006) → else `400`. */
    private requireId(id: string): void {
        if (!isFoodId(id)) {
            throw new BadRequestException({ error: 'Invalid id' });
        }
    }

    /** Validate + extract a non-empty `name` from the add body → else `400`. */
    private requireName(body: unknown): string {
        const name = this.field(body, 'name');

        if (typeof name !== 'string' || name.trim().length === 0) {
            throw new BadRequestException({ error: 'Empty name' });
        }

        return name;
    }

    /** Validate + extract the `names` array (≤100, all strings) → else `400`. */
    private requireNames(body: unknown): string[] {
        const names = this.field(body, 'names');

        if (!Array.isArray(names) || names.some((entry) => typeof entry !== 'string')) {
            throw new BadRequestException({ error: 'Invalid names' });
        }

        const cleaned = (names as string[]).map((name) => name.trim()).filter((name) => name.length > 0);

        if (cleaned.length > MAX_BATCH_NAMES) {
            throw new BadRequestException({ error: 'Batch too large', maxNames: MAX_BATCH_NAMES });
        }

        return cleaned;
    }

    /** Validate + extract the non-empty `candidateIds` array (malformed body → `400`, DSN-14). */
    private requireCandidateIds(body: unknown): string[] {
        const ids = this.field(body, 'candidateIds');

        if (!Array.isArray(ids) || ids.length === 0 || ids.some((entry) => typeof entry !== 'string')) {
            throw new BadRequestException({ error: 'Invalid candidateIds' });
        }

        return ids as string[];
    }

    /** Read a property off an unknown body, or `undefined`. */
    private field(body: unknown, key: string): unknown {
        return body !== null && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
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
