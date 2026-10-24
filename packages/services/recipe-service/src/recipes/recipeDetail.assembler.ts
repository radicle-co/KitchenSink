/**
 * Assemble every recipe READ projection that needs the food service.
 *
 * DESIGN PATTERN: Assembler (DTO) behind a Facade, as the Imperative Shell over `recipe-core`'s functional
 * core — three public methods over private batched loaders, the pure status overlays in
 * `domain/lineVerification.ts`, the pure view composer in `domain/ingredientLineView.ts`, and the pure
 * assemblers in `recipe-core`.
 *
 * ## The read, in order (plan 002 R9)
 *
 * 1. ONE bindings read (`FoodLookupsDal.findByIds`), where each `food_lookups` row is parsed into its arm.
 * 2. Concurrently: the nutrition of the bound foods — roots and variants alike, by the id each binding stores (curated
 *    U9) — the lines' names (`LineIdentityReader`, detail only), and the verdict and pending reads. The verdict read
 *    no longer waits for food, because the food id a verdict is keyed on is on the binding (`foodRefOf(arm)`).
 * 3. Per line, the pure overlay chain `resolveLineStatus → foodPresenceStatus → viewerLineStatus`, then
 *    `composeIngredientLineView`.
 *
 * So the detail read makes two concurrent food requests (nutrition and names) and the card batch makes one
 * (nutrition). Each is ONE batched request for the whole read, never one per line: the batching lives in the
 * loaders here and in the gateways, which is why no food-touching loader is public.
 *
 * ⚠️ `loadPhotoRows` is the ONE deliberate public loader, and it touches no food: `getById` loads photos in
 * PARALLEL with the viewer's rating, and update/setVisibility/clone load them after their own writes. The price
 * is an ordering rule callers keep — load the rows (or pass `[]`), then hand them to `toDetailResponse`.
 *
 * ## ⛔ It never takes a transaction — and what that does and does not guarantee
 *
 * ADR-0034 makes a recipe write and its version row atomic, and `recipes.service.ts` adds that a Postgres
 * transaction *"must never be held across a network call"*. Every caller reaches this class AFTER its
 * transaction has committed. No `RecipeTx` or `Writer` type appears in any signature here, so this class cannot
 * USE a transaction. ⚠️ That is narrower than "cannot run inside one": nothing stops a caller awaiting
 * `toDetailResponse` within a `transaction(async tx => …)` callback, so "call it after commit" remains a rule
 * each call site keeps.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    computeRecipeNutrition,
    FoodResolutionStatus,
    lineNutritionSource,
    nutritionFreshness,
    toNutritionLine,
    type LineCatalogNutrition,
    type LineMeasure,
    type StatedMeasure,
    type NutritionFreshness,
    type NutritionLine,
    type RecipeDetailNutrition,
} from '@kitchensink/recipe-core';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';

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
import { composeIngredientLineView, type IngredientLineView } from './domain/ingredientLineView.js';
import { LineVerificationsDal, type LineVerdictRow } from './dal/lineVerifications.dal.js';
import { sha256Hex } from '../common/sha256.js';
import type { RecipeNutritionResponse, RecipeNutritionState } from './recipes.schema.js';
import { quantityFromColumns, statedMeasureFromColumns } from './dal/quantityColumns.js';
import { userNutritionFromColumns } from './dal/userNutritionColumns.js';
import { parseStoredShortlist } from './domain/verificationRequests.js';
import { IngredientResolutionsDal } from '../ingredients/resolution/ingredientResolutions.dal.js';
import type { LatestResolution } from '../ingredients/resolution/ingredientResolutions.dal.js';
import type { RecipeResponse } from './dto/recipeResponse.dto.js';
import { FoodLookupsDal } from '../ingredients/dal/foodLookups.dal.js';
import {
    catalogStatusOf,
    presenceOf,
    type IngredientLineIdentity,
} from '../ingredients/domain/ingredientLineIdentity.js';
import { LineIdentityReader } from '../ingredients/lineIdentity.reader.js';
import { foodRefOf, privateFoodOwnerOf, type FoodLookupArm } from '../database/schema/foodLookupArm.js';
import type { IngredientRow, RecipePhotoRow } from '../database/schema/index.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { FoodNutritionGateway, type NutritionReadBudget } from '../ingredients/foodNutrition.gateway.js';
import { toRecipeResponse } from './mappers/recipeResponse.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_CDN_URL,
    RECIPE_PHOTOS_DAL,
} from './recipes.tokens.js';

/**
 * One recipe line as the nutrition path needs it: the measure the assembler consumes, the binding it resolves
 * through, and the two columns a verification verdict is keyed on.
 *
 * ⚠️ `lineId` is the `ingredients` row id and is used ONLY to carry a per-LINE verdict back to the right line
 * within one request. It is deliberately NOT what the verdict is stored under: that id is regenerated on every
 * recipe save (`replaceForRecipe` deletes and re-inserts), which is exactly why the verdict table is
 * content-keyed instead.
 */
