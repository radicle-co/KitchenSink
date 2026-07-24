/**
 * T040 / T140 — the Collections service: CRUD, membership, no-cascade delete, and the visibility
 * toggle (FR-010), all ownership-enforced.
 *
 * Ownership is THE authorization boundary: every read/mutation of a specific collection first resolves
 * it and asserts `collection.ownerId === principal.userId`. A missing collection is a
 * `NotFoundException` (→ 404); a collection owned by someone else is a `RecipeDomainError` NOT_OWNER
 * (→ 403) — matching the OpenAPI 403/404 split so existence is only revealed to the owner.
 *
 * `deleteCollection` is **no-cascade**: it removes the collection (and, via FK, its junction rows) but
 * never the recipes themselves — a recipe in multiple collections survives the delete of any one.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    RecipeCollectionAddedVia,
    RecipeSourceType,
    RecipeVisibility,
    usesPremiumCapability,
    type PaginatedResponse,
    type Recipe,
    type RecipeStatus,
    type RecipeDifficulty,
} from '@kitchensink/recipe-core';

import {
    COLLECTION_VISIBILITIES,
    type CollectionRow,
    type CollectionVisibility,
} from '../database/schema/collections.js';
import type { RecipeRow } from '../database/schema/recipes.js';
import { AuthorHandlesDal } from '../authors/dal/author-handles.dal.js';
import { CollectionsDal } from './dal/collections.dal.js';
import { isRecipeViewableBy } from '../recipes/domain/recipe-visibility.js';
import {
    collectionNotClonedError,
    collectionNotOwnedError,
    invalidVisibilityError,
    pullDriftError,
    recipeNotFoundError,
} from './collections.errors.js';
import { computePullDiff, pullDiffsAgree, type PullDiff } from './domain/pull-diff.js';
import type {
    CloneCollectionInput,
    CollectionRecipeMembershipResponse,
    CollectionResponse,
    CollectionWithRecipesResponse,
    CreateCollectionInput,
    PageParams,
    PullFromSourceResult,
    UpdateCollectionInput,
} from './collections.types.js';

/** Map a `collections` row to the `Collection` wire shape (ISO dates; nulls → absent). */
function toCollectionResponse(row: CollectionRow, recipeCount?: number): CollectionResponse {
    const response: CollectionResponse = {
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        visibility: row.visibility as CollectionVisibility,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };

    return {
        ...response,
        ...(row.description !== null ? { description: row.description } : {}),
        ...(row.sourceCollectionId !== null ? { sourceCollectionId: row.sourceCollectionId } : {}),
        ...(row.sourceOwnerHandle !== null ? { sourceOwnerHandle: row.sourceOwnerHandle } : {}),
        ...(row.sourceCollectionName !== null ? { sourceCollectionName: row.sourceCollectionName } : {}),
        ...(row.lastPulledAt !== null ? { lastPulledAt: row.lastPulledAt.toISOString() } : {}),
        ...(recipeCount !== undefined ? { recipeCount } : {}),
    };
}

