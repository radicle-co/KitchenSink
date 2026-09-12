/**
 * Assemble every recipe READ projection that needs the food service.
 *
 * DESIGN PATTERN: Assembler (DTO) behind a Facade, as the Imperative Shell over `recipe-core`'s functional
 * core — three public methods over four private batched loaders, `computeDetailNutrition`, and the pure
 * assemblers in `recipe-core`.
 *
 * ## ⛔ Why this is its own collaborator
 *
 * `recipes.service.ts` records that *"exactly one food call per request is a property of the CALL GRAPH —
 * one call site per request — rather than of remembering to hoist a loop."* Inside a 2,113-line class that
 * was a convention; behind a three-method interface with `loadLineCatalog` PRIVATE it is a module boundary.
 * That is the whole argument for the extraction, and it is forfeited if any FOOD-touching loader becomes public.
 *
 * ⚠️ `loadPhotoRows` is the ONE deliberate public loader, and it touches no food: `getById` loads photos in
 * PARALLEL with the viewer's rating, and update/setVisibility/clone load them after their own writes. Folding
 * it into `toDetailResponse` would serialise that read behind the rating for no gain. The price is an ordering
 * rule callers keep — load the rows (or pass `[]`), then hand them to `toDetailResponse`.
 *
 * ## ⛔ It never takes a transaction — and what that does and does not guarantee
 *
 * ADR-0034 makes a recipe write and its version row atomic, and `recipes.service.ts` adds that a Postgres
 * transaction *"must never be held across a network call"*. Every caller reaches this class AFTER its
 * transaction has committed — create, update, clone, setVisibility and getById alike. No `RecipeTx` or
 * `Writer` type appears in any signature here, so this class cannot USE a transaction. ⚠️ That is narrower than
 * "cannot run inside one": nothing stops a caller awaiting `toDetailResponse` within a `transaction(async tx =>
 * …)` callback, so "call it after commit" remains a rule each call site keeps.
 *
 * ⚠️ Lifted OUT of `RecipesService` unchanged. Every ruling in the moved code came with it; the loaders,
 * their failure semantics and their ordering are as they were.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    computeRecipeNutrition,
    lineNutritionSource,
    toNutritionLine,
    type CatalogFoodResolutionStatus,
    type LineCatalogNutrition,
    type LineMeasure,
    type StatedMeasure,
    type LineResolutionStatus,
    type NutritionLine,
    type RecipeNutrition,
} from '@kitchensink/recipe-core';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import type { FoodStatus } from '@kitchensink/food-service-client';

import { PhotosDal } from '../photos/dal/photos.dal.js';
import { resolveCoverUrl, resolvePhotoView } from '../photos/photoView.js';
import { RecipesDal, type RecipeAggregate } from './dal/recipes.dal.js';
import { toRecipeNutritionState } from './domain/nutritionState.js';
import {
    isWithheld,
    isWithheldLine,
    pendingStateOf,
    type PendingState,
    ambiguousStateOf,
    identityContradictedOf,
    foodPresenceStatus,
    resolveLineStatus,
    viewerLineStatus,
    verifiedLineIdentity,
} from './domain/lineVerification.js';
import { LineVerificationsDal, type LineVerdictRow } from './dal/lineVerifications.dal.js';
import { sha256Hex } from '../common/sha256.js';
import type { RecipeNutritionResponse, RecipeNutritionState } from './recipes.schema.js';
import { quantityFromColumns, statedMeasureFromColumns } from './dal/quantityColumns.js';
import { parseStoredShortlist } from './domain/verificationRequests.js';
import { IngredientResolutionsDal } from '../ingredients/resolution/ingredientResolutions.dal.js';
import type { LatestResolution } from '../ingredients/resolution/ingredientResolutions.dal.js';
import type { RecipeResponse } from './dto/recipeResponse.dto.js';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import type { RecipeIngredientRow, RecipePhotoRow } from '../database/schema/index.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { FoodNutritionGateway } from '../ingredients/foodNutrition.gateway.js';
import { toRecipeResponse } from './mappers/recipeResponse.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_CDN_URL,
    RECIPE_PHOTOS_DAL,
} from './recipes.tokens.js';

/**
 * One recipe line as the nutrition path needs it: the measure the assembler consumes, the catalog
 * ingredient it resolves through, and the two columns a verification verdict is keyed on.
 *
 * ⚠️ `lineId` is the `recipe_ingredients` row id and is used ONLY to carry a per-LINE verdict back to the
 * right line within one request. It is deliberately NOT what the verdict is stored under: that id is
 * regenerated on every recipe save (`replaceForRecipe` deletes and re-inserts), which is exactly why the
 * verdict table is content-keyed instead.
 */
