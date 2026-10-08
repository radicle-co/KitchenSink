/**
 * Follows catalog forwards (curated catalog plan U8; ADR-0050 §4, KTD-8). A retired root or variant names its
 * successor in `food_forward`, and a successor may itself be retired and forwarded, so a reference is followed to the
 * end of its chain.
 *
 * The chain is bounded: more than {@link MAX_FORWARD_HOPS} hops, or a cycle, answers `resolved: false`. The caller
 * records that and answers "unknown", never a 500 — a read must not fail because the seed wrote a bad chain.
 *
 * The service writes one kind of forward, the one 0018's `food_forward_guard` admits `food_app` for: a live, unauthored,
 * unseeded root that the same transaction retired ({@link FoodForwardDao.forwardLiveRoot}). A by-name food that turns
 * out to BE a catalog entry is answered by that entry this way (FOOD-SERVICE-6), as the seed answers a claimed live food
 * (KTD-12), so every reader that follows a forward (refs resolve, the nutrition batch, search) needs nothing new.
 *
 * @pattern Table Data Gateway — `food_forward`, read through one recursive statement per batch
 * @module
 */
import { sql } from 'drizzle-orm';

import type { FoodWriter } from '../../database/unitOfWork.js';
import type { FoodRef } from '../foods.schema.js';

/** The most forwards one reference may follow before it is answered unresolved. */
export const MAX_FORWARD_HOPS = 8;

/** Where a reference's chain ends. */
export type ForwardOutcome =
    | {
          readonly resolved: true;
          /** The live end of the chain; the id itself when nothing forwards it. */
          readonly id: string;
          /** The end's kind, or `undefined` when nothing forwards it (the caller already knows the id's kind). */
          readonly kind: 'root' | 'variant' | undefined;
          /** How many forwards were followed. */
          readonly hops: number;
      }
    | { readonly resolved: false; readonly reason: 'depth' | 'cycle' };

/** One row of the recursive statement: the deepest step reached from a start. */
type ChainEnd = Readonly<{
    start_id: string;
    id: string;
    kind: 'root' | 'variant' | null;
    depth: number;
    is_cycle: boolean;
}>;

export class FoodForwardDao {
    public constructor(private readonly db: FoodWriter) {}

    /**
     * Follow each id's forwards to the end of its chain, in one statement.
     *
     * @param ids - Root or variant ids (one namespace: both are minted by `newFoodId`).
     * @returns One outcome per distinct id.
     * @sideEffect Reads `food_forward`.
     */
    public async follow(ids: readonly string[]): Promise<Map<string, ForwardOutcome>> {
        const outcomes = new Map<string, ForwardOutcome>();

        if (ids.length === 0) {
            return outcomes;
        }

        // Recursion stops one hop past the bound, so a chain longer than the bound is visible as a deeper row.
        const result = await this.db.execute<ChainEnd>(sql`
            WITH RECURSIVE chain (start_id, id, kind, depth) AS (
                SELECT s.id, s.id, NULL::food_item_owner_kind, 0
                  FROM unnest(${sql.param([...new Set(ids)])}::text[]) AS s (id)
                UNION ALL
                SELECT c.start_id,
                       coalesce(f.target_food_id, f.target_variant_id),
                       (CASE WHEN f.target_food_id IS NOT NULL THEN 'root' ELSE 'variant' END)::food_item_owner_kind,
                       c.depth + 1
                  FROM chain c
                  JOIN food_forward f ON f.source_id = c.id
                 WHERE c.depth <= ${MAX_FORWARD_HOPS}
            ) CYCLE id SET is_cycle USING path
            SELECT DISTINCT ON (start_id) start_id, id, kind::text AS kind, depth, is_cycle
              FROM chain
             ORDER BY start_id, depth DESC
        `);

        for (const end of result.rows) {
            outcomes.set(end.start_id, outcomeOf(end));
        }

        return outcomes;
    }

    /**
     * Retire a live by-name root and forward it to the catalog entry it is, in the caller's transaction. Only a live,
     * unauthored root that owns no seed item can be retired here: the statement says so, and `food_forward_guard`
     * refuses any other source.
     *
     * @param foodId - The live root.
     * @param to - The live catalog root or variant it is.
     * @throws {Error} when the root is not live and unauthored: the caller's status check should have stopped it.
     * @sideEffect Updates `food.retired_at` and inserts into `food_forward`.
     */
    public async forwardLiveRoot(foodId: string, to: FoodRef): Promise<void> {
        const retired = await this.db.execute(sql`
            UPDATE food SET retired_at = now(), updated_at = now()
             WHERE id = ${foodId} AND user_id IS NULL AND retired_at IS NULL
            RETURNING id
        `);

        if ((retired.rowCount ?? 0) !== 1) {
            throw new Error(`food ${foodId} is not a live catalog root and cannot be forwarded`);
        }

        await this.db.execute(sql`
            INSERT INTO food_forward (source_id, source_kind, source_key, target_food_id, target_variant_id)
            VALUES (
                ${foodId},
                'root',
                NULL,
                ${to.kind === 'root' ? to.id : null},
                ${to.kind === 'variant' ? to.id : null}
            )
        `);
    }
}

/**
 * Read one chain's deepest row as an outcome. Pure.
 *
 * @param end - The row.
 * @returns The outcome.
 */
function outcomeOf(end: ChainEnd): ForwardOutcome {
    if (end.is_cycle) {
        return { resolved: false, reason: 'cycle' };
    }

    if (end.depth > MAX_FORWARD_HOPS) {
        return { resolved: false, reason: 'depth' };
    }

    return { resolved: true, id: end.id, kind: end.kind ?? undefined, hops: Number(end.depth) };
}
