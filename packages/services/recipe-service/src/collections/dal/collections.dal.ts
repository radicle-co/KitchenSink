/**
 * T039 — the Collections data-access layer.
 *
 * Owns every SQL touch for `collections` + the `recipe_collections` junction over the global Drizzle
 * client. Ownership is enforced one layer up (the service), so the DAL is intentionally identity-blind:
 * it takes ids and returns rows. Two invariants live here:
 *
 *  - **Membership excludes tombstoned recipes.** Every membership read (`listRecipes`, and the active
 *    lookup used before an add) `INNER JOIN`s `recipes` and filters `recipes.deleted_at IS NULL`, so a
 *    soft-deleted recipe (C-007) never appears in a collection even though its junction row survives.
 *  - **Add is idempotent + many-to-many.** `addRecipe` uses `ON CONFLICT DO NOTHING`; a recipe may
 *    belong to any number of collections, and re-adding it to one is a no-op that still returns the row.
 *
 * Collection delete is **no-cascade** with respect to recipes: dropping a `collections` row cascades
 * only to its `recipe_collections` junction rows (FK `ON DELETE CASCADE`), never to the `recipes`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns, sql } from 'drizzle-orm';

import { DrizzleProvider, type RecipeDrizzle } from '../../database/database.module.js';
import {
    collections,
    recipeCollections,
    type CollectionRow,
    type RecipeCollectionAddedVia,
    type RecipeCollectionRow,
} from '../../database/schema/collections.js';
import { recipes, type RecipeRow } from '../../database/schema/recipes.js';
import { activeRecipe, publishedOrOwnedBy, viewableBy } from '../../recipes/dal/recipe-predicates.js';

/** Row shape for creating a collection (owner resolved from the principal by the service). */
export interface CreateCollectionRow {
    readonly ownerId: string;
    readonly name: string;
    readonly description?: string;
    readonly visibility: string;
    /**
     * Clone provenance (FR-011): the collection this one was cloned FROM, or absent/null for an
     * originally-authored collection. A single hop — cloning a clone points at that clone, not its
     * ancestor.
     */
    readonly sourceCollectionId?: string | null;
    /**
     * W5 Task 2: the source owner's display handle, FROZEN at clone time (never resynced on a later
     * source-owner rename — CR-003). `null`/absent when the source owner has no resolvable handle yet,
     * in which case attribution degrades to the name only.
     */
    readonly sourceOwnerHandle?: string | null;
    /** W5 Task 2: the source collection's name, FROZEN at clone time. */
    readonly sourceCollectionName?: string | null;
}

/** Partial patch for updating a collection. Absent fields are left untouched. */
export interface UpdateCollectionRow {
    readonly name?: string;
    readonly description?: string;
    readonly visibility?: string;
}

/** A page of an owner's collections plus the unpaged total, for building the paginated envelope. */
export interface CollectionPage {
    readonly rows: CollectionRow[];
    readonly total: number;
}

@Injectable()
export class CollectionsDal {
    public constructor(@Inject(DrizzleProvider) private readonly db: RecipeDrizzle) {}

    /** Insert a new collection and return the persisted row. */
    public async create(input: CreateCollectionRow): Promise<CollectionRow> {
        const inserted = await this.db
            .insert(collections)
            .values({
                ownerId: input.ownerId,
                name: input.name,
                description: input.description ?? null,
                visibility: input.visibility,
                sourceCollectionId: input.sourceCollectionId ?? null,
                sourceOwnerHandle: input.sourceOwnerHandle ?? null,
                sourceCollectionName: input.sourceCollectionName ?? null,
            })
            .returning();

        const row = inserted[0];

        if (!row) {
            throw new Error('Collection insert returned no row.');
        }

        return row;
    }

    /** Look up a collection by id, or `undefined` when it does not exist. */
    public async findById(id: string): Promise<CollectionRow | undefined> {
        const rows = await this.db.select().from(collections).where(eq(collections.id, id)).limit(1);

        return rows[0];
    }