type LineNutritionInput = LineMeasure & {
    readonly ingredientId: string;
    readonly lineId: string;
    readonly sourceLine: string | null;
    /**
     * What the SOURCE printed, when this line's measure was restated (migration 0027).
     *
     * ⛔ CARRIED BECAUSE THIS SHAPE IS FED TO `verifiedLineIdentity`, which is how a line finds the verdict
     * the gate recorded about it. The stated measure is part of that key (`v2`), so dropping it here would
     * make every RESTATED line look up a key the worker never wrote — reporting "the gate has judged
     * nothing" for exactly the lines the gate was most likely to have an opinion about, and, because absence
     * of a verdict PUBLISHES, doing so completely silently.
     */
    readonly statedMeasure: StatedMeasure | undefined;
};

/**
 * Map a persisted `recipe_ingredients` row to the nutrition line-assembler input (W8-a.1), coercing the
 * `numeric` columns (surfaced as strings) to numbers and `null` to absent. Pure.
 */
function rowToMeasureInput(row: RecipeIngredientRow): LineNutritionInput {
    return {
        ingredientId: row.ingredientId,
        lineId: row.id,
        sourceLine: row.sourceLine,
        statedMeasure: statedMeasureFromColumns(row),
        quantity: quantityFromColumns(row),
        unit: row.unit,
        ...(row.userCalories !== null ? { userCalories: Number(row.userCalories) } : {}),
        ...(row.userProteinG !== null ? { userProteinG: Number(row.userProteinG) } : {}),
        ...(row.userCarbsG !== null ? { userCarbsG: Number(row.userCarbsG) } : {}),
        ...(row.userFatG !== null ? { userFatG: Number(row.userFatG) } : {}),
    };
}

/**
 * One batched catalog load: everything the line assembler and the nutrition classifier need, resolved once
 * for however many recipes the request named. Produced by `loadLineCatalog`.
 */
interface LineCatalog {
    /** Resolved per-100g nutrition + portions by INGREDIENT id; `undefined` when the food yielded none. */
    readonly byIngredientId: ReadonlyMap<string, LineCatalogNutrition | undefined>;
    /** The food each ingredient references — absent for a freeform ingredient that maps to no food. */
    readonly foodIdByIngredientId: ReadonlyMap<string, string>;
    /** The foods the lookup actually produced an entry for (live OR from cache). */
    readonly resolvedFoodIds: ReadonlySet<string>;
    /** How the SHARED lookup fared (`fresh` | `stale` | `absent`). */
    /** Whether any chunk of the shared lookup failed — for the reachable-vs-unreachable distinction only. */
    readonly degraded: boolean;
    /** Food ids served from cache after a failed refresh, so each recipe can be caveated on its OWN data. */
    readonly staleFoodIds: ReadonlySet<string>;
    /**
     * The shared catalog row's OWN food-resolution status, by ingredient id (U14).
     *
     * ⛔ The five-value CATALOG subset. `NEEDS_REVIEW` is layered on top of it PER LINE by
     * `resolveLineStatus` and is never read from — or written to — a catalog row (migration 0023).
     */
    readonly statusByIngredientId: ReadonlyMap<string, CatalogFoodResolutionStatus>;
    /**
     * FOOD's OWN lifecycle status for each ingredient's food, as published on THIS read (owner rulings
     * 3 + 4). Absent for an ingredient the lookup could not answer for.
     *
     * ⛔ A SEPARATE map rather than a field on `byIngredientId`. That value is `LineCatalogNutrition`, a
     * recipe-core type describing per-100g macros and portions; food's lifecycle vocabulary has no business
     * in it, and putting it there would push a foreign union into the shared nutrition model every consumer
     * imports. Food's vocabulary stops at this service, which is where the anti-corruption layer lives.
     *
     * ⚠️ DISTINCT from {@link statusByIngredientId} above, which is the PERSISTED mirror — stale by
     * construction for a withdrawal, since nothing refreshes it. `foodPresenceStatus` reads this one.
     */
    readonly liveFoodStatusByIngredientId: ReadonlyMap<string, FoodStatus>;
}

