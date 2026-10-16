/**
 * The gateway to `test_picked_root` (migration 0023): which catalog roots a signed test principal's remote pick created
 * (ADR-0040 food half; owner ruling 2026-10-16, "Clean up test-picked foods").
 *
 * The RULE for what may be deleted is `domain/testPickedRootPolicy.ts`; this file only reads the facts it needs, marks
 * holds, and deletes the ids the rule chose.
 *
 * @pattern Repository — the attribution table's reads and writes; the decision stays in the Specification
 * @module
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { FoodWriter } from '../../database/unitOfWork.js';
import { testPickedRoot } from '../../db/schema/index.js';
import type { PickedRootFacts } from '../domain/testPickedRootPolicy.js';

/** An attributed root with the facts the purge's rule reads. */
export interface AttributedRoot {
    readonly foodId: string;
    readonly facts: PickedRootFacts;
}

export class TestPickedRootDao {
    /** @param db - The food-schema Drizzle client, or a transaction on it. */
    public constructor(private readonly db: FoodWriter) {}

    /**
     * Attribute a root a test principal's pick just created, in the pick's own transaction.
     *
     * @param foodId - The new root.
     * @param createdBy - The test principal's app-user ULID.
     * @sideEffect Inserts one `test_picked_root` row.
     */
    public async record(foodId: string, createdBy: string): Promise<void> {
        await this.db.insert(testPickedRoot).values({ foodId, createdBy });
    }

    /**
     * Mark roots held because a real cook has been answered with them. An id nobody attributed has no row, and a root
     * already held is skipped, so neither writes nor locks anything. Idempotent. The statement waits on a purge that
     * holds a row's lock: it then finds the root gone, or finds it held before the purge could decide.
     *
     * @param foodIds - The answered ids.
     * @sideEffect May update `test_picked_root` rows, locking them.
     */
    public async markHeldByRealUser(foodIds: readonly string[]): Promise<void> {
        if (foodIds.length === 0) {
            return;
        }

        await this.db
            .update(testPickedRoot)
            .set({ heldByRealUser: true })
            .where(and(inArray(testPickedRoot.foodId, [...foodIds]), eq(testPickedRoot.heldByRealUser, false)));
    }

    /**
     * The roots a test principal created, with the facts the purge's rule reads, their attribution rows locked until the
     * transaction ends: a real cook's hold waits on the lock, so a root is either held before the purge decides or
     * recreated after it.
     *
     * @param createdBy - The test principal's app-user ULID.
     * @returns Its attributed roots.
     * @sideEffect Reads and row-locks `test_picked_root`.
     */
    public async lockCreatedBy(createdBy: string): Promise<AttributedRoot[]> {
        const result = await this.db.execute<{
            food_id: string;
            created_by: string;
            held_by_real_user: boolean;
            user_id: string | null;
            seed_owned: boolean;
            has_variants: boolean;
            status: string;
        }>(sql`
            SELECT a.food_id, a.created_by, a.held_by_real_user, f.user_id, i.seed_owned,
                   EXISTS (SELECT 1 FROM food_variant v WHERE v.food_id = f.id) AS has_variants,
                   f.status::text AS status
              FROM test_picked_root a
              JOIN food f ON f.id = a.food_id
              JOIN food_item i ON i.id = f.item_id
             WHERE a.created_by = ${createdBy}
               FOR UPDATE OF a
        `);

        return result.rows.map((row) => ({
            foodId: row.food_id,
            facts: {
                createdBy: row.created_by,
                heldByRealUser: row.held_by_real_user,
                authorId: row.user_id,
                seedOwned: row.seed_owned,
                hasVariants: row.has_variants,
                status: row.status,
            },
        }));
    }

    /**
     * Delete roots and their items. The root's crosswalks, record and attribution cascade from the root.
     *
     * @param roots - The roots the rule chose.
     * @returns How many roots were deleted.
     * @sideEffect Deletes from `food` and `food_item`, and by cascade their per-root rows.
     */
    public async deleteRoots(roots: readonly AttributedRoot[]): Promise<number> {
        if (roots.length === 0) {
            return 0;
        }

        const foodIds = roots.map((root) => root.foodId);
        // The hold is re-read in the DELETE itself, not trusted from the rule's earlier read: `lockCreatedBy` already
        // holds the attribution rows, so a hold written meanwhile waits, and this predicate is the second guard for a
        // caller that did not lock. `RETURNING` names the roots actually deleted, so only their items are deleted below.
        const deleted = await this.db.execute<{ item_id: string }>(sql`
            DELETE FROM food f
             WHERE f.id = ANY(${sql.param(foodIds)})
               AND NOT EXISTS (
                   SELECT 1 FROM test_picked_root a WHERE a.food_id = f.id AND a.held_by_real_user
               )
            RETURNING f.item_id
        `);
        const itemIds = deleted.rows.map((row) => row.item_id);

        // Each root owns its item (curated catalog plan KTD-6); an item left without its root is never cleaned up.
        if (itemIds.length > 0) {
            await this.db.execute(sql`DELETE FROM food_item WHERE id = ANY(${sql.param(itemIds)})`);
        }

        return deleted.rowCount ?? 0;
    }
}
