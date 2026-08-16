/**
 * The recipe service's read path to food's nutrition (KTD-3, KTD-3a, KTD-3b; plan U10).
 *
 * After U10 the recipe database holds `food_id` and `food_resolution_status` and **nothing else
 * food-derived**. Every calorie a recipe reports comes from here — one batched call to
 * `GET /api/v1/foods/nutrition?ids=…`, food's own projection, food's own normalized portions.
 *
 * ## The new runtime dependency, stated plainly
 *
 * This makes the recipe READ path depend on food's availability where it previously did not. That is the
 * cost of deleting the duplicate, and it is mitigated — not eliminated — by the cache below.
 *
 * ## KTD-3b: stale, then absent. Never wrong.
 *
 * On a food error the cache serves its last known value **marked stale**, so a reader knows the number may
 * have moved. With nothing cached it reports nutrition **absent** — the recipe still renders, without
 * numbers. What it never does is fabricate or zero: a zero calorie count is a factual claim about a food,
 * and an outage is not evidence for it.
 *
 * ⚠️ **Accepted limitation, recorded rather than discovered:** the cache is in-process, so it dies with the
 * Fargate task. A cold task during a food outage has nothing to serve and reports absent for everything.
 * A shared cache would fix that and is deliberately not built — it is a second store of food's data, which
 * is the thing this unit exists to remove.
 *
 * `lru-cache` over `keyv`: keyv is a multi-backend adapter layer and this is a single-process TTL cache,
 * so keyv's entire value proposition (swap the backend) is the thing we must not have.
 *
 * @implements KTD-3 KTD-3a KTD-3b
 */
import { Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';

import type { CallerToken } from '../auth/CallerToken.js';
import type { FoodServiceClients } from './FoodServiceClients.factory.js';

/** One food's nutrition as recipe consumes it — food's projection, unchanged. */
export interface FoodNutritionEntry {
    /** Energy, kcal per 100 g. Absent when food reports no qualifying row. */
    readonly caloriesPer100g?: number;
    /** Protein, g per 100 g. */
    readonly proteinGPer100g?: number;
    /** Carbohydrate, g per 100 g. */
    readonly carbsGPer100g?: number;
    /** Fat, g per 100 g. */
    readonly fatGPer100g?: number;
    /** Normalized household portions (`{ unit, gramsPerUnit }`), de-duplicated by unit. */
    readonly portions: readonly { readonly unit: string; readonly gramsPerUnit: number }[];
}

/** How a lookup's data was obtained — carried to the wire so a reader can tell fresh from stale. */
export type NutritionFreshness = 'fresh' | 'stale' | 'absent';

/** The outcome of one batched lookup. Total: this never rejects. */
export interface FoodNutritionLookup {
    /** Nutrition by food id. Missing ids simply have no entry. */
    readonly byFoodId: ReadonlyMap<string, FoodNutritionEntry>;
    /**
     * `fresh` — food answered. `stale` — food failed and at least one value came from cache. `absent` —
     * food failed and nothing was cached, so the recipe renders without numbers.
     */
    readonly freshness: NutritionFreshness;
}

/** Options for {@link FoodNutritionGateway}. */
export interface FoodNutritionGatewayOptions {
    /** How long a cached entry stays servable as FRESH. */
    readonly ttlMs?: number;
    /** Max distinct foods held. Bounded because an unbounded cache is a memory leak with a nice name. */
    readonly maxEntries?: number;
}

/** Five minutes: long enough to absorb a recipe list's repeats, short enough that a correction lands soon. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Enough for a large recipe list's distinct ingredients several times over, and still trivially bounded. */
const DEFAULT_MAX_ENTRIES = 5_000;

/** Food's per-request id cap (U8). Batches larger than this are split rather than rejected. */
const MAX_IDS_PER_REQUEST = 100;

export class FoodNutritionGateway {
    private readonly logger = new Logger(FoodNutritionGateway.name);

    /**
     * Last known nutrition per food id.
     *
     * `allowStale` is the whole point: an expired entry is retained and returned when the fetch that would
     * have refreshed it fails, which is exactly KTD-3b's "serve stale, marked".
     */
    private readonly cache: LRUCache<string, FoodNutritionEntry>;

    public constructor(
        private readonly clients: FoodServiceClients,
        options: FoodNutritionGatewayOptions = {},
    ) {
        this.cache = new LRUCache<string, FoodNutritionEntry>({
            max: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
            ttl: options.ttlMs ?? DEFAULT_TTL_MS,
            allowStale: true,
        });
    }

    /**
     * Fetch nutrition for many foods in as few calls as possible.
     *
     * **Total by construction — never rejects.** Food being down degrades the result; it does not fail the
     * recipe read.
     *
     * @param caller - The requesting user's credential, forwarded to food.
     * @param foodIds - The distinct food ids a recipe (or a list of them) references. Order irrelevant.
     * @returns The nutrition by id plus how fresh it is.
     * @sideEffect Performs batched food-service HTTP requests; populates the in-process cache.
     */
    public async lookup(caller: CallerToken | undefined, foodIds: readonly string[]): Promise<FoodNutritionLookup> {
        const wanted = [...new Set(foodIds.filter((id) => id.length > 0))].sort();

        if (wanted.length === 0) {
            return { byFoodId: new Map(), freshness: 'fresh' };
        }

        if (caller === undefined) {
            // Never substitute another credential — food's own auth decides what this user may read.
            return this.fromCacheOnly(wanted, 'no caller credential to forward');
        }

        const byFoodId = new Map<string, FoodNutritionEntry>();

        try {
            // Split at food's published cap rather than letting it 400 the whole batch: a 60-recipe list
            // can legitimately reference more than 100 distinct foods, and that is not a client error.
            for (let offset = 0; offset < wanted.length; offset += MAX_IDS_PER_REQUEST) {
                const chunk = wanted.slice(offset, offset + MAX_IDS_PER_REQUEST);
                const response = await this.clients.nutrition(caller).getNutrition(chunk);

                for (const food of response.foods) {
                    const entry: FoodNutritionEntry = {
                        ...(food.caloriesPer100g !== undefined ? { caloriesPer100g: food.caloriesPer100g } : {}),
                        ...(food.proteinGPer100g !== undefined ? { proteinGPer100g: food.proteinGPer100g } : {}),
                        ...(food.carbsGPer100g !== undefined ? { carbsGPer100g: food.carbsGPer100g } : {}),
                        ...(food.fatGPer100g !== undefined ? { fatGPer100g: food.fatGPer100g } : {}),
                        portions: food.portions,
                    };

                    byFoodId.set(food.id, entry);
                    this.cache.set(food.id, entry);
                }
            }

            return { byFoodId, freshness: 'fresh' };
        } catch (error) {
            return this.fromCacheOnly(wanted, error instanceof Error ? error.message : 'unknown error');
        }
    }

    /**
     * Serve whatever the cache still holds, INCLUDING expired entries (KTD-3b).
     *
     * @param wanted - The ids that were requested.
     * @param reason - Why the live fetch did not happen or did not succeed.
     * @returns `stale` when anything was recovered, `absent` when nothing was.
     * @sideEffect Logs the degradation.
     */
    private fromCacheOnly(wanted: readonly string[], reason: string): FoodNutritionLookup {
        const byFoodId = new Map<string, FoodNutritionEntry>();

        for (const id of wanted) {
            // `allowStale` — this is the branch the option exists for: the entry is past its TTL and is
            // returned anyway, because a slightly old number the reader is TOLD is old beats no number.
            const cached = this.cache.get(id, { allowStale: true });

            if (cached !== undefined) {
                byFoodId.set(id, cached);
            }
        }

        const freshness: NutritionFreshness = byFoodId.size > 0 ? 'stale' : 'absent';

        this.logger.warn('food nutrition degraded', { reason, freshness, requested: wanted.length });

        return { byFoodId, freshness };
    }
}
