/**
 * T025 / T033 — recipe CRUD orchestration + authorization.
 *
 * Sits between the controller (which supplies the authenticated owner key — `principal.userId`) and the
 * {@link RecipesDal}. It owns the domain rules the DAL deliberately does not:
 * - **Authorization** — mutations are owner-only (`owner_id == principal.userId` → else `NOT_OWNER`);
 *   a read is allowed for the owner OR any `public` recipe.
 * - **Optimistic concurrency (T033)** — an update whose `expectedVersion` != the stored
 *   `currentVersion` is rejected with `VERSION_CONFLICT` (409, `details.currentVersion`).
 * - **Response shaping** — persistence rows → the `Recipe` wire contract (ISO dates, `version`).
 *
 * Ownership is ALWAYS the app-user ULID, never the Clerk `sub` (D2 / REQ-IF-007).
 */
import { BadRequestException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { deriveDisplayName } from '@kitchensink/identity-core';
import {
    computeRecipeNutrition,
    toNutritionLine,
    type LineCatalogNutrition,
    type LineMeasure,
    type NutritionLine,
    type RecipeNutrition,
    type RecipePhoto,
    type RecipeSnapshot,
    type VersionConflictSide,
} from '@kitchensink/recipe-core';

import { toPageEnvelope } from '../common/pagination.js';
import { VersionsService } from '../versions/versions.service.js';
import { PhotosDal } from '../photos/dal/photos.dal.js';
import { resolveCoverUrl, resolvePhotoView } from '../photos/photoView.js';
import { RecipesDal, type RecipeAggregate, type StepInput } from './dal/recipes.dal.js';
import { toRecipeNutritionState } from './domain/nutritionState.js';
import type { RecipeNutritionResponse, RecipeNutritionState } from './recipes.schema.js';
import { RatingsDal } from '../ratings/dal/ratings.dal.js';
import type { ResolvedIngredientLine } from './dal/recipeIngredients.dal.js';
import { invalidVisibility, notOwner, recipeNotFound, unknownIngredient, versionConflict } from './recipe.error.js';
import { defaultCloneVisibility, evaluateVisibility } from './domain/visibilityPolicy.js';
import { isRecipeViewableBy } from './domain/recipeVisibility.js';
import { recipeRowToDomain } from './mappers/recipeRowToDomain.js';
import { resolveCdnUrl } from '../photos/photoView.js';
import type { CreateRecipeDto, CreateRecipeStepInputDto, RecipeIngredientInputDto } from './dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from './dto/updateRecipe.dto.js';
import type { ListRecipesQueryDto } from './dto/listRecipes.query.dto.js';
import type { PaginatedRecipesResponse, RecipeIngredientResponse, RecipeResponse } from './dto/recipeResponse.dto.js';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import { RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import type { RecipeIngredientRow, RecipePhotoRow, RecipeRow, RecipeStepRow } from '../database/schema/index.js';
import type { Principal } from '../auth/principal.js';
import type { CallerToken } from '../auth/CallerToken.js';
import { FoodNutritionGateway } from '../ingredients/foodNutrition.gateway.js';

/** DI token for the recipe DAL — provided by `RecipesModule` via `useFactory` over the Drizzle client. */
export const RECIPES_DAL = 'RECIPES_DAL';

/** DI token for the recipes vertical's own `PhotosDal` instance (embeds a recipe's photos in the detail). */
export const RECIPE_PHOTOS_DAL = 'RECIPE_PHOTOS_DAL';

/** DI token for the CloudFront base URL used to resolve embedded photo URLs. */
export const RECIPE_PHOTOS_CDN_URL = 'RECIPE_PHOTOS_CDN_URL';

/**
 * DI token for the recipes vertical's OWN {@link RatingsDal} instance (over the shared Drizzle client),
 * used only to read the VIEWER's own rating for the `RecipeDetail.viewerRating` field. Its own instance
 * (not the ratings vertical's `RATINGS_DAL`) keeps `RecipesModule` self-contained and, crucially, avoids
 * a module cycle: `RatingsModule` imports `RecipesModule` (to reuse `RecipesService`), so `RecipesModule`
 * must NOT import `RatingsModule`. The same "own DAL instance" pattern the vertical uses for its embedded
 * PhotosDal. `RatingsDal` remains the single owner of all `recipe_ratings` SQL (including this read).
 */
export const RECIPE_RATINGS_DAL = 'RECIPE_RATINGS_DAL';

/**
 * The permission string that marks a principal as premium-tier. There is deliberately NO tier field on
 * the {@link Principal} (subscriptions are a future feature, 010), so premium is derived from the signed
 * session token's `permissions` claim: `isPremium = principal.permissions.includes(PREMIUM_PERMISSION)`.
 * Centralized here so the C-004 policy has a single tier source until 010 introduces real subscriptions.
 */
export const PREMIUM_PERMISSION = 'premium';

/**
 * Space-join ingredient names into the denormalized, search-feeding `ingredient_names_text` column.
 * Built from the RESOLVED catalog lines (`ingredientName`), NOT the client DTO `name`: the junction
 * persists the catalog name, so the search vector must index the same canonical string. Building it from
 * `dto.name` would let a client index a recipe under arbitrary text (search poisoning) and diverge the
 * index from the displayed name (a recipe shown as "All-purpose flour" but unfindable by it). Pure.
 */
function buildIngredientNamesText(lines: ResolvedIngredientLine[]): string {
    return lines
        .map((line) => line.ingredientName.trim())
        .filter((name) => name.length > 0)
        .join(' ');
}

/** Map a DTO step to the DAL's step input shape. Pure. */
function toStepInput(step: { instruction: string; timerSeconds?: number }): StepInput {
    return step.timerSeconds === undefined
        ? { instruction: step.instruction }
        : { instruction: step.instruction, timerSeconds: step.timerSeconds };
}

/** Map a persisted `recipe_ingredients` link row to the wire `RecipeIngredient` shape. Pure. */
function toIngredientResponse(row: RecipeIngredientRow): RecipeIngredientResponse {
    return {
        ingredientId: row.ingredientId,
        name: row.ingredientName,
        // `quantity` is a `numeric` column — Drizzle/pg surface it as a string; the contract is a number.
        quantity: Number(row.quantity),
        ...(row.unit.length > 0 ? { unit: row.unit } : {}),
        ...(row.displayText !== null ? { notes: row.displayText } : {}),
        isUserEntered: row.isUserEntered,
    };
}

/** Optional projection extras layered onto a recipe response by the caller (detail vs. list). */
interface RecipeResponseExtras {
    /** Embedded photos (DETAIL reads only) — omitted on list/search metadata. */
    photos?: RecipePhoto[];
    /** Per-serving nutrition (DETAIL reads only) — omitted on list/search metadata. */
    nutrition?: RecipeNutrition;
    /** Absolute CDN URL of the cover photo (FR-001c). Resolved by the caller (list LATERAL / detail photos). */
    coverPhotoUrl?: string;
    /**
     * The VIEWER's own rating (1–5), for the `RecipeDetail.viewerRating` field (FR-013). DETAIL reads only,
     * and only when the viewer has actually rated — ABSENT otherwise (never `0`). Resolved by the caller
     * (`getById`) from the viewer-scoped `recipe_ratings` row.
     */
    viewerRating?: number;
    /**
     * The nutrition figure U10 stopped storing (plan U10). Supplied only by the DETAIL read, which is the
     * one path that actually fetches food's live data; list/search emit no nutrition at all rather than
     * paying an N+1 — the deferred batch endpoint is where a card gets its number.
     */
    derivedNutrition?: { leadCaloriesPerServing?: number };
}

/**
 * Map a persisted recipe aggregate to the wire response. Pure. On the single-recipe DETAIL reads the
 * caller passes the embedded `photos` + per-serving `nutrition` so the client renders the whole recipe in
 * one round-trip; on list/search metadata reads both are omitted (their keys are absent).
 *
 * The base recipe-level fields (S-R4) come from the canonical {@link recipeRowToDomain} Data Mapper — the
 * SAME `difficulty` (omitted when unstated), trigger-maintained `averageRating`/`ratingCount` (average
 * omitted when unrated — never `0`), and derived `usesPremiumCapability` (via the single authoritative
 * `recipe-core` fn) that the collections/search projections share. This function then layers the
 * `RecipeResponse` SUPERSET on top: `ingredients`/`steps` (always), and `viewerRating`/`coverPhotoUrl`/
 * `photos`/`nutrition` via {@link RecipeResponseExtras} (the two read paths resolve `coverPhotoUrl`
 * differently — list via a cover LATERAL, detail from the first embedded photo).
 *
 * `description` is the ONE base field NOT taken from the canonical mapper: `RecipeResponse.description`
 * is optional and OMITTED when unset, whereas the canonical `Recipe.description` is required and defaults
 * to `''` — a genuinely different wire rule (not a duplicate to collapse), so it is re-derived here from
 * the raw row, exactly as before.
 */
function toRecipeResponse(aggregate: RecipeAggregate, extras: RecipeResponseExtras = {}): RecipeResponse {
    const { recipe, steps, ingredients } = aggregate;
    // `description` is excluded from the canonical base (see the doc comment above) and re-applied below
    // under RecipeResponse's own omit-when-null rule.
    // Nutrition is emitted ONLY when the caller computed it. An absent `derivedNutrition` yields a recipe
    // with no nutrition fields, which is what "we did not look it up" honestly looks like — the pinned
    // `hasPartialNutrition: true` that used to stand here claimed "partial", a different fact.
    const { description: _canonicalDescription, ...base } = recipeRowToDomain(recipe, extras.derivedNutrition ?? {});

    return {
        ...base,
        // RecipeResponse.description is OPTIONAL — OMITTED (not `''`) when unset, unlike the canonical
        // Recipe.description (required, `''` default).
        ...(recipe.description !== null ? { description: recipe.description } : {}),
        // Composed from the `recipe_ingredients` junction (persisted atomically with the recipe), in
        // author order (`sortOrder`). Empty only when the recipe genuinely has no ingredient lines.
        ingredients: ingredients.map(toIngredientResponse),
        steps: steps.map((step) => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds !== null ? { timerSeconds: step.timerSeconds } : {}),
        })),
        // The viewer's OWN rating (per-viewer, distinct from the community average) — present only on the
        // detail read and only when the viewer has rated; OMITTED (not `0`) otherwise. The caller resolves
        // it viewer-scoped, so it can only ever be THIS viewer's stars.
        ...(extras.viewerRating !== undefined ? { viewerRating: extras.viewerRating } : {}),
        // Cover photo (FR-001c) — absent when the recipe has no photos.
        ...(extras.coverPhotoUrl !== undefined ? { coverPhotoUrl: extras.coverPhotoUrl } : {}),
        // Embedded photos + per-serving nutrition for the detail read (absent on list/search metadata).
        ...(extras.photos !== undefined ? { photos: extras.photos } : {}),
        ...(extras.nutrition !== undefined ? { nutrition: extras.nutrition } : {}),
    };
}

