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
    lineNutritionSource,
    quantitiesEqual,
    toNutritionLine,
    type CatalogFoodResolutionStatus,
    type LineCatalogNutrition,
    type LineMeasure,
    type StatedMeasure,
    type LineResolutionStatus,
    type NutritionLine,
    type RecipeNutrition,
    type RecipePhoto,
    type Ingredient,
    type RecipeSnapshot,
    type VersionConflictSide,
} from '@kitchensink/recipe-core';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';

import { Logger } from '@nestjs/common';
import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';

import { toPageEnvelope } from '../common/pagination.js';
import { VersionsService } from '../versions/versions.service.js';
import { PhotosDal } from '../photos/dal/photos.dal.js';
import { resolveCoverUrl, resolvePhotoView } from '../photos/photoView.js';
import { RecipesDal, type RecipeAggregate, type StepInput } from './dal/recipes.dal.js';
import { toRecipeNutritionState } from './domain/nutritionState.js';
import {
    isWithheld,
    resolveLineStatus,
    verifiedLineIdentity,
    type VerificationBand,
} from './domain/lineVerification.js';
import { LineVerificationsDal } from './dal/lineVerifications.dal.js';
import { sha256Hex } from '../common/sha256.js';
import type { RecipeNutritionResponse, RecipeNutritionState } from './recipes.schema.js';
import { RatingsDal } from '../ratings/dal/ratings.dal.js';
import type { ResolvedIngredientLine } from './dal/recipeIngredients.dal.js';
import { quantityFromColumns, statedMeasureFromColumns } from './dal/quantityColumns.js';
import {
    invalidVisibility,
    notOwner,
    provenanceNotPermitted,
    recipeNotFound,
    unknownIngredient,
    versionConflict,
} from './recipe.error.js';
import { evaluateProvenance } from './domain/provenancePolicy.js';
import { defaultCloneVisibility, evaluateVisibility } from './domain/visibilityPolicy.js';
import { isRecipeViewableBy } from './domain/recipeVisibility.js';
import { recipeRowToDomain } from './mappers/recipeRowToDomain.js';
import { resolveCdnUrl } from '../photos/photoView.js';
import type { CreateRecipeDto, CreateRecipeStepInputDto, RecipeIngredientInputDto } from './dto/createRecipe.dto.js';
import type { CreateRecipeIngredientInput } from './recipes.schema.js';
import { carryForwardTranscription } from './domain/transcriptionCarryForward.js';
import { buildVerificationRequests, type VerifiableLine } from './domain/verificationRequests.js';
import { VERIFICATION_QUEUE, type VerificationQueuePort } from './verification.queue.js';
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

/**
 * What {@link RecipesService.resolveIngredientLines} produces: the link rows to persist, AND the catalog rows
 * they were resolved against.
 *
 * The catalog half exists for the verification producer, which needs `foodId` and the catalog's canonical
 * `name` — neither of which survives onto a `recipe_ingredients` row. Returning it reuses the batch read the
 * method already performs rather than adding a second query to every recipe save.
 */
interface ResolvedIngredientLines {
    readonly lines: ResolvedIngredientLine[];
    readonly catalog: ReadonlyMap<string, Ingredient>;
}