type LineNutritionInput = LineMeasure & {
    readonly lookupId: string;
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
 * Map a persisted `ingredients` row to the nutrition line-assembler input (W8-a.1), coercing the `numeric`
 * columns (surfaced as strings) to numbers and `null` to absent. Pure.
 */
function rowToMeasureInput(row: IngredientRow): LineNutritionInput {
    return {
        lookupId: row.foodLookupId,
        lineId: row.id,
        sourceLine: row.sourceLine,
        statedMeasure: statedMeasureFromColumns(row),
        quantity: quantityFromColumns(row),
        unit: row.unit,
        ...userNutritionFromColumns(row),
    };
}

/**
 * One batched nutrition load: everything the line assembler and the nutrition classifier need, resolved once for
 * however many recipes the request named. Produced by `loadLineCatalog`.
 */
interface LineCatalog {
    /**
     * Resolved per-100g nutrition + portions by LOOKUP id; `undefined` when the binding's food yielded none.
     *
     * ⛔ `freshness` is REQUIRED here although it is optional on `LineCatalogNutrition`: this is the one server
     * producer of catalog entries, and an entry that forgot it would make every line it feeds read as current.
     */
    readonly byLookupId: ReadonlyMap<
        string,
        (LineCatalogNutrition & { readonly freshness: NutritionFreshness }) | undefined
    >;
    /** The food id each bound binding stores — a root's or a variant's (one id namespace); absent for an unresolved one. */
    readonly foodRefIdByLookupId: ReadonlyMap<string, string>;
    /**
     * Whether a binding's ROOT has a live variant, from food's batch entry (curated U9). Absent when food's entry said
     * nothing — a variant's entry, no entry, or none recovered — which the line view reads as `false`.
     */
    readonly hasLiveVariantsByLookupId: ReadonlyMap<string, boolean>;
    /** The foods the lookup actually produced an entry for (live OR from cache). */
    readonly resolvedFoodIds: ReadonlySet<string>;
    /**
     * Whether food left any id unanswered — for the reachable-vs-unreachable distinction only. ⛔ Never for marking a
     * recipe stale, which each line's `freshness` does: a recipe whose own foods all came back fresh is not caveated
     * because a sibling recipe's chunk failed.
     */
    readonly degraded: boolean;
}

/** The verdict and pending reads of one request, which run beside the food requests. */
interface LineJudgements {
    readonly verdicts: LineVerdicts;
    readonly pending: ReadonlyMap<string, PendingState>;
    /** The latest resolution event by LOOKUP id — the ambiguity classifier's feed. */
    readonly resolutions: ReadonlyMap<string, LatestResolution>;
}

/**
 * The view of a line whose binding vanished between the recipe read and the bindings read — a rebind that
 * repointed the line and removed the orphaned binding in that window. The line is shown as unreachable for this
 * read, which a reload resolves; the alternative is failing the whole recipe on a race.
 */
const VANISHED_BINDING_VIEW: IngredientLineView = {
    isUserEntered: false,
    resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
};

/**
 * What the gate concluded about the lines of one request, keyed by `ingredients` row id (U14).
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
    return measures.map(({ lookupId, lineId, sourceLine: _sourceLine, ...measure }) =>
        toNutritionLine(
            measure,
            isWithheldLine(verdicts.get(lineId)?.band, pending.get(lineId) ?? 'none')
                ? undefined
                : catalog.byLookupId.get(lookupId),
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
    return measures.filter(({ lookupId, lineId, sourceLine: _sourceLine, ...measure }) => {
        if ((pending.get(lineId) ?? 'none') === 'none') {
            return false;
        }

        const withCatalog = toNutritionLine(measure, catalog.byLookupId.get(lookupId));

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
    return measures.filter(({ lookupId, lineId, sourceLine: _sourceLine, ...measure }) => {
        // ⛔ CONTRADICTIONS ONLY, deliberately not KTD-A's pending withholds — those are counted (and
        // classified) separately, because "we disagreed" and "we have not checked yet" tell the reader two
        // different things with two different fixes. See `countPendingContributions`.
        if (!isWithheld(verdicts.get(lineId)?.band)) {
            return false;
        }

        const withCatalog = toNutritionLine(measure, catalog.byLookupId.get(lookupId));

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
        private readonly lookups: FoodLookupsDal,
        private readonly identities: LineIdentityReader,
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
     * @sideEffect One bindings read, two concurrent food requests (nutrition and names), and the verdict and
     *   pending reads.
     */
    public async toDetailResponse(
        aggregate: RecipeAggregate,
        photoRows: RecipePhotoRow[],
        // ⛔ `caller` is a REQUIRED key whose value may be `undefined`, never an optional one: the numbers and
        // the names come from the food service, which authorizes the request as the calling user, and a path
        // that omits it degrades every bound line to nameless. An `undefined` here is a decision someone wrote
        // down. ⛔ `budget` is required for the same reason: whether this response follows a COMMITTED write
        // decides how long it may wait on food, and a path that has not said so must not compile.
        options: {
            readonly caller: CallerToken | undefined;
            readonly budget: NutritionReadBudget;
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

        const { nutrition, lineViews } = await this.computeDetailNutrition(
            aggregate,
            options.caller,
            options.budget,
            options.viewerId,
        );

        return toRecipeResponse(aggregate, lineViews, {
            photos,
            // `nutrition` is the detail read's ONE calorie representation — no top-level copy of the same
            // figure (ADR-0021): completeness is reported once (`nutrition.isComplete`), and so is the figure.
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
     * all. It asks food for no names: a card carries no lines.
     *
     * @param viewerId - The requesting principal's app-user ULID.
     * @param recipeIds - The recipes to report on (already capped by `recipeNutritionRequestSchema`).
     * @param caller - The requesting user's credential, forwarded to food. Absent ⇒ the gateway degrades.
     * @returns The nutrition state per READABLE recipe; unreadable and unknown ids are simply absent.
     * @sideEffect One `recipes` + `ingredients` read, one bindings read, one food lookup, and the verdict and
     *   pending reads.
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
        const arms = await this.lookups.findByIds(allMeasures.map((measure) => measure.lookupId));
        // A READ — the card batch — so the standard food deadline.
        const [catalog, { verdicts, pending }] = await Promise.all([
            this.loadLineCatalog(caller, arms, 'read'),
            this.loadJudgements(arms, allMeasures),
        ]);

        const nutrition: Record<string, RecipeNutritionState> = {};

        for (const input of inputs) {
            const measures = measuresByRecipe.get(input.recipeId) ?? [];
            // The food counts are PER RECIPE, not per batch: under a partially-warm cache one recipe's foods
            // are recovered and another's are not, and a batch-wide verdict would report the second recipe's
            // outage as the first's (or hide it as `no_nutrient_data`).
            const referenced = new Set(
                measures
                    .map((measure) => catalog.foodRefIdByLookupId.get(measure.lookupId))
                    .filter((foodId): foodId is string => foodId !== undefined),
            );

            nutrition[input.recipeId] = toRecipeNutritionState(
                {
                    lines: assembleLines(catalog, measures, verdicts, pending),
                    referencedFoodCount: referenced.size,
                    resolvedFoodCount: [...referenced].filter((foodId) => catalog.resolvedFoodIds.has(foodId)).length,
                    withheldLineCount: countWithheldContributions(catalog, measures, verdicts),
                    pendingLineCount: countPendingContributions(catalog, measures, pending),
                },
                input.servings,
                catalog.degraded,
            );
        }

        return { nutrition };
    }

    /**
     * Compute a recipe's estimated per-serving nutrition (FR-007) from its ingredient lines — each line's
     * user-entered override (FR-007a) when present, else the catalog per-100g nutrition scaled by mass —
     * TOGETHER with each line's composed view (U14, plan 002 R9).
     *
     * ⚠️ ONE method returning BOTH, rather than two reads. The status and the figure are computed from the
     * same loads, and splitting them would either double the I/O or let the two disagree: a line badged
     * "needs review" while its nutrition still fed the total is exactly the incoherence this unit removes.
     *
     * @sideEffect One bindings read, two concurrent food requests, and the verdict and pending reads.
     */
    private async computeDetailNutrition(
        aggregate: RecipeAggregate,
        caller: CallerToken | undefined,
        budget: NutritionReadBudget,
        /** U13 (R20): the VIEWING user — the private-food overlay's comparand. Absent classifies as a stranger. */
        viewerId?: string,
    ): Promise<{ nutrition: RecipeDetailNutrition; lineViews: ReadonlyMap<string, IngredientLineView> }> {
        const measures = aggregate.ingredients.map(rowToMeasureInput);
        const arms = await this.lookups.findByIds(measures.map((measure) => measure.lookupId));
        const [catalog, identities, { verdicts, pending, resolutions }] = await Promise.all([
            this.loadLineCatalog(caller, arms, budget),
            this.identities.identifyArms(caller, arms, budget),
            this.loadJudgements(arms, measures),
        ]);
        const lineViews = new Map<string, IngredientLineView>();

        for (const measure of measures) {
            const identity = identities.get(measure.lookupId);

            if (identity === undefined) {
                this.logger.warn('A line’s binding vanished between reads; it renders unreachable for this read.', {
                    lineId: measure.lineId,
                    lookupId: measure.lookupId,
                });
                lineViews.set(measure.lineId, VANISHED_BINDING_VIEW);
                continue;
            }

            lineViews.set(
                measure.lineId,
                composeIngredientLineView(
                    identity,
                    finalLineStatus(
                        identity,
                        verdicts.get(measure.lineId),
                        pending.get(measure.lineId),
                        resolutions.get(measure.lookupId),
                        viewerId,
                    ),
                    { hasLiveVariants: catalog.hasLiveVariantsByLookupId.get(measure.lookupId) },
                ),
            );
        }

        // Assembled ONCE: the figure and its freshness must be read off the same lines, or a withheld line could
        // count in one and not the other.
        const lines = assembleLines(catalog, measures, verdicts, pending);

        return {
            nutrition: {
                ...computeRecipeNutrition(lines, aggregate.recipe.servings),
                freshness: nutritionFreshness(lines),
            },
            lineViews,
        };
    }

    /**
     * Batch-load the per-100g nutrition behind a set of bindings — ONE batched food lookup, however many recipes
     * those bindings came from.
     *
     * ⛔ Skipping the lookup makes every recipe report `calories: 0, isComplete: false` while every unit test
     * stays green, because they mock the food client. `nutrition.integration.test.ts` is what catches it.
     *
     * Both arms are asked about, by the id the binding stores (curated U9): food's batch answers a root or a variant id
     * — one namespace — with that entry's OWN numbers, a forwarded id with its forward's end, so a variant line reads
     * the variant's numbers and never its root's (R21).
     *
     * @param caller - The requesting user's credential, forwarded to food (never substituted).
     * @param arms - The bindings, by lookup id.
     * @param budget - The food latency contract the lookup runs under.
     * @returns The nutrition by lookup id, the food id each references, whether each root has a live variant, which
     *   foods resolved, and how the shared lookup fared.
     * @sideEffect One batched {@link FoodNutritionGateway.lookup}.
     */
    private async loadLineCatalog(
        caller: CallerToken | undefined,
        arms: ReadonlyMap<string, FoodLookupArm>,
        budget: NutritionReadBudget,
    ): Promise<LineCatalog> {
        const foodRefIdByLookupId = new Map(
            [...arms.values()].flatMap((arm) => {
                const ref = foodRefOf(arm);

                return ref === undefined ? [] : [[arm.lookupId, ref.id] as const];
            }),
        );
        const lookup = await this.foodNutrition.lookup(caller, [...new Set(foodRefIdByLookupId.values())], budget);

        const entryOf = (lookupId: string) => {
            const foodId = foodRefIdByLookupId.get(lookupId);

            return foodId === undefined ? undefined : lookup.byFoodId.get(foodId);
        };

        return {
            byLookupId: new Map([...arms.keys()].map((lookupId) => [lookupId, entryOf(lookupId)] as const)),
            foodRefIdByLookupId,
            hasLiveVariantsByLookupId: new Map(
                [...arms.keys()].flatMap((lookupId) => {
                    const hasLiveVariants = entryOf(lookupId)?.hasLiveVariants;

                    return hasLiveVariants === undefined ? [] : [[lookupId, hasLiveVariants] as const];
                }),
            ),
            resolvedFoodIds: new Set(lookup.byFoodId.keys()),
            degraded: lookup.unansweredIds.size > 0,
        };
    }

    /**
     * The verdict read, then the pending read that depends on it. Neither waits for food: the food id a verdict
     * is keyed on is on the binding.
     *
     * @sideEffect One `recipe_ingredient_verifications` read and one batched resolutions read.
     */
    private async loadJudgements(
        arms: ReadonlyMap<string, FoodLookupArm>,
        measures: readonly LineNutritionInput[],
    ): Promise<LineJudgements> {
        const verdicts = await this.loadLineVerdicts(arms, measures);
        const { pending, resolutions } = await this.loadPendingStates(measures, verdicts);

        return { verdicts, pending, resolutions };
    }

    /**
     * What the U11 verification gate concluded about these lines — ONE batched read, keyed back to each
     * line's row id (plan U14 / R15).
     *
     * ⚠️ ONE READ FOR THE WHOLE REQUEST, on the same reasoning as {@link loadLineCatalog}: the deferred
     * batch answers for up to `MAX_NUTRITION_RECIPE_IDS` recipes, and a per-line lookup would restore the
     * N+1 that endpoint exists to remove.
     *
     * @param arms - The bindings, for each line's bound food id through `foodRefOf`.
     * @param measures - Every line in the request.
     * @returns Row id → verdict, for the lines the gate has judged. A line with no entry PUBLISHES.
     * @sideEffect One `recipe_ingredient_verifications` read.
     */
    private async loadLineVerdicts(
        arms: ReadonlyMap<string, FoodLookupArm>,
        measures: readonly LineNutritionInput[],
    ): Promise<LineVerdicts> {
        const keyByLineId = new Map<string, string>();

        for (const measure of measures) {
            const arm = arms.get(measure.lookupId);
            const identity = verifiedLineIdentity(measure, arm === undefined ? undefined : foodRefOf(arm)?.id);

            if (identity !== undefined) {
                keyByLineId.set(measure.lineId, verificationKey(identity, sha256Hex));
            }
        }

        if (keyByLineId.size === 0) {
            // Every line was authored rather than transcribed, or has no food to judge. No verdict about any of
            // them can exist, so the read is skipped entirely rather than issued with an empty predicate.
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
     * KTD-A's per-line pending classification (plan U4c): for each line, whether its binding's latest
     * resolution is a zero-authority LEXICAL bind still awaiting its verdict.
     *
     * ⚠️ Quiet and total, like every auxiliary read on this path: on a failed read every line classifies `none`
     * — the shipped absence-means-publish semantics, never an error.
     *
     * @param measures - The recipe's lines.
     * @param verdicts - The loaded verdicts, by line id.
     * @returns Pending state by line id, and the events by lookup id.
     * @sideEffect One batched resolutions read.
     */
    private async loadPendingStates(
        measures: readonly LineNutritionInput[],
        verdicts: LineVerdicts,
    ): Promise<Omit<LineJudgements, 'verdicts'>> {
        const pending = new Map<string, PendingState>();

        if (measures.length === 0) {
            return { pending, resolutions: new Map<string, LatestResolution>() };
        }

        let resolutions: ReadonlyMap<string, LatestResolution>;

        try {
            resolutions = await this.ingredientResolutions.latestResolutionsByLookupIds(
                measures.map((measure) => measure.lookupId),
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
            const event = resolutions.get(measure.lookupId);
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
}

/**
 * One line's status after every overlay.
 *
 * ⛔ THE OVERLAY ORDER IS LOAD-BEARING, in both directions: `resolveLineStatus → foodPresenceStatus →
 * viewerLineStatus`. Presence runs after resolution because food's answer on THIS read overrides the binding's
 * stored state — a withdrawn food still has a bound row. It runs BEFORE the viewer overlay because
 * `RESOLVED_UNAVAILABLE` is a PRIVACY answer ("this viewer is not served the details") and must never be
 * rewritten into `FOOD_REMOVED`, a FACTUAL claim about a food the viewer is not entitled to know anything about.
 *
 * @param identity - The line's identity.
 * @param verdict - The gate's verdict about the line, if any.
 * @param pending - The line's pending state, if classified.
 * @param resolution - The binding's latest resolution event, if any.
 * @param viewerId - The viewing user.
 * @returns The final status. Pure.
 */
function finalLineStatus(
    identity: IngredientLineIdentity,
    verdict: LineVerdictRow | undefined,
    pending: PendingState | undefined,
    resolution: LatestResolution | undefined,
    viewerId: string | undefined,
) {
    // U13 (D7/R9): material spread over the SAME parsed shortlist the producer's evidence uses — one boundary
    // parse, one agreement rule, so the gate and the badge cannot disagree.
    const ambiguous = ambiguousStateOf(verdict?.band, parseStoredShortlist(resolution?.shortlist));

    return viewerLineStatus(
        foodPresenceStatus(
            resolveLineStatus(
                verdict?.band,
                catalogStatusOf(identity),
                pending ?? 'none',
                ambiguous,
                // Owner ruling 2026-08-31 (§4): a high-certainty identity contradiction opens the re-pick door; a
                // pre-0042 verdict (identityVerdict null) keeps the passive badge.
                verdict !== undefined && identityContradictedOf(verdict),
            ),
            presenceOf(identity),
        ),
        privateFoodOwnerOf(identity.arm),
        viewerId,
    );
}
