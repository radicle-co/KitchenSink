/**
 * T028 — `IngredientsService`: the ingredient picker's business logic, orchestrating the shared
 * `ingredients` catalog (via {@link IngredientsDal}) and the source-agnostic food service (via
 * `@kitchensink/food-service-client`, NEVER USDA directly).
 *
 * Async food resolution is first-class (data-model R5 / FR-007):
 *   - **search** — {@link IngredientsService.search} does local fuzzy + FTS catalog search over `ingredients`
 *     ONLY. It backs the recipe-SEARCH ingredient filter, whose result ids are filter values, so it must never
 *     return anything that lacks an `ingredients` row.
 *   - **suggest / typeahead (Stage 2)** — {@link IngredientsService.suggest} BLENDS that local search with the
 *     food-service golden catalog through the short-timeout, no-throw {@link FoodCatalogGateway}, deduped on
 *     `food_id` and sectioned by provenance. This is the picker's read.
 *   - **addByFoodId (Stage 2 pick)** — {@link IngredientsService.addByFoodId} admits a catalog suggestion as a
 *     food-backed row AND backfills its golden-record nutrition in one round-trip (F1).
 *   - **addByName** — `foodClient.addByName` returns `202` (`PENDING` / `UNRESOLVED`); we persist a
 *     food-backed catalog row (deduped on the opaque `food_id`) and return it immediately with its
 *     non-terminal status, so the picker can render a "nutrition pending" state.
 *   - **poll** — {@link IngredientsService.refreshStatus} re-reads `foodClient.getStatus`; on `RESOLVED`
 *     it persists the golden-record per-100g nutrition, otherwise it just advances the stored status.
 *   - **disambiguation** — {@link IngredientsService.getCandidates} + {@link IngredientsService.resolve}
 *     drive an `UNRESOLVED` food through `getCandidates` / `resolve(id, candidateIds)`.
 *   - **terminal** — a `NOT_FOUND` / `FAILED` food is written back as the ingredient's terminal status;
 *     the caller surfaces an error, offers a freeform fallback ({@link IngredientsService.createFreeform},
 *     `is_user_entered = true`), and allows removal. A terminal food never throws out of the poll.
 *
 * **Every food call is made AS THE CALLER** (issue #120). Food-service verifies a Clerk token, so the only
 * credential that can satisfy it is the requesting user's own. It is therefore threaded explicitly through
 * every food-touching operation as the FIRST parameter — the authority the operation acts under, stated at
 * each call site rather than picked up ambiently — and exchanged for a per-request client via
 * {@link FoodServiceClients}. `undefined` means the request carried no bearer (the non-production dev-auth
 * bypass); it is never substituted with another credential. `search` and `createFreeform` take no caller
 * because they touch nothing but the local catalog.
 *
 * @implements FR-007 FR-007a FR-047
 */
import { Injectable } from '@nestjs/common';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import { isNotFoundError } from '@kitchensink/food-service-client';
import type { CandidateView, FoodStatus, StatusResult } from '@kitchensink/food-service-client';

import type { CallerToken } from '../auth/CallerToken.js';
import { clampLimit, IngredientsDal } from './dal/ingredients.dal.js';
import { FoodCatalogGateway } from './foodCatalog.gateway.js';
import { FoodServiceClients } from './FoodServiceClients.factory.js';
import { blendIngredientSuggestions } from './ingredientSuggestion.js';
import type { IngredientSuggestions } from './ingredientSuggestion.js';
import type { IngredientCandidate } from './ingredients.schema.js';
import { foodNotAdmissible, ingredientNotFound } from '../recipes/recipe.error.js';

