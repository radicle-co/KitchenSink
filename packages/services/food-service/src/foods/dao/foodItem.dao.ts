/**
 * The live path's access to `food_item` (curated catalog plan U4, KTD-6).
 *
 * Every root owns one item, and the per-item tables key on it. The live path addresses a food by its id, so the
 * per-item DAOs resolve the item inside their own SQL through {@link itemIdOfFood}, and their signatures stay keyed
 * by the food. Only the seed mints a natural key, so every item minted here is live: not seed-owned.
 *
 * @pattern Table Data Gateway — one gateway for the item table, and the one creator of a live root with its item
 */
import { sql, type SQL } from 'drizzle-orm';

import type { FoodTx } from '../../database/unitOfWork.js';
import { food, foodItem, type NewFoodRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';

/**
 * A live root's own columns. The item, the ids and the seed's columns are this gateway's to set, never a caller's.
 */
type LiveRootInput = Omit<NewFoodRow, 'id' | 'itemId' | 'itemOwnerKind' | 'seedKey' | 'retiredAt'>;

/**
 * The SQL expression for a root's item id: a scalar subquery the per-item DAOs embed. Pure.
 *
 * @param foodId - The root's id.
 * @returns The expression, or NULL at run time when the food does not exist.
 */
export function itemIdOfFood(foodId: string): SQL {
    return sql`(SELECT item_id FROM food WHERE id = ${foodId})`;
}

/** The item table's gateway. */
export class FoodItemDao {
    /** A transaction only: the item and its root are written together or not at all. */
    public constructor(private readonly tx: FoodTx) {}

    /**
     * Create a live root on a new live item: no natural key, so the item is not seed-owned. Both creators of a live
     * root use it, the add-by-name pipeline and an author.
     *
     * @param root - The root's own columns.
     * @returns The root's id.
     * @sideEffect Inserts one `food_item` row and one `food` row in the caller's transaction.
     */
    public async insertLiveRoot(root: LiveRootInput): Promise<string> {
        const itemId = newFoodId();
        const id = newFoodId();

        await this.tx.insert(foodItem).values({ id: itemId, ownerKind: 'root' });
        await this.tx.insert(food).values({ ...root, id, itemId });

        return id;
    }
}