/** Map a persisted `recipe_ingredients` row back to a resolvable link (for cloning). Pure. */
function toResolvedIngredientLine(row: RecipeIngredientRow): ResolvedIngredientLine {
    return {
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        // `quantity` is a `numeric` column surfaced as a string; the DAL re-serializes it on insert.
        quantity: Number(row.quantity),
        unit: row.unit,
        ...(row.displayText !== null ? { displayText: row.displayText } : {}),
        sortOrder: row.sortOrder,
        isUserEntered: row.isUserEntered,
        // Preserve any per-line user-entered nutrition (FR-007a) across a clone (numeric → number).
        ...(row.userCalories !== null ? { userCalories: Number(row.userCalories) } : {}),
        ...(row.userProteinG !== null ? { userProteinG: Number(row.userProteinG) } : {}),
        ...(row.userCarbsG !== null ? { userCarbsG: Number(row.userCarbsG) } : {}),
        ...(row.userFatG !== null ? { userFatG: Number(row.userFatG) } : {}),
    };
}

/**
 * Map a persisted `recipe_ingredients` row to the nutrition line-assembler input (W8-a.1), coercing the
 * `numeric` columns (surfaced as strings) to numbers and `null` to absent. Pure.
 */
function rowToMeasureInput(row: RecipeIngredientRow): LineMeasure & { ingredientId: string } {
    return {
        ingredientId: row.ingredientId,
        quantity: Number(row.quantity),
        unit: row.unit,
        ...(row.userCalories !== null ? { userCalories: Number(row.userCalories) } : {}),
        ...(row.userProteinG !== null ? { userProteinG: Number(row.userProteinG) } : {}),
        ...(row.userCarbsG !== null ? { userCarbsG: Number(row.userCarbsG) } : {}),
        ...(row.userFatG !== null ? { userFatG: Number(row.userFatG) } : {}),
    };
}

