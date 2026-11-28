/**
 * The reads and writes of a hold clear (ADR-0106), every one inside the caller's transaction.
 *
 * @pattern Repository — over `recipes`, `recipe_source_corrections` and `recipe_source_hold_clears`. It runs no policy and opens no
 *   transaction: the service decides, this class only locks, reads and writes.
 *
 * ## The rules that live here
 *
 *  1. **The record comes first.** `recordClears` runs before `releaseHolds`: the database ratchet accepts a clear only when a record
 *     for the same recipe exists in the same transaction.
 *  2. **The chain read has no depth cap.** A cap would truncate the chain and make a long chain look all third-party. `CYCLE` ends a
 *     loop. A tombstoned ancestor is walked: its rows still count.
 *  3. **Lock first, derive after.** `lockOwnersDescendants` row-locks the owner's descendants in ascending id; only then does
 *     `releasableDescendants` read the set, in a NEW statement. Under READ COMMITTED a locking SELECT re-checks only the locked
 *     row, so deriving in the same statement would read a stale `recipe_source_corrections` and hold.
 *
 * @sideEffect Every method reads or writes Postgres through the transaction it is given.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipes } from '../../database/schema/index.js';
import type { RecipeTx } from '../../database/unitOfWork.js';
import {
    recipeSourceKindSchema,
    recipeSourceTypeSchema,
    recipeStatementKindSchema,
    type HoldClearCause,
    type RecipeSourceKind,
    type RecipeSourceType,
    type RecipeStatementKind,
} from '@kitchensink/recipe-core';
import { activeRecipe } from './recipePredicates.js';

/** One correction row of a chain, as the policy needs it. Row 0 is the newest of the nearest recipe that has one. */
export interface CorrectionChainRow {
    readonly id: string;
    readonly recipeId: string;
    readonly newSourceType: RecipeSourceType;
    readonly newSourceKind: RecipeSourceKind | null;
    readonly newStatementKind: RecipeStatementKind | null;
}

/** What `recordClears` writes. */
export interface HoldClearRecord {
    readonly recipeIds: readonly string[];
    readonly cause: HoldClearCause;
    /** The staff account; `null` for an earned rewrite. */
    readonly actorAccountId: string | null;
    readonly reason: string;
}

type ChainRowRaw = {
    readonly id: string;
    readonly recipe_id: string;
    readonly new_source_type: string;
    readonly new_source_kind: string | null;
    readonly new_statement_kind: string | null;
};