/**
 * Translate food's lifecycle status into recipe's persisted resolution status. Pure and total.
 *
 * ⛔ **This was a CAST, and the cast shipped a production `500`.** It read
 * `return status as FoodResolutionStatus`, above a comment asserting the two unions "are the SAME
 * UPPER_SNAKE union by design (they mirror each other)". True when written; falsified by plan U9, which
 * added `AWAITING_RETRY` to FOOD's enum and left recipe's five-value CHECK constraint
 * (`0001_initial.sql`) untouched. Because a cast asks the compiler to stop checking, `tsc` stayed silent
 * and the failure surfaced only as a check-constraint violation on write, for any ingredient whose food
 * was mid-retry.
 *
 * The `switch` is the point: it is exhaustive over food's union, so the next status food adds is a
 * COMPILE error here rather than a runtime one in production. Do not replace it with a cast, a lookup
 * with a default, or a `Record` that TypeScript cannot prove total.
 *
 * ⚠️ `AWAITING_RETRY` maps to `PENDING`, deliberately. Recipe's union is a UX vocabulary — "not ready
 * yet, will transition" versus "terminal, offer the freeform fallback" — and a scheduled retry is the
 * former: food's own transition table makes `AWAITING_RETRY` a legal prior for `RESOLVED`, and it becomes
 * `FAILED` only once the retry budget is exhausted, which recipe then sees as the terminal state it
 * already handles. Reporting failure here would strand the ingredient in the picker's terminal branch
 * while food was still working on it.
 *
 * @param status - The status food published.
 * @returns The status recipe persists and renders.
 */
export function toResolutionStatus(status: FoodStatus): FoodResolutionStatus {
    switch (status) {
        case 'PENDING':
        case 'UNRESOLVED':
        case 'RESOLVED':
        case 'NOT_FOUND':
        case 'FAILED':
            return status;
        case 'AWAITING_RETRY':
            return 'PENDING';
    }
}

/*
 * ⛔ DELETED HERE (KTD-3 / plan U10): `nutrientPer100g`, `extractNutrition`, `parsePortionAmount`,
 * `parsePortion` and `extractPortions`.
 *
 * They were the recipe service INTERPRETING food's data — a substring selector that matched `energy` and
 * so picked the `kJ` row as readily as the `kcal` one (a 4.184× error rendered as a calorie count), and a
 * portion parser that re-derived what a cup of a food weighs. Two services parsing the same rows can
 * disagree about one food, and only one of them owns it.
 *
 * Their replacements live in the FOOD service, which owns the data: `foods/nutrition/nutrientSelection.ts`
 * (basis + canonical name + unit — all three) and `foods/nutrition/portionNormalization.ts`. Recipe now
 * consumes the already-projected result through `FoodNutritionGateway` and keeps no heuristic of its own.
 */

/**
 * Map the food service's `CandidateView` onto the RECIPE API's own candidate shape.
 *
 * This one-line adapter is the whole point of the ownership decision recorded in `ingredients.schema.ts`: the
 * recipe API's public response body is `IngredientCandidate`, which recipe owns, and `CandidateView` is an
 * implementation detail of how recipe happens to obtain it. Before this, the controller returned
 * `readonly CandidateView[]` — so ANOTHER SERVICE'S CLIENT LIBRARY defined this endpoint's contract, and the
 * recipe client had to re-declare the shape to avoid depending on it.
 *
 * It is written field-by-field rather than as a pass-through cast on purpose: a field FOOD adds does not
 * silently become part of RECIPE's contract, and a field food REMOVES is a compile error here — at the seam
 * that has to decide what to do about it — rather than a silently-missing key on the wire.
 *
 * @param view - The food service's candidate view.
 * @returns The recipe API's candidate shape. Pure.
 */
function toIngredientCandidate(view: CandidateView): IngredientCandidate {
    return {
        candidateId: view.candidateId,
        source: view.source,
        externalKey: view.externalKey,
        name: view.name,
        summary: view.summary,
    };
}

@Injectable()
export class IngredientsService {
    public constructor(
        private readonly dal: IngredientsDal,
        private readonly foodClients: FoodServiceClients,
        private readonly catalog: FoodCatalogGateway,
    ) {}

