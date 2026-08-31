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
 *   - **addByName** — consults the RESOLUTION CASCADE first (plan U10 / R11: curated mappings, then
 *     remembered resolutions), and admits the mapped food directly on a hit. On a miss —
 *     `foodClient.addByName` returns `202` (`PENDING` / `UNRESOLVED`); we persist a
 *     food-backed catalog row (deduped on the opaque `food_id`) and return it immediately with its
 *     non-terminal status, so the picker can render a "nutrition pending" state.
 *   - **poll** — {@link IngredientsService.refreshStatus} re-reads `foodClient.getStatus` and advances the
 *     stored status; on `RESOLVED` it also ADOPTS the golden record's canonical name (plan U3).
 *
 *   - **disambiguation** — {@link IngredientsService.getCandidates} + {@link IngredientsService.resolve}
 *     drive an `UNRESOLVED` food through `getCandidates` / `resolve(id, candidateIds)`.
 *   - **terminal** — a `NOT_FOUND` / `FAILED` food is written back as the ingredient's terminal status;
 *     the caller surfaces an error, offers a freeform fallback ({@link IngredientsService.createFreeform},
 *     `is_user_entered = true`), and allows removal. A terminal food never throws out of the poll.
 *
 * ⛔ **THE NAME ON A ROW IS SHARED STATE, AND ONLY FOOD-SERVICE MAY SETTLE IT** (plan U3). `ingredients` has
 * no `owner_id`: whoever adds a food names it for everyone who later searches. `addByName` must persist the
 * caller's own text when the food is not yet resolved — that text is the only label a `PENDING` food has, and
 * the owner ruling is that such a row stays VISIBLE in search so the demand signal is not lost — but it is a
 * PLACEHOLDER, not a label. From the picker that placeholder is a search term ("butter"); from the cookbook
 * importer it is a fragment of recipe prose ("1 cup of sifted pastry flour, well packed"), and ~92.8% of the
 * 448-recipe import's lines were decided against this table, so the placeholders became the corpus the ranker
 * searched. The repair is the WRITE path: every transition to `RESOLVED` — the poll, the pick, and an add
 * whose food food-service ALREADY holds — takes the canonical name, decided once by `canonicalNameFrom`. Do
 * not fix this by filtering non-terminal rows out of the read, and do not add a fourth name-writing path
 * without a {@link CanonicalIngredientName} (the DAL will not compile if you try).
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
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FoodResolutionStatus, RecipeErrorCode } from '@kitchensink/recipe-core';
import type { FoodReferencesResponse } from './ingredients.schema.js';
import type { Ingredient } from '@kitchensink/recipe-core';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { MIN_SEARCH_QUERY_LENGTH, meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';
import { isNotFoundError } from '@kitchensink/food-service-client';
import type { CandidateView, StatusResult } from '@kitchensink/food-service-client';

import type { CallerToken } from '../auth/CallerToken.js';
import { clampLimit, IngredientsDal } from './dal/ingredients.dal.js';
import type { CanonicalIngredientName } from './domain/ingredientName.js';
import { canonicalNameFrom, toResolutionStatus } from './foodStatusTranslation.js';
import type { IngredientResolutionsDal } from './resolution/ingredientResolutions.dal.js';
import { marginBandOf } from '@kitchensink/recipe-core/resolution/band-policy';
import { queryShapeOf } from '@kitchensink/recipe-core/resolution/band-policy';
import { RANKER_VERSION } from '@kitchensink/recipe-core/resolution/ranking-tiers';
import type { ResolutionBandsDal } from './resolution/resolutionBands.dal.js';
import { runResolutionCascade, type ResolutionTier } from './resolution/resolutionCascade.js';
import { FoodCatalogGateway } from './foodCatalog.gateway.js';
import { FoodServiceClients } from './FoodServiceClients.factory.js';
import { blendIngredientSuggestions } from './ingredientSuggestion.js';
import type { IngredientSuggestions } from './ingredientSuggestion.js';
import type { IngredientCandidate, LiveIngredientSearchResponse } from './ingredients.schema.js';
import { apiError } from '../common/apiError.js';
import { foodNotAdmissible, ingredientNotFound, isRecipeDomainError } from '../recipes/recipe.error.js';

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
    /** One logger for the cascade's tier failures — a degraded tier must be visible, never silent. */
    private readonly logger = new Logger(IngredientsService.name);

    /**
     * @param dal - The shared `ingredients` catalog.
     * @param foodClients - The per-caller food-service client factory.
     * @param catalog - The typeahead blend's short-timeout, no-throw gateway.
     * @param resolutionTiers - The ORDERED resolution cascade (plan U10). The order IS the configuration
     *   (R11), so it is injected as a registry rather than assembled here: today it holds tiers 1 and 3, U5/U6
     *   insert the lexical tier between them, and U11 appends the LLM tier. An EMPTY array is a valid and
     *   fully-supported state — it leaves `addByName` behaving exactly as it did before the cascade existed.
     */
    public constructor(
        private readonly dal: IngredientsDal,
        private readonly foodClients: FoodServiceClients,
        private readonly catalog: FoodCatalogGateway,
        private readonly resolutionTiers: readonly ResolutionTier[] = [],
        // Optional like the tiers above, for the same reason: a service constructed without the store is a
        // fully-supported state (unit fixtures, pre-0035 callers) — resolutions simply go unrecorded, which
        // is the pre-U2 behaviour.
        private readonly resolutions?: IngredientResolutionsDal,
        // Optional for the same reason again: without it, ranked events simply record no band epoch.
        private readonly bands?: Pick<ResolutionBandsDal, 'authorityFor'>,
    ) {}

    /**
     * `GET /api/v1/ingredients/food-references/{foodId}` (plan U18, R22) — who references this food.
     *
     * Serves the food service's delete flow (consulted with the CALLER's own forwarded bearer) and the
     * 409 body it reports back. `total` spans all users; ids are the CALLER's own recipes only — another
     * user's (possibly private) recipe id is never enumerated to the food's author.
     *
     * @param callerId - The authenticated caller's app-user ULID.
     * @param foodId - The opaque food id.
     * @returns The reference count and the caller's own referencing recipe ids.
     * @sideEffect One grouped read.
     */
    public async foodReferences(callerId: string, foodId: string): Promise<FoodReferencesResponse> {
        const references = await this.dal.recipesReferencingFood(foodId);

        return {
            total: references.length,
            ownRecipeIds: references.filter((row) => row.ownerId === callerId).map((row) => row.recipeId),
        };
    }

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
     * ON-DEMAND live source search (plan U29) — the seam behind the picker's "Search USDA for '…'" control.
     *
     * ⛔ **Not a typeahead, and it must never be wired to one.** Each call spends one request against a
     * SHARED per-IP source quota, out of FR-019's reserved interactive lane: at 50 concurrent cooks even a
     * perfect one-call-per-settled-query autocomplete would want roughly three times the whole hourly key.
     * It exists for a button a cook presses. It is also the acknowledged SLOW path — a multi-second wait is
     * the expected experience, and it is explicitly outside SC-007's 500ms local-search budget.
     *
     * ⛔ **Three outcomes, kept apart.** Unlike {@link suggest} — whose catalog half is additive and may
     * therefore flatten every failure into `catalogAvailability: 'unavailable'` — this method's outcome IS
     * the product: hits (possibly EMPTY, meaning the source answered and has nothing), `SOURCE_BUSY` (a rate
     * refusal that names its window), or `SOURCE_UNAVAILABLE` (the source did not answer). A cook takes a
     * different action on each, so collapsing any pair strands them in the wrong loop.
     *
     * @param caller - The requesting user's credential, forwarded to food. Absent → the source cannot be
     *   searched, reported as `SOURCE_UNAVAILABLE` by the gateway.
     * @param query - The raw user query (trimmed here).
     * @returns The source's hits, each carrying `foodId` when we already hold that food.
     * @throws {BadRequestException} (→ 400) below the 003-FR-010a search minimum, BEFORE any call goes out —
     *   a query that short can never justify a request against a shared external quota.
     * @throws {HttpException} `503 SOURCE_BUSY` / `502 SOURCE_UNAVAILABLE`, per the gateway's outcome.
     * @sideEffect Performs one food-service request that causes an upstream source call.
     */
    public async searchLive(caller: CallerToken | undefined, query: string): Promise<LiveIngredientSearchResponse> {
        const trimmed = query.trim();

        if (!meetsSearchMinimum(trimmed)) {
            throw new BadRequestException(`q must be at least ${MIN_SEARCH_QUERY_LENGTH} characters`);
        }

        const outcome = await this.catalog.searchLive(caller, trimmed);

        switch (outcome.kind) {
            case 'results':
                return { hits: outcome.hits };
            case 'busy':
                // The window rides in `details` only when one is actually known — see the schema arm for why
                // fabricating one is worse than omitting it.
                throw apiError(
                    'SOURCE_BUSY',
                    'The ingredient source is busy; try again shortly.',
                    outcome.retryAfterSeconds === undefined
                        ? undefined
                        : { retryAfterSeconds: outcome.retryAfterSeconds },
                );
            default:
                throw apiError('SOURCE_UNAVAILABLE', 'The ingredient source did not answer.');
        }
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
        // ⚠️ ONE decision, made once. This used to be an inline `status.food?.name?.trim()` — a second, weaker
        // copy of the same "may this name be used?" rule that `refreshStatus` now asks of
        // `canonicalNameFrom`, differing precisely in that `.trim()` admits a name of zero-width
        // characters into an ownerless catalog (plan U3).
        const name = canonicalNameFrom(status);

        if (name === undefined) {
            // Nothing admissible. An existing row still advances to the status we just observed, so the picker
            // can poll/disambiguate/fall back exactly as it does elsewhere; a brand-new pick is rejected
            // rather than half-admitted as a nameless row.
            if (existing !== undefined) {
                const advanced = await this.dal.updateResolution(existing.id, {
                    foodResolutionStatus: toResolutionStatus(status.status),
                });

                return advanced ?? existing;
            }

            throw foodNotAdmissible(
                id,
                status.status === 'RESOLVED'
                    ? 'the golden record has no usable name'
                    : `status is ${status.status}, not RESOLVED`,
            );
        }

        // U5: the golden record's consumption prior, captured into the local cache (ADR-0006 forbids a
        // cross-database join at rank time). Spread, not assigned: absent stays absent.
        const prior = status.food?.priorFraction === undefined ? {} : { priorFraction: status.food.priorFraction };
        const row =
            existing ??
            (await this.dal.createFoodBacked({
                name,
                foodId: id,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                ...prior,
            }));
        // Status + name — nutrition is no longer copied into this table (U10). The name matters even when the
        // row already existed: the pick may be landing on a row the importer minted under prose, and leaving
        // that alone would keep serving prose to every other user's search (plan U3).
        const backfilled = await this.dal.updateResolution(row.id, {
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            canonicalName: name,
            ...prior,
        });

        return backfilled ?? row;
    }

    /**
     * Consult the resolution cascade and, on a hit, admit the mapped food.
     *
     * ⛔ TOTAL AND NON-THROWING BY CONSTRUCTION. Every failure mode here — an unusable phrase, an exhausted
     * cascade, a tier whose database read failed, a mapping naming a food that no longer resolves — returns
     * `undefined`, which the caller reads as "carry on down the ordinary path". The cascade is a shortcut to a
     * better answer; it must never be able to WITHHOLD the ordinary one. The only error deliberately swallowed
     * is `UNKNOWN_INGREDIENT` from the admission, which is the stale-mapping case; anything else (a
     * food-service outage, a database failure on the `ingredients` write) still propagates, because those are
     * failures of the ordinary path too and hiding them would report success for an ingredient never created.
     *
     * @param caller - The requesting user's credential, forwarded to food-service on admission.
     * @param name - The phrase the caller supplied, already in canonical display form.
     * @param userId - The requesting user, or `undefined` for an unattended import (R22).
     * @returns The admitted ingredient, or `undefined` when the cascade could not (or should not) answer.
     * @sideEffect Runs the cascade's tiers, then admits a food (one food-service read + an `ingredients` write).
     */
    /**
     * The band-authority epoch a ranked resolution was made under, or `undefined` when the band has never
     * crossed a threshold — the "zero-authority" state KTD-A's pending derivation keys on.
     *
     * ⚠️ Quiet by contract: an unreadable band table degrades to "no epoch observed" rather than failing a
     * resolution that already succeeded, the same discipline as the event write around it.
     *
     * @param rung - The winner's ladder rung.
     * @param margin - The measured margin, or `undefined` for a singleton shortlist.
     * @param phrase - The resolved phrase, for the query-shape axis.
     * @returns The epoch as stored text, or `undefined`. @sideEffect One band-authority read.
     */
    private async observedBandEpoch(
        rung: string,
        margin: number | undefined,
        phrase: string,
    ): Promise<string | undefined> {
        if (this.bands === undefined) {
            return undefined;
        }

        try {
            const authority = await this.bands.authorityFor({
                rung,
                marginBand: marginBandOf(margin),
                queryShape: queryShapeOf(phrase),
                rankerVersion: RANKER_VERSION,
            });

            return authority === undefined ? undefined : String(authority.epoch);
        } catch (error) {
            this.logger.warn(
                'Band-authority read failed; the resolution event records no epoch.',
                error instanceof Error ? error.stack : String(error),
            );

            return undefined;
        }
    }

    private async resolveThroughCascade(
        caller: CallerToken | undefined,
        name: CanonicalIngredientName,
        userId: string | undefined,
    ): Promise<Ingredient | undefined> {
        if (this.resolutionTiers.length === 0) {
            return undefined;
        }

        const key = normalizedIngredientKey(name);

        if (key === undefined) {
            return undefined;
        }

        const outcome = await runResolutionCascade(
            this.resolutionTiers,
            { key, phrase: name },
            { userId, caller },
            {
                onTierFailure: (tier, error) =>
                    this.logger.warn(
                        `Resolution tier '${tier}' failed; falling through to the food service.`,
                        error instanceof Error ? error.stack : String(error),
                    ),
            },
        );

        if (outcome.kind !== 'resolved') {
            return undefined;
        }

        try {
            const admitted = await this.addByFoodId(caller, outcome.foodId);

            // U2: the provenance EVENT — which tier answered, recorded so the verification producer can
            // send real evidence and the band log (plan U3) has a substrate. Quietly: a lost event
            // degrades to `unattributed`, the pre-U2 behaviour, and must never fail a resolution that
            // already succeeded.
            if (this.resolutions !== undefined) {
                try {
                    await this.resolutions.record({
                        ingredientId: admitted.id,
                        tier: outcome.tier,
                        // KTD-C: a RANKED resolution persists its full confidence shape — the band log's
                        // substrate and the verification producer's evidence. Non-ranking tiers leave all
                        // of this undefined, exactly as before.
                        ...(outcome.rung === undefined
                            ? {}
                            : {
                                  rung: outcome.rung,
                                  margin: outcome.confidence,
                                  shortlist: outcome.shortlist,
                                  queryShape: queryShapeOf(name),
                                  rankerVersion: RANKER_VERSION,
                                  bandEpoch: await this.observedBandEpoch(outcome.rung, outcome.confidence, name),
                              }),
                    });
                } catch (recordError) {
                    this.logger.warn(
                        `Resolution provenance write failed for ingredient '${admitted.id}' (tier '${outcome.tier}').`,
                        recordError instanceof Error ? recordError.stack : String(recordError),
                    );
                }
            }

            return admitted;
        } catch (error) {
            if (isRecipeDomainError(error) && error.code === RecipeErrorCode.UNKNOWN_INGREDIENT) {
                // The stale-mapping case. `food_id` has no foreign key and U12's reseed mints fresh ULIDs, so
                // this is expected traffic rather than an incident — logged at `warn` so a SUSTAINED rate is
                // still visible as the "the knowledge base is pointing at a dead catalog" signal it would be.
                this.logger.warn(
                    `Curated mapping for '${name}' names food '${outcome.foodId}', which is not admissible; ` +
                        'falling through to the food service.',
                );

                return undefined;
            }

            throw error;
        }
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
     * ⛔ **`202` does NOT imply a non-terminal status, and assuming it did is what made caller prose
     * PERMANENT** (plan U3). `FoodsService.addByName` enqueues only when it CREATES or REACTIVATES a row;
     * for a food the catalog already holds it returns that food's real status — which is `RESOLVED` whenever
     * the name is already known. On that branch the row created here would be born terminal, and nothing
     * would ever rename it: `refreshStatus` is only reached by a client polling a non-terminal row, the
     * importer's settle pass re-reads only `PENDING`/`UNRESOLVED`, `addByFoodId` short-circuits on `RESOLVED`
     * and `resolve` is converge-only. It is also the DOMINANT branch once the catalog is warm — i.e. exactly
     * the state U12's reseed leaves for U15's re-import. So a `RESOLVED` add spends one more read to learn
     * the canonical name; every other status keeps the caller's placeholder, as it must.
     *
     * ⚠️ It does NOT delegate to {@link IngredientsService.addByFoodId}, which throws `UNKNOWN_INGREDIENT`
     * for a resolved-but-nameless golden record. That is the right answer for a PICK (the caller chose a row
     * that cannot back an ingredient) and the wrong one here, where the caller supplied a perfectly good name
     * of their own and a `400` would strand a legitimate add.
     *
     * ⛔ **THE RESOLUTION CASCADE IS CONSULTED FIRST** (plan U10 / R11, R19). This route is where BOTH the
     * picker and the cookbook importer land, so it is the one place a curated mapping written by one cook can
     * resolve another cook's — and every future import's — line without a food-service round trip. That is
     * AE6's whole content, and it is what makes the learning loop close. A cascade hit is admitted by
     * `food_id`, which also means the row is named from food-service's CANONICAL record rather than from the
     * caller's phrase, so this is the one add path that structurally cannot mint prose into the shared
     * catalog (plan U3).
     *
     * ⛔ A cascade hit is an OPTIMISATION, never an obligation: if the mapped food is not admissible, this
     * falls through to the ordinary path and never raises. `ingredients.food_id` has no foreign key and U12's
     * reseed mints fresh food ULIDs, so a mapping naming a food that no longer resolves is a certainty rather
     * than a hazard — and `UNKNOWN_INGREDIENT` is the right answer for a PICK (the caller chose that row) and
     * the wrong one here, where the caller chose a NAME and knows nothing about the mapping. Turning a stale
     * mapping into a `400` would take a whole class of ingredient adds down the day the catalog is reseeded.
     *
     * @param caller - The requesting user's credential, forwarded to food-service.
     * @param name - The display name, already parsed to its canonical form by the controller.
     * @param userId - The requesting user's ULID, so a curated mapping THEY wrote outranks the global one.
     *   `undefined` means an unattended import (R22): the cascade then sees global mappings and nobody's
     *   personal ones, because one user's private correction must never silently rewrite an import.
     * @returns The created (or deduped) food-backed ingredient with its current resolution status.
     * @sideEffect Consults the cascade, then calls the food service and reads/writes `ingredients`.
     */
    public async addByName(
        caller: CallerToken | undefined,
        name: CanonicalIngredientName,
        userId?: string,
    ): Promise<Ingredient> {
        const mapped = await this.resolveThroughCascade(caller, name, userId);

        if (mapped !== undefined) {
            return mapped;
        }

        const client = this.foodClients.standard(caller);
        const added = await client.addByName(name);
        const existing = await this.dal.findByFoodId(added.id);

        if (existing) {
            return existing;
        }

        const status = toResolutionStatus(added.status);
        const canonical =
            status === FoodResolutionStatus.RESOLVED ? await this.canonicalNameOf(client, added.id) : undefined;

        return this.dal.createFoodBacked({
            name: canonical ?? name,
            foodId: added.id,
            foodResolutionStatus: status,
        });
    }

    /**
     * Read a just-added food's canonical name, tolerating the narrow race in which it went terminal between
     * the add and this read.
     *
     * A `404` here is not a failure of the ADD — the row is legitimate and the caller's own name is a valid
     * placeholder for it — so it degrades to "no canonical name" rather than propagating. Naming is a quality
     * improvement on a path whose purpose is to persist the ingredient.
     *
     * @param client - The per-request food client, already minted for this caller.
     * @param foodId - The opaque food id just returned by add-by-name.
     * @returns The canonical name, or `undefined` when the food is terminal or carries no usable name.
     * @sideEffect One authenticated food-service read.
     */
    private async canonicalNameOf(
        client: ReturnType<FoodServiceClients['standard']>,
        foodId: string,
    ): Promise<CanonicalIngredientName | undefined> {
        try {
            return canonicalNameFrom(await client.getStatus(foodId));
        } catch (error) {
            if (isNotFoundError(error)) {
                return undefined;
            }

            throw error;
        }
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
            // Status + NAME (U3), and nothing else. Whether the food resolved is a fact about THIS
            // ingredient's link, and so is the label the shared row should now carry; what the food CONTAINS
            // is food's, read live rather than copied here (U10). `canonicalNameFrom` returns `undefined`
            // for every status that does not license a rename, which the DAL treats as "leave the name".
            const canonicalName = canonicalNameFrom(status);
            const updated = await this.dal.updateResolution(id, {
                foodResolutionStatus: toResolutionStatus(status.status),
                ...(canonicalName !== undefined ? { canonicalName } : {}),
                // U5: the refresh IS the prior's staleness contract — a food-side prior update reaches
                // the local rank column on exactly this write. Absent leaves the stored value.
                ...(status.food?.priorFraction === undefined ? {} : { priorFraction: status.food.priorFraction }),
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
     * ⚠️ The name is already in canonical form, not merely trimmed (plan U3). A freeform row is still a row in
     * the ownerless shared catalog, and its dedup key is the partial unique index on `lower(name)` — so an
     * invisible character in the name mints a second row that renders identically to the first.
     *
     * @param name - The display name, already parsed to its canonical form by the controller.
     * @returns The created or pre-existing freeform ingredient.
     * @sideEffect Reads, then conditionally inserts into `ingredients`.
     */
    public async createFreeform(name: CanonicalIngredientName): Promise<Ingredient> {
        return this.dal.createFreeform(name);
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
