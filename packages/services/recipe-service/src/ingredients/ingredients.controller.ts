/**
 * T029 — `IngredientsController`: the `/api/v1/ingredients` HTTP surface (US1 MVP + async resolution).
 *
 * All endpoints are authenticated behind the fail-closed Clerk `AuthMiddleware`. The `@OwnerId()`
 * decorator resolves the verified caller ULID from `req.principal` and fails closed with `401` when it is
 * absent (route escaped auth) — here it is used PURELY as an authentication assertion: the shared
 * `ingredients` catalog is intentionally ownerless (data-model R5), so no endpoint keys on the caller, but
 * every one still proves the caller is authenticated exactly the way the sibling controllers (recipes,
 * ratings, account) do. Bodies are validated by the controller-scoped `ZodValidationPipe` against the DTOs in
 * `dto/`, which ARE the authored wire contract (`ingredients.schema.ts`) rather than a second set of
 * `class-validator` rules beside it — CODING_STANDARDS §15.2. Unknown keys are stripped, so a stray/spoofed
 * field never reaches the service:
 *
 *   - `GET /api/v1/ingredients/search?q=&limit=` — fuzzy + full-text autocomplete over the shared catalog
 *     (`200` → `Ingredient[]`). A missing/blank `q` is a `400`.
 *   - `POST /api/v1/ingredients` `{ name }` — create a freeform (user-entered) ingredient (`201` →
 *     `Ingredient`). A missing/blank/over-long name is a `400` (via {@link CreateIngredientDto}).
 *   - `POST /api/v1/ingredients/by-name` `{ name }` — add an unknown food by name through the source-agnostic
 *     food service (data-model R5): persists a food-backed catalog row and returns it (`202` → `Ingredient`)
 *     with its NON-terminal `foodResolutionStatus` (`PENDING` / `UNRESOLVED`). `202 Accepted` (not `201`) is
 *     deliberate: the ingredient ROW is created synchronously, but the meaningful work — nutrition resolution
 *     of the linked food — is asynchronous and NOT complete when this returns, so the caller must poll
 *     `GET :id/status` (or disambiguate an `UNRESOLVED` row). The status code is the caller's signal to poll,
 *     distinct from the synchronous `201` freeform create; the body's `foodResolutionStatus` is authoritative.
 *     A missing/blank/over-long name is a `400`. This is the ENTRY POINT of the async-resolution vertical
 *     (R5 / FR-007): `addByName` → `PENDING` (poll → `RESOLVED`) | `UNRESOLVED` (disambiguate) | terminal
 *     (`NOT_FOUND` / `FAILED`, freeform fallback).
 *   - `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model
 *     R5): re-reads the food service, persists the current status (and golden-record nutrition on
 *     `RESOLVED`), and returns the refreshed `Ingredient`. A missing ingredient is a `404`. This is a
 *     read from the caller's view (idempotent, convergent) and carries the generous read limit so a
 *     client polling a `PENDING` food is never throttled into a false failure mid-resolution.
 *   - `GET /api/v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED`
 *     food-backed ingredient (`200` → `IngredientCandidate[]`, RECIPE's own wire shape — see
 *     `ingredients.schema.ts` for why this endpoint no longer returns the food client's `CandidateView`;
 *     empty for a freeform or non-`UNRESOLVED` row).
 *   - `POST /api/v1/ingredients/{id}/resolve` `{ candidateIds }` — resolve an `UNRESOLVED` ingredient from a
 *     candidate pick, then re-poll so the newly-`RESOLVED` nutrition is persisted (`200` → `Ingredient`).
 *     A missing/empty/oversized `candidateIds` is a `400`; a missing ingredient is a `404`.
 *
 *   - `POST /api/v1/ingredients/corrections` `{ phrase, foodId, surfacing }` — record "this phrase means
 *     this food" in the resolution knowledge base (`200` → `RecordCorrectionResponse`, plan U14 / R19, R20).
 *     ⛔ The ONE route here that takes `@CurrentPrincipal()` rather than only `@OwnerId()`, and the reason is
 *     the authorization: how far a correction reaches is decided by the pure `evaluateMappingWrite` from the
 *     caller's SIGNED grants, so a controller forwarding only a ULID would silently make every correction
 *     author-scoped and the curator grant decorative — with nothing failing. ⛔ It is NOT behind a scopes
 *     Guard: the route must stay open to every authenticated user, because a cook fixing their own
 *     ingredient line is the ordinary case and the entire point of the learning loop. What is authorized is
 *     the FIELD VALUE `scope` (ADR-0023's shape, second instance). A `recorded: false` answer is a `200` —
 *     re-asserting a binding already in force is idempotent, not an error — while a phrase that reduces to
 *     nothing is a `400`.
 *
 * Input is validated at the boundary and delegated to {@link IngredientsService}; domain errors are
 * surfaced via thrown `RecipeError`s mapped by the global `ApiExceptionFilter`.
 *
 * **Forwarded caller credential (issue #120).** Every route that reaches the food service also takes
 * `@CallerBearerToken()`: food verifies a Clerk token, so recipe calls it AS the authenticated user rather
 * than with a service credential. The decorator yields `undefined` when the request carried no bearer (the
 * non-production dev-auth bypass) and the ingredient paths degrade rather than substitute a credential — see
 * `auth/CallerToken.ts` for why the credential is an opaque value object and never a `string`. The
 * local-only routes (`/search`, `POST /`) take no credential because they make no cross-service call.
 *
 * @implements FR-007 FR-007a FR-047
 */
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UsePipes,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Ingredient } from '@kitchensink/recipe-core';