    /** A page of an owner's collections (newest first) plus the unpaged total. */
    public async listByOwner(ownerId: string, limit: number, offset: number): Promise<CollectionPage> {
        const rows = await this.db
            .select()
            .from(collections)
            .where(eq(collections.ownerId, ownerId))
            .orderBy(desc(collections.createdAt))
            .limit(limit)
            .offset(offset);

        const totals = await this.db
            .select({ value: count() })
            .from(collections)
            .where(eq(collections.ownerId, ownerId));

        return { rows, total: Number(totals[0]?.value ?? 0) };
    }

    /** Apply a partial patch (always bumping `updated_at`); returns the updated row, or `undefined`. */
    public async update(id: string, patch: UpdateCollectionRow): Promise<CollectionRow | undefined> {
        const set: Record<string, unknown> = { updatedAt: new Date() };

        if (patch.name !== undefined) {
            set['name'] = patch.name;
        }

        if (patch.description !== undefined) {
            set['description'] = patch.description;
        }

        if (patch.visibility !== undefined) {
            set['visibility'] = patch.visibility;
        }

        const updated = await this.db.update(collections).set(set).where(eq(collections.id, id)).returning();

        return updated[0];
    }

    /**
     * Stamp `last_pulled_at` (W5 Task 3) with the CURRENT time, server-derived — never client input.
     * `updated_at` is bumped alongside it, matching {@link update}'s convention. Called once per
     * successful `pullFromSource` commit, regardless of whether the pull added any recipes: "last
     * pulled" means "the user last synced", not "the last time something changed".
     *
     * @sideEffect Updates the collection row's `last_pulled_at` + `updated_at`.
     */
    public async touchLastPulled(id: string): Promise<CollectionRow> {
        const updated = await this.db
            .update(collections)
            .set({ lastPulledAt: new Date(), updatedAt: new Date() })
            .where(eq(collections.id, id))
            .returning();

        const row = updated[0];

        if (!row) {
            throw new Error('touchLastPulled: no collection row found to update.');
        }

        return row;
    }

    /**
     * Delete a collection by id; returns whether a row was removed. No-cascade w.r.t. recipes — only the
     * `recipe_collections` junction rows are removed (by FK), never the `recipes` themselves.
     */
    public async deleteById(id: string): Promise<boolean> {
        const deleted = await this.db
            .delete(collections)
            .where(eq(collections.id, id))
            .returning({ id: collections.id });

        return deleted.length > 0;
    }

    /** Fetch an active (non-tombstoned) recipe by id, for validating a membership add. */
    public async findActiveRecipe(recipeId: string): Promise<RecipeRow | undefined> {
        const rows = await this.db
            .select()
            .from(recipes)
            .where(and(eq(recipes.id, recipeId), activeRecipe()))
            .limit(1);

        return rows[0];
    }

    /**
     * Add a recipe to a collection (idempotent). Returns the membership row whether it was newly
     * inserted or already present. Many-to-many: the same recipe can live in any number of collections.
     */
    public async addRecipe(
        collectionId: string,
        recipeId: string,
        addedVia: RecipeCollectionAddedVia = 'manual',
    ): Promise<RecipeCollectionRow> {
        const inserted = await this.db
            .insert(recipeCollections)
            .values({ collectionId, recipeId, addedVia })
            .onConflictDoNothing()
            .returning();

        const row = inserted[0];

        if (row) {
            return row;
        }

        const existing = await this.findMembership(collectionId, recipeId);

        if (!existing) {
            throw new Error('Membership insert conflicted but no existing row was found.');
        }

        return existing;
    }

    /** Look up a single membership row, or `undefined`. */
    public async findMembership(collectionId: string, recipeId: string): Promise<RecipeCollectionRow | undefined> {
        const rows = await this.db
            .select()
            .from(recipeCollections)
            .where(and(eq(recipeCollections.collectionId, collectionId), eq(recipeCollections.recipeId, recipeId)))
            .limit(1);

        return rows[0];
    }

