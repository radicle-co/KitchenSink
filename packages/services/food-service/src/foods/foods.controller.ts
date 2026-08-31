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
    Put,
    Query,
    Req,
    Res,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { sanitizeFoodName } from '@kitchensink/recipe-core/food-name';

import {
    FOOD_ADMIN_SCOPE,
    hasScope,
    IDENTITY_SYNC_PENDING_CODE,
    resolveRequesterId,
    type AuthenticatedPrincipal,
    type AuthenticatedRequest,
} from '../auth/authenticatedPrincipal.js';
import { apiError } from '../common/apiError.js';
import {
    canonicalizeNutritionIds,
    isNutritionIdListError,
    MAX_NUTRITION_IDS,
    type FoodNutritionBatchResponse,
} from './foods.schema.js';
import type { Environment } from '../config/env.schema.js';
import { isFoodId } from '../db/ulid.js';
import { isFoodPendingError } from './foods.errors.js';
import { FoodsService } from './foods.service.js';
import { LiveFoodSearchService } from './liveSearch.service.js';
// The AUTHORED wire contract (CODING_STANDARDS §15.2): the request schemas below are the validators this
// controller runs AND the definitions `@kitchensink/schema-food` publishes to every client, so there is one
// representation of each shape instead of a server-side check and a client-side belief about it.
import {
    AddFoodBodyDto,
    BatchAddFoodBodyDto,
    CreateAuthoredFoodBodyDto,
    FoodNutritionQueryDto,
    ResolveFoodBodyDto,
    SearchFoodQueryDto,
    UpdateAuthoredFoodBodyDto,
} from './dto/foods.dto.js';
import type {
    AddResponse,
    BatchResponse,
    CandidatesResponse,
    FoodResponse,
    LiveSearchResponse,
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
        private readonly liveSearch: LiveFoodSearchService,
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
        return this.foodsService.search(query.query, query.withNutrition === 'true');
    }

    /**
     * `GET /api/v1/foods/search/live?query=` — the ON-DEMAND source search behind the picker's
     * "Search USDA for '…'" affordance (plan U29). The only read path here that leaves our own database.
     *
     * ⚠️ **Declared BEFORE every `:id` route** (and before `search` would be irrelevant — a two-segment path
     * cannot be swallowed by the one-segment `search`, but it CAN be swallowed by `:id`). Nest matches in
     * declaration order; registered after `:id` this would bind `search` as an id and 404 with no clue why —
     * the same trap `nutrition` documents below.
     *
     * ⛔ **This is an explicit action, not autocomplete.** It spends a call against a SHARED 1,000/hr per-IP
     * source quota out of FR-019's reserved interactive lane. At 50 concurrent cooks even a perfect
     * one-call-per-settled-query typeahead would want ~3x the whole key, so no amount of debouncing makes a
     * live blend affordable — see {@link LiveFoodSearchService} for the arithmetic and the three outcomes.
     *
     * ⛔ **USER-AGNOSTIC by design.** The source rate-limits our egress IP, not our users, so the aggregate
     * limiter is the ONLY quota authority and no caller identity is needed or accepted here. (The route is
     * still authenticated — `FoodAuthGuard` covers the whole controller — because authentication proves the
     * caller is ours; it is simply not what enforces the quota.)
     *
     * Reuses {@link SearchFoodQueryDto}: the wire SHAPE is identical to the local search's, and the search
     * MINIMUM is a domain rule the service applies (003-FR-010a) rather than a wire constraint — the food
     * contract's import allowlist is zod-only on purpose, so it cannot read the shared minimum.
     */
    @Get('search/live')
    public async searchLive(@Query() query: SearchFoodQueryDto): Promise<LiveSearchResponse> {
        return this.liveSearch.search(query.query);
    }

    /**
     * `POST /api/v1/foods/authored` — create a user-authored food → `201` + the COMPLETE entity (plan
     * U10, D9a: the sibling CREATE door, beside add-by-name's `202` + PENDING).
     *
     * ⚠️ Declared BEFORE every `:id` route (Nest matches in declaration order — the `nutrition` route's
     * own warning). The author comes from the VERIFIED principal, never the body; a `svc_*` principal
     * cannot author a food (authored rows belong to people).
     */
    @Post('authored')
    public async createAuthored(
        @Body() body: CreateAuthoredFoodBodyDto,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<FoodResponse> {
        const result = await this.foodsService.createAuthored(this.requireUserUlid(req), body);
        res.status(HttpStatus.CREATED);

        return result;
    }

    /** `POST /api/v1/foods` — add by name → `202` + `id` (FR-005); empty name → `400` (FR-006). */
    @Post()
    public async addByName(
        @Body() body: AddFoodBodyDto,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AddResponse> {
        const result = await this.foodsService.addByName(this.visibleName(body.name), this.requireRequesterId(req));
        res.status(HttpStatus.ACCEPTED);

        return result;
    }

    /** `POST /api/v1/foods/batch` — batch add-by-name; ≤100 names (`400` over) (FR-045). */
    @Post('batch')
    public async batch(@Body() body: BatchAddFoodBodyDto, @Req() req: AuthenticatedRequest): Promise<BatchResponse> {
        const names = this.boundedNames(body.names);

        return this.foodsService.batchAdd(names, this.requireRequesterId(req));
    }

    /**
     * `GET /api/v1/foods/nutrition?ids=a,b,c` — batch per-100g nutrition + normalized portions (plan U8).
     *
     * ⚠️ **Declared BEFORE `:id/status` and every other `:id` route.** Nest matches in declaration order, so
     * a route registered after a `:id` pattern would be swallowed by it — `nutrition` would bind as an id and
     * this endpoint would 404 with no clue why.
     *
     * ⛔ **GET, deliberately against this controller's own `POST /batch` precedent.** CloudFront does not
     * cache POST responses AT ALL, so following the local precedent would have silently voided the entire
     * reason food has a distribution (ADR-0020). The `ids` list is canonicalized — sorted, de-duplicated,
     * capped — so two callers asking for the same foods produce byte-identical URLs and therefore share a
     * cache entry.
     *
     * The response must not vary by caller; the edge keys it on the URL alone.
     */
    @Get('nutrition')
    public async getNutritionBatch(@Query() query: FoodNutritionQueryDto): Promise<FoodNutritionBatchResponse> {
        return this.foodsService.getNutritionBatch(this.requireNutritionIds(query.ids));
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
    /**
     * `PUT /api/v1/foods/{id}` — full replacement of an AUTHORED food (plan U10). Authorization is the
     * pure `authorshipPolicy`, evaluated in the service BEFORE anything else touches the row: stranger +
     * private → 404, stranger + promoted → 403, pipeline food → 409 `NOT_EDITABLE`.
     */
    @Put(':id')
    public async updateAuthored(
        @Param('id') id: string,
        @Body() body: UpdateAuthoredFoodBodyDto,
        @Req() req: AuthenticatedRequest,
    ): Promise<FoodResponse> {
        this.requireId(id);

        return this.foodsService.updateAuthored(this.requireUserUlid(req), id, body);
    }

    @Get(':id')
    public async getFood(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest,
        @Res({ passthrough: true }) res: Response,
    ): Promise<FoodResponse | PendingResponse> {
        this.requireId(id);

        try {
            // The requester key feeds the authorship gate (plan U10): a stranger reading a PRIVATE
            // authored food must get the same 404 a missing id gets. A `svc_*` principal is a stranger
            // to every authored food by construction.
            const food = await this.foodsService.getFood(id, this.requireRequesterId(req));
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

    /**
     * The requester key, narrowed to a PERSON (plan U10): the authored-food routes take a user's app ULID
     * and refuse a `svc_*` service principal with `403` — authored rows belong to people, and a service
     * writing one would put un-attributable content behind a person-shaped column.
     *
     * @param req - The guard-authenticated request.
     * @returns The caller's app-user ULID.
     * @throws (→ 401) the {@link requireRequesterId} cases; (→ 403) for a service principal.
     */
    private requireUserUlid(req: AuthenticatedRequest): string {
        const requesterId = this.requireRequesterId(req);

        if (requesterId.startsWith('svc_')) {
            throw apiError('FORBIDDEN', 'Authored foods belong to user accounts, not service principals.');
        }

        return requesterId;
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
     * Canonicalize the `?ids=` list, translating its typed failure into this API's structured error.
     *
     * The canonicalization is NOT validation-for-its-own-sake: the URL is the cache key (ADR-0020), so an
     * unsorted or duplicated list is a second cache entry for the same data, and an uncapped list is an
     * unbounded database read from a single request.
     *
     * ⚠️ **`details` is REQUIRED on both codes, not decoration.** `foodErrorSchema` publishes
     * `BATCH_TOO_LARGE` as carrying `details.maxNames` ("so a caller can re-chunk without guessing it") and
     * `VALIDATION_FAILED` as carrying `details.fields`. Raising either with a bare message emits a body the
     * service's OWN published schema rejects — so a client following §15 and validating food's envelope
     * cannot parse food's `400`, on the one endpoint where re-chunking is the whole recovery. `POST /batch`
     * has always reported `maxNames`; this path shipped without it (caught by `tests/e2e/foodsNutrition.e2e.test.ts`).
     *
     * @param ids - The raw `ids` query value.
     * @returns The canonical id list.
     * @throws (→ 400 `BATCH_TOO_LARGE` / `VALIDATION_FAILED`) when the list is over the cap or empty.
     */
    private requireNutritionIds(ids: string): string[] {
        try {
            return canonicalizeNutritionIds(ids);
        } catch (error) {
            if (isNutritionIdListError(error)) {
                // Mapped onto the EXISTING published codes rather than minting a new one: the error
                // taxonomy is part of the wire contract, and a new member is a schema-package change every
                // client must absorb. Over-cap is the same condition `BATCH_TOO_LARGE` already names for
                // `POST /batch`; an empty list is an ordinary validation failure.
                if (error.message.includes('exceeds')) {
                    // The published key is `maxNames` because the code is shared with `POST /batch`; here it
                    // caps ids rather than names, and the number is what a caller needs either way.
                    throw apiError('BATCH_TOO_LARGE', error.message, { maxNames: MAX_NUTRITION_IDS });
                }

                // The message already leads with the field it rejects, so it IS the rendered entry —
                // restating `'ids'` beside it would be a second copy of the same fact.
                throw apiError('VALIDATION_FAILED', error.message, { fields: [error.message] });
            }

            throw error;
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
        const cleaned = names.map((name) => sanitizeFoodName(name)).filter((name) => name.length > 0);
        const maxNames = this.config.get('FOOD_MAX_BATCH_NAMES', { infer: true });

        if (cleaned.length > maxNames) {
            throw apiError('BATCH_TOO_LARGE', `At most ${maxNames} names per batch`, { maxNames });
        }

        return cleaned;
    }

    /**
     * Reduce a caller's name to the canonical form the catalog stores, rejecting one that carries no visible
     * content at all.
     *
     * Here rather than in the published contract, for the reason {@link boundedNames} records: this is
     * server-side NORMALIZATION, and a `.transform()` cannot be represented in the derived JSON Schema. The
     * `400` is the same `VALIDATION_FAILED` the pipe raises for `""`, because `"\u200B"` is the same condition
     * written in characters a caller cannot see — see `../foodName.ts` for why it is the catalog's business.
     *
     * @param raw - The name the pipe accepted (length-bounded, JS-trimmed, non-empty).
     * @returns The canonical name, guaranteed to carry visible content.
     * @throws (→ 400 `VALIDATION_FAILED`) when nothing visible survives canonicalization.
     */
    private visibleName(raw: string): string {
        const name = sanitizeFoodName(raw);

        if (name.length === 0) {
            throw apiError('VALIDATION_FAILED', 'A food name must contain at least one visible character');
        }

        return name;
    }
}