/**
 * What the gate concluded about the lines of one request, keyed by `recipe_ingredients` row id (U14).
 *
 * ⚠️ A line with NO entry is a line the gate has not judged, and that means PUBLISH — migration 0023's
 * standing rule for an asynchronous gate. An empty map is therefore the correct, common answer, not a
 * degraded one.
 */
type LineVerdicts = ReadonlyMap<string, LineVerdictRow>;

/**
 * Merge a set of line measures with a loaded catalog through the single {@link toNutritionLine}
 * line-assembler. Pure — the functional core the batched I/O feeds.
 *
 * ⛔ A WITHHELD line is assembled with NO catalog nutrition, which is what "withheld" means here: the
 * figure is not published, the line is not deleted, and the recipe's `isComplete` falls to `false` through
 * the same path any other unaccountable line takes. A per-line USER override (FR-007a) survives — the gate
 * judged OUR parse against the cook's source, and it has no standing over a number the cook typed
 * themselves.
 */
function assembleLines(
    catalog: LineCatalog,
    measures: readonly LineNutritionInput[],
    verdicts: LineVerdicts,
    pending: ReadonlyMap<string, PendingState>,
): NutritionLine[] {
    return measures.map(({ ingredientId, lineId, sourceLine: _sourceLine, ...measure }) =>
        toNutritionLine(
            measure,
            isWithheldLine(verdicts.get(lineId)?.band, pending.get(lineId) ?? 'none')
                ? undefined
                : catalog.byIngredientId.get(ingredientId),
        ),
    );
}

/**
 * How many of these lines KTD-A's pending state withheld and thereby cost this recipe a contribution.
 * Pure — the pending twin of {@link countWithheldContributions}, with the same "would otherwise have
 * accounted" discipline: a pending line the catalog could not have priced anyway, or one carrying the
 * cook's own override, did not cost the recipe its figure.
 */
function countPendingContributions(
    catalog: LineCatalog,
    measures: readonly LineNutritionInput[],
    pending: ReadonlyMap<string, PendingState>,
): number {
    return measures.filter(({ ingredientId, lineId, sourceLine: _sourceLine, ...measure }) => {
        if ((pending.get(lineId) ?? 'none') === 'none') {
            return false;
        }

        const withCatalog = toNutritionLine(measure, catalog.byIngredientId.get(ingredientId));

        return (
            lineNutritionSource(withCatalog) !== null &&
            lineNutritionSource(toNutritionLine(measure, undefined)) === null
        );
    }).length;
}

/**
 * How many of these lines the gate WITHHELD and thereby cost this recipe a contribution. Pure.
 *
 * ⚠️ A contradicted line only counts when withholding actually removed its accounting — a line the catalog
 * could not have priced anyway (no per-100g rows, or a unit with no mass) did not lose the recipe anything,
 * and a line carrying the cook's own override still accounts after the catalog figure is dropped. Counting
 * either would blame the gate for an absence it did not cause, and `verification_disagreement` is precisely
 * the claim "our own doubt is why there is no figure".
 */
function countWithheldContributions(
    catalog: LineCatalog,
    measures: readonly LineNutritionInput[],
    verdicts: LineVerdicts,
): number {
    return measures.filter(({ ingredientId, lineId, sourceLine: _sourceLine, ...measure }) => {
        // ⛔ CONTRADICTIONS ONLY, deliberately not KTD-A's pending withholds — those are counted (and
        // classified) separately, because "we disagreed" and "we have not checked yet" tell the reader two
        // different things with two different fixes. See `countPendingContributions`.
        if (!isWithheld(verdicts.get(lineId)?.band)) {
            return false;
        }

        const withCatalog = toNutritionLine(measure, catalog.byIngredientId.get(ingredientId));

        return (
            lineNutritionSource(withCatalog) !== null &&
            lineNutritionSource(toNutritionLine(measure, undefined)) === null
        );
    }).length;
}