/**
 * Project a PERSISTED `recipe_ingredients` row onto the gate's question.
 *
 * ⛔ THE ONLY PROJECTION, used for the lines being asked about AND for the lines already asked about. An
 * earlier revision had a second adapter reading the pre-persistence `ResolvedIngredientLine`, and the two
 * disagreed in a way nothing would have caught: the DTO carries an unrounded `number` while
 * `recipe_ingredients.quantity` is `numeric(10,3)`, and `recipeIngredientQuantitySchema` imposes NO scale.
 * A client sending `0.3333333333` would have produced a create message keyed on `0.3333333333` against a
 * stored row of `0.333` — a verdict keyed on a quantity no row holds, and a dedup that could never match
 * again. That it does not happen today rests only on `recipe-import-core` pre-rounding, which is a coupling
 * across two packages with nothing asserting it. Reading the RETURNED rows removes the question.
 *
 * ⚠️ `quantityFromColumns` is the ONE adapter that turns the two nullable `numeric` columns back into the
 * value object — the same one the read projection and `ingredientsChanged` use. A local re-derivation here
 * would make "unchanged" mean something subtly different from what the rest of the service means by it, and
 * the only symptom would be a bill.
 *
 * ⚠️ The `foodId` comes from the CURRENT catalog, not from a snapshot taken when the row was written — and
 * that is only sound because `ingredients.food_id` is IMMUTABLE. It is set on insert (`createFoodBacked`)
 * and no statement in `IngredientsDal` ever updates it: `updateResolution` writes
 * `food_resolution_status`, `name` and `search_vector`, and nothing else. If that ever changes, this
 * lookup starts reporting a stored line's judgement as being about a food it was not about, and a request
 * that SHOULD be re-asked would be suppressed instead.
 *
 * @param row - The stored `recipe_ingredients` row.
 * @param catalog - The catalog rows, by ingredient id. A row whose ingredient is absent from this map yields
 *   no `foodId`, hence no judgement identity, hence no suppression — the SAFE direction (re-ask).
 * @returns The verifiable projection. Pure.
 */
function storedLineToVerifiable(row: RecipeIngredientRow, catalog: ReadonlyMap<string, Ingredient>): VerifiableLine {
    const ingredient = catalog.get(row.ingredientId);

    return {
        sourceLine: row.sourceLine ?? undefined,
        foodId: ingredient?.foodId,
        // The CATALOG's canonical name where we have it, never the caller's phrase: the gate asks whether the
        // source line means THIS food, and our rendering is the output of the very parse under test
        // (`0024_ingredient_source_line.sql` makes the point — checking it against itself agrees by
        // construction). The denormalized column is the fallback for a row the catalog map does not cover.
        candidateFoodName: ingredient?.name ?? row.ingredientName,
        quantity: quantityFromColumns(row),
        unit: row.unit,
        // ⛔ U7/U11 — what the SOURCE printed, when the pair above is a RESTATEMENT of it. Through the ONE
        // adapter, and never omitted: a projection that dropped it would ask the model about `0.5 cup` for a
        // line whose source said `one gill` — a false DISAGREE against a line we parsed correctly — AND would
        // key the resulting verdict the pre-0027 way, so the corrected line could never find it.
        statedMeasure: statedMeasureFromColumns(row),
    };
}

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
 * DI token for the recipes vertical's {@link LineVerificationsDal} — the read side of the U11 verification
 * gate (plan U14). Same "own DAL instance over the shared Drizzle client" pattern as the two above.
 */
export const RECIPE_LINE_VERIFICATIONS_DAL = 'RECIPE_LINE_VERIFICATIONS_DAL';

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

/**
 * Map a persisted `recipe_ingredients` link row to the wire `RecipeIngredient` shape. Pure.
 *
 * `resolutionStatus` (U14) is layered on by the DETAIL read alone and is OMITTED everywhere else — a list
 * or search projection has performed neither the catalog load nor the verdict read, and emitting a default
 * there would state a resolution fact nobody looked up.
 */
function toIngredientResponse(
    row: RecipeIngredientRow,
    resolutionStatus: LineResolutionStatus | undefined,
): RecipeIngredientResponse {
    return {
        ingredientId: row.ingredientId,
        name: row.ingredientName,
        // Both quantity columns, read through the ONE adapter (`dal/quantityColumns.ts`).
        quantity: quantityFromColumns(row),
        ...(row.unit.length > 0 ? { unit: row.unit } : {}),
        ...(row.displayText !== null ? { notes: row.displayText } : {}),
        isUserEntered: row.isUserEntered,
        ...(resolutionStatus === undefined ? {} : { resolutionStatus }),
    };
}

