/**
 * `RemoteAdoptionDao` — the write that turns a picked remote item into the catalog root that stands for it (ADR-0055
 * point 10, review ruling 9), as one transaction:
 *
 * 1. A transaction lock per item (`foodRemoteAdoption`), so concurrent adopts of one item run one at a time and the
 *    later ones find the first one's crosswalk.
 * 2. The crosswalk read again under the lock: an item someone already crosswalked makes no root.
 * 3. The name lock add-by-name also takes ({@link nameDedupLock}), and the live catalog root that carries the name,
 *    since a catalog name is unique among live roots (0018), read under its row lock, because a cook's PATCH resolve
 *    takes no name lock and may resolve it meanwhile. A root holding a record answers the pick; a placeholder
 *    is COMPLETED with the picked item (`namedRootPolicy.ts`): its queue and requester rows settled as a resolve
 *    settles them, its status moved as a resolve moves it, the item claimed, and its record written. A drain fetching
 *    for that placeholder (a live claim the pick does not hold) means nothing is written.
 * 4. With no root carrying the name, a new live root on a new item.
 * 5. The item's crosswalk row CLAIMED (`FoodSourcesDao.claimSource`, `ON CONFLICT` on
 *    `food_sources_source_key_unique`). A writer that takes no adoption lock (the worker) may have claimed the item
 *    meanwhile; then the whole transaction is rolled back.
 * 6. The root's record, written by the caller's `persistRoot` inside this transaction: the source pipeline's own
 *    merge writer.
 *
 * The source is never called here. The caller fetches the item first, so no transaction or connection is held across
 * a network call: the fetch's admission and block writes take pool connections of their own. Before fetching for a
 * placeholder, the caller leases its queue row (`FetchQueueDao.leaseFood`), so no drain fetches for it meanwhile, and
 * presents that lease here.
 *
 * @pattern Unit of Work — the locks, the checks, the root, the claim, the record and the queue settle commit together
 * @module
 */
import { and, inArray, isNull, sql, TransactionRollbackError } from 'drizzle-orm';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import type { FoodWriter } from '../../database/unitOfWork.js';
import { food } from '../../db/schema/index.js';
import { namedRootActionOf } from '../domain/namedRootPolicy.js';
import { FetchQueueDao } from './fetchQueue.dao.js';
import { FoodDao, nameDedupLock, type FoodStatus } from './food.dao.js';
import { FoodItemDao } from './foodItem.dao.js';
import { FoodSourcesDao, type FoodSource } from './foodSources.dao.js';
import type { LeaseFence, SettleAuthority } from './leaseFence.js';

/** How an adoption write ended. */
export type AdoptionWrite =
    /** A new root owns the item. */
    | { readonly kind: 'created'; readonly id: string }
    /** A placeholder root carrying the name now owns the item, with its record. */
    | { readonly kind: 'completed'; readonly id: string }
    /** A live catalog root holding a record already carries the name; nothing was written. */
    | { readonly kind: 'named'; readonly id: string }
    /** Someone crosswalked the item first; nothing was written. The catalog owner reader says whose it is. */
    | { readonly kind: 'crosswalked' }
    /** A drain is fetching for the placeholder that carries the name; nothing was written. */
    | { readonly kind: 'draining' };

/** The live catalog root that carries a name. */
export interface NamedRoot {
    readonly id: string;
    readonly status: FoodStatus;
}

/** The queue lease the pick took, before it fetched, on the placeholder root it expected to complete. */
export interface AdoptionLease {
    readonly rootId: string;
    readonly fence: LeaseFence;
}

/** One adoption. */
export interface AdoptionWriteInput {
    readonly source: FoodSource;
    /** The source's key for the item. */
    readonly externalKey: string;
    /** The new root's name. */
    readonly name: string;
    /** Its dedup key (`normalizeName`). */
    readonly normalizedName: string;
    /** The lease the pick holds on the placeholder it expected to complete, or `undefined`. */
    readonly lease: AdoptionLease | undefined;
    /**
     * Write the root's record from the fetched item, on the transaction it is given.
     *
     * @sideEffect Writes the root's record.
     */
    readonly persistRoot: (writer: FoodWriter, foodId: string) => Promise<void>;
}

/**
 * Complete a placeholder root with the picked item, on the adoption's transaction.
 *
 * The queue is settled first, as a resolve settles it (the row and the requesters, `FetchQueueDao.resolve`): with the
 * pick's lease when it holds one on this root, else out of band, which is refused when a drain holds the row. Then a
 * terminal root is reactivated, the item claimed, and the record written, which moves the root to `RESOLVED` and
 * clears its candidates as PATCH resolve does.
 *
 * @param tx - The adoption's transaction.
 * @param root - The placeholder.
 * @param input - The adoption.
 * @returns `completed`, or `draining` with nothing written.
 * @throws {LeaseLostError} when the pick's lease was lost; the transaction rolls back.
 * @throws {TransactionRollbackError} when another writer claimed the item; the transaction rolls back.
 * @sideEffect Deletes `fetch_queue` and `fetch_requesters` rows; updates `food`; inserts `food_sources`; writes the record.
 */