export class SourceHoldClearsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * The recipe's owner and hold, read `FOR UPDATE`.
     *
     * @param tx - The open transaction.
     * @param id - The recipe.
     * @returns The facts, or `undefined` when no active recipe has that id.
     * @sideEffect Row-locks the `recipes` row until the transaction ends.
     */
    public async lockHoldFacts(
        tx: RecipeTx,
        id: string,
    ): Promise<{ readonly ownerId: string; readonly held: boolean } | undefined> {
        const [row] = await tx
            .select({ ownerId: recipes.ownerId, held: recipes.sourceCorrectionHold })
            .from(recipes)
            .where(and(eq(recipes.id, id), activeRecipe()))
            .for('update');

        return row;
    }

    /**
     * Every correction row of the recipe and of each ancestor, nearest recipe first, newest first within a recipe.
     *
     * @param id - The recipe.
     * @param db - The caller's transaction; the pool when omitted (the preview reads it unlocked).
     * @returns The rows; empty when no recipe in the chain was ever corrected.
     */
    public async readCorrectionChain(
        id: string,
        db: RecipeTx | RecipeDrizzle = this.db,
    ): Promise<readonly CorrectionChainRow[]> {
        const result = await db.execute<ChainRowRaw>(sql`
            WITH RECURSIVE chain(id, depth) AS (
                SELECT ${id}::uuid, 0
                UNION ALL
                SELECT r.cloned_from_id, c.depth + 1 FROM chain c JOIN recipes r ON r.id = c.id WHERE r.cloned_from_id IS NOT NULL
            ) CYCLE id SET is_cycle USING path
            SELECT k.id, k.recipe_id, k.new_source_type, k.new_source_kind, k.new_statement_kind
              FROM chain c JOIN recipe_source_corrections k ON k.recipe_id = c.id
             WHERE NOT c.is_cycle
             ORDER BY c.depth ASC, k.recorded_at DESC, k.id DESC
        `);

        // Parsed, not cast: a stored value outside the vocabulary throws here and never reads as a third-party answer.
        return (result.rows ?? []).map((row) => ({
            id: row.id,
            recipeId: row.recipe_id,
            newSourceType: recipeSourceTypeSchema.parse(row.new_source_type),
            newSourceKind: recipeSourceKindSchema.nullable().parse(row.new_source_kind),
            newStatementKind: recipeStatementKindSchema.nullable().parse(row.new_statement_kind),
        }));
    }

    /**
     * The newest correction row across the WHOLE chain (the recipe and every ancestor), newest by `recorded_at` then `id`. This is
     * the one answer to "what is the latest correction", read by the preview and by the staff clear's stale check, so a
     * correction on a farther ancestor is never hidden behind an older row on a nearer recipe.
     *
     * @param id - The recipe.
     * @param db - The caller's transaction; the pool when omitted (the preview reads it unlocked).
     * @returns The row id, or `null` when no recipe in the chain was ever corrected.
     */
    public async readLatestCorrectionId(id: string, db: RecipeTx | RecipeDrizzle = this.db): Promise<string | null> {
        const result = await db.execute<{ id: string }>(sql`
            WITH RECURSIVE chain(id) AS (
                SELECT ${id}::uuid
                UNION ALL
                SELECT r.cloned_from_id FROM chain c JOIN recipes r ON r.id = c.id WHERE r.cloned_from_id IS NOT NULL
            ) CYCLE id SET is_cycle USING path
            SELECT k.id FROM chain c JOIN recipe_source_corrections k ON k.recipe_id = c.id
             WHERE NOT c.is_cycle
             ORDER BY k.recorded_at DESC, k.id DESC
             LIMIT 1
        `);

        return result.rows?.[0]?.id ?? null;
    }

    /**
     * Row-lock the owner's live descendants of the root, in ascending id (the lock order of the staff clear).
     *
     * @param tx - The open transaction.
     * @param rootId - The cleared recipe.
     * @param ownerId - Its owner.
     * @sideEffect Row-locks the descendants until the transaction ends.
     */
    public async lockOwnersDescendants(tx: RecipeTx, rootId: string, ownerId: string): Promise<void> {
        await tx.execute(sql`
            WITH RECURSIVE d(id) AS (
                SELECT id FROM recipes WHERE cloned_from_id = ${rootId}::uuid
                UNION
                SELECT r.id FROM recipes r JOIN d ON r.cloned_from_id = d.id
            )
            SELECT r.id FROM recipes r
             WHERE r.id IN (SELECT id FROM d) AND r.owner_id = ${ownerId} AND r.deleted_at IS NULL
             ORDER BY r.id FOR UPDATE
        `);
    }

    /**
     * The held, same-owner descendants a staff clear of the root releases. Read AFTER {@link lockOwnersDescendants}, in its own
     * statement. A clone with its own correction row, and every recipe below it, is not released; an unheld clone is
     * transparent; a held clone of another owner (or a tombstoned one) stops its branch.
     *
     * @param tx - The open transaction.
     * @param rootId - The cleared recipe.
     * @param ownerId - Its owner.
     * @returns The ids, ascending.
     */
    public async releasableDescendants(tx: RecipeTx, rootId: string, ownerId: string): Promise<readonly string[]> {
        const result = await tx.execute<{ id: string }>(sql`
            WITH RECURSIVE f(id) AS (
                SELECT ${rootId}::uuid
                UNION
                SELECT c.id FROM f JOIN recipes c ON c.cloned_from_id = f.id
                 WHERE NOT EXISTS (SELECT 1 FROM recipe_source_corrections k WHERE k.recipe_id = c.id)
                   AND (NOT c.source_correction_hold OR (c.owner_id = ${ownerId} AND c.deleted_at IS NULL))
            )
            SELECT r.id FROM recipes r
             WHERE r.id IN (SELECT id FROM f) AND r.id <> ${rootId}::uuid
               AND r.source_correction_hold AND r.owner_id = ${ownerId} AND r.deleted_at IS NULL
             ORDER BY r.id
        `);

        return (result.rows ?? []).map((row) => row.id);
    }

    /**
     * Write one clear record per recipe. Raw SQL on purpose: the stamp trigger owns `recorded_at` and `xact_id`.
     *
     * @param tx - The open transaction.
     * @param record - The recipes, the cause, the actor and the reason.
     * @sideEffect Inserts into `recipe_source_hold_clears`; the database refuses a recipe that is not held.
     */
    public async recordClears(tx: RecipeTx, record: HoldClearRecord): Promise<void> {
        if (record.recipeIds.length === 0) {
            return;
        }

        await tx.execute(sql`
            INSERT INTO recipe_source_hold_clears (recipe_id, cause, actor_account_id, reason)
            SELECT unnest(${sql.param([...record.recipeIds])}::uuid[]), ${record.cause}, ${record.actorAccountId}, ${record.reason}
        `);
    }

    /**
     * Turn the hold off. Never touches `visibility`: a clear makes nothing public (ADR-0105).
     *
     * @param tx - The open transaction.
     * @param recipeIds - The recipes whose clear record is already written.
     * @sideEffect Updates `recipes`; the database ratchet refuses a recipe with no record in this transaction.
     */
    public async releaseHolds(tx: RecipeTx, recipeIds: readonly string[]): Promise<void> {
        if (recipeIds.length === 0) {
            return;
        }

        await tx.execute(
            sql`UPDATE recipes SET source_correction_hold = false, updated_at = now() WHERE id = ANY(${sql.param([...recipeIds])}::uuid[])`,
        );
    }
}