    /**
     * Local catalog search (fuzzy `pg_trgm` + tsvector FTS) for the `GET /api/v1/ingredients/search`
     * autocomplete. Returns already-known catalog ingredients (with any resolved nutrition).
     *
     * @param query - The raw user query (trimmed here).
     * @param limit - Optional max hits (clamped by the DAL).
     * @returns Ranked catalog ingredients.
     * @sideEffect Reads `ingredients`.
     */
    public async search(query: string, limit?: number): Promise<Ingredient[]> {
        return this.dal.search(query.trim(), limit);
    }

    /**
     * Stage 2 — the BLENDED typeahead behind `GET /api/v1/ingredients/suggest`: the recipe-local `ingredients`
     * catalog **plus** the food-service golden catalog, deduped on `food_id` and sectioned by provenance.
     *
     * Before Stage 2 the typeahead saw only `ingredients` rows — foods that had already been *used* in a
     * recipe — so the ~8k lab-analyzed golden records Stage 1 seeded into food-service were invisible until
     * somebody add-by-named them. This is the read that makes them findable.
     *
     * **Availability discipline (F2).** The blend puts a cross-service round-trip on a per-keystroke path, so:
     *  - both reads are issued CONCURRENTLY — total latency is `max(local, catalog)`, not their sum;
     *  - the catalog read goes through {@link FoodCatalogGateway}, which is short-timeout and TOTAL (it
     *    degrades instead of throwing), so a slow/down food service costs the typeahead a bounded wait and
     *    yields `catalogAvailability: 'unavailable'` — the local section still renders, every time. The extra
     *    `catch` here is belt-and-braces: the gateway's no-throw guarantee is a contract, not a hope.
     *  - a LOCAL database failure is deliberately NOT swallowed. The recipe-local section is the floor of this
     *    feature; if it cannot be read, that is a real 500, not a degradation to hide.
     *
     * **Dedup.** Catalog hits the local search did not already return are crosswalked in ONE batch read
     * ({@link IngredientsDal.findByFoodIds}); a hit that turns out to have an `ingredients` row is PROMOTED
     * into the familiar section rather than shown as a catalog hit (it is pickable with no round-trip). The
     * dedup is therefore exact, not dependent on whether the local `limit` window happened to include the row.
     *
     * @param caller - The requesting user's credential, forwarded to food-service. `undefined` degrades the
     *   catalog half to `unavailable` (see {@link FoodCatalogGateway}); the local section still renders.
     * @param query - The raw user query (trimmed here). Blank yields an empty envelope.
     * @param limit - Optional max hits PER SECTION (clamped to `[1, 50]`, default 10).
     * @returns The sectioned, deduped suggestions plus whether the food catalog contributed.
     * @sideEffect Reads `ingredients` (twice at most) and performs one short-timeout food-service request.
     */
    public async suggest(
        caller: CallerToken | undefined,
        query: string,
        limit?: number,
    ): Promise<IngredientSuggestions> {
        const trimmed = query.trim();
        const perSection = clampLimit(limit);

        const [local, catalog] = await Promise.all([
            this.dal.search(trimmed, perSection),
            // The gateway is total by contract; this guard exists so a future regression there degrades the
            // typeahead rather than 500-ing a keystroke.
            this.catalog
                .search(caller, trimmed, perSection)
                .catch(() => ({ hits: [] as const, availability: 'unavailable' as const })),
        ]);

        const knownFoodIds = new Set(
            local.flatMap((ingredient) => (ingredient.foodId === undefined ? [] : [ingredient.foodId])),
        );
        const uncrosswalked = catalog.hits.map((hit) => hit.foodId).filter((foodId) => !knownFoodIds.has(foodId));
        const promoted = uncrosswalked.length > 0 ? await this.dal.findByFoodIds(uncrosswalked) : [];

        return {
            suggestions: blendIngredientSuggestions({
                local,
                promoted,
                catalogHits: catalog.hits,
                limit: perSection,
            }),
            catalogAvailability: catalog.availability,
        };
    }