/** Map a `recipes` row to the shared `Recipe` domain type (nullable numerics defaulted, dates → ISO). */
function toRecipe(row: RecipeRow): Recipe {
    const recipe: Recipe = {
        id: row.id,
        ownerId: row.ownerId,
        title: row.title,
        description: row.description ?? '',
        prepTimeMinutes: row.prepTimeMinutes ?? 0,
        cookTimeMinutes: row.cookTimeMinutes ?? 0,
        totalTimeMinutes: row.totalTimeMinutes ?? 0,
        servings: row.servings,
        visibility: row.visibility as RecipeVisibility,
        // Publication status (W8-a.3) — always present; listRecipes already excludes other users' drafts.
        status: row.status as RecipeStatus,
        sourceType: row.sourceType as RecipeSourceType,
        hasSubstantiveEdit: row.hasSubstantiveEdit,
        dietaryFlags: row.dietaryFlags,
        tags: row.tags,
        hasPartialNutrition: row.hasPartialNutrition,
        currentVersion: row.currentVersion,
        // CR-001 read-model: the trigger-maintained aggregate + the derived PRO badge (same authoritative
        // `recipe-core` rule the recipes/search projections use). `coverPhotoUrl` is deliberately NOT
        // resolved on the collection-embedded projection — no cover LATERAL runs here — so it is absent
        // (a valid state); the collection card owns its no-image visual until a cover path is added.
        ratingCount: row.ratingCount,
        usesPremiumCapability: usesPremiumCapability({
            visibility: row.visibility as RecipeVisibility,
            sourceType: row.sourceType as RecipeSourceType,
        }),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };

    return {
        ...recipe,
        ...(row.difficulty !== null ? { difficulty: row.difficulty as RecipeDifficulty } : {}),
        ...(row.averageRating !== null ? { averageRating: Number(row.averageRating) } : {}),
        // Denormalized headline per-serving calories (W8-a.1) — the collection-embed card reads it here
        // (no N+1 nutrition read); OMITTED when NULL, never a misleading 0.
        ...(row.leadCaloriesPerServing !== null ? { leadCaloriesPerServing: Number(row.leadCaloriesPerServing) } : {}),
        // Denormalized author handle (W8-a.2) — the collection-embed card reads it here; OMITTED when NULL.
        ...(row.authorHandle !== null ? { authorHandle: row.authorHandle } : {}),
        ...(row.sourceUrl !== null ? { sourceUrl: row.sourceUrl } : {}),
        ...(row.sourceAttribution !== null ? { sourceAttribution: row.sourceAttribution } : {}),
        ...(row.clonedFromId !== null ? { clonedFromId: row.clonedFromId } : {}),
        ...(row.cuisine !== null ? { cuisine: row.cuisine } : {}),
        ...(row.deletedAt !== null ? { deletedAt: row.deletedAt.toISOString() } : {}),
    };
}

@Injectable()
export class CollectionsService {
    public constructor(
        @Inject(CollectionsDal) private readonly dal: CollectionsDal,
        @Inject(AuthorHandlesDal) private readonly authorHandles: AuthorHandlesDal,
    ) {}

    /** Create a collection owned by `ownerId`. Visibility defaults to `private` (FR-010). */
    public async createCollection(ownerId: string, input: CreateCollectionInput): Promise<CollectionResponse> {
        const row = await this.dal.create({
            ownerId,
            name: input.name,
            description: input.description,
            visibility: input.visibility ?? 'private',
        });

        return toCollectionResponse(row);
    }

    /** List the caller's own collections as a paginated envelope (newest first). */
    public async listCollections(ownerId: string, page: PageParams): Promise<PaginatedResponse<CollectionResponse>> {
        const limit = page.pageSize;
        const offset = (page.page - 1) * page.pageSize;
        const { rows, total } = await this.dal.listByOwner(ownerId, limit, offset);

        return {
            data: rows.map((row) => toCollectionResponse(row)),
            total,
            page: page.page,
            pageSize: page.pageSize,
            hasMore: offset + rows.length < total,
        };
    }

    /** Get one owned collection with its recipes (non-tombstoned AND viewable by the caller). */
    public async getCollection(ownerId: string, id: string): Promise<CollectionWithRecipesResponse> {
        const collection = await this.requireOwned(ownerId, id);
        // The caller (collection owner) is the viewer: they see public members + their own private ones,
        // never another user's private recipe that was added to (or left in) this collection.
        const recipeRows = await this.dal.listRecipes(id, ownerId);
        // W5 Task 4: carry each member's provenance through onto the embedded recipe (source-indicator
        // checkbox, C3) — the `Recipe` projection plus the DAL row's `addedVia`, nothing more.
        const recipes = recipeRows.map((row) => ({ ...toRecipe(row), addedVia: row.addedVia }));

        return { ...toCollectionResponse(collection, recipes.length), recipes };
    }

