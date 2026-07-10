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
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { RecipeNutrition, RecipePhoto, RecipeSnapshot } from '@kitchensink/recipe-core';

import { VersionsService } from '../versions/versions.service.js';
import { PhotosDal } from '../photos/dal/photos.dal.js';
import { resolvePhotoView } from '../photos/photo-view.js';
import { computeRecipeNutrition, type NutritionLine } from './domain/nutrition.js';
import { RecipesDal, type RecipeAggregate, type StepInput } from './dal/recipes.dal.js';
import type { ResolvedIngredientLine } from './dal/recipe-ingredients.dal.js';
import { invalidVisibility, notOwner, recipeNotFound, unknownIngredient, versionConflict } from './recipe.error.js';
import { defaultCloneVisibility, evaluateVisibility } from './domain/visibility-policy.js';
import { isRecipeViewableBy } from './domain/recipe-visibility.js';
import type { CreateRecipeDto, CreateRecipeStepInputDto, RecipeIngredientInputDto } from './dto/create-recipe.dto.js';
import type { UpdateRecipeDto } from './dto/update-recipe.dto.js';
import type { ListRecipesQueryDto } from './dto/list-recipes.query.dto.js';
import type { PaginatedRecipesResponse, RecipeIngredientResponse, RecipeResponse } from './dto/recipe-response.dto.js';
import { IngredientsDal } from '../ingredients/dal/ingredients.dal.js';
import { RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from '../database/schema/index.js';
import type { Principal } from '../auth/principal.js';

/** DI token for the recipe DAL — provided by `RecipesModule` via `useFactory` over the Drizzle client. */
export const RECIPES_DAL = 'RECIPES_DAL';

/** DI token for the recipes vertical's own `PhotosDal` instance (embeds a recipe's photos in the detail). */
export const RECIPE_PHOTOS_DAL = 'RECIPE_PHOTOS_DAL';

/** DI token for the CloudFront base URL used to resolve embedded photo URLs. */
export const RECIPE_PHOTOS_CDN_URL = 'RECIPE_PHOTOS_CDN_URL';

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

/**
 * Map a persisted recipe aggregate to the wire response. Pure. On the single-recipe DETAIL reads the
 * caller passes the embedded `photos` + per-serving `nutrition` so the client renders the whole recipe in
 * one round-trip; on list/search metadata reads both are omitted (their keys are absent).
 */
function toRecipeResponse(
    aggregate: RecipeAggregate,
    photos?: RecipePhoto[],
    nutrition?: RecipeNutrition,
): RecipeResponse {
    const { recipe, steps, ingredients } = aggregate;

    return {
        id: recipe.id,
        ownerId: recipe.ownerId,
        title: recipe.title,
        ...(recipe.description !== null ? { description: recipe.description } : {}),
        ...(recipe.cuisine !== null ? { cuisine: recipe.cuisine } : {}),
        visibility: recipe.visibility as RecipeVisibility,
        sourceType: recipe.sourceType as RecipeSourceType,
        ...(recipe.sourceUrl !== null ? { sourceUrl: recipe.sourceUrl } : {}),
        ...(recipe.sourceAttribution !== null ? { sourceAttribution: recipe.sourceAttribution } : {}),
        ...(recipe.clonedFromId !== null ? { clonedFromId: recipe.clonedFromId } : {}),
        hasSubstantiveEdit: recipe.hasSubstantiveEdit,
        hasPartialNutrition: recipe.hasPartialNutrition,
        // Composed from the `recipe_ingredients` junction (persisted atomically with the recipe), in
        // author order (`sortOrder`). Empty only when the recipe genuinely has no ingredient lines.
        ingredients: ingredients.map(toIngredientResponse),
        steps: steps.map((step) => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds !== null ? { timerSeconds: step.timerSeconds } : {}),
        })),
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        totalTimeMinutes: recipe.totalTimeMinutes,
        tags: recipe.tags,
        dietaryFlags: recipe.dietaryFlags,
        currentVersion: recipe.currentVersion,
        createdAt: recipe.createdAt.toISOString(),
        updatedAt: recipe.updatedAt.toISOString(),
        // Tombstone: present only when the recipe is soft-deleted; OMITTED (not `null`) otherwise, to match
        // the optional `Recipe.deletedAt` contract (a `null` would fail `recipeSchema`).
        ...(recipe.deletedAt !== null ? { deletedAt: recipe.deletedAt.toISOString() } : {}),
        // Embedded photos + per-serving nutrition for the detail read (absent on list/search metadata).
        ...(photos !== undefined ? { photos } : {}),
        ...(nutrition !== undefined ? { nutrition } : {}),
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
        @Inject(forwardRef(() => VersionsService)) private readonly versions: VersionsService,
        // The recipes vertical embeds a recipe's photos in the `RecipeDetail` read via its OWN PhotosDal
        // instance over the shared Drizzle client (no PhotosModule import → no module cycle).
        @Inject(RECIPE_PHOTOS_DAL) private readonly photosDal: PhotosDal,
        @Inject(RECIPE_PHOTOS_CDN_URL) private readonly photosCdnUrl: string,
    ) {}

    /** Load a recipe's photos, resolved to the shared `RecipePhoto` wire shape (display order). */
    private async loadPhotos(recipeId: string): Promise<RecipePhoto[]> {
        const rows = await this.photosDal.findByRecipe(recipeId);

        return rows.map((row) => resolvePhotoView(row, this.photosCdnUrl));
    }

    /**
     * Compute a recipe's estimated per-serving nutrition (FR-007) from its ingredient lines: each line's
     * user-entered override (FR-007a) when present, else the catalog per-100g nutrition scaled by mass.
     * The catalog nutrition is batch-loaded for the recipe's ingredient ids in one query.
     */
    private async computeDetailNutrition(aggregate: RecipeAggregate): Promise<RecipeNutrition> {
        const ids = [...new Set(aggregate.ingredients.map((row) => row.ingredientId))];
        const catalog = new Map((await this.ingredientsDal.findByIds(ids)).map((ing) => [ing.id, ing]));

        const lines: NutritionLine[] = aggregate.ingredients.map((row) => {
            const ingredient = catalog.get(row.ingredientId);

            return {
                quantity: Number(row.quantity),
                unit: row.unit,
                ...(row.userCalories !== null ? { userCalories: Number(row.userCalories) } : {}),
                ...(row.userProteinG !== null ? { userProteinG: Number(row.userProteinG) } : {}),
                ...(row.userCarbsG !== null ? { userCarbsG: Number(row.userCarbsG) } : {}),
                ...(row.userFatG !== null ? { userFatG: Number(row.userFatG) } : {}),
                ...(ingredient?.caloriesPer100g !== undefined ? { caloriesPer100g: ingredient.caloriesPer100g } : {}),
                ...(ingredient?.proteinGPer100g !== undefined ? { proteinGPer100g: ingredient.proteinGPer100g } : {}),
                ...(ingredient?.carbsGPer100g !== undefined ? { carbsGPer100g: ingredient.carbsGPer100g } : {}),
                ...(ingredient?.fatGPer100g !== undefined ? { fatGPer100g: ingredient.fatGPer100g } : {}),
                ...(ingredient?.portions !== undefined ? { portions: ingredient.portions } : {}),
            };
        });

        return computeRecipeNutrition(lines, aggregate.recipe.servings);
    }

    /**
     * Shape a recipe aggregate into the full `RecipeDetail` response: the metadata + composed ingredients
     * and steps, PLUS the embedded `photos` and computed per-serving `nutrition`. Used by every
     * single-recipe read (get/create/update/clone/set-visibility).
     */
    private async toDetailResponse(aggregate: RecipeAggregate, photos: RecipePhoto[]): Promise<RecipeResponse> {
        return toRecipeResponse(aggregate, photos, await this.computeDetailNutrition(aggregate));
    }

    /**
     * Record an immutable version snapshot of a just-written recipe aggregate (FR-007b). Best-effort:
     * the recipe has already committed, so a snapshot/retention failure must NOT fail the user's save —
     * it is logged and swallowed (the reconciliation/worker path backstops a missed row). This is the
     * ONE place create/update/clone converge to populate version history.
     *
     * @sideEffect Inserts a `recipe_versions` row and runs retention (archive + prune) via VersionsService.
     */
    private async recordSnapshot(aggregate: RecipeAggregate, ownerId: string, changeSummary: string): Promise<void> {
        try {
            await this.versions.createSnapshot({
                recipeId: aggregate.recipe.id,
                versionNumber: aggregate.recipe.currentVersion,
                snapshot: aggregateToSnapshot(aggregate),
                createdBy: ownerId,
                changeSummary,
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
    public async create(principal: Principal, dto: CreateRecipeDto): Promise<RecipeResponse> {
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
            tags: dto.tags ?? [],
            dietaryFlags: dto.dietaryFlags ?? [],
            ingredientNamesText: buildIngredientNamesText(ingredients),
            ingredients,
            steps: dto.steps.map(toStepInput),
        });

        await this.recordSnapshot(aggregate, principal.userId, 'Created');

        // A freshly-created recipe has no photos yet (uploaded afterward); nutrition is computed from its lines.
        return this.toDetailResponse(aggregate, []);
    }

    /**
     * Resolve each DTO ingredient line against the shared catalog, yielding the denormalized link rows
     * the DAL persists. Each line's `ingredientId` MUST already exist (the client resolves ingredients
     * via `/v1/ingredients` first); an unknown id fails fast with `UNKNOWN_INGREDIENT`. The catalog is
     * the source of truth for the persisted `ingredientName` / `isUserEntered`, and array order becomes
     * `sortOrder`.
     */
    private async resolveIngredientLines(lines: RecipeIngredientInputDto[]): Promise<ResolvedIngredientLine[]> {
        const resolved: ResolvedIngredientLine[] = [];

        for (const [index, line] of lines.entries()) {
            const ingredient = await this.ingredientsDal.findById(line.ingredientId);

            if (!ingredient) {
                throw unknownIngredient(line.ingredientId);
            }

            resolved.push({
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
            });
        }

        return resolved;
    }

    /** Fetch one recipe. Allowed for the owner, or for any `public` recipe. */
    public async getById(ownerId: string, id: string): Promise<RecipeResponse> {
        const aggregate = await this.dal.findById(id);

        if (!aggregate) {
            throw recipeNotFound(id);
        }

        if (!isRecipeViewableBy(aggregate.recipe, ownerId)) {
            throw notOwner(id);
        }

        return this.toDetailResponse(aggregate, await this.loadPhotos(id));
    }

    /** List the caller's own recipes (owner-scoped, tombstones excluded), paginated. */
    public async list(ownerId: string, query: ListRecipesQueryDto): Promise<PaginatedRecipesResponse> {
        const { page, pageSize, sortBy } = query;
        const { rows, total } = await this.dal.findAll({ ownerId, page, pageSize, sortBy });

        return {
            // Metadata list — NO embedded photos (also: `.map(toRecipeResponse)` would pass the index as
            // the `photos` arg, so the explicit arrow is required, not just an optimization).
            data: rows.map((row) => toRecipeResponse(row)),
            total,
            page,
            pageSize,
            hasMore: page * pageSize < total,
        };
    }

    /**
     * Update a recipe the caller owns, enforcing optimistic concurrency (T033), and record a version
     * snapshot of the result. `options.recordSnapshot = false` suppresses the snapshot for the RESTORE
     * path (which records its own snapshot with restore-specific provenance) so a restore writes exactly
     * one version, not two at the same number. `options.changeSummary` labels the recorded version.
     */
    public async update(
        ownerId: string,
        id: string,
        dto: UpdateRecipeDto,
        options: { recordSnapshot?: boolean; changeSummary?: string } = {},
    ): Promise<RecipeResponse> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, existing.recipe);

        if (existing.recipe.currentVersion !== dto.expectedVersion) {
            throw versionConflict(existing.recipe.currentVersion, dto.expectedVersion);
        }

        // Resolve replacement ingredient links only when the patch carries them (absent → links untouched).
        const ingredients =
            dto.ingredients !== undefined ? await this.resolveIngredientLines(dto.ingredients) : undefined;

        // C-004 / FR-005: a change to ingredients/steps flips `hasSubstantiveEdit` to true (once true, it
        // stays true — never reset). Only newly-substantive edits are persisted; the import provenance
        // columns are never touched here, so imported lineage survives the version bump (T139).
        const newlySubstantive = !existing.recipe.hasSubstantiveEdit && detectSubstantiveEdit(existing, dto);

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
            tags: dto.tags,
            dietaryFlags: dto.dietaryFlags,
            // Rebuild the search text from the RESOLVED catalog lines (not dto.ingredients) so the index
            // tracks the persisted junction names — only when the patch actually replaces ingredients.
            ...(ingredients !== undefined
                ? { ingredientNamesText: buildIngredientNamesText(ingredients), ingredients }
                : {}),
            ...(dto.steps !== undefined ? { steps: dto.steps.map(toStepInput) } : {}),
            ...(newlySubstantive ? { hasSubstantiveEdit: true } : {}),
        });

        if (!updated) {
            // The CAS matched 0 rows: either the row was tombstoned, or a concurrent update advanced the
            // version between our read and our write (the lost-update race). Re-read to tell them apart so
            // the loser of a concurrent edit gets a truthful 409 VERSION_CONFLICT, not a misleading 404.
            const current = await this.dal.findById(id);

            if (current) {
                throw versionConflict(current.recipe.currentVersion, dto.expectedVersion);
            }

            throw recipeNotFound(id);
        }

        if (options.recordSnapshot !== false) {
            await this.recordSnapshot(updated, ownerId, options.changeSummary ?? 'Updated');
        }

        return this.toDetailResponse(updated, await this.loadPhotos(id));
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
    public async clone(ownerId: string, id: string): Promise<RecipeResponse> {
        const source = await this.dal.findById(id);

        if (!source) {
            throw recipeNotFound(id);
        }

        if (source.recipe.ownerId !== ownerId && source.recipe.visibility !== 'public') {
            throw notOwner(id);
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

        await this.recordSnapshot(created, ownerId, `Cloned from ${source.recipe.id}`);

        // A fresh clone starts with no photos (not copied from the source); nutrition is computed from its lines.
        return this.toDetailResponse(created, []);
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

        return this.toDetailResponse(updated, await this.loadPhotos(id));
    }

    /** Owner-only guard for mutations: `owner_id == principal.userId` or `NOT_OWNER`. */
    private assertOwner(ownerId: string, recipe: RecipeRow): void {
        if (recipe.ownerId !== ownerId) {
            throw notOwner(recipe.id);
        }
    }
}