import { CallerBearerToken } from '../auth/CallerToken.decorator.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { CurrentPrincipal, OwnerId } from '../auth/currentPrincipal.decorator.js';
import type { Principal } from '../auth/principal.js';
import { apiError } from '../common/apiError.js';
import { canonicalIngredientName, type CanonicalIngredientName } from './domain/ingredientName.js';
import { IngredientsService } from './ingredients.service.js';
import type { IngredientSuggestions } from './ingredientSuggestion.js';
import type { FoodReferencesResponse } from './ingredients.schema.js';
import type {
    IngredientCandidate,
    LiveIngredientSearchResponse,
    RecordCorrectionResponse,
} from './ingredients.schema.js';
import { ResolutionMappingsService } from './resolution/resolutionMappings.service.js';
import { AddIngredientByFoodDto } from './dto/addIngredientByFood.dto.js';
import { CreateIngredientDto } from './dto/createIngredient.dto.js';
import { RecordCorrectionDto } from './dto/recordCorrection.dto.js';
import { ResolveIngredientDto } from './dto/resolveIngredient.dto.js';
import { SearchRateLimit, WriteRateLimit } from '../common/throttle/throttle.decorators.js';

/** Parse the optional `limit` query param into a number (the DAL clamps it into `[1, 50]`, default 10). */
function parseLimit(raw: string | undefined): number | undefined {
    if (raw === undefined) {
        return undefined;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed)) {
        throw new BadRequestException('limit must be a number');
    }

    return parsed;
}

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/ingredients', 'v1/ingredients'])
@UsePipes(ZodValidationPipe)
export class IngredientsController {
    public constructor(
        private readonly ingredients: IngredientsService,
        /**
         * The U14 correction write path (plan U10 / R19, R20) — a SECOND collaborator rather than a method on
         * {@link IngredientsService}, because it owns its own Unit of Work over a different table and answers
         * a different question (what a phrase MEANS, not which ingredient row exists).
         */
        private readonly corrections: ResolutionMappingsService,
    ) {}