    /** Update an owned collection (name/description/visibility). Rejects an invalid visibility (FR-010). */
    public async updateCollection(
        ownerId: string,
        id: string,
        patch: UpdateCollectionInput,
    ): Promise<CollectionResponse> {
        if (patch.visibility !== undefined) {
            this.assertVisibility(patch.visibility);
        }

        await this.requireOwned(ownerId, id);
        const row = await this.dal.update(id, patch);

        if (!row) {
            throw new NotFoundException('Collection not found');
        }

        return toCollectionResponse(row);
    }

    /**
     * Set a collection's visibility (FR-010 / T140): a `public`↔`private` toggle, ownership-enforced,
     * with an invalid value rejected as INVALID_VISIBILITY (→ 400).
     */
    public async setVisibility(ownerId: string, id: string, visibility: string): Promise<CollectionResponse> {
        this.assertVisibility(visibility);
        await this.requireOwned(ownerId, id);
        const row = await this.dal.update(id, { visibility });

        if (!row) {
            throw new NotFoundException('Collection not found');
        }

        return toCollectionResponse(row);
    }

    /** Delete an owned collection. No-cascade: the collection's recipes are not deleted. */
    public async deleteCollection(ownerId: string, id: string): Promise<void> {
        await this.requireOwned(ownerId, id);
        await this.dal.deleteById(id);
    }

    /** Add an active recipe to an owned collection (idempotent). */
    public async addRecipe(
        ownerId: string,
        collectionId: string,
        recipeId: string,
    ): Promise<CollectionRecipeMembershipResponse> {
        await this.requireOwned(ownerId, collectionId);

        const recipe = await this.dal.findActiveRecipe(recipeId);

        // A recipe the caller cannot VIEW must not be addable — otherwise a user could add anyone's
        // private recipe to their own collection and read its body back through `getCollection` (IDOR).
        // Report it as not-found (not 403) so a private recipe's existence is never disclosed to a
        // non-owner. Read-side `listRecipes` re-checks viewability too, so a recipe that goes private
        // AFTER being added is also hidden — this is the fail-fast half of that defense in depth.
        if (!recipe || !isRecipeViewableBy(recipe, ownerId)) {
            throw recipeNotFoundError(recipeId);
        }

        const membership = await this.dal.addRecipe(collectionId, recipeId, RecipeCollectionAddedVia.MANUAL);

        return {
            collectionId: membership.collectionId,
            recipeId: membership.recipeId,
            addedVia: membership.addedVia as RecipeCollectionAddedVia,
            createdAt: membership.addedAt.toISOString(),
        };
    }

    /** Remove a recipe from an owned collection (no-op if the membership is already absent). */
    public async removeRecipe(ownerId: string, collectionId: string, recipeId: string): Promise<void> {
        await this.requireOwned(ownerId, collectionId);
        await this.dal.removeRecipe(collectionId, recipeId);
    }