/**
 * One batched catalog load: everything the line assembler and the nutrition classifier need, resolved once
 * for however many recipes the request named. Produced by `RecipesService.loadLineCatalog`.
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
}

/**
 * Merge a set of line measures with a loaded catalog through the single {@link toNutritionLine}
 * line-assembler. Pure — the functional core the batched I/O feeds.
 */
function assembleLines(
    catalog: LineCatalog,
    measures: readonly (LineMeasure & { ingredientId: string })[],
): NutritionLine[] {
    return measures.map(({ ingredientId, ...measure }) =>
        toNutritionLine(measure, catalog.byIngredientId.get(ingredientId)),
    );
}

/** Map a persisted step row to the DAL's step input shape (for cloning). Pure. */
function toStepInputFromRow(row: RecipeStepRow): StepInput {
    return row.timerSeconds === null
        ? { instruction: row.instruction }
        : { instruction: row.instruction, timerSeconds: row.timerSeconds };
}

/**
 * Capture a persisted recipe aggregate as an immutable {@link RecipeSnapshot} for version history
 * (FR-007b). The snapshot must be faithful enough to RESTORE the recipe, so it carries the full content
 * (title/description/servings/times + ordered steps + composed ingredient lines with their catalog name
 * and any user-nutrition override), keyed at the recipe's current version. Pure.
 */
function aggregateToSnapshot(aggregate: RecipeAggregate): RecipeSnapshot {
    const { recipe, steps, ingredients } = aggregate;

    return {
        version: recipe.currentVersion,
        title: recipe.title,
        description: recipe.description ?? '',
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        steps: steps.map((step) => ({
            id: step.id,
            recipeId: step.recipeId,
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds !== null ? { timerSeconds: step.timerSeconds } : {}),
        })),
        ingredients: ingredients.map((line) => ({
            id: line.id,
            recipeId: line.recipeId,
            ingredientId: line.ingredientId,
            // `quantity` is a numeric column surfaced as a string by pg — the snapshot contract is a number.
            quantity: Number(line.quantity),
            unit: line.unit,
            ...(line.displayText !== null ? { displayText: line.displayText } : {}),
            sortOrder: line.sortOrder,
            ingredientName: line.ingredientName,
            isUserEntered: line.isUserEntered,
            ...(line.userCalories !== null ? { userCalories: Number(line.userCalories) } : {}),
            ...(line.userProteinG !== null ? { userProteinG: Number(line.userProteinG) } : {}),
            ...(line.userCarbsG !== null ? { userCarbsG: Number(line.userCarbsG) } : {}),
            ...(line.userFatG !== null ? { userFatG: Number(line.userFatG) } : {}),
        })),
    };
}

/** Whether an incoming step patch differs from the persisted steps (order-sensitive). Pure. */
function stepsChanged(existing: RecipeStepRow[], incoming: CreateRecipeStepInputDto[]): boolean {
    if (existing.length !== incoming.length) {
        return true;
    }

    return existing.some((step, index) => {
        const next = incoming[index];

        return (
            next === undefined ||
            step.instruction !== next.instruction ||
            (step.timerSeconds ?? null) !== (next.timerSeconds ?? null)
        );
    });
}

/** Whether an incoming ingredient patch differs from the persisted links (order-sensitive). Pure. */
function ingredientsChanged(existing: RecipeIngredientRow[], incoming: RecipeIngredientInputDto[]): boolean {
    if (existing.length !== incoming.length) {
        return true;
    }

    return existing.some((row, index) => {
        const next = incoming[index];

        return (
            next === undefined ||
            row.ingredientId !== next.ingredientId ||
            Number(row.quantity) !== next.quantity ||
            (row.unit.length > 0 ? row.unit : '') !== (next.unit ?? '') ||
            (row.displayText ?? null) !== (next.notes ?? null)
        );
    });
}

/**
 * Whether an update is a *substantive* edit (C-004 / FR-005): a change to INGREDIENTS or STEPS. A patch
 * touching only metadata (title/description/tags/cuisine/times/servings/dietaryFlags) is NOT substantive.
 * Pure — compares the incoming patch against the existing aggregate.
 */
function detectSubstantiveEdit(existing: RecipeAggregate, dto: UpdateRecipeDto): boolean {
    if (dto.steps !== undefined && stepsChanged(existing.steps, dto.steps)) {
        return true;
    }

    if (dto.ingredients !== undefined && ingredientsChanged(existing.ingredients, dto.ingredients)) {
        return true;
    }

    return false;
}

