/**
 * `FoodsController` — HTTP surface for the `/v1/foods/*` read API (ARCH-001, MOD-001).
 *
 * Validates `fdcId` at the boundary (positive integer → else 400, FR-006), delegates branching
 * to {@link FoodsService}, and maps the service's typed errors to HTTP responses:
 * {@link FoodPendingError} → 202, {@link FoodNotFoundError} → 404. Internal/DB errors are never
 * leaked — they propagate to Nest's default 500 handler with a generic body.
 *
 * Status precedence (FR-051) is `401 → 403 → 400 → 404/202/200`; the `401/403` auth layer is the
 * Phase-7 `FoodAuthGuard` (not built here). In this phase endpoints are open and `requestedBy`
 * comes from `req.user?.sub` (populated by the future guard) with a clearly-marked TEMP debug
 * header fallback for tests.
 *
 * @implements FR-001 FR-002 FR-003 FR-005 FR-006 FR-007 FR-008 FR-009 FR-010 FR-031 FR-033
 */
import {
    BadRequestException,
    Controller,
    Get,
    HttpStatus,
    NotFoundException,
    Param,
    Query,
    Req,
    Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { isFoodNotFoundError, isFoodPendingError } from './foods.errors.js';
import { FoodsService } from './foods.service.js';
import type { FoodAutocompleteResponse, FoodResponse, FoodSearchResponse, FoodStatusResponse } from './foods.types.js';

/**
 * TEMP (Phase 7): until `FoodAuthGuard` populates `req.user`, allow tests to inject the
 * authenticated `sub` via the `x-debug-sub` header. Used ONLY when `req.user` is absent. The
 * production auth path (guard → `req.user.sub`) supersedes this; never a real auth path.
 */
const DEBUG_SUB_HEADER = 'x-debug-sub';

/** Default principal when neither the (future) guard nor the debug header supplies one. */
const ANONYMOUS_SUB = 'anonymous';

/** A request augmented by the future `FoodAuthGuard` with the verified principal. */
interface AuthedRequest extends Request {
    user?: { sub: string };
}

@Controller('v1/foods')
export class FoodsController {
    public constructor(private readonly foodsService: FoodsService) {}

    /**
     * `GET /v1/foods/search?query=` — local full-text + fuzzy search (FR-008–FR-010).
     *
     * Declared before the `:fdcId` routes so `search`/`autocomplete` are not captured as ids.
     */
    @Get('search')
    public async search(@Query('query') query?: string): Promise<FoodSearchResponse> {
        return this.foodsService.search(query ?? '');
    }

    /** `GET /v1/foods/autocomplete?query=` — local autocomplete suggestions (FR-008). */
    @Get('autocomplete')
    public async autocomplete(@Query('query') query?: string): Promise<FoodAutocompleteResponse> {
        return this.foodsService.autocomplete(query ?? '');
    }

    /** `GET /v1/foods/{fdcId}/status` — poll fetch status without triggering a fetch (FR-007/FR-033). */
    @Get(':fdcId/status')
    public async getStatus(@Param('fdcId') fdcIdParam: string): Promise<FoodStatusResponse> {
        const fdcId = this.parseFdcId(fdcIdParam);

        try {
            return await this.foodsService.getStatus(fdcId);
        } catch (error) {
            if (isFoodNotFoundError(error)) {
                throw new NotFoundException({ error: 'Food not found', fdcId });
            }

            throw error;
        }
    }

    /** `GET /v1/foods/{fdcId}/nutrients` — full nutrient breakdown for a fetched food (FR-002). */
    @Get(':fdcId/nutrients')
    public async getNutrients(@Param('fdcId') fdcIdParam: string): Promise<FoodResponse> {
        const fdcId = this.parseFdcId(fdcIdParam);

        try {
            return await this.foodsService.getNutrients(fdcId);
        } catch (error) {
            if (isFoodNotFoundError(error)) {
                throw new NotFoundException({
                    error: 'Nutrition data not available',
                    fdcId,
                    message: 'Food is not yet fetched; poll /status or retry shortly',
                });
            }

            throw error;
        }
    }

    /**
     * `GET /v1/foods/{fdcId}` — the synchronous lookup path (FR-001–FR-005, FR-025, FR-031).
     *
     * Returns 200 (fresh or stale-while-revalidate), 202 (pending/miss/tombstone-lapsed enqueue),
     * or 404 (tombstoned within TTL). Uses `@Res({ passthrough: true })` to set 200/202 per branch
     * while leaving Nest's serialization intact.
     */
    @Get(':fdcId')
    public async getFood(
        @Param('fdcId') fdcIdParam: string,
        @Req() req: AuthedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<FoodResponse | FoodStatusResponse> {
        const fdcId = this.parseFdcId(fdcIdParam);
        const requestedBy = this.resolveRequestedBy(req);

        try {
            const food = await this.foodsService.getFood(fdcId, requestedBy);
            res.status(HttpStatus.OK);

            return food;
        } catch (error) {
            if (isFoodPendingError(error)) {
                res.status(HttpStatus.ACCEPTED);

                return { fdcId: error.fdcId, status: 'pending', estimatedWaitSeconds: error.estimatedWaitSeconds };
            }

            if (isFoodNotFoundError(error)) {
                throw new NotFoundException({
                    error: 'Food not found',
                    fdcId,
                    message:
                        'This food was not found in USDA; tombstoned until TTL expiry (default 30 days), after which a re-attempt is allowed',
                });
            }

            throw error;
        }
    }

    /**
     * Parse + validate the `fdcId` path param as a positive integer (FR-006).
     *
     * @throws {BadRequestException} (→ 400) for any non-positive-integer input. No invalid input
     * reaches the queue.
     */
    private parseFdcId(raw: string): number {
        if (!/^\d+$/.test(raw)) {
            throw new BadRequestException({
                error: 'Invalid fdcId format',
                message: 'fdcId must be a positive integer',
            });
        }

        const fdcId = Number(raw);

        if (!Number.isInteger(fdcId) || fdcId <= 0) {
            throw new BadRequestException({
                error: 'Invalid fdcId format',
                message: 'fdcId must be a positive integer',
            });
        }

        return fdcId;
    }

    /**
     * Resolve the authenticated principal for enqueue provenance (FR-048).
     *
     * Prefers `req.user.sub` (set by the Phase-7 `FoodAuthGuard`). Falls back to the TEMP
     * `x-debug-sub` header only when the guard has not populated `req.user`, then to
     * {@link ANONYMOUS_SUB}. The guard, once added, makes the header path unreachable.
     */
    private resolveRequestedBy(req: AuthedRequest): string {
        if (req.user?.sub) {
            return req.user.sub;
        }

        const debugSub = req.header(DEBUG_SUB_HEADER);

        return debugSub && debugSub.length > 0 ? debugSub : ANONYMOUS_SUB;
    }
}