    /** Remove a recipe from a collection; returns whether a membership row was removed. */
    public async removeRecipe(collectionId: string, recipeId: string): Promise<boolean> {
        const deleted = await this.db
            .delete(recipeCollections)
            .where(and(eq(recipeCollections.collectionId, collectionId), eq(recipeCollections.recipeId, recipeId)))
            .returning({ recipeId: recipeCollections.recipeId });

        return deleted.length > 0;
    }

    /**
     * List the recipes in a collection VIEWABLE BY `viewerId`, oldest membership first. Two filters:
     *  - EXCLUDING tombstoned recipes (C-007): the `INNER JOIN` + `deleted_at IS NULL` drops soft-deleted
     *    recipes even though their junction rows remain.
     *  - EXCLUDING recipes the viewer may not see: `visibility = 'public' OR owner_id = viewerId` AND the
     *    W8-a.3 draft term `status = 'published' OR owner_id = viewerId`. This is the authoritative half of
     *    the membership-IDOR guard — a recipe that was public when added but later went private OR became a
     *    draft (which add-time validation cannot catch) is filtered out here at read time. This ONE read
     *    serves three callers (the `CollectionWithRecipes` embed, `cloneCollection`'s clone-seed, and
     *    `pullFromSource`/preview), so patching this predicate covers all three. Keep it in lockstep with
     *    `isRecipeViewableBy` (recipes/domain/recipe-visibility.ts).
     */
    public async listRecipes(collectionId: string, viewerId: string): Promise<RecipeRow[]> {
        return this.db
            .select(getTableColumns(recipes))
            .from(recipeCollections)
            .innerJoin(recipes, eq(recipeCollections.recipeId, recipes.id))
            .where(this.membershipPredicate(collectionId, viewerId))
            .orderBy(recipeCollections.addedAt);
    }

    /**
     * Read the clone + source membership id sets for a pull PREVIEW (W8-a.8) in ONE explicit READ-ONLY
     * transaction. `SET TRANSACTION READ ONLY` gives a single coherent snapshot for both reads AND makes any
     * accidental write inside the block abort at the database — so the preview endpoint is structurally
     * incapable of mutating (the "make illegal states unrepresentable" guarantee, verified by a test that a
     * write inside this tx throws). Ids are viewer-scoped by the SAME predicate as {@link listRecipes}, so a
     * source recipe gone private/draft/deleted is already absent (no disclosure).
     */
    public async previewMembershipIds(
        cloneId: string,
        sourceId: string,
        viewerId: string,
    ): Promise<{ readonly cloneIds: string[]; readonly sourceIds: string[] }> {
        return this.db.transaction(async (tx) => {
            await tx.execute(sql`SET TRANSACTION READ ONLY`);

            // Sequential (not Promise.all): a single transaction runs on one connection, so its statements
            // must not be pipelined concurrently.
            const cloneRows = await tx
                .select({ id: recipes.id })
                .from(recipeCollections)
                .innerJoin(recipes, eq(recipeCollections.recipeId, recipes.id))
                .where(this.membershipPredicate(cloneId, viewerId));
            const sourceRows = await tx
                .select({ id: recipes.id })
                .from(recipeCollections)
                .innerJoin(recipes, eq(recipeCollections.recipeId, recipes.id))
                .where(this.membershipPredicate(sourceId, viewerId));

            return { cloneIds: cloneRows.map((r) => r.id), sourceIds: sourceRows.map((r) => r.id) };
        });
    }

    /**
     * The viewer-scoped collection-membership predicate (C-007 tombstone + the W8-a.3 read boundary). The
     * RULE lives once in the predicate helpers ({@link activeRecipe}/{@link viewableBy}/{@link publishedOrOwnedBy});
     * this composes them for `listRecipes` and the preview read so both enforce the identical scope. Pure.
     */
    private membershipPredicate(collectionId: string, viewerId: string) {
        return and(
            eq(recipeCollections.collectionId, collectionId),
            activeRecipe(),
            viewableBy(viewerId),
            publishedOrOwnedBy(viewerId),
        );
    }
}