/** Optional projection extras layered onto a recipe response by the caller (detail vs. list). */
interface RecipeResponseExtras {
    /** Embedded photos (DETAIL reads only) — omitted on list/search metadata. */
    photos?: RecipePhoto[];
    /** Per-serving nutrition (DETAIL reads only) — omitted on list/search metadata. */
    nutrition?: RecipeNutrition;
    /**
     * Per-LINE resolution status by `recipe_ingredients` row id (U14, DETAIL reads only).
     *
     * ⛔ Keyed on the row id and NOT the ingredient id: two lines of one recipe may reference the same
     * catalog ingredient with different quantities, which are two different judgements and may carry two
     * different verdicts. Keying on the ingredient would silently badge both lines from one of them.
     */
    lineStatuses?: ReadonlyMap<string, LineResolutionStatus>;
    /** Absolute CDN URL of the cover photo (FR-001c). Resolved by the caller (list LATERAL / detail photos). */
    coverPhotoUrl?: string;
    /**
     * The VIEWER's own rating (1–5), for the `RecipeDetail.viewerRating` field (FR-013). DETAIL reads only,
     * and only when the viewer has actually rated — ABSENT otherwise (never `0`). Resolved by the caller
     * (`getById`) from the viewer-scoped `recipe_ratings` row.
     */
    viewerRating?: number;
    /*
     * ⛔ THERE IS NO `derivedNutrition` EXTRA, and reintroducing one is how the drift comes back.
     *
     * It carried `leadCaloriesPerServing` into the base projection, and the only path that ever set it was
     * `toDetailResponse` — from the SAME `computeDetailNutrition` result it already emits as `nutrition`.
     * So the detail body reported one number twice, under two names, with nothing keeping them in step
     * (ADR-0021's "Follow-up owed"). The detail's figure is `nutrition`; a card's is
     * `POST /api/v1/recipes/nutrition-batch`, whose union can say "measured zero" and "unaccounted"
     * separately — which an optional number never could.
     */
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
    // The base projection carries NO nutrition of any kind — the mapper has no input for one. A recipe with
    // no nutrition fields is what "we did not look it up" honestly looks like; the pinned
    // `hasPartialNutrition: true` that used to stand here claimed "partial", a different fact.
    const { description: _canonicalDescription, ...base } = recipeRowToDomain(recipe);