@Injectable()
export class RecipesService {
    public constructor(
        @Inject(RECIPES_DAL) private readonly dal: RecipesDal,
        private readonly ingredientsDal: IngredientsDal,
        // Circular by nature: recipe writes record a version, and version restore drives a recipe write.
        // forwardRef lets Nest resolve the two-way dependency (see VersionsService's matching forwardRef).
        //
        // The field is typed as a `Pick` of VersionsService, NOT the concrete class, ON PURPOSE — DO NOT
        // "simplify" it back to `: VersionsService`. With `emitDecoratorMetadata`, the constructor param's
        // TYPE ANNOTATION is emitted into `design:paramtypes`, which is evaluated at class-definition time.
        // A concrete-class annotation there emits a VALUE reference to VersionsService; under native ESM the
        // recipes<->versions import cycle means that binding is still in its temporal dead zone when this
        // module first evaluates, so the compiled service crashes at boot with `ReferenceError: Cannot
        // access 'VersionsService' before initialization` (it only surfaces in the COMPILED image — tsx/
        // vitest transpile the cycle differently, so tests don't catch it). A `Pick<…>` is a structural
        // type with no runtime value, so `design:paramtypes` emits `Object` and the cycle boots — while
        // `forwardRef(() => VersionsService)` (lazy arrow, evaluated later) still resolves the real instance.
        @Inject(forwardRef(() => VersionsService)) private readonly versions: Pick<VersionsService, 'createSnapshot'>,
        // The recipes vertical embeds a recipe's photos in the `RecipeDetail` read via its OWN PhotosDal
        // instance over the shared Drizzle client (no PhotosModule import → no module cycle).
        @Inject(RECIPE_PHOTOS_DAL) private readonly photosDal: PhotosDal,
        @Inject(RECIPE_PHOTOS_CDN_URL) private readonly photosCdnUrl: string,
        // Own RatingsDal instance over the shared Drizzle client, used ONLY to read the viewer's own rating
        // for `RecipeDetail.viewerRating` (see RECIPE_RATINGS_DAL for why an own instance, not a module import).
        @Inject(RECIPE_RATINGS_DAL) private readonly ratingsDal: RatingsDal,
        private readonly foodNutrition: FoodNutritionGateway,
    ) {}

    /**
     * Load a recipe's photo ROWS in display order. Returns rows (not wire views) because the detail read
     * needs the cover row's `thumbnailKey` to resolve the cover thumbnail (FOLLOW-UP-CR-001-A), which the
     * `RecipePhoto` wire shape does not carry. {@link toDetailResponse} maps them to the gallery views.
     */
    private async loadPhotoRows(recipeId: string): Promise<RecipePhotoRow[]> {
        return this.photosDal.findByRecipe(recipeId);
    }