async function completePlaceholder(
    tx: FoodWriter,
    root: NamedRoot,
    reactivateFrom: 'NOT_FOUND' | 'FAILED' | undefined,
    input: AdoptionWriteInput,
): Promise<AdoptionWrite> {
    const queue = new FetchQueueDao(tx);
    const authority: SettleAuthority = input.lease?.rootId === root.id ? input.lease.fence : 'out-of-band';

    if (authority === 'out-of-band' && (await queue.getByFoodId(root.id))?.status === 'in_flight') {
        return { kind: 'draining' };
    }

    await queue.resolve(root.id, authority);

    if (reactivateFrom !== undefined) {
        await new FoodDao(tx).setStatus({ id: root.id, status: 'PENDING', from: [reactivateFrom] });
    }

    if (
        (await new FoodSourcesDao(tx).claimSource({
            foodId: root.id,
            source: input.source,
            externalKey: input.externalKey,
        })) === undefined
    ) {
        throw new TransactionRollbackError();
    }

    await input.persistRoot(tx, root.id);

    return { kind: 'completed', id: root.id };
}

export class RemoteAdoptionDao {
    /** @param db - The food-schema Drizzle client, or a transaction on it. */
    public constructor(private readonly db: FoodWriter) {}

    /**
     * The live catalog root that carries a name, read without a lock: lets an adopt answer a root holding a record
     * without a source call, and lease a placeholder's queue row before it fetches. A retired root is not live.
     *
     * @param normalizedName - The name's dedup key.
     * @returns Its id and status, or `undefined`.
     * @sideEffect Reads `food`.
     */
    public async liveCatalogRootNamed(normalizedName: string): Promise<NamedRoot | undefined> {
        return (await this.liveCatalogRootsNamed([normalizedName])).get(normalizedName);
    }

    /**
     * The live catalog roots that carry any of these names, read without a lock: lets the search hide a remote hit whose
     * root name such a root answers (`remoteHitTriage.ts`).
     *
     * @param normalizedNames - The names' dedup keys; an empty key names no root and is not read.
     * @returns Each carrying root's id and status, by key; a key no live catalog root carries is absent.
     * @sideEffect Reads `food` when a key is given.
     */
    public async liveCatalogRootsNamed(normalizedNames: readonly string[]): Promise<Map<string, NamedRoot>> {
        const keys = [...new Set(normalizedNames)].filter((key) => key !== '');

        if (keys.length === 0) {
            return new Map();
        }

        const found = await this.liveCatalogRootQuery(keys);

        return new Map(
            found.map((row): [string, NamedRoot] => [row.normalizedName, { id: row.id, status: row.status }]),
        );
    }

    /**
     * The live catalog root that carries a name, locked until the transaction ends, so no other writer moves its status
     * between this read and the adoption's writes.
     *
     * @param normalizedName - The name's dedup key.
     * @returns Its id and status, or `undefined`.
     * @sideEffect Reads and row-locks `food`.
     */
    private async lockedLiveCatalogRootNamed(normalizedName: string): Promise<NamedRoot | undefined> {
        const [found] = await this.liveCatalogRootQuery([normalizedName]).for('update');

        return found === undefined ? undefined : { id: found.id, status: found.status };
    }

    /**
     * The query for the live catalog roots that carry these names: catalog roots (no author) that are not retired. A
     * name is unique among them (0018), so each key matches at most one row.
     *
     * @param normalizedNames - The names' dedup keys; at least one.
     * @returns The query, not yet run.
     */
    private liveCatalogRootQuery(normalizedNames: readonly string[]) {
        return this.db
            .select({ id: food.id, status: food.status, normalizedName: food.normalizedName })
            .from(food)
            .where(
                and(inArray(food.normalizedName, [...normalizedNames]), isNull(food.userId), isNull(food.retiredAt)),
            );
    }

    /**
     * Adopt one item as a new root, unless it is crosswalked or its name is taken.
     *
     * @param input - The item, the root's name, and how its record is written.
     * @returns How the write ended.
     * @throws Whatever `persistRoot` or the database throws; nothing is written then.
     * @sideEffect Takes two transaction locks and the named root's row lock; may insert `food_item`, `food` and
     *   `food_sources`, settle a placeholder's queue rows, and write the record.
     */
    public async adopt(input: AdoptionWriteInput): Promise<AdoptionWrite> {
        try {
            return await this.db.transaction(
                async (tx): Promise<AdoptionWrite> => {
                    const item = `${input.source}:${input.externalKey}`;

                    await tx.execute(
                        sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.foodRemoteAdoption}, hashtext(${item}))`,
                    );

                    const crosswalked = await tx.execute(sql`
                        SELECT 1 FROM food_sources
                         WHERE source = ${input.source}::food_source AND external_key = ${input.externalKey}
                    `);

                    if ((crosswalked.rowCount ?? 0) > 0) {
                        return { kind: 'crosswalked' };
                    }

                    await tx.execute(nameDedupLock(input.normalizedName));

                    const named = await new RemoteAdoptionDao(tx).lockedLiveCatalogRootNamed(input.normalizedName);

                    if (named !== undefined) {
                        const action = namedRootActionOf(named.status);

                        return action.kind === 'answer'
                            ? { kind: 'named', id: named.id }
                            : completePlaceholder(tx, named, action.reactivateFrom, input);
                    }

                    const id = await new FoodItemDao(tx).insertLiveRoot({
                        name: input.name,
                        normalizedName: input.normalizedName,
                        status: 'PENDING',
                    });
                    const claimed = await new FoodSourcesDao(tx).claimSource({
                        foodId: id,
                        source: input.source,
                        externalKey: input.externalKey,
                    });

                    if (claimed === undefined) {
                        // Another writer claimed the item after the read above: undo the root.
                        throw new TransactionRollbackError();
                    }

                    await input.persistRoot(tx, id);

                    return { kind: 'created', id };
                },
                { isolationLevel: 'read committed' },
            );
        } catch (error) {
            if (error instanceof TransactionRollbackError) {
                return { kind: 'crosswalked' };
            }

            throw error;
        }
    }
}