    /**
     * Stage 2 pick path (F1) — admit a food-catalog suggestion into the shared `ingredients` catalog as a
     * food-backed row that ALREADY carries its golden-record nutrition.
     *
     * **Why this is not just `createFoodBacked`.** A catalog suggestion comes from `/api/v1/foods/search`, whose
     * `SearchResultView` carries **no nutrition**, and `createFoodBacked` writes only `name`/`food_id`/`status`
     * — nutrition reaches an `ingredients` row ONLY through `updateResolution`. Creating the row and stopping
     * there would ship an ingredient with NULL calories that nothing ever backfills (the status poll stops on a
     * `RESOLVED` row). So the pick does exactly ONE food-service read and writes the nutrition through.
     *
     * **Read-then-create, not create-then-read** (same single round-trip, strictly safer): the read is what
     * supplies the display name, and the name MUST come from food-service. Accepting a caller-supplied name
     * would let any authenticated client attach an arbitrary label to a real food in a catalog that is
     * ownerless and shared by every user (data-model R5) — mislabeled nutrition for everyone. The read also
     * validates the id before anything is written, so a stale or hand-crafted `foodId` cannot create a row.
     *
     * Poll-free in TIMING (a Stage-1 seeded food is already `RESOLVED`, so the read returns immediately) but it
     * IS one cross-service round-trip — not "already has nutrition, no call".
     *
     * @param caller - The requesting user's credential, forwarded to food-service.
     * @param foodId - The opaque food-service id from a `catalog` suggestion (trimmed here).
     * @returns The food-backed ingredient, `RESOLVED`. Nutrition is NOT carried (U10) — it is read live.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when the food cannot back an ingredient — unknown,
     *   terminal, still mid-resolution, or nameless — and no row already exists to advance.
     * @sideEffect One food-service read, then inserts/updates `ingredients`.
     */
    public async addByFoodId(caller: CallerToken | undefined, foodId: string): Promise<Ingredient> {
        const id = foodId.trim();
        const existing = await this.dal.findByFoodId(id);

        // Already settled: nothing to admit and nothing to advance — no round-trip.
        //
        // ⚠️ This used to also require `existing.caloriesPer100g !== undefined` ("already nourished"). U10
        // dropped that column, and simply deleting the clause made the short-circuit unreachable — every
        // repeat pick issued a second cross-service read. The RESOLUTION STATUS is the same signal and is
        // data this service still owns: a row that reached `RESOLVED` has nothing left to learn from food
        // about its identity, and its NUTRITION is fetched live on read rather than backfilled here.
        // `blendedSuggest.integration.test.ts` is what caught the extra call; no unit test could.
        if (existing !== undefined && existing.foodResolutionStatus === FoodResolutionStatus.RESOLVED) {
            return existing;
        }

        const status = await this.readFoodStatus(caller, id, existing);
        const resolved = status.status === 'RESOLVED' ? status.food : undefined;
        const name = resolved?.name?.trim();

        if (resolved === undefined || name === undefined || name.length === 0) {
            // Nothing admissible. An existing row still advances to the status we just observed, so the picker
            // can poll/disambiguate/fall back exactly as it does elsewhere; a brand-new pick is rejected
            // rather than half-admitted as a nameless, nutrition-less row.
            if (existing !== undefined) {
                const advanced = await this.dal.updateResolution(existing.id, {
                    foodResolutionStatus: toResolutionStatus(status.status),
                });

                return advanced ?? existing;
            }

            throw foodNotAdmissible(
                id,
                resolved === undefined ? `status is ${status.status}, not RESOLVED` : 'the golden record has no name',
            );
        }

        const row =
            existing ??
            (await this.dal.createFoodBacked({
                name,
                foodId: id,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            }));
        // Status only — nutrition is no longer copied into this table (U10).
        const backfilled = await this.dal.updateResolution(row.id, {
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
        });

        return backfilled ?? row;
    }