    /**
     * Compute a recipe's estimated per-serving nutrition (FR-007) from its ingredient lines: each line's
     * user-entered override (FR-007a) when present, else the catalog per-100g nutrition scaled by mass.
     * The catalog nutrition is batch-loaded for the recipe's ingredient ids in one query.
     */
    private async computeDetailNutrition(
        aggregate: RecipeAggregate,
        caller: CallerToken | undefined,
    ): Promise<RecipeNutrition> {
        const lines = await this.assembleNutritionLines(caller, aggregate.ingredients.map(rowToMeasureInput));

        return computeRecipeNutrition(lines, aggregate.recipe.servings);
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
        };
    }

    /**
     * Assemble one recipe's lines into {@link NutritionLine}s via the single {@link toNutritionLine}
     * line-assembler, over its own catalog load. The single-recipe shell over {@link loadLineCatalog};
     * the detail read ({@link computeDetailNutrition}) is its caller.
     */
    private async assembleNutritionLines(
        caller: CallerToken | undefined,
        lines: readonly (LineMeasure & { ingredientId: string })[],
    ): Promise<NutritionLine[]> {
        const catalog = await this.loadLineCatalog(
            caller,
            lines.map((line) => line.ingredientId),
        );

        return assembleLines(catalog, lines);
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
        caller?: CallerToken,
    ): Promise<RecipeNutritionResponse> {
        const inputs = await this.dal.findNutritionInputs([...new Set(recipeIds)], viewerId);

        if (inputs.length === 0) {
            // Nothing readable — and therefore nothing to ask food about. A lookup here would forward this
            // caller's credential and this batch's food ids for recipes they may not see.
            return { nutrition: {} };
        }

        const measuresByRecipe = new Map(inputs.map((input) => [input.recipeId, input.lines.map(rowToMeasureInput)]));
        const catalog = await this.loadLineCatalog(
            caller,
            [...measuresByRecipe.values()].flat().map((measure) => measure.ingredientId),
        );

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
                    lines: assembleLines(catalog, measures),
                    referencedFoodCount: referenced.size,
                    resolvedFoodCount: [...referenced].filter((foodId) => catalog.resolvedFoodIds.has(foodId)).length,
                    staleFoodCount: [...referenced].filter((foodId) => catalog.staleFoodIds.has(foodId)).length,
                },
                input.servings,
                catalog.degraded,
            );
        }

        return { nutrition };
    }

    /*
     * ⛔ `leadCaloriesFor` DELETED (plan U10). It computed the headline per-serving calories at WRITE time
     * so the list/search projections could render them without an N+1 — i.e. it maintained the
     * denormalized column. With that column dropped there is nothing to maintain: the detail read derives
     * the figure from the same computation it already performs, and list/search honestly report nutrition
     * as unaccounted rather than serving a value frozen at the recipe's last save.
     */

    /**
     * Shape a recipe aggregate into the full `RecipeDetail` response: the metadata + composed ingredients
     * and steps, PLUS the embedded `photos` and computed per-serving `nutrition`. Used by every
     * single-recipe read (get/create/update/clone/set-visibility).
     *
     * `options.viewerRating` carries the viewer's own stars for the `viewerRating` field; only the GET
     * detail path supplies it (create/clone/update/set-visibility are owner operations, and an owner can
     * never hold a rating on their own recipe, so it is correctly absent there).
     */
    private async toDetailResponse(
        aggregate: RecipeAggregate,
        photoRows: RecipePhotoRow[],
        // `caller` is REQUIRED for nutrition: the numbers come from the food service, which authorizes the
        // request as the calling user. A path that omits it degrades to nutrition-absent (KTD-3b) — which
        // looks exactly like a food outage, so every detail path must supply it.
        options: { viewerRating?: number; caller?: CallerToken } = {},
    ): Promise<RecipeResponse> {
        // The embedded gallery is always the FULL-SIZE originals (`resolvePhotoView.url`). The COVER,
        // however, serves the small thumbnail rendition (FOLLOW-UP-CR-001-A) via `resolveCoverUrl`, falling
        // back to the original when a photo predates the thumbnail. On detail the cover is the FIRST
        // photo — `loadPhotoRows` returns them in the same (sort_order, created_at) order the list/search
        // cover LATERAL uses, so all three read paths agree on which photo is the cover.
        const photos = photoRows.map((row) => resolvePhotoView(row, this.photosCdnUrl));
        const coverRow = photoRows[0];

        const nutrition = await this.computeDetailNutrition(aggregate, options.caller);

        return toRecipeResponse(aggregate, {
            photos,
            nutrition,
            // Derived from the SAME computation the detail body reports, so the card figure and the detail
            // total cannot disagree — the claim `nutrition.ts` used to make and could not keep while a
            // second, frozen copy lived in a column.
            // Derived from the SAME computation the detail body reports, so the card figure and the detail
            // total cannot disagree. Completeness itself is no longer duplicated up here: the detail body's
            // own `nutrition.isComplete` is the single place it is reported.
            derivedNutrition: nutrition.calories > 0 ? { leadCaloriesPerServing: nutrition.calories } : {},
            ...(coverRow !== undefined ? { coverPhotoUrl: resolveCoverUrl(coverRow, this.photosCdnUrl) } : {}),
            ...(options.viewerRating !== undefined ? { viewerRating: options.viewerRating } : {}),
        });
    }

    /**
     * Record an immutable version snapshot of a just-written recipe aggregate (FR-007b). Best-effort:
     * the recipe has already committed, so a snapshot/retention failure must NOT fail the user's save —
     * it is logged and swallowed (the reconciliation/worker path backstops a missed row). This is the
     * ONE place create/update/clone converge to populate version history.
     *
     * @sideEffect Inserts a `recipe_versions` row and runs retention (archive + prune) via VersionsService.
     */
    private async recordSnapshot(
        aggregate: RecipeAggregate,
        ownerId: string,
        changeSummary: string,
        deviceLabel?: string,
        editorHandle?: string,
    ): Promise<void> {
        try {
            await this.versions.createSnapshot({
                recipeId: aggregate.recipe.id,
                versionNumber: aggregate.recipe.currentVersion,
                snapshot: aggregateToSnapshot(aggregate),
                createdBy: ownerId,
                changeSummary,
                // Device attribution (W8-a.6) — from the write request; omitted (→ NULL) on clone/restore.
                ...(deviceLabel !== undefined ? { deviceLabel } : {}),
                // Editor handle (W8-a.2) — the version editor's denormalized display name; omitted → NULL.
                ...(editorHandle !== undefined ? { editorHandle } : {}),
            });
        } catch (error) {
            // The recipe is saved; a version-history hiccup is non-fatal to the write. Surface it for
            // observability (logs route to Sentry) without propagating.
            console.error(`Failed to record version snapshot for recipe ${aggregate.recipe.id}:`, error);
        }
    }

    /**
     * Create a recipe owned by `principal.userId`. A create is always a `user_created` recipe with no
     * substantive edit yet, so the requested visibility is gated by the same pure C-004
     * {@link evaluateVisibility} policy the set-visibility endpoint uses: a free-tier caller requesting
     * `private` is rejected with `INVALID_VISIBILITY` (FR-003 — free-tier user_created recipes are
     * public-only), rather than silently persisting a `private` row the policy forbids. Premium is
     * derived from the signed token's `permissions` (see {@link PREMIUM_PERMISSION}).
     */
    public async create(principal: Principal, dto: CreateRecipeDto, caller?: CallerToken): Promise<RecipeResponse> {
        const requested = dto.visibility ?? RecipeVisibility.PUBLIC;
        const decision = evaluateVisibility({
            sourceType: RecipeSourceType.USER_CREATED,
            isPremium: principal.permissions.includes(PREMIUM_PERMISSION),
            hasSubstantiveEdit: false,
            requested,
        });

        if (!decision.allowed) {
            throw invalidVisibility(decision.reason, { visibility: requested, sourceType: 'user_created' });
        }

        const ingredients = await this.resolveIngredientLines(dto.ingredients);
        // Denormalized author handle (W8-a.2 / decision 6): the initial value from the token claims via the
        // ONE shared rule. The handle-sync consumer keeps every owned recipe/version current thereafter.
        const authorHandle = deriveDisplayName(principal) || undefined;

        const aggregate = await this.dal.create({
            ownerId: principal.userId,
            title: dto.title,
            description: dto.description,
            cuisine: dto.cuisine,
            visibility: requested,
            servings: dto.servings,
            prepTimeMinutes: dto.prepTimeMinutes,
            cookTimeMinutes: dto.cookTimeMinutes,
            totalTimeMinutes: dto.totalTimeMinutes,
            // Author-stated difficulty (FR-001b) — persisted only when the author stated one; omitted
            // otherwise so the row stays "not stated" (NULL). Never defaulted.
            ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
            // Publication status (W8-a.3) — omitted → DB default 'published'; Save-Draft sends 'draft'.
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            tags: dto.tags ?? [],
            dietaryFlags: dto.dietaryFlags ?? [],
            ingredientNamesText: buildIngredientNamesText(ingredients),
            // Denormalized headline per-serving calories (W8-a.1) — recomputed from the resolved lines so the
            // list/search/collection-embed cards render calories without an N+1. Absent → column stays NULL.
            // Denormalized author handle (W8-a.2) — absent → column stays NULL until the fan-out fills it.
            ...(authorHandle !== undefined ? { authorHandle } : {}),
            ingredients,
            steps: dto.steps.map(toStepInput),
        });

        await this.recordSnapshot(aggregate, principal.userId, 'Created', dto.deviceLabel, authorHandle);

        // A freshly-created recipe has no photos yet (uploaded afterward); nutrition is computed from its lines.
        return this.toDetailResponse(aggregate, [], { caller });
    }

    /**
     * Resolve each DTO ingredient line against the shared catalog, yielding the denormalized link rows
     * the DAL persists. Each line's `ingredientId` MUST already exist (the client resolves ingredients
     * via `/api/v1/ingredients` first); an unknown id fails fast with `UNKNOWN_INGREDIENT`. The catalog is
     * the source of truth for the persisted `ingredientName` / `isUserEntered`, and array order becomes
     * `sortOrder`.
     *
     * S-R6: a SINGLE batch `findByIds` over the deduped ids — not one `findById` per line — so a recipe
     * with M lines costs one catalog round-trip regardless of M (mirrors {@link assembleNutritionLines}).
     */
    private async resolveIngredientLines(lines: RecipeIngredientInputDto[]): Promise<ResolvedIngredientLine[]> {
        const ids = [...new Set(lines.map((line) => line.ingredientId))];
        const catalog = new Map((await this.ingredientsDal.findByIds(ids)).map((ing) => [ing.id, ing]));

        return lines.map((line, index) => {
            const ingredient = catalog.get(line.ingredientId);

            if (!ingredient) {
                throw unknownIngredient(line.ingredientId);
            }

            return {
                ingredientId: ingredient.id,
                ingredientName: ingredient.name,
                quantity: line.quantity,
                unit: line.unit ?? '',
                ...(line.notes !== undefined ? { displayText: line.notes } : {}),
                sortOrder: index,
                isUserEntered: ingredient.isUserEntered,
                // Per-line user-entered nutrition override (FR-007a) — carried through to persistence.
                ...(line.userCalories !== undefined ? { userCalories: line.userCalories } : {}),
                ...(line.userProteinG !== undefined ? { userProteinG: line.userProteinG } : {}),
                ...(line.userCarbsG !== undefined ? { userCarbsG: line.userCarbsG } : {}),
                ...(line.userFatG !== undefined ? { userFatG: line.userFatG } : {}),
            };
        });
    }

    /** Fetch one recipe. Allowed for the owner, or for any `public` recipe. */
    public async getById(ownerId: string, id: string, caller?: CallerToken): Promise<RecipeResponse> {
        const aggregate = await this.dal.findById(id);

        if (!aggregate) {
            throw recipeNotFound(id);
        }

        // W8-a.4 (IDOR): a recipe the caller can't see (private/draft, not owned) is 404 — indistinguishable
        // from a missing id — not 403, which would confirm the id exists. getById is the hottest such path.
        if (!isRecipeViewableBy(aggregate.recipe, ownerId)) {
            throw recipeNotFound(id);
        }

        // The viewer's OWN rating (FR-013) for `viewerRating`, scoped to (recipe, this viewer) so it can
        // only ever be the caller's own stars — one indexed point lookup on this single-recipe read.
        // `undefined` (viewer has not rated, incl. the owner viewing their own recipe) → the field is absent.
        const [photos, viewerRating] = await Promise.all([
            this.loadPhotoRows(id),
            this.ratingsDal.findStars(id, ownerId),
        ]);

        return this.toDetailResponse(aggregate, photos, {
            caller,
            ...(viewerRating !== undefined ? { viewerRating } : {}),
        });
    }

    /** List the caller's own recipes (owner-scoped, tombstones excluded), paginated. */
    public async list(ownerId: string, query: ListRecipesQueryDto): Promise<PaginatedRecipesResponse> {
        const { page, pageSize, sortBy } = query;
        const { rows, total } = await this.dal.findAll({ ownerId, page, pageSize, sortBy });

        return {
            // Metadata list — NO embedded photos/nutrition, but WITH the derived cover URL resolved from
            // the DAL's cover-photo key (one cover LATERAL for the page; no N+1). The explicit arrow is
            // required (a bare `.map(toRecipeResponse)` would pass the index as the extras arg).
            data: rows.map((row) =>
                toRecipeResponse(row, {
                    ...(row.coverPhotoKey !== undefined
                        ? { coverPhotoUrl: resolveCdnUrl(this.photosCdnUrl, row.coverPhotoKey) }
                        : {}),
                }),
            ),
            ...toPageEnvelope({ total, page, pageSize, rowCount: rows.length }),
        };
    }

    /**
     * Update a recipe the caller owns, enforcing optimistic concurrency (T033), and record a version
     * snapshot of the result. `options.recordSnapshot = false` suppresses the snapshot for the RESTORE
     * path (which records its own snapshot with restore-specific provenance) so a restore writes exactly
     * one version, not two at the same number. `options.changeSummary` labels the recorded version.
     */
    public async update(
        principal: Principal,
        id: string,
        dto: UpdateRecipeDto,
        options: { recordSnapshot?: boolean; changeSummary?: string } = {},
    ): Promise<RecipeResponse> {
        const ownerId = principal.userId;
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, existing.recipe);

        // Fast pre-check: the client is already stale at read time (the common conflict). Raise the SAME
        // enriched 409 (W8-a.5) the CAS-miss path does, so every conflict — whether caught here or in the
        // race window below — carries the server + base snapshots.
        if (existing.recipe.currentVersion !== dto.expectedVersion) {
            return this.raiseVersionConflict(id, dto.expectedVersion);
        }

        // Resolve replacement ingredient links only when the patch carries them (absent → links untouched).
        const ingredients =
            dto.ingredients !== undefined ? await this.resolveIngredientLines(dto.ingredients) : undefined;

        // ⛔ No lead-calorie recompute here any more (plan U10). This block existed to keep a denormalized
        // column in step with the lines and the serving count; with the column dropped there is nothing to
        // keep in step, and the figure is derived on every detail read from food's live data instead.

        // C-004 / FR-005: a change to ingredients/steps flips `hasSubstantiveEdit` to true (once true, it
        // stays true — never reset). Only newly-substantive edits are persisted; the import provenance
        // columns are never touched here, so imported lineage survives the version bump (T139).
        const newlySubstantive = !existing.recipe.hasSubstantiveEdit && detectSubstantiveEdit(existing, dto);

        // A recipe may EXIST empty — that is what a draft IS — but it may not be PUBLISHED empty. The wire
        // schema rejects a body that publishes while sending an empty array; only the service can judge the
        // body that publishes WITHOUT resending the arrays, because only it knows what is already stored.
        // Counting the patch when present and the persisted rows otherwise is the same "absent means
        // unchanged" rule the DAL applies below, evaluated against the post-update state.
        if (dto.status === RecipeStatus.PUBLISHED) {
            const ingredientCount = dto.ingredients?.length ?? existing.ingredients.length;
            const stepCount = dto.steps?.length ?? existing.steps.length;

            if (ingredientCount === 0 || stepCount === 0) {
                throw new BadRequestException('A published recipe needs at least one ingredient and one step.');
            }
        }

        const updated = await this.dal.update(id, {
            // The version predicate makes the write an atomic compare-and-swap (closes the lost-update
            // race the read-then-check above cannot). The pre-check stays for the fast, clear-error path.
            expectedVersion: dto.expectedVersion,
            title: dto.title,
            description: dto.description,
            cuisine: dto.cuisine,
            servings: dto.servings,
            prepTimeMinutes: dto.prepTimeMinutes,
            cookTimeMinutes: dto.cookTimeMinutes,
            totalTimeMinutes: dto.totalTimeMinutes,
            // Three-state difficulty (FR-001b) passed straight through: `undefined` leaves it unchanged, a
            // value sets it, explicit `null` clears it. The DAL is what distinguishes the three — the DTO
            // preserved absent-vs-null, and forwarding the raw value keeps that distinction intact.
            difficulty: dto.difficulty,
            // Publication status (W8-a.3) — passed straight through: absent leaves it unchanged, a value
            // sets it (Publish / re-draft). The DAL keys off `!== undefined`.
            status: dto.status,
            tags: dto.tags,
            dietaryFlags: dto.dietaryFlags,
            // Rebuild the search text from the RESOLVED catalog lines (not dto.ingredients) so the index
            // tracks the persisted junction names — only when the patch actually replaces ingredients.
            ...(ingredients !== undefined
                ? { ingredientNamesText: buildIngredientNamesText(ingredients), ingredients }
                : {}),
            // Denormalized lead calories (W8-a.1): written (value or `null`-to-clear) only when an input
            // changed; omitted otherwise so an unrelated patch leaves the stored figure untouched.
            ...(dto.steps !== undefined ? { steps: dto.steps.map(toStepInput) } : {}),
            ...(newlySubstantive ? { hasSubstantiveEdit: true } : {}),
        });

        if (!updated) {
            // The CAS matched 0 rows: either the row was tombstoned, or a concurrent update advanced the
            // version between our read and our write (the lost-update race). Raise the enriched 409 (or a
            // 404 if the row is genuinely gone). `return` narrows `updated` to defined below.
            return this.raiseVersionConflict(id, dto.expectedVersion);
        }

        if (options.recordSnapshot !== false) {
            // Editor handle (W8-a.2) — the version's "by @handle" attribution. Derived from the editor's
            // token claims via the ONE shared rule create uses; `author_handles` is deliberately NOT the
            // source here (it is seeded only by rename events, so it is NULL for any un-renamed user).
            const editorHandle = deriveDisplayName(principal) || undefined;
            await this.recordSnapshot(
                updated,
                ownerId,
                options.changeSummary ?? 'Updated',
                dto.deviceLabel,
                editorHandle,
            );
        }

        return this.toDetailResponse(updated, await this.loadPhotoRows(id));
    }

    /** Soft-delete (tombstone) a recipe the caller owns. */
    public async delete(ownerId: string, id: string): Promise<void> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, existing.recipe);

        const removed = await this.dal.softDelete(id);

        if (!removed) {
            throw recipeNotFound(id);
        }
    }

    /**
     * Clone a recipe (FR-011). Only a `public` recipe is cloneable by a non-owner; an owner may clone
     * their own (even private). The clone is a NEW recipe owned by the caller with
     * `clonedFromId = source.id`, the source's attribution RETAINED
     * (`sourceType`/`sourceUrl`/`sourceAttribution`), content copied, `hasSubstantiveEdit = false`, and
     * `visibility` set to the C-004 clone default for the source type. The ORIGINAL is never mutated.
     */
    public async clone(principal: Principal, id: string, caller?: CallerToken): Promise<RecipeResponse> {
        const ownerId = principal.userId;
        const source = await this.dal.findById(id);

        if (!source) {
            throw recipeNotFound(id);
        }

        // Clone read-scoping (FR-011 / W8-a.3+.4): a non-owner may clone only a public, PUBLISHED recipe; an
        // owner may clone their own (even private/draft). Routes through the single in-memory viewability
        // predicate (the twin of the `readableBy` DAL predicate). An unreadable source (private/draft, not
        // owned) returns 404 — indistinguishable from a missing id (IDOR), not 403.
        if (!isRecipeViewableBy(source.recipe, ownerId)) {
            throw recipeNotFound(id);
        }

        const sourceType = source.recipe.sourceType as RecipeSourceType;
        // A user_created original carries no attribution — record it to the original author so the clone
        // still credits provenance. An imported source already carries its attribution; keep it verbatim.
        const attribution = source.recipe.sourceAttribution ?? `Cloned from ${source.recipe.ownerId}`;

        const created = await this.dal.create({
            ownerId,
            title: source.recipe.title,
            ...(source.recipe.description !== null ? { description: source.recipe.description } : {}),
            ...(source.recipe.cuisine !== null ? { cuisine: source.recipe.cuisine } : {}),
            visibility: defaultCloneVisibility(sourceType),
            servings: source.recipe.servings,
            prepTimeMinutes: source.recipe.prepTimeMinutes,
            cookTimeMinutes: source.recipe.cookTimeMinutes,
            totalTimeMinutes: source.recipe.totalTimeMinutes,
            tags: source.recipe.tags,
            dietaryFlags: source.recipe.dietaryFlags,
            sourceType,
            sourceUrl: source.recipe.sourceUrl,
            sourceAttribution: attribution,
            clonedFromId: source.recipe.id,
            hasSubstantiveEdit: false,
            ingredientNamesText: source.recipe.ingredientNamesText,
            ingredients: source.ingredients.map(toResolvedIngredientLine),
            steps: source.steps.map(toStepInputFromRow),
        });

        // Editor handle (W8-a.2): the CLONER (not the source author) is the editor of the clone's first
        // version — derived from the caller's claims via the ONE shared rule, matching create/update.
        const editorHandle = deriveDisplayName(principal) || undefined;
        await this.recordSnapshot(created, ownerId, `Cloned from ${source.recipe.id}`, undefined, editorHandle);

        // A fresh clone starts with no photos (not copied from the source); nutrition is computed from its lines.
        return this.toDetailResponse(created, [], { caller });
    }

    /**
     * Set a recipe's visibility (C-004 / T050), owner-only, gated by the pure {@link evaluateVisibility}
     * policy over `(sourceType, isPremium, hasSubstantiveEdit, requested)`. Premium is derived from the
     * principal's `permissions` (see {@link PREMIUM_PERMISSION}) — there is no tier field until 010. A
     * denied transition throws `INVALID_VISIBILITY` (→ 400); an allowed one persists without bumping the
     * content version.
     */
    public async setVisibility(
        principal: Principal,
        id: string,
        visibility: RecipeVisibility,
    ): Promise<RecipeResponse> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(principal.userId, existing.recipe);

        const isPremium = principal.permissions.includes(PREMIUM_PERMISSION);
        const decision = evaluateVisibility({
            sourceType: existing.recipe.sourceType as RecipeSourceType,
            isPremium,
            hasSubstantiveEdit: existing.recipe.hasSubstantiveEdit,
            requested: visibility,
        });

        if (!decision.allowed) {
            throw invalidVisibility(decision.reason, { visibility, sourceType: existing.recipe.sourceType });
        }

        const updated = await this.dal.setVisibility(id, visibility);

        if (!updated) {
            // The active row vanished between the read and the write (a concurrent tombstone).
            throw recipeNotFound(id);
        }

        return this.toDetailResponse(updated, await this.loadPhotoRows(id));
    }

    /** Owner-only guard for mutations: `owner_id == principal.userId` or `NOT_OWNER`. */
    /**
     * Assemble and throw the enriched `409 VERSION_CONFLICT` (W8-a.5) — or a `404` when the recipe is gone —
     * from the coherent {@link RecipesDal.readConflict} read. The ONE place both the fast pre-check and the
     * CAS-miss produce a conflict, so every 409 carries the same `{ server, base? }` snapshots read from a
     * single snapshot (a third writer can't make `server` a version ahead of the reported `currentVersion`).
     * Owner-only by construction: only the owner-gated update path calls it (a non-owner already got 404).
     */
    private async raiseVersionConflict(id: string, expectedVersion: number): Promise<never> {
        const conflict = await this.dal.readConflict(id, expectedVersion);

        if (!conflict) {
            throw recipeNotFound(id);
        }

        const server: VersionConflictSide = {
            versionNumber: conflict.current.recipe.currentVersion,
            ...(conflict.serverVersion?.deviceLabel != null ? { deviceLabel: conflict.serverVersion.deviceLabel } : {}),
            updatedAt: conflict.current.recipe.updatedAt.toISOString(),
            snapshot: aggregateToSnapshot(conflict.current),
        };
        const base: VersionConflictSide | undefined =
            conflict.baseVersion !== undefined
                ? {
                      versionNumber: conflict.baseVersion.versionNumber,
                      ...(conflict.baseVersion.deviceLabel != null
                          ? { deviceLabel: conflict.baseVersion.deviceLabel }
                          : {}),
                      updatedAt: conflict.baseVersion.createdAt.toISOString(),
                      snapshot: conflict.baseVersion.snapshot as RecipeSnapshot,
                  }
                : undefined;

        throw versionConflict(conflict.current.recipe.currentVersion, expectedVersion, {
            server,
            ...(base !== undefined ? { base } : {}),
        });
    }

    private assertOwner(ownerId: string, recipe: RecipeRow): void {
        // W8-a.4 (IDOR): a recipe the caller cannot even SEE (private/draft, not owned) returns 404 —
        // indistinguishable from a missing id — closing the existence oracle a bare owner check (403) opens
        // on `update`/`delete`/`setVisibility` (all reachable via a leaked clonedFromId/collection/version
        // reference). A recipe the caller CAN see but does not OWN (public, other-owner) still returns 403:
        // you can see it, you just can't modify it — not an oracle.
        if (!isRecipeViewableBy(recipe, ownerId)) {
            throw recipeNotFound(recipe.id);
        }

        if (recipe.ownerId !== ownerId) {
            throw notOwner(recipe.id);
        }
    }
}