/** The read-side collaborator `RecipesService` and `RecipesController` project details through. */
@Injectable()
export class RecipeDetailAssembler {
    public constructor(
        @Inject(RECIPES_DAL) private readonly dal: Pick<RecipesDal, 'findNutritionInputs'>,
        private readonly ingredientsDal: IngredientsDal,
        @Inject(RECIPE_PHOTOS_DAL) private readonly photosDal: PhotosDal,
        @Inject(RECIPE_PHOTOS_CDN_URL) private readonly photosCdnUrl: string,
        private readonly foodNutrition: FoodNutritionGateway,
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL) private readonly lineVerificationsDal: LineVerificationsDal,
        private readonly ingredientResolutions: IngredientResolutionsDal,
    ) {}

    /** Its own logger — a quiet-and-total read that failed open must still be visible. */
    private readonly logger = new Logger(RecipeDetailAssembler.name);

    /**
     * Load a recipe's photo ROWS in display order. Returns rows (not wire views) because the detail read
     * needs the cover row's `thumbnailKey` to resolve the cover thumbnail (FOLLOW-UP-CR-001-A), which the
     * `RecipePhoto` wire shape does not carry. {@link toDetailResponse} maps them to the gallery views.
     *
     * @sideEffect One `recipe_photos` read.
     */
    public async loadPhotoRows(recipeId: string): Promise<RecipePhotoRow[]> {
        return this.photosDal.findByRecipe(recipeId);
    }

    /**
     * Shape a recipe aggregate into the full `RecipeDetail` response: the metadata + composed ingredients
     * and steps, PLUS the embedded `photos` and computed per-serving `nutrition`. Used by every
     * single-recipe read (get/create/update/clone/set-visibility).
     *
     * `options.viewerRating` carries the viewer's own stars for the `viewerRating` field; only the GET
     * detail path supplies it (create/clone/update/set-visibility are owner operations, and an owner can
     * never hold a rating on their own recipe, so it is correctly absent there).
     *
     * ⚠️ Named for what it returns, but NOT a pure mapper like `toRecipeResponse` — it performs the detail
     * read's food and verification I/O.
     *
     * @sideEffect One `ingredients` read, one food lookup, one `recipe_ingredient_verifications` read, and the
     * pending/private-owner reads `computeDetailNutrition` makes.
     */
    public async toDetailResponse(
        aggregate: RecipeAggregate,
        photoRows: RecipePhotoRow[],
        // ⛔ `caller` is a REQUIRED key whose value may be `undefined`, never an optional one: the numbers
        // come from the food service, which authorizes the request as the calling user, and a path that
        // omits it degrades to nutrition from the in-process cache alone (absent when cold — which looks
        // exactly like a food outage). It WAS optional, and update, setVisibility, clone and restore all
        // omitted it for exactly that reason. An `undefined` here is now a decision someone wrote down.
        options: {
            readonly caller: CallerToken | undefined;
            readonly viewerId?: string;
            readonly viewerRating?: number;
        },
    ): Promise<RecipeResponse> {
        // The embedded gallery is always the FULL-SIZE originals (`resolvePhotoView.url`). The COVER,
        // however, serves the small thumbnail rendition (FOLLOW-UP-CR-001-A) via `resolveCoverUrl`, falling
        // back to the original when a photo predates the thumbnail. On detail the cover is the FIRST
        // photo — `loadPhotoRows` returns them in the same (sort_order, created_at) order the list/search
        // cover LATERAL uses, so all three read paths agree on which photo is the cover.
        const photos = photoRows.map((row) => resolvePhotoView(row, this.photosCdnUrl));
        const coverRow = photoRows[0];

        const { nutrition, lineStatuses } = await this.computeDetailNutrition(
            aggregate,
            options.caller,
            options.viewerId,
        );

        return toRecipeResponse(aggregate, {
            photos,
            // U14 — the per-line status the detail body badges. Absent for every line the gate has not
            // judged and whose catalog row reports nothing, which is the ordinary case.
            lineStatuses,
            // `nutrition` is the detail read's ONE calorie representation. It used to be accompanied by
            // `derivedNutrition: { leadCaloriesPerServing: nutrition.calories }` — the same number, from the
            // same computation, emitted a second time at the top level. Removed per ADR-0021's "Follow-up
            // owed": completeness is reported once (`nutrition.isComplete`), and so is the figure.
            nutrition,
            ...(coverRow !== undefined ? { coverPhotoUrl: resolveCoverUrl(coverRow, this.photosCdnUrl) } : {}),
            ...(options.viewerRating !== undefined ? { viewerRating: options.viewerRating } : {}),
        });
    }

    /**
     * The DEFERRED calorie lookup (`POST /api/v1/recipes/nutrition-batch`): each named recipe's per-serving
     * nutrition state, in ONE database read and ONE batched food lookup.
     *
     * ⛔ **AUTHORIZATION IS BY ABSENCE.** The read is visibility-scoped in SQL, and this method answers for
     * exactly the recipes it returned — a recipe the caller may not read is OMITTED from the map, never
     * given a state. Emitting `unaccounted` for another owner's recipe would confirm the id exists, and
     * emitting `known` would leak the figure. Do NOT "helpfully" fill absent ids in.
     *
     * ⛔ **ONE food call for the whole batch**, whatever the page size — the reason this endpoint exists at
     * all. The alternative (per-recipe assembly) is silently correct and quadratically expensive against a
     * service the recipe read now depends on at runtime.
     *
     * @param viewerId - The requesting principal's app-user ULID.
     * @param recipeIds - The recipes to report on (already capped by `recipeNutritionRequestSchema`).
     * @param caller - The requesting user's credential, forwarded to food. Absent ⇒ the gateway degrades.
     * @returns The nutrition state per READABLE recipe; unreadable and unknown ids are simply absent.
     * @sideEffect One `recipes` + `recipe_ingredients` read, one `ingredients` read, one food lookup.
     */
    public async getNutritionForRecipes(
        viewerId: string,
        recipeIds: readonly string[],
        caller: CallerToken | undefined,
    ): Promise<RecipeNutritionResponse> {
        const inputs = await this.dal.findNutritionInputs([...new Set(recipeIds)], viewerId);

        if (inputs.length === 0) {
            // Nothing readable — and therefore nothing to ask food about. A lookup here would forward this
            // caller's credential and this batch's food ids for recipes they may not see.
            return { nutrition: {} };
        }

        const measuresByRecipe = new Map(inputs.map((input) => [input.recipeId, input.lines.map(rowToMeasureInput)]));
        const allMeasures = [...measuresByRecipe.values()].flat();
        const catalog = await this.loadLineCatalog(
            caller,
            allMeasures.map((measure) => measure.ingredientId),
        );
        // ONE verdict read for the whole batch, for the same reason there is one food call: see
        // `loadLineVerdicts`. It runs AFTER the catalog because a verdict is keyed on the line's food id.
        const verdicts = await this.loadLineVerdicts(catalog, allMeasures);
        // KTD-A: one batched pending classification for the whole batch, like the verdict read above.
        const { pending } = await this.loadPendingStates(allMeasures, verdicts);

        const nutrition: Record<string, RecipeNutritionState> = {};

        for (const input of inputs) {
            const measures = measuresByRecipe.get(input.recipeId) ?? [];
            // The food counts are PER RECIPE, not per batch: under a partially-warm cache one recipe's foods
            // are recovered and another's are not, and a batch-wide verdict would report the second recipe's
            // outage as the first's (or hide it as `no_nutrient_data`).
            const referenced = new Set(
                measures
                    .map((measure) => catalog.foodIdByIngredientId.get(measure.ingredientId))
                    .filter((foodId): foodId is string => foodId !== undefined),
            );

            nutrition[input.recipeId] = toRecipeNutritionState(
                {
                    lines: assembleLines(catalog, measures, verdicts, pending),
                    referencedFoodCount: referenced.size,
                    resolvedFoodCount: [...referenced].filter((foodId) => catalog.resolvedFoodIds.has(foodId)).length,
                    staleFoodCount: [...referenced].filter((foodId) => catalog.staleFoodIds.has(foodId)).length,
                    withheldLineCount: countWithheldContributions(catalog, measures, verdicts),
                    pendingLineCount: countPendingContributions(catalog, measures, pending),
                },
                input.servings,
                catalog.degraded,
            );
        }

        return { nutrition };
    }

    /*
     * ⛔ `assembleNutritionLines` DELETED (plan U14). It was the single-recipe shell over
     * `loadLineCatalog` — load the catalog, assemble the lines — and its only caller was
     * `computeDetailNutrition`. That method now needs the LOADED CATALOG itself (for each line's food id,
     * to derive the verdict key, and for the catalog's own resolution status), so a shell that returned
     * only the assembled lines and discarded the catalog could no longer serve it. Keeping it would have
     * meant a second catalog load per detail read — the exact fan-out `loadLineCatalog`'s own docstring
     * exists to prevent. Its behaviour is unchanged and now lives inline in `computeDetailNutrition`.
     */

    /**
     * Compute a recipe's estimated per-serving nutrition (FR-007) from its ingredient lines — each line's
     * user-entered override (FR-007a) when present, else the catalog per-100g nutrition scaled by mass —
     * TOGETHER with the per-line resolution status the detail body renders (U14).
     *
     * ⚠️ ONE method returning BOTH, rather than two reads. The status and the figure are computed from the
     * same catalog load and the same verdict read, and splitting them would either double the I/O or let
     * the two disagree: a line badged "needs review" while its nutrition still fed the total is exactly the
     * incoherence this unit exists to remove.
     *
     * @sideEffect One `ingredients` read, one food lookup, one `recipe_ingredient_verifications` read.
     */
    private async computeDetailNutrition(
        aggregate: RecipeAggregate,
        caller: CallerToken | undefined,
        /** U13 (R20): the VIEWING user — the private-food overlay's comparand. Absent classifies as a stranger. */
        viewerId?: string,
    ): Promise<{ nutrition: RecipeNutrition; lineStatuses: ReadonlyMap<string, LineResolutionStatus> }> {
        const measures = aggregate.ingredients.map(rowToMeasureInput);
        // `loadLineCatalog` reaches the food service over HTTP and the next two steps chain off it;
        // `loadPrivateFoodOwners` takes only `measures`, so it has no reason to wait behind that round trip.
        const [catalog, privateOwners] = await Promise.all([
            this.loadLineCatalog(
                caller,
                measures.map((measure) => measure.ingredientId),
            ),
            this.loadPrivateFoodOwners(measures),
        ]);
        const verdicts = await this.loadLineVerdicts(catalog, measures);
        const { pending, resolutions } = await this.loadPendingStates(measures, verdicts);
        const lineStatuses = new Map<string, LineResolutionStatus>();

        for (const measure of measures) {
            const verdict = verdicts.get(measure.lineId);
            // U13 (D7/R9): material spread over the SAME parsed shortlist the producer's evidence uses —
            // one boundary parse, one agreement rule, so the gate and the badge cannot disagree.
            const ambiguous = ambiguousStateOf(
                verdict?.band,
                parseStoredShortlist(resolutions.get(measure.ingredientId)?.shortlist),
            );
            // ⛔ THE OVERLAY ORDER IS LOAD-BEARING, in both directions:
            //
            //   resolveLineStatus → foodPresenceStatus → viewerLineStatus
            //
            // Presence runs after resolution because it must override a STALE persisted mirror — nothing
            // refreshes `food_resolution_status` on a withdrawal, so a food withdrawn yesterday still reads
            // RESOLVED there. It runs BEFORE the viewer overlay because `RESOLVED_UNAVAILABLE` is a PRIVACY
            // answer ("this viewer is not served the details") and must never be rewritten into
            // `FOOD_REMOVED`, a FACTUAL claim about a food they are not entitled to know anything about.
            const status = viewerLineStatus(
                foodPresenceStatus(
                    resolveLineStatus(
                        verdict?.band,
                        catalog.statusByIngredientId.get(measure.ingredientId),
                        pending.get(measure.lineId) ?? 'none',
                        ambiguous,
                        // Owner ruling 2026-08-31 (§4): a high-certainty identity contradiction opens the
                        // re-pick door; a pre-0042 verdict (identityVerdict null) keeps the passive badge.
                        verdict !== undefined && identityContradictedOf(verdict),
                    ),
                    // The LIVE status this read obtained, never the persisted mirror. Absent (food
                    // unreachable, or the entry came from cache) leaves the line exactly as it was.
                    catalog.liveFoodStatusByIngredientId.get(measure.ingredientId),
                ),
                privateOwners.get(measure.ingredientId),
                viewerId,
            );

            if (status !== undefined) {
                lineStatuses.set(measure.lineId, status);
            }
        }

        return {
            nutrition: computeRecipeNutrition(
                assembleLines(catalog, measures, verdicts, pending),
                aggregate.recipe.servings,
            ),
            lineStatuses,
        };
    }

    /**
     * Batch-load the catalog per-100g nutrition for a set of INGREDIENT ids — ONE catalog query and ONE
     * batched food lookup, however many recipes those ids came from.
     *
     * ⛔ THE SEAM U10 EXISTS FOR. The ingredient row carries `food_id` and NOTHING food-derived, so the
     * numbers come from the food service — ONE batched call for every line in the recipe (or the whole
     * list), never one per ingredient. An earlier revision of this method dropped the columns and simply
     * stopped looking anything up, which made every recipe report `calories: 0, isComplete: false` while
     * 1654 unit tests stayed green: they mock the food client, so none of them exercised this wiring.
     * `nutrition.integration.test.ts` is what catches it, and it is why that tier is not optional.
     *
     * ⚠️ THE I/O IS SEPARATED FROM THE ASSEMBLY ON PURPOSE (functional core / imperative shell). This method
     * is the only place either read happens, so "exactly one food call per request" is a property of the
     * CALL GRAPH — one call site per request — rather than of remembering to hoist a loop. The deferred
     * batch endpoint fans one of these out across up to `MAX_NUTRITION_RECIPE_IDS` recipes; the earlier
     * shape, which assembled and looked up together, would have issued one lookup per recipe with every
     * answer still correct.
     *
     * @param caller - The requesting user's credential, forwarded to food (never substituted).
     * @param ingredientIds - Every ingredient id referenced by the lines about to be assembled.
     * @returns The catalog nutrition by ingredient id, the food each references, which foods resolved, and
     *   how the shared lookup fared.
     * @sideEffect One `ingredients` read; one batched {@link FoodNutritionGateway.lookup}.
     */
    private async loadLineCatalog(
        caller: CallerToken | undefined,
        ingredientIds: readonly string[],
    ): Promise<LineCatalog> {
        const rows = await this.ingredientsDal.findByIds([...new Set(ingredientIds)]);
        const foodIds = rows.map((row) => row.foodId).filter((id): id is string => id !== undefined);
        const lookup = await this.foodNutrition.lookup(caller, foodIds);

        const byIngredientId = new Map(
            rows.map((row) => {
                const nutrition = row.foodId === undefined ? undefined : lookup.byFoodId.get(row.foodId);

                return [row.id, nutrition] as const;
            }),
        );
        const foodIdByIngredientId = new Map(
            rows
                .filter((row): row is typeof row & { foodId: string } => row.foodId !== undefined)
                .map((row) => [row.id, row.foodId] as const),
        );

        return {
            byIngredientId,
            foodIdByIngredientId,
            resolvedFoodIds: new Set(lookup.byFoodId.keys()),
            degraded: lookup.degraded,
            staleFoodIds: new Set(
                [...lookup.byFoodId].filter(([, entry]) => entry.freshness === 'stale').map(([id]) => id),
            ),
            statusByIngredientId: new Map(
                rows
                    .filter(
                        (row): row is typeof row & { foodResolutionStatus: CatalogFoodResolutionStatus } =>
                            row.foodResolutionStatus !== undefined,
                    )
                    .map((row) => [row.id, row.foodResolutionStatus] as const),
            ),
            liveFoodStatusByIngredientId: new Map(
                rows
                    .map((row) => {
                        const status = row.foodId === undefined ? undefined : lookup.byFoodId.get(row.foodId)?.status;

                        return status === undefined ? undefined : ([row.id, status] as const);
                    })
                    .filter((entry): entry is readonly [string, FoodStatus] => entry !== undefined),
            ),
        };
    }

    /**
     * What the U11 verification gate concluded about these lines — ONE batched read, keyed back to each
     * line's row id (plan U14 / R15).
     *
     * ⛔ THIS IS THE READ THE GATE NEVER HAD. Migration 0023 shipped the verdict table, `recipe-workers`
     * shipped the writer, and nothing selected from it; a disagreement was durably stored and structurally
     * unable to reach a cook. The join it was waiting for is derivable now that migration 0024 admits
     * `recipe_ingredients.source_line`: a line's own columns plus its food id reproduce the content key the
     * verdict is stored under.
     *
     * ⚠️ ONE READ FOR THE WHOLE REQUEST, on the same reasoning as {@link loadLineCatalog}: the deferred
     * batch answers for up to `MAX_NUTRITION_RECIPE_IDS` recipes, and a per-line lookup would restore the
     * N+1 that endpoint exists to remove.
     *
     * @param catalog - The already-loaded catalog, for each line's food id.
     * @param measures - Every line in the request.
     * @returns Row id → band, for the lines the gate has judged. A line with no entry PUBLISHES.
     * @sideEffect One `recipe_ingredient_verifications` read.
     */
    private async loadLineVerdicts(
        catalog: LineCatalog,
        measures: readonly LineNutritionInput[],
    ): Promise<LineVerdicts> {
        const keyByLineId = new Map<string, string>();

        for (const measure of measures) {
            const identity = verifiedLineIdentity(measure, catalog.foodIdByIngredientId.get(measure.ingredientId));

            if (identity !== undefined) {
                keyByLineId.set(measure.lineId, verificationKey(identity, sha256Hex));
            }
        }

        if (keyByLineId.size === 0) {
            // Every line was authored rather than transcribed, or freeform. No verdict about any of them can
            // exist, so the read is skipped entirely rather than issued with an empty predicate.
            return new Map();
        }

        const bands = await this.lineVerificationsDal.findBandsByKeys([...keyByLineId.values()]);
        const byLineId = new Map<string, LineVerdictRow>();

        for (const [lineId, key] of keyByLineId) {
            const row = bands.get(key);

            if (row !== undefined) {
                byLineId.set(lineId, row);
            }
        }

        return byLineId;
    }

    /**
     * KTD-A's per-line pending classification (plan U4c): for each line, whether its ingredient's latest
     * resolution is a zero-authority LEXICAL bind still awaiting its verdict.
     *
     * ⚠️ Quiet and total, like every auxiliary read on this path: with no resolutions DAL, or on a failed
     * read, every line classifies `none` — the shipped absence-means-publish semantics, never an error.
     *
     * @param measures - The recipe's lines.
     * @param verdicts - The loaded verdicts, by line id.
     * @returns Pending state by line id. @sideEffect One batched resolutions read.
     */
    private async loadPendingStates(
        measures: readonly LineNutritionInput[],
        verdicts: LineVerdicts,
    ): Promise<{
        pending: ReadonlyMap<string, PendingState>;
        /** U13: the same batched read's events, by INGREDIENT id — the ambiguity classifier's feed. */
        resolutions: ReadonlyMap<string, LatestResolution>;
    }> {
        const pending = new Map<string, PendingState>();

        if (measures.length === 0) {
            return { pending, resolutions: new Map<string, LatestResolution>() };
        }

        let resolutions: ReadonlyMap<string, LatestResolution>;

        try {
            resolutions = await this.ingredientResolutions.latestResolutionsByIngredientIds(
                measures.map((measure) => measure.ingredientId),
            );
        } catch (error) {
            this.logger.warn(
                'Resolution provenance read failed; no line renders pending.',
                error instanceof Error ? error.stack : String(error),
            );

            return { pending, resolutions: new Map<string, LatestResolution>() };
        }

        const now = new Date();

        for (const measure of measures) {
            const event = resolutions.get(measure.ingredientId);
            pending.set(
                measure.lineId,
                pendingStateOf(
                    verdicts.get(measure.lineId)?.band,
                    event === undefined
                        ? undefined
                        : { tier: event.tier, bandEpoch: event.bandEpoch, resolvedAt: event.createdAt },
                    now,
                ),
            );
        }

        return { pending, resolutions };
    }

    /**
     * U13 (R20): the private-food OWNERS behind this read's lines — quiet and total like every auxiliary
     * read on this path: on failure no line renders unavailable, which is the shipped pre-U13 behaviour.
     * ⚠️ Failing OPEN here leaks only a STATUS treatment, never data: a stranger's nutrition read cannot
     * fetch a private food regardless (the food service refuses it), so the worst case is a line briefly
     * badged with its underlying state instead of "details unavailable".
     *
     * @sideEffect One batched `ingredients` read.
     */
    private async loadPrivateFoodOwners(measures: readonly LineNutritionInput[]): Promise<ReadonlyMap<string, string>> {
        if (measures.length === 0) {
            return new Map<string, string>();
        }

        try {
            return await this.ingredientsDal.privateFoodOwnersByIngredientIds(
                measures.map((measure) => measure.ingredientId),
            );
        } catch (error) {
            this.logger.warn(
                'Private-food owner read failed; no line renders unavailable.',
                error instanceof Error ? error.stack : String(error),
            );

            return new Map<string, string>();
        }
    }
}