    /**
     * `GET /api/v1/ingredients/search` — fuzzy + FTS autocomplete over the shared ingredient catalog.
     *
     * @param _ownerId - The verified caller ULID (resolved by `@OwnerId()`, purely an auth assertion — the
     *   catalog is ownerless, so it is not used to scope the query, but its resolution guarantees the caller
     *   is authenticated and fails closed with `401` otherwise).
     * @param q - The name query (required, non-blank).
     * @param limit - Optional max hits (1–50, default 10).
     * @returns Ranked catalog ingredients.
     * @throws {BadRequestException} (→ 400) when `q` is missing/blank or `limit` is non-numeric.
     */
    @Get('search')
    @SearchRateLimit()
    public async search(
        @OwnerId() _ownerId: string,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<Ingredient[]> {
        const query = (q ?? '').trim();

        if (query.length === 0) {
            throw new BadRequestException('q is required');
        }

        return this.ingredients.search(query, parseLimit(limit));
    }

    /**
     * `GET /api/v1/ingredients/suggest` — the Stage-2 BLENDED typeahead: the shared `ingredients` catalog **plus**
     * the food-service golden catalog, deduped on `food_id` and sectioned by provenance.
     *
     * **Why this is a separate route from `/search`, not a flag on it.** They are different reads with
     * different consumers and different correctness rules — the same knowledge is not being duplicated:
     *  - `/search` returns `Ingredient[]`, every element a real catalog row whose `id` is a valid
     *    `recipe_ingredients.ingredient_id`. Its other consumer is the recipe-SEARCH ingredient filter, where
     *    a result id becomes an `ingredientIds` filter value — a not-yet-admitted food would be meaningless
     *    there (nothing could match it), so blending into `/search` would be wrong, not merely shape-breaking.
     *  - `/suggest` returns a DISCRIMINATED UNION, because a catalog hit has no ingredient id and no nutrition
     *    and must be admitted (`POST by-food`) before it can go on a recipe line.
     * A query param that switches the RESPONSE TYPE would put two contracts on one route and leave every
     * client narrowing by hand; a separate route keeps each contract single-shaped, and leaves `/search`'s
     * existing wire contract (and its clients) untouched.
     *
     * F2: never fails because of the food service — a slow/unavailable catalog yields the local section plus
     * `catalogAvailability: 'unavailable'`. The response's `catalogAvailability` is how the picker tells the
     * user the catalog is degraded instead of silently showing fewer results.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param q - The name query (required, non-blank).
     * @param limit - Optional max hits PER SECTION (1–50, default 10).
     * @returns The blended suggestions plus whether the food catalog contributed.
     * @throws {BadRequestException} (→ 400) when `q` is missing/blank or `limit` is non-numeric.
     */
    @Get('suggest')
    @SearchRateLimit()
    public async suggest(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Query('q') q?: string,
        @Query('limit') limit?: string,
    ): Promise<IngredientSuggestions> {
        const query = (q ?? '').trim();

        if (query.length === 0) {
            throw new BadRequestException('q is required');
        }

        return this.ingredients.suggest(caller, query, parseLimit(limit));
    }

    /**
     * `GET /api/v1/ingredients/search/live?q=` — the ON-DEMAND live source search (plan U29): the seam
     * behind the picker's "Search USDA for '…'" control.
     *
     * ⚠️ **Declared before every `:id` route.** Nest matches in declaration order, so registered after them
     * `search` would bind as an `:id` and this endpoint would 404 with no clue why.
     *
     * ⛔ **Never wire this to a typeahead.** Each call spends one request against a SHARED per-IP source
     * quota, out of FR-019's reserved interactive lane; the whole surface is affordable only because a cook
     * presses a button for it. It carries {@link WriteRateLimit} rather than {@link SearchRateLimit} for the
     * same reason: the per-user allowance for an action that costs an external call is the write budget, not
     * the generous read one a debounced typeahead needs. That is our own fairness limit, NOT the quota —
     * the quota is aggregate and lives in food-service (F-#4).
     *
     * ⚠️ It is the acknowledged SLOW path. A multi-second wait is expected here and is deliberately outside
     * SC-007's 500ms budget, which governs the LOCAL search.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param q - The name query (required, and at least the shared search minimum).
     * @returns The source's hits — EMPTY meaning the source answered and has nothing.
     * @throws {BadRequestException} (→ 400) when `q` is missing/blank or below the search minimum.
     * @throws {HttpException} `503 SOURCE_BUSY` when the rate budget refused; `502 SOURCE_UNAVAILABLE` when
     *   the source did not answer. Three outcomes a cook acts on differently — see the service.
     */
    @Get('search/live')
    @WriteRateLimit()
    public async searchLive(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Query('q') q?: string,
    ): Promise<LiveIngredientSearchResponse> {
        const query = (q ?? '').trim();

        if (query.length === 0) {
            throw new BadRequestException('q is required');
        }

        return this.ingredients.searchLive(caller, query);
    }

    /**
     * `POST /api/v1/ingredients` — create a freeform (user-entered) ingredient.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param body - `{ name }` (non-blank, ≤120 chars), validated by {@link CreateIngredientDto}.
     * @returns The created (or deduped) freeform ingredient.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @WriteRateLimit()
    public async create(@OwnerId() _ownerId: string, @Body() body: CreateIngredientDto): Promise<Ingredient> {
        return this.ingredients.createFreeform(this.visibleName(body.name));
    }

    /**
     * `POST /api/v1/ingredients/by-name` — add an unknown food by name through the source-agnostic food service.
     *
     * The ENTRY POINT of the async food-resolution vertical (data-model R5 / FR-007). The food service returns
     * a NON-terminal status (`PENDING` / `UNRESOLVED`); we persist a food-backed catalog row (deduped on the
     * opaque `food_id`) and return it immediately so the picker renders a "nutrition pending" state and either
     * polls `GET :id/status` to `RESOLVED` or disambiguates an `UNRESOLVED` row.
     *
     * Returns `202 Accepted` — NOT `201`: the row is created synchronously, but nutrition resolution proceeds
     * asynchronously and is incomplete when this returns, so the caller MUST poll. `202` is that poll signal
     * (distinct from the synchronous `201` freeform create); the body's `foodResolutionStatus` is authoritative.
     * A mutation (food-service add + DB write) → the write rate limit.
     *
     * ⚠️ **`ownerId` is no longer an auth assertion ALONE on this route** (plan U10). It is passed to the
     * service, where the resolution cascade uses it so a curated mapping the CALLER wrote outranks the global
     * one for them. Every other route here still takes it purely as the "this request is authenticated"
     * proof the shared, ownerless catalog otherwise has no use for.
     *
     * @param ownerId - The verified caller ULID: the authentication assertion, AND the identity whose own
     *   curated mappings take precedence in the cascade.
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param body - `{ name }` (non-blank, ≤120 chars), validated by {@link CreateIngredientDto}.
     * @returns The created (or deduped) food-backed ingredient with its current non-terminal resolution status.
     */
    @Post('by-name')
    @HttpCode(HttpStatus.ACCEPTED)
    @WriteRateLimit()
    public async addByName(
        @OwnerId() ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: CreateIngredientDto,
    ): Promise<Ingredient> {
        return this.ingredients.addByName(caller, this.visibleName(body.name), ownerId);
    }

    /**
     * `POST /api/v1/ingredients/by-food` — Stage 2 pick: admit a `catalog` suggestion from
     * {@link IngredientsController.suggest} as a food-backed ingredient, WITH its nutrition already backfilled.
     *
     * Returns **`200 OK`, not `202`** — the deliberate contrast with `by-name`. `by-name` is `202` because the
     * meaningful work (resolving an unknown food) is genuinely asynchronous and incomplete when it returns.
     * Here the food is an already-`RESOLVED` golden record, so the row is created AND its per-100g nutrition +
     * portions are written before the response: there is nothing to wait for, and telling the caller to poll
     * would be a lie. In the anomalous case where the food is unexpectedly still `PENDING`/`UNRESOLVED` and a
     * row already exists, that status comes back in the body and the caller uses the SAME poll/disambiguate
     * machinery — `foodResolutionStatus` is authoritative, exactly as it is for `by-name`.
     *
     * A mutation (food-service read + DB write) → the write rate limit.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param body - `{ foodId }` (non-blank, ≤64 chars), validated by {@link AddIngredientByFoodDto}. Any
     *   caller-supplied `name` is REFUSED with a `400` (it was stripped before GR-017 §17-c) — the display name
     *   comes from the food service, so a client that supplied one must learn it was not used.
     * @returns The food-backed ingredient with its golden-record nutrition.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when the food cannot back an ingredient (unknown,
     *   terminal, mid-resolution, or nameless) and no row exists to advance.
     */
    @Post('by-food')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async addByFood(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Body() body: AddIngredientByFoodDto,
    ): Promise<Ingredient> {
        return this.ingredients.addByFoodId(caller, body.foodId);
    }

    /**
     * `GET /api/v1/ingredients/{id}/status` — poll a food-backed ingredient's async resolution (data-model R5).
     *
     * Re-reads the food service, persists the current status (and golden-record nutrition on `RESOLVED`),
     * and returns the refreshed ingredient. A freeform ingredient (no linked food) is returned unchanged.
     * NO throttle decorator: this GET is a client-driven poll, so it inherits the generous read limit — the
     * tighter write/search limits would 429 a caller mid-resolution.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param id - The 001 ingredient id (UUID; a malformed id is a `400` via `ParseUUIDPipe`).
     * @returns The refreshed ingredient (with its current `foodResolutionStatus`).
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    /**
     * `GET /api/v1/ingredients/food-references/:foodId` (plan U18, R22) — how many live recipes reference
     * this food, plus the CALLER's own referencing recipe ids. Consumed by the food service's authored
     * DELETE flow with the caller's forwarded bearer; the count spans all users, the ids never do.
     *
     * ⚠️ Declared BEFORE the `:id/*` routes — Nest matches in declaration order.
     */
    @Get('food-references/:foodId')
    public async foodReferences(
        @OwnerId() ownerId: string,
        @Param('foodId') foodId: string,
    ): Promise<FoodReferencesResponse> {
        return this.ingredients.foodReferences(ownerId, foodId);
    }

    @Get(':id/status')
    public async status(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<Ingredient> {
        return this.ingredients.refreshStatus(caller, id);
    }

    /**
     * `GET /api/v1/ingredients/{id}/candidates` — the disambiguation candidate set for an `UNRESOLVED`
     * food-backed ingredient. A read (no throttle decorator). Empty for a freeform or non-`UNRESOLVED` row.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param id - The 001 ingredient id (UUID).
     * @returns The (non-expired) candidate set the caller can pick from to resolve the ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Get(':id/candidates')
    public async candidates(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<readonly IngredientCandidate[]> {
        return this.ingredients.getCandidates(caller, id);
    }

    /**
     * `POST /api/v1/ingredients/{id}/resolve` — resolve an `UNRESOLVED` food-backed ingredient from a candidate
     * pick, then re-poll so the newly-`RESOLVED` golden-record nutrition is persisted. Returns `200` with
     * the resolved ingredient (an update, not a creation). A mutation → the write rate limit.
     *
     * @param _ownerId - The verified caller ULID (auth assertion only; see {@link IngredientsController.search}).
     * @param caller - The caller's own bearer, forwarded to the food service (see the class doc).
     * @param id - The 001 ingredient id (UUID).
     * @param body - `{ candidateIds }` (non-empty, ≤20, each non-blank), validated by {@link ResolveIngredientDto}.
     * @returns The refreshed, resolved ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     */
    @Post(':id/resolve')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async resolve(
        @OwnerId() _ownerId: string,
        @CallerBearerToken() caller: CallerToken | undefined,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: ResolveIngredientDto,
    ): Promise<Ingredient> {
        return this.ingredients.resolve(caller, id, body.candidateIds);
    }

    /**
     * `POST /api/v1/ingredients/corrections` — record what an ingredient phrase MEANS (plan U14 / R19, R20).
     *
     * The affordance that makes U10's write path reachable: without it the knowledge base has a writer and
     * no caller, and the learning loop never fires. A mutation → the write rate limit.
     *
     * ⚠️ `200`, not `201`, and the choice carries information. The honest answer is often that NOTHING was
     * created — the caller re-asserted a binding already in force, or a concurrent correction committed
     * first — and `201 Created` would assert a resource that does not exist. The response body's `recorded`
     * discriminant is what says which happened.
     *
     * ⚠️ NO route Guard, deliberately — see the class doc. And no `foodId` verification against the food
     * service: migration 0021 requires every reader to treat an unresolvable mapping as a MISS and fall
     * through (U12's reseed mints fresh food ULIDs, so a dangling id is a certainty), and a cross-service
     * round-trip here would put a network dependency on a write whose entire value is that it is cheap.
     *
     * @param principal - The verified caller. Passed WHOLE: its signed `scopes`/`permissions` are what the
     *   pure scope policy reads, and this controller neither inspects nor narrows them.
     * @param body - `{ phrase, foodId, surfacing }`, validated by {@link RecordCorrectionDto}.
     * @returns What the correction did, and HOW FAR it reaches.
     * @throws {HttpException} `VALIDATION_FAILED` (→ 400) when the phrase carries no content the knowledge
     *   base can key on — the same condition, written in characters a caller cannot see, that
     *   {@link IngredientsController.visibleName} answers `400` for on a name.
     */
    @Post('corrections')
    @HttpCode(HttpStatus.OK)
    @WriteRateLimit()
    public async recordCorrection(
        @CurrentPrincipal() principal: Principal,
        @Body() body: RecordCorrectionDto,
    ): Promise<RecordCorrectionResponse> {
        const result = await this.corrections.recordCorrection({
            principal,
            phrase: body.phrase,
            foodId: body.foodId,
            surfacing: body.surfacing,
        });

        if (result.written) {
            return { recorded: true, mappingId: result.mappingId, scope: result.scope };
        }

        if (result.outcome === 'phrase_not_usable') {
            // ⛔ NOT a `recorded: false` answer. `min(1)` passes for zero-width characters and for
            // punctuation alone, and the normalized key is then empty — reporting that as "already in force"
            // would tell the caller their correction was redundant when it was never usable at all.
            throw apiError('VALIDATION_FAILED', 'phrase must contain at least one visible character');
        }

        // ⛔ `result.reason` is NOT forwarded. It is prose written for a reviewer reading the policy module;
        // publishing it would freeze that wording into the contract, and a client cannot branch on a
        // sentence. The closed `outcome` is what crosses.
        return { recorded: false, outcome: result.outcome };
    }

    /**
     * Reduce a caller's name to the canonical form the shared catalog stores, or reject it. THE parse
     * boundary for every name this API accepts (plan U3).
     *
     * ⛔ **HERE rather than in the published contract**, mirroring `foods.controller.ts`'s sibling method for
     * the sibling ownerless catalog. This is server-side NORMALIZATION, and `contract-gen` states the rule
     * directly: it "is not part of the shape a caller must satisfy — move it out of the published schema and
     * into the handler." Two further reasons this is not a style preference: an authored `*.schema.ts` that
     * imported the rule would drag the whole text of `recipe-core/src/foodName.ts` into the contract
     * fingerprint, so a future Unicode-hygiene fix with no wire projection would move `CONTRACT_HASH`; and
     * unlike `.trim()`, NFKC can EXPAND a string, so the published `maxLength: 120` would begin rejecting
     * bodies it documents as valid.
     *
     * The `400` is the SAME `VALIDATION_FAILED` envelope the validation pipe raises for `""`, because a name
     * of U+200B ZERO WIDTH SPACEs is the same condition written in characters a caller cannot see —
     * `String#trim` does not remove format characters, so the pipe's `min(1)` passes it and, before this, a
     * blank name was stored in a catalog every user searches.
     *
     * @param raw - The name from the validated request body (already trimmed and length-bounded).
     * @returns The parsed, branded canonical name.
     * @throws {HttpException} `VALIDATION_FAILED` (→ 400) when nothing visible survives canonicalization.
     */
    private visibleName(raw: string): CanonicalIngredientName {
        const name = canonicalIngredientName(raw);

        if (name === undefined) {
            throw apiError('VALIDATION_FAILED', 'name must contain at least one visible character');
        }

        return name;
    }
}