    return {
        ...base,
        // RecipeResponse.description is OPTIONAL — OMITTED (not `''`) when unset, unlike the canonical
        // Recipe.description (required, `''` default).
        ...(recipe.description !== null ? { description: recipe.description } : {}),
        // Composed from the `recipe_ingredients` junction (persisted atomically with the recipe), in
        // author order (`sortOrder`). Empty only when the recipe genuinely has no ingredient lines.
        ingredients: ingredients.map((row) => toIngredientResponse(row, extras.lineStatuses?.get(row.id))),
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
    const cloned = statedMeasureFromColumns(row);

    return {
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        // Both quantity columns, read through the ONE adapter (`dal/quantityColumns.ts`).
        quantity: quantityFromColumns(row),
        unit: row.unit,
        ...(row.displayText !== null ? { displayText: row.displayText } : {}),
        // ⛔ The raw source line travels with the clone (U11). It is a fact about the SOURCE, not about the
        // author — a clone of an imported recipe was transcribed from the same book — so it belongs to the
        // line exactly as `display_text` does. Omitting it (as this mapper did until `0024` was noticed here)
        // means a cloned recipe can NEVER be verified and U14's correction surface has nothing to show the
        // cook their source said, permanently and silently.
        //
        // ⚠️ The clone deliberately does NOT enqueue a verification of its own: the judgement is
        // content-identical to the source's, and `verificationKey` is content-addressed, so any verdict the
        // source already carries applies to the clone unchanged.
        ...(row.sourceLine !== null ? { sourceLine: row.sourceLine } : {}),
        // ⛔ And so does the stated measure, for the same reason and with a sharper consequence. A clone of an
        // imported recipe was transcribed from the same book, so the gill belongs to the line exactly as the
        // source line does. It is also what makes the sentence above TRUE: the judgement is content-identical
        // to the source's only if the stated measure travels, because `verificationKey` v2 hashes it — omit it
        // and the clone's key differs, the source's verdict no longer applies, and the clone is never verified.
        ...(cloned === undefined ? {} : { statedMeasure: cloned }),
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
    /**
     * The shared catalog row's OWN food-resolution status, by ingredient id (U14).
     *
     * ⛔ The five-value CATALOG subset. `NEEDS_REVIEW` is layered on top of it PER LINE by
     * `resolveLineStatus` and is never read from — or written to — a catalog row (migration 0023).
     */
    readonly statusByIngredientId: ReadonlyMap<string, CatalogFoodResolutionStatus>;
}

/**
 * What the gate concluded about the lines of one request, keyed by `recipe_ingredients` row id (U14).
 *
 * ⚠️ A line with NO entry is a line the gate has not judged, and that means PUBLISH — migration 0023's
 * standing rule for an asynchronous gate. An empty map is therefore the correct, common answer, not a
 * degraded one.
 */
type LineVerdicts = ReadonlyMap<string, VerificationBand>;

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
): NutritionLine[] {
    return measures.map(({ ingredientId, lineId, sourceLine: _sourceLine, ...measure }) =>
        toNutritionLine(
            measure,
            isWithheld(verdicts.get(lineId)) ? undefined : catalog.byIngredientId.get(ingredientId),
        ),
    );
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
        if (!isWithheld(verdicts.get(lineId))) {
            return false;
        }

        const withCatalog = toNutritionLine(measure, catalog.byIngredientId.get(ingredientId));

        return (
            lineNutritionSource(withCatalog) !== null &&
            lineNutritionSource(toNutritionLine(measure, undefined)) === null
        );
    }).length;
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
            // Both quantity columns, read through the ONE adapter (`dal/quantityColumns.ts`).
            quantity: quantityFromColumns(line),
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
            // ⛔ `!==` here would be REFERENCE identity against a value object — every metadata-only PATCH
            // would read as a substantive edit and mint a new version. `quantitiesEqual` is the value
            // object's own identity, and it is what makes an upper-bound-only edit substantive (C-004).
            !quantitiesEqual(quantityFromColumns(row), next.quantity) ||
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
        // ⛔ THE VERIFICATION GATE'S PRODUCER (plan U11 / ADR-0024). REQUIRED, not defaulted: U11 shipped the
        // gate's consumer with nothing sending it a message, and a collaborator that defaults to a no-op is
        // how that state comes back — silently, past a green suite. Every construction site must name it.
        @Inject(VERIFICATION_QUEUE) private readonly verificationQueue: VerificationQueuePort,
        // U14 — the read side of the U11 verification gate. Its OWN DAL instance over the shared Drizzle
        // client, the same pattern as the embedded PhotosDal/RatingsDal above (no module import, no cycle).
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL) private readonly lineVerificationsDal: LineVerificationsDal,
    ) {}

    /** One logger for the producer — a queue that is refusing work must be visible, never silent. */
    private readonly logger = new Logger(RecipesService.name);

    /**
     * Load a recipe's photo ROWS in display order. Returns rows (not wire views) because the detail read
     * needs the cover row's `thumbnailKey` to resolve the cover thumbnail (FOLLOW-UP-CR-001-A), which the
     * `RecipePhoto` wire shape does not carry. {@link toDetailResponse} maps them to the gallery views.
     */
    private async loadPhotoRows(recipeId: string): Promise<RecipePhotoRow[]> {
        return this.photosDal.findByRecipe(recipeId);
    }

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
    ): Promise<{ nutrition: RecipeNutrition; lineStatuses: ReadonlyMap<string, LineResolutionStatus> }> {
        const measures = aggregate.ingredients.map(rowToMeasureInput);
        const catalog = await this.loadLineCatalog(
            caller,
            measures.map((measure) => measure.ingredientId),
        );
        const verdicts = await this.loadLineVerdicts(catalog, measures);
        const lineStatuses = new Map<string, LineResolutionStatus>();

        for (const measure of measures) {
            const status = resolveLineStatus(
                verdicts.get(measure.lineId),
                catalog.statusByIngredientId.get(measure.ingredientId),
            );

            if (status !== undefined) {
                lineStatuses.set(measure.lineId, status);
            }
        }

        return {
            nutrition: computeRecipeNutrition(assembleLines(catalog, measures, verdicts), aggregate.recipe.servings),
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
        const byLineId = new Map<string, VerificationBand>();

        for (const [lineId, key] of keyByLineId) {
            const band = bands.get(key);

            if (band !== undefined) {
                byLineId.set(lineId, band);
            }
        }

        return byLineId;
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
        const allMeasures = [...measuresByRecipe.values()].flat();
        const catalog = await this.loadLineCatalog(
            caller,
            allMeasures.map((measure) => measure.ingredientId),
        );
        // ONE verdict read for the whole batch, for the same reason there is one food call: see
        // `loadLineVerdicts`. It runs AFTER the catalog because a verdict is keyed on the line's food id.
        const verdicts = await this.loadLineVerdicts(catalog, allMeasures);

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
                    lines: assembleLines(catalog, measures, verdicts),
                    referencedFoodCount: referenced.size,
                    resolvedFoodCount: [...referenced].filter((foodId) => catalog.resolvedFoodIds.has(foodId)).length,
                    staleFoodCount: [...referenced].filter((foodId) => catalog.staleFoodIds.has(foodId)).length,
                    withheldLineCount: countWithheldContributions(catalog, measures, verdicts),
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
     *
     * Its OUTPUT field outlived it by a release and has now gone too (ADR-0021's "Follow-up owed"): the
     * detail response no longer echoes `nutrition.calories` back as a top-level `leadCaloriesPerServing`,
     * and a card's figure comes from `POST /api/v1/recipes/nutrition-batch`.
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

        const { nutrition, lineStatuses } = await this.computeDetailNutrition(aggregate, options.caller);

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
     * Create a recipe owned by `principal.userId`.
     *
     * ⚠️ A create is no longer ALWAYS `user_created` (004-FR-024 / ADR-0023). It carries the provenance the
     * caller DECLARED, resolved by {@link evaluateProvenance} — which defaults an absent declaration to
     * `user_created`, so a body that says nothing behaves exactly as it always did, and gates
     * `imported_public` on the curator grant. A create still carries no substantive edit yet, and the
     * requested visibility is gated by the same pure C-004 {@link evaluateVisibility} policy the
     * set-visibility endpoint uses — now against the RESOLVED provenance: a free-tier caller requesting
     * `private` is rejected with `INVALID_VISIBILITY` (FR-003 — free-tier user_created recipes are
     * public-only), rather than silently persisting a `private` row the policy forbids. Premium is
     * derived from the signed token's `permissions` (see {@link PREMIUM_PERMISSION}).
     */
    public async create(principal: Principal, dto: CreateRecipeDto, caller?: CallerToken): Promise<RecipeResponse> {
        // ── Provenance FIRST, then visibility ────────────────────────────────────────────────────
        // The order is the seam (ADR-0023): the provenance policy decides WHAT THE RECIPE IS, and C-004
        // then decides what visibility THAT THING may hold. Until 004-FR-024, `evaluateVisibility` was
        // handed the literal `USER_CREATED`, so the provenance a caller declared and the provenance its
        // visibility was judged against could not be the same fact.
        //
        // `scopes` ∪ `permissions` mirrors identity's `ScopesGuard` rule that a grant is satisfied by
        // EITHER list; both come from the token's SIGNED `public_metadata`.
        const provenanceDecision = evaluateProvenance({
            declared: dto.source,
            grantedScopes: [...principal.scopes, ...principal.permissions],
        });

        if (!provenanceDecision.allowed) {
            throw provenanceNotPermitted(provenanceDecision.reason, {
                requiredScope: provenanceDecision.requiredScope,
                sourceType: dto.source?.sourceType,
            });
        }

        const provenance = provenanceDecision.provenance;
        const requested = dto.visibility ?? RecipeVisibility.PUBLIC;
        const decision = evaluateVisibility({
            sourceType: provenance.sourceType,
            isPremium: principal.permissions.includes(PREMIUM_PERMISSION),
            hasSubstantiveEdit: false,
            requested,
        });

        if (!decision.allowed) {
            throw invalidVisibility(decision.reason, { visibility: requested, sourceType: provenance.sourceType });
        }

        const { lines: ingredients, catalog } = await this.resolveIngredientLines(dto.ingredients);
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
            // Provenance as the policy RESOLVED it, never as the body stated it. `sourceType` is always
            // written (the resolved value equals the column default for an undeclared create, so the row is
            // unchanged); the two nullable text columns are written as the policy's `null`, which is what
            // "no external source" means — never `''`, which would render as an empty credit line.
            sourceType: provenance.sourceType,
            sourceUrl: provenance.sourceUrl,
            sourceAttribution: provenance.sourceAttribution,
            ingredientNamesText: buildIngredientNamesText(ingredients),
            // Denormalized headline per-serving calories (W8-a.1) — recomputed from the resolved lines so the
            // list/search/collection-embed cards render calories without an N+1. Absent → column stays NULL.
            // Denormalized author handle (W8-a.2) — absent → column stays NULL until the fan-out fills it.
            ...(authorHandle !== undefined ? { authorHandle } : {}),
            ingredients,
            steps: dto.steps.map(toStepInput),
        });

        await this.recordSnapshot(aggregate, principal.userId, 'Created', dto.deviceLabel, authorHandle);

        // Ask the verification gate about the transcribed lines (plan U11 / ADR-0024). A create has nothing
        // already on record, so `previous` is empty. Never throws — see `requestVerification`.
        //
        // ⛔ LAST, after the snapshot, and the UPDATE path does the same: this is a lossy, explicitly
        // droppable side effect, so nothing that must not be lost may sit behind it. Interposing it between
        // the committed write and the version snapshot would mean a stall delays — and a process death
        // loses — a snapshot, to buy nothing.
        //
        // ⛔ Reads `aggregate.ingredients` (the PERSISTED rows), not the pre-persistence lines: the DTO
        // carries an unrounded number while the column is `numeric(10,3)`, so the two can disagree on a
        // quantity — see `storedLineToVerifiable`.
        await this.requestVerification(
            aggregate.recipe.id,
            aggregate.recipe.ownerId,
            aggregate.ingredients,
            catalog,
            [],
        );

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
     * with M lines costs one catalog round-trip regardless of M (mirrors {@link loadLineCatalog}).
     */
    private async resolveIngredientLines(
        lines: readonly CreateRecipeIngredientInput[],
    ): Promise<ResolvedIngredientLines> {
        const ids = [...new Set(lines.map((line) => line.ingredientId))];
        const catalog = new Map((await this.ingredientsDal.findByIds(ids)).map((ing) => [ing.id, ing]));

        const resolved = lines.map((line, index) => {
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
                // U11/U14 — carried only when the CALLER transcribed one, which only a create can do (the
                // field is on the create element schema alone, ADR-0023's shape). An UPDATE's lines arrive
                // here without one and are handed the stored transcription afterwards, by
                // `withCarriedTranscription` — see `domain/transcriptionCarryForward.ts` for why that is a
                // carry-forward rather than a wire field.
                ...(line.sourceLine !== undefined ? { sourceLine: line.sourceLine } : {}),
                // U7/U11 — likewise create-only, and for a SHARPER version of the same reason: a source line
                // is what the gate checks our parse against, so a lie in it is visible to the model, while a
                // stated measure IS the parse the model is shown. An UPDATE's lines arrive without one and are
                // handed the stored restatement afterwards, by `withCarriedTranscription`.
                ...(line.statedMeasure !== undefined ? { statedMeasure: line.statedMeasure } : {}),
                sortOrder: index,
                isUserEntered: ingredient.isUserEntered,
                // Per-line user-entered nutrition override (FR-007a) — carried through to persistence.
                ...(line.userCalories !== undefined ? { userCalories: line.userCalories } : {}),
                ...(line.userProteinG !== undefined ? { userProteinG: line.userProteinG } : {}),
                ...(line.userCarbsG !== undefined ? { userCarbsG: line.userCarbsG } : {}),
                ...(line.userFatG !== undefined ? { userFatG: line.userFatG } : {}),
            };
        });

        // ⛔ The catalog map is RETURNED, not discarded, because the verification producer needs the two
        // fields only it holds — `foodId` and the catalog's canonical `name`. Returning it costs nothing
        // (the batch read already happened); re-reading it after the write would put a second query on
        // every recipe save to recover data this method already had in hand.
        return { lines: resolved, catalog };
    }

    /**
     * Ask the verification gate about the lines this write changed (plan U11 / ADR-0024).
     *
     * ⛔ CALLED AFTER THE ROW IS PERSISTED, and its failure is SWALLOWED. Two rules, each with a reason:
     *
     *  - **After**, because the message carries the recipe's id — a producer that ran first would have
     *    nothing to name.
     *  - **Swallowed**, because the gate is a quality enhancement on an ASYNC path and
     *    `0023_line_verifications.sql` establishes that absence of a verdict means PUBLISH. A lost message
     *    degrades to exactly the behaviour the system had before the gate existed, so letting SQS fail a
     *    save would trade a quality improvement for an availability regression. It is logged at `error`
     *    so a SUSTAINED rate is visible as the "the gate is receiving nothing" signal it would be.
     *
     * @param recipeId - The persisted recipe.
     * @param ownerId - That recipe's owner, carried so a remembered phrase stays erasable (migration 0026).
     * @param lines - The lines as they are now stored.
     * @param catalog - The catalog rows those lines resolved to, by ingredient id.
     * @param previous - The recipe's lines BEFORE this write; empty on a create.
     * @sideEffect Sends SQS messages; logs on failure. Never throws.
     */
    private async requestVerification(
        recipeId: string,
        ownerId: string,
        lines: readonly RecipeIngredientRow[],
        catalog: ReadonlyMap<string, Ingredient>,
        previous: readonly RecipeIngredientRow[],
    ): Promise<void> {
        const { requests, unasked } = buildVerificationRequests({
            recipeId,
            ownerId,
            lines: lines.map((row) => storedLineToVerifiable(row, catalog)),
            alreadyRequested: previous.map((row) => storedLineToVerifiable(row, catalog)),
            thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
            requestedAt: new Date().toISOString(),
        });

        // ⛔ An over-cap line is the ONE unasked reason worth a log line. `authored` and
        // `no-catalog-identity` are the normal, dominant cases and would drown it; `over-cap` means the
        // system has permanently decided never to check a line a cook can see, and
        // `recipeRequestBounds.ts` says such a line should be "surfaced for correction". Observe-only ships
        // no `unresolved` state to write, so this log is the interim surface.
        const overCap = unasked.filter((entry) => entry.reason === 'over-cap');

        if (overCap.length > 0) {
            this.logger.warn(
                `recipe ${recipeId}: ${overCap.length} ingredient line(s) exceed the verification gate's ` +
                    `input cap and will never be checked (longest ${Math.max(
                        ...overCap.map((entry) => entry.observedChars ?? 0),
                    )} characters)`,
            );
        }

        if (requests.length === 0) {
            // ⛔ Not an empty batch — no call at all. `SendMessageBatch` REFUSES an empty `Entries` list
            // (`AWS.SimpleQueueService.EmptyBatchRequest`, verified against LocalStack), so an unguarded call
            // here would turn every hand-authored recipe save into a logged error.
            return;
        }

        try {
            await this.verificationQueue.enqueue(requests);
        } catch (error) {
            this.logger.error(
                `failed to enqueue ${requests.length} verification request(s) for recipe ${recipeId}; ` +
                    'the lines publish unverified, which is the behaviour that predates the gate',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /**
     * Re-attach each resolved line's transcription — its raw source line AND the measure the source printed
     * before a historical unit was restated — from the currently-stored lines, per the pure
     * {@link carryForwardTranscription} rule.
     *
     * The stored rows are adapted here rather than in the policy: `quantity`/`quantity_high` arrive from
     * Drizzle as two nullable strings, and `quantityFromColumns` is the ONE adapter that turns them back into
     * the value object — the same one the read projection and `ingredientsChanged` use, so all three agree on
     * what a stored quantity IS.
     *
     * @param stored - The recipe's currently persisted ingredient rows.
     * @param resolved - The lines the update is about to persist, in final order.
     * @returns The same lines, each carrying the transcription it inherits (if any). Pure.
     */
    private withCarriedTranscription(
        stored: readonly RecipeIngredientRow[],
        resolved: readonly ResolvedIngredientLine[],
    ): ResolvedIngredientLine[] {
        const carried = carryForwardTranscription(
            stored.map((row) => ({
                ingredientId: row.ingredientId,
                quantity: quantityFromColumns(row),
                unit: row.unit,
                sourceLine: row.sourceLine ?? undefined,
                statedMeasure: statedMeasureFromColumns(row),
            })),
            resolved,
        );

        return resolved.map((line, index) => ({
            ...line,
            // Spread-if-present rather than assign-if-undefined: `ResolvedIngredientLine` spells "this line
            // has none" by OMITTING the key, matching the way the wire and the DAL both spell it, so an
            // explicit `undefined` would put a second spelling of absence into the persistence path.
            ...(carried[index]?.sourceLine === undefined ? {} : { sourceLine: carried[index]?.sourceLine }),
            ...(carried[index]?.statedMeasure === undefined ? {} : { statedMeasure: carried[index]?.statedMeasure }),
        }));
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
        // ⛔ The resolved lines are then handed the TRANSCRIPTION the stored lines already hold. `PATCH`
        //    cannot carry a `sourceLine` (create-only, ADR-0023's shape) and `replaceForRecipe` swaps the
        //    whole set, so without this a title edit would destroy every source line on an imported recipe —
        //    and BOTH shipped clients send `ingredients` on every save (`toUpdateRecipeInput` spreads
        //    `toCreateRecipeInput`, which always emits the array), so "a metadata-only PATCH preserves them"
        //    describes a request no app makes. The rule is `domain/transcriptionCarryForward.ts`; it is applied
        //    HERE because this is the only layer holding both the stored aggregate and the resolved lines.
        const resolved = dto.ingredients !== undefined ? await this.resolveIngredientLines(dto.ingredients) : undefined;
        const ingredients =
            resolved === undefined ? undefined : this.withCarriedTranscription(existing.ingredients, resolved.lines);

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

        if (resolved !== undefined) {
            // ⛔ `existing.ingredients` is the ALREADY-REQUESTED set, and it is what stops a title edit from
            // re-paying for every line: `replaceForRecipe` rewrites the whole set on every save, and both
            // shipped clients send `ingredients` on every save. A patch carrying no `ingredients` asks
            // nothing at all, because no judgement moved. LAST, for the reason `create` states.
            await this.requestVerification(
                id,
                existing.recipe.ownerId,
                updated.ingredients,
                resolved.catalog,
                existing.ingredients,
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
