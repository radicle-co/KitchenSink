/**
 * T040 / T140 — the Collections service: CRUD, membership, no-cascade delete, and the visibility
 * toggle (FR-010), all ownership-enforced.
 *
 * Ownership is THE authorization boundary: every read/mutation of a specific collection first resolves
 * it and asserts `collection.ownerId === principal.userId`. A missing collection is a
 * `NotFoundException` (→ 404); a collection owned by someone else is a `CollectionError` NOT_OWNER
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
    type PaginatedResponse,
    type Recipe,
} from '@kitchensink/recipe-core';

import {
    COLLECTION_VISIBILITIES,
    type CollectionRow,
    type CollectionVisibility,
} from '../database/schema/collections.js';
import type { RecipeRow } from '../database/schema/recipes.js';
import { CollectionsDal } from './dal/collections.dal.js';
import { isRecipeViewableBy } from '../recipes/domain/recipe-visibility.js';
import { collectionNotOwnedError, invalidVisibilityError, recipeNotFoundError } from './collections.errors.js';
import type {
    CollectionRecipeMembershipResponse,
    CollectionResponse,
    CollectionWithRecipesResponse,
    CreateCollectionInput,
    PageParams,
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
        servings: row.servings ?? 1,
        visibility: row.visibility as RecipeVisibility,
        sourceType: row.sourceType as RecipeSourceType,
        hasSubstantiveEdit: row.hasSubstantiveEdit,
        dietaryFlags: row.dietaryFlags,
        tags: row.tags,
        hasPartialNutrition: row.hasPartialNutrition,
        currentVersion: row.currentVersion,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };

    return {
        ...recipe,
        ...(row.sourceUrl !== null ? { sourceUrl: row.sourceUrl } : {}),
        ...(row.sourceAttribution !== null ? { sourceAttribution: row.sourceAttribution } : {}),
        ...(row.clonedFromId !== null ? { clonedFromId: row.clonedFromId } : {}),
        ...(row.cuisine !== null ? { cuisine: row.cuisine } : {}),
        ...(row.deletedAt !== null ? { deletedAt: row.deletedAt.toISOString() } : {}),
    };
}

@Injectable()
export class CollectionsService {
    public constructor(@Inject(CollectionsDal) private readonly dal: CollectionsDal) {}

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
        const recipes = recipeRows.map(toRecipe);

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
