/**
 * The ONE lock order of a bulk import's rows (ADR-0072): the header, then an item, then its lines.
 *
 * Several writers touch more than one of the three in a transaction: the save claim, a payment, a snapshot, a pick, the cook's
 * choices, a cursor move with a mark, a chunk of items. When some took the item first and the header after, and others the
 * reverse, a cursor move racing a save deadlocked, and Postgres broke the tie by failing one of them after a second. So every
 * writer takes the header lock FIRST, with this, whether or not it has a header value to write.
 *
 * `FOR NO KEY UPDATE`, the same strength an `UPDATE` of a non-key column takes: it serialises the writers of one import and
 * does not block the foreign-key checks of the item and line inserts.
 */
import { eq } from 'drizzle-orm';

import { recipeImports } from '../../database/schema/recipeImports.js';
import type { Writer } from '../../database/unitOfWork.js';

/**
 * Lock the import's header row until the transaction ends.
 *
 * @param tx - The open transaction (the recipe's own, for the save claim).
 * @param importId - The import.
 * @sideEffect Takes a row lock.
 */
export async function lockImportHeader(tx: Writer, importId: string): Promise<void> {
    await tx
        .select({ id: recipeImports.id })
        .from(recipeImports)
        .where(eq(recipeImports.id, importId))
        .for('no key update');
}