    /**
     * Read a food's status for the pick path, translating a food-service `404` (unknown row, or a terminal
     * `NOT_FOUND`/`FAILED`) into the terminal status the caller then records or rejects on.
     *
     * @param caller - The requesting user's credential, forwarded to food-service.
     * @param id - The opaque food id.
     * @param existing - The pre-existing ingredient row, when there is one (drives the reject-vs-advance choice).
     * @returns The observed status result.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` when the food is unknown/terminal and no row exists to advance.
     * @sideEffect Performs one authenticated food-service HTTP request.
     */
    private async readFoodStatus(
        caller: CallerToken | undefined,
        id: string,
        existing: Ingredient | undefined,
    ): Promise<StatusResult> {
        try {
            return await this.foodClients.standard(caller).getStatus(id);
        } catch (error) {
            if (!isNotFoundError(error)) {
                throw error;
            }

            const terminal = error.foodStatus ?? 'NOT_FOUND';

            if (existing === undefined) {
                throw foodNotAdmissible(id, `the food service reports ${terminal}`);
            }

            return { id, status: terminal };
        }
    }

    /**
     * Add an unknown food by name. The food service returns `202` with a non-terminal status
     * (`PENDING` / `UNRESOLVED`); we persist a food-backed catalog row (deduped on the opaque `food_id`)
     * and return it immediately so the picker renders a "nutrition pending" state and polls later.
     *
     * @param caller - The requesting user's credential, forwarded to food-service.
     * @param name - The display name (trimmed here).
     * @returns The created (or deduped) food-backed ingredient with its current resolution status.
     * @sideEffect Calls the food service, then reads/writes `ingredients`.
     */
    public async addByName(caller: CallerToken | undefined, name: string): Promise<Ingredient> {
        const trimmed = name.trim();
        const added = await this.foodClients.standard(caller).addByName(trimmed);
        const existing = await this.dal.findByFoodId(added.id);

        if (existing) {
            return existing;
        }

        return this.dal.createFoodBacked({
            name: trimmed,
            foodId: added.id,
            foodResolutionStatus: toResolutionStatus(added.status),
        });
    }

    /**
     * Poll and persist the current resolution status of a food-backed ingredient. On `RESOLVED` the
     * golden-record per-100g nutrition is written back; a terminal `NOT_FOUND` / `FAILED` is recorded as
     * the ingredient's status (never thrown — the picker surfaces it and offers a freeform fallback).
     *
     * @param caller - The requesting user's credential, forwarded to food-service.
     * @param id - The 001 ingredient id.
     * @returns The refreshed ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     * @sideEffect Calls the food service, then updates `ingredients`.
     */
    public async refreshStatus(caller: CallerToken | undefined, id: string): Promise<Ingredient> {
        const ingredient = await this.requireIngredient(id);

        // Freeform / user-entered ingredients carry no food reference — nothing to poll.
        if (ingredient.foodId === undefined) {
            return ingredient;
        }

        try {
            const status = await this.foodClients.standard(caller).getStatus(ingredient.foodId);
            // Status only (U10): whether the food resolved is a fact about THIS ingredient's link. What the
            // food CONTAINS is food's, read live rather than copied here.
            const updated = await this.dal.updateResolution(id, {
                foodResolutionStatus: toResolutionStatus(status.status),
            });

            return updated ?? ingredient;
        } catch (error) {
            // A terminal food (NOT_FOUND / FAILED) or a vanished row surfaces as a client NotFoundError;
            // record the terminal status rather than propagating, so the picker can fall back to freeform.
            if (isNotFoundError(error)) {
                const terminal = toResolutionStatus(error.foodStatus ?? 'NOT_FOUND');
                const updated = await this.dal.updateResolution(id, { foodResolutionStatus: terminal });

                return updated ?? ingredient;
            }

            throw error;
        }
    }