    /**
     * Clone a collection into the caller's account as a point-in-time snapshot (FR-011).
     *
     * The seed set is read through the CLONER's eyes — `listRecipes(sourceId, clonerId)` scopes to
     * `public OR owner_id = cloner`, so private recipes the cloner cannot access are excluded exactly
     * as FR-011 requires. Passing the source's owner as the viewer here would leak their private
     * recipes into a stranger's collection, so the cloner is the viewer, always.
     *
     * The clone is fully the cloner's: their ownership, `private` by default (FR-010 — a clone of a
     * public collection is not itself published), and no listener links it back to the source. Later
     * source edits reach it only through an explicit {@link pullFromSource}.
     *
     * **Source attribution is FROZEN at clone time** (W5 Task 2): the source's name and its owner's
     * CURRENT display handle (resolved once, here, via {@link AuthorHandlesDal.findHandle}) are copied
     * onto the clone row and never resynced — a later rename of the source owner does NOT propagate
     * (CR-003: this is deliberate, not a missed sync). When the handle cannot be resolved yet (no
     * `author_handles` row for that owner), attribution degrades gracefully to the name only.
     *
     * @param clonerId - The app-user ULID performing the clone; becomes the clone's owner.
     * @param sourceId - The collection being cloned.
     * @param overrides - Optional `name` / `description` for the clone (`CloneCollectionRequest`);
     *   absent fields inherit the source's, so a plain clone needs no body at all.
     * @returns The new collection.
     * @throws NotFoundException when the source is missing, or is private and not the caller's own — a
     *   private collection is not discoverable, so its existence is never revealed.
     * @sideEffect Inserts a `collections` row plus one `recipe_collections` row per seeded recipe.
     */
    public async cloneCollection(
        clonerId: string,
        sourceId: string,
        overrides: CloneCollectionInput = {},
    ): Promise<CollectionResponse> {
        const source = await this.dal.findById(sourceId);

        // 404 (not 403) for someone else's private collection: FR-011 clones PUBLIC collections, and a
        // private one must not even be revealed to exist.
        if (!source || (source.visibility !== 'public' && source.ownerId !== clonerId)) {
            throw new NotFoundException('Collection not found');
        }

        const seedRecipes = await this.dal.listRecipes(sourceId, clonerId);
        // Frozen attribution (W5 Task 2): resolved ONCE, at clone time, from the CURRENT read model —
        // never re-read on a later source-owner rename (CR-003).
        const sourceOwnerHandle = await this.authorHandles.findHandle(source.ownerId);

        const clone = await this.dal.create({
            ownerId: clonerId,
            name: overrides.name ?? source.name,
            description: overrides.description ?? source.description ?? undefined,
            // A clone starts private regardless of the source's visibility — publishing is the
            // cloner's own, separate decision (FR-010).
            visibility: 'private',
            sourceCollectionId: sourceId,
            sourceOwnerHandle: sourceOwnerHandle ?? null,
            sourceCollectionName: source.name,
        });

        for (const recipe of seedRecipes) {
            await this.dal.addRecipe(clone.id, recipe.id, RecipeCollectionAddedVia.CLONE_SEED);
        }

        return toCollectionResponse(clone, seedRecipes.length);
    }

    /**
     * Reconcile a clone with its source's current state — opt-in, per invocation (FR-011).
     *
     * **Additive by design.** New source recipes the caller can see arrive as `added_via = 'pull'`.
     * Recipes the SOURCE owner has since removed from the source are left in place: the clone is the
     * cloner's property and source curation does not reach into it (data-model.md §Clone semantics).
     * Recipes already present are skipped, so a recipe the cloner added themselves keeps its `manual`
     * provenance and is never overwritten (FR-011).
     *
     * FR-011 also says a pull removes "recipes the cloner can no longer access". That need is already
     * met, continuously and without a pull: `listRecipes` filters every membership read by
     * `visibility = 'public' OR owner_id = viewer`, so a recipe that goes private vanishes from the
     * clone on the next read. Deleting those rows here would be strictly worse — irreversible, and a
     * recipe restored to public could never return.
     *
     * @param ownerId - The app-user ULID of the clone's owner.
     * @param collectionId - The clone to reconcile.
     * @returns The resulting collection plus the recipe ids this pull added (empty when the source has
     *   nothing new) — the `PullFromSourceResponse` shape fixed by `contracts/api.openapi.yaml`.
     * @throws NotFoundException when the collection is missing; NOT_OWNER (403) when not the caller's;
     *   COLLECTION_NOT_CLONED (400) when it has no source, or its source no longer exists.
     * @sideEffect Inserts `recipe_collections` rows for newly-pulled recipes.
     */
    public async pullFromSource(
        ownerId: string,
        collectionId: string,
        previewedDiff?: PullDiff,
    ): Promise<PullFromSourceResult> {
        const { sourceCollectionId } = await this.resolvePullContext(ownerId, collectionId);

        // Read BOTH memberships in one read-only, coherent snapshot and derive the diff via the SAME pure fn
        // the preview used — so the "what will change" the caller confirmed is computed identically here.
        const { cloneIds, sourceIds } = await this.dal.previewMembershipIds(collectionId, sourceCollectionId, ownerId);
        const diff = computePullDiff(sourceIds, cloneIds);

        // Decision 7 drift guard: if the caller echoed the diff they previewed and it no longer matches the
        // live one — because the SOURCE drifted OR the caller changed their OWN clone membership since the
        // preview — do NOT silently apply a different set. Return 409 with the fresh diff so the UI re-previews.
        if (previewedDiff !== undefined && !pullDiffsAgree(previewedDiff, diff)) {
            throw pullDriftError(collectionId, diff);
        }

        // `addRecipe` is idempotent (ON CONFLICT DO NOTHING), so a benign concurrent double-submit is safe.
        for (const recipeId of diff.added) {
            await this.dal.addRecipe(collectionId, recipeId, RecipeCollectionAddedVia.PULL);
        }

        // W5 Task 3: "last pulled" means the user SYNCED, not "something changed" — stamp it even when
        // `diff.added` is empty. Build the response from the UPDATED row so `lastPulledAt` is present.
        const touched = await this.dal.touchLastPulled(collectionId);

        return {
            collection: toCollectionResponse(touched, cloneIds.length + diff.added.length),
            addedRecipeIds: diff.added,
        };
    }

