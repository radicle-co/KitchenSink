/**
 * `PrivateSlotsDal` - the live count behind a free cook's private slots, and the per-user lock that makes a decision
 * from that count true (ADR-0073 sections 2 and 5).
 *
 * @pattern Repository - over `recipes`, taking the CALLER'S transaction so the count and the write it gates are one
 *   transaction (the same shape as `ImportAllowanceDal`).
 *
 * ## The rules that live here
 *
 *  1. **A slot is a row, never a counter.** `COUNT(*)` over the cook's `private`, undeleted recipes, every label and every
 *     status (a private draft holds a slot). A stored counter would be a second copy of a fact `recipes` already holds, kept
 *     in step by every path that creates, deletes, erases, purges, clones or flips a recipe; one missed path and it drifts
 *     for good. The tombstone term is the SAME `activeRecipe()` every read uses, not a restatement of `deleted_at IS NULL`.
 *  2. **The lock is the first statement.** `pg_advisory_xact_lock(class, hashtext(owner_id))` serialises one cook's private
 *     writes and nobody else's. Without it two writes racing at 49 both count 49 and both land, and the cook holds 51. It is
 *     a transaction lock, so the commit or rollback of the CALLER's transaction releases it, which is why this takes the
 *     caller's `tx` and never opens its own.
 *  3. **Lock order.** A transaction that also takes the import allowance lock takes THAT one first (ADR-0073 section 5).
 *  4. **A count taken without the lock is for display only.** {@link PrivateSlotsDal.count} serves the slot-usage read; a
 *     write must never be decided from it.
 *
 * The index `idx_recipes_owner_id` (partial, `WHERE deleted_at IS NULL`) serves the count.
 */
import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';
import { and, eq, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipes } from '../../database/schema/index.js';
import type { Writer } from '../../database/unitOfWork.js';
import { activeRecipe } from './recipePredicates.js';

export class PrivateSlotsDal {
    /**
     * Take the cook's private-slot lock, then count their private recipes.
     *
     * Call it as the FIRST statement of the transaction that writes the recipe the count gates, and decide from the number
     * it returns inside that same transaction.
     *
     * @param tx - The open transaction (the lock lives and dies with it).
     * @param ownerId - The verified app-user ULID, never a request field.
     * @returns The cook's private, undeleted recipes, as of the moment the lock was held.
     * @sideEffect Takes a transaction-scoped advisory lock (blocks while another private write of this cook is in flight).
     */
    public async lockAndCount(tx: Writer, ownerId: string): Promise<number> {
        await tx.execute(
            sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.recipePrivateSlots}, hashtext(${ownerId}))`,
        );

        return this.count(tx, ownerId);
    }

    /**
     * Count the cook's private, undeleted recipes WITHOUT the lock - for display (the slot-usage read), never for a decision.
     *
     * @param reader - A client or an open transaction.
     * @param ownerId - The verified app-user ULID.
     * @returns The count, `0` for a cook with none.
     */
    public async count(reader: Pick<RecipeDrizzle, 'select'>, ownerId: string): Promise<number> {
        const [row] = await reader
            .select({ used: sql<number>`count(*)::int`.mapWith(Number) })
            .from(recipes)
            .where(and(eq(recipes.ownerId, ownerId), eq(recipes.visibility, 'private'), activeRecipe()));

        return row?.used ?? 0;
    }
}