    /**
     * The disambiguation candidate set for an `UNRESOLVED` food-backed ingredient.
     *
     * @param caller - The requesting user's credential, forwarded to food-service.
     * @param id - The 001 ingredient id.
     * @returns The (non-expired) candidate set; empty for a freeform or non-`UNRESOLVED` ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     * @sideEffect Calls the food service.
     */
    public async getCandidates(caller: CallerToken | undefined, id: string): Promise<readonly IngredientCandidate[]> {
        const ingredient = await this.requireIngredient(id);

        if (ingredient.foodId === undefined) {
            return [];
        }

        const result = await this.foodClients.standard(caller).getCandidates(ingredient.foodId);

        return result.candidates.map(toIngredientCandidate);
    }

    /**
     * Resolve an `UNRESOLVED` food-backed ingredient from a candidate pick, then re-poll so the newly
     * `RESOLVED` golden-record nutrition is persisted.
     *
     * **Converge-only.** A `RESOLVED` ingredient is a TERMINAL, immutable resolution: its `food_id` and
     * golden-record nutrition are settled and must not be re-pointed. The `ingredients` catalog is
     * intentionally ownerless (data-model R5) and shared across users, so without this guard any caller
     * could re-`resolve` an already-resolved row to a DIFFERENT (still-legitimate) candidate and overwrite
     * the food link + nutrition another user's resolution produced — a cross-user data-integrity defect,
     * not an IDOR. So an already-`RESOLVED` ingredient is returned unchanged (idempotent no-op) without
     * calling the food service or writing; only a still-open (non-terminal-resolved) ingredient may be
     * driven to a resolution.
     *
     * @param caller - The requesting user's credential, forwarded to food-service.
     * @param id - The 001 ingredient id.
     * @param candidateIds - The picked candidate row ids (validated to the food's own set by the service).
     * @returns The refreshed, resolved ingredient (or the existing resolution, unchanged, when already `RESOLVED`).
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) when no such ingredient exists.
     * @sideEffect Calls the food service (resolve + status), then updates `ingredients` — SKIPPED entirely
     *   for a freeform or already-`RESOLVED` ingredient.
     */
    public async resolve(
        caller: CallerToken | undefined,
        id: string,
        candidateIds: readonly string[],
    ): Promise<Ingredient> {
        const ingredient = await this.requireIngredient(id);

        // Freeform / user-entered ingredients carry no food reference — nothing to resolve.
        if (ingredient.foodId === undefined) {
            return ingredient;
        }

        // Converge-only: never overwrite a settled resolution (see the method docstring). Returning the
        // loaded row (rather than re-polling) guarantees no food-service call and no write occur.
        if (ingredient.foodResolutionStatus === FoodResolutionStatus.RESOLVED) {
            return ingredient;
        }

        await this.foodClients.standard(caller).resolve(ingredient.foodId, candidateIds);

        return this.refreshStatus(caller, id);
    }

    /**
     * Create (or dedup-return) a freeform, user-entered ingredient (`is_user_entered = true`) for the
     * `POST /api/v1/ingredients` fallback — a name with no linked food record. Its nutrition, when supplied,
     * lives per-line on `recipe_ingredients`, not here.
     *
     * @param name - The display name (trimmed here).
     * @returns The created or pre-existing freeform ingredient.
     * @sideEffect Reads, then conditionally inserts into `ingredients`.
     */
    public async createFreeform(name: string): Promise<Ingredient> {
        return this.dal.createFreeform(name.trim());
    }

    /** Load an ingredient or throw the shared `RECIPE_NOT_FOUND` domain error (mapped to 404 by the filter). */
    private async requireIngredient(id: string): Promise<Ingredient> {
        const ingredient = await this.dal.findById(id);

        if (ingredient === undefined) {
            throw ingredientNotFound(id);
        }

        return ingredient;
    }
}