    /**
     * Compute the read-only pull PREVIEW (W8-a.8 / decision 7): the `{ added, removed, unchanged }` diff the
     * client shows before committing. Runs entirely through the DAL's READ-ONLY transaction and the shared
     * pure {@link computePullDiff}, so it CANNOT mutate and is derived identically to the commit. The client
     * echoes this diff back on commit as the drift baseline.
     */
    public async previewPull(ownerId: string, collectionId: string): Promise<PullDiff> {
        const { sourceCollectionId } = await this.resolvePullContext(ownerId, collectionId);

        const { cloneIds, sourceIds } = await this.dal.previewMembershipIds(collectionId, sourceCollectionId, ownerId);

        return computePullDiff(sourceIds, cloneIds);
    }

    /**
     * Resolve the owner-gated collection + its live source id for a pull (preview or commit). Shared so both
     * enforce the identical ownership + source-exists preconditions.
     *
     * @throws NotFoundException / NOT_OWNER (via requireOwned); COLLECTION_NOT_CLONED (400) when the
     *   collection has no source, or the source no longer exists.
     */
    private async resolvePullContext(
        ownerId: string,
        collectionId: string,
    ): Promise<{ collection: CollectionRow; sourceCollectionId: string }> {
        const collection = await this.requireOwned(ownerId, collectionId);

        if (!collection.sourceCollectionId) {
            throw collectionNotClonedError(collectionId);
        }

        // The pointer is ON DELETE SET NULL, but a clone read mid-delete can still carry a stale one —
        // treat a vanished source as "nothing to pull from" rather than dereferencing it.
        const source = await this.dal.findById(collection.sourceCollectionId);

        if (!source) {
            throw collectionNotClonedError(collectionId);
        }

        return { collection, sourceCollectionId: collection.sourceCollectionId };
    }

    /** Resolve a collection and assert the caller owns it; 404 if missing, NOT_OWNER (403) if not owned. */
    private async requireOwned(ownerId: string, id: string): Promise<CollectionRow> {
        const collection = await this.dal.findById(id);

        if (!collection) {
            throw new NotFoundException('Collection not found');
        }

        if (collection.ownerId !== ownerId) {
            throw collectionNotOwnedError(id);
        }

        return collection;
    }

    /** Throw INVALID_VISIBILITY unless `value` is one of the allowed `public` | `private` values. */
    private assertVisibility(value: string): void {
        if (!(COLLECTION_VISIBILITIES as readonly string[]).includes(value)) {
            throw invalidVisibilityError(value);
        }
    }
}
