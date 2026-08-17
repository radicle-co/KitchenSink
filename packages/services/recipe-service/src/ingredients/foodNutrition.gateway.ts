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

/** One food's nutrition as recipe consumes it — food's projection, plus how THIS read obtained it. */
export interface FoodNutritionEntry {
    /**
     * Whether this value came from a live read or from cache after a failed refresh.
     *
     * ⛔ Per ENTRY, not per lookup. Chunks now run concurrently under `Promise.allSettled`, so one answer
     * legitimately mixes ids fetched a moment ago with ids recovered from cache — and a single batch-level
     * scalar cannot describe that without lying in one direction: calling the whole thing `stale` slanders
     * data fetched a second earlier, and calling it `fresh` hides a real outage.
     */
    readonly freshness: NutritionFreshness;
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

/**
 * How one entry was obtained — carried to the wire so a reader can tell fresh from stale.
 *
 * ⛔ There is no `absent` member any more. An id nothing recovered is simply NOT IN THE MAP, the same way
 * an unreadable recipe is simply not in the wire response: absence is the signal, so there is no value a
 * consumer could accidentally render as a reading.
 */
export type NutritionFreshness = 'fresh' | 'stale';

/** The nutrition data itself, without the per-read provenance — what the cache retains. */
type CachedNutrition = Omit<FoodNutritionEntry, 'freshness'>;

/** The outcome of one batched lookup. Total: this never rejects. */
export interface FoodNutritionLookup {
    /** Nutrition by food id, each entry carrying its own freshness. Missing ids simply have no entry. */
    readonly byFoodId: ReadonlyMap<string, FoodNutritionEntry>;
    /**
     * Whether ANY chunk failed. For logging and metrics — ⛔ never for marking a recipe stale, which is
     * what the per-entry `freshness` is for. A recipe whose own foods all came back fresh must not be
     * caveated because a sibling recipe's chunk failed.
     */
    readonly degraded: boolean;
}

/** Options for {@link FoodNutritionGateway}. */
export interface FoodNutritionGatewayOptions {
    /** How long a cached entry stays servable as FRESH. */
    readonly ttlMs?: number;
    /** Max distinct foods held. Bounded because an unbounded cache is a memory leak with a nice name. */
    readonly maxEntries?: number;
}

/**
 * How long a cached entry stays servable during an outage.
 *
 * ⛔ This is NOT a read-through cache, and the comment here used to imply it was ("long enough to absorb a
 * recipe list's repeats"). It absorbs nothing: `lookup` fetches EVERY wanted id on every call and reads the
 * cache only for chunks that FAILED. A 500-recipe list re-pays all 50 chunk calls on every request —
 * measured, at 13,968 chunk requests for the same 5,000 ids across one load run.
 *
 * That is a defensible design rather than a bug: always-fetch means always-fresh, and the cache exists as
 * an outage fallback, so this TTL is the staleness bound on what a degraded read may serve — not a hit
 * window. Making it read-through is the single largest performance win available here (repeat fan-out
 * would collapse to ~0 waves), but it is a deliberate change to the freshness CONTRACT, not an
 * optimization: a within-TTL hit that never touched food would still be reported `fresh`, and ADR-0021's
 * vocabulary has no word for "recent but not just now". Decide that before changing this.
 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Enough for a large recipe list's distinct ingredients several times over, and still trivially bounded. */
const DEFAULT_MAX_ENTRIES = 5_000;

/** Food's per-request id cap (U8). Batches larger than this are split rather than rejected. */
const MAX_IDS_PER_REQUEST = 100;

/**
 * How many chunks may be in flight at once.
 *
 * The loop used to be serial, so cost was `ceil(distinctFoods / 100) x foodLatency` in SERIES — at the
 * 500-recipe cap with low ingredient overlap that is roughly 50 round trips, well past REQ-NF-006's 500ms
 * budget. Six is a bound rather than a maximum: unbounded `Promise.all` would put ~50 simultaneous
 * requests on food from ONE recipe read, multiplied by every concurrent caller, against a service with a
 * finite connection pool and a load shedder in front of it.
 *
 * Waves are used rather than a work queue: a slow chunk holds its wave, which is slightly less optimal and
 * much easier to reason about, and the tail here is dominated by the number of waves, not by variance
 * within one.
 */
export const MAX_CONCURRENT_CHUNKS = 6;

export class FoodNutritionGateway {
    private readonly logger = new Logger(FoodNutritionGateway.name);

    /**
     * Last known nutrition per food id.
     *
     * `allowStale` is the whole point: an expired entry is retained and returned when the fetch that would
     * have refreshed it fails, which is exactly KTD-3b's "serve stale, marked".
     */
    private readonly cache: LRUCache<string, CachedNutrition>;

    public constructor(
        private readonly clients: FoodServiceClients,
        options: FoodNutritionGatewayOptions = {},
    ) {
        this.cache = new LRUCache<string, CachedNutrition>({
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
            return { byFoodId: new Map(), degraded: false };
        }

        if (caller === undefined) {
            // Never substitute another credential — food's own auth decides what this user may read.
            return this.fromCacheOnly(wanted, 'no caller credential to forward');
        }

        // Chunk first, then run the chunks in bounded WAVES under `Promise.allSettled`, so one failing
        // chunk degrades only its own ids instead of abandoning the answer. Split at food's published cap
        // rather than letting it 400 the whole batch: a 60-recipe list can legitimately reference more
        // than 100 distinct foods, and that is not a client error.
        const chunks: string[][] = [];

        for (let offset = 0; offset < wanted.length; offset += MAX_IDS_PER_REQUEST) {
            chunks.push(wanted.slice(offset, offset + MAX_IDS_PER_REQUEST));
        }

        const client = this.clients.nutrition(caller);
        const byFoodId = new Map<string, FoodNutritionEntry>();
        const failedIds: string[] = [];
        let degraded = false;

        for (let wave = 0; wave < chunks.length; wave += MAX_CONCURRENT_CHUNKS) {
            const inFlight = chunks.slice(wave, wave + MAX_CONCURRENT_CHUNKS);
            const settled = await Promise.allSettled(inFlight.map((chunk) => client.getNutrition(chunk)));

            settled.forEach((outcome, index) => {
                if (outcome.status === 'rejected') {
                    // Remember the ids rather than the error: what this chunk owed is recoverable from
                    // cache below, and one failed chunk says nothing about the others.
                    degraded = true;
                    failedIds.push(...(inFlight[index] ?? []));
                    this.logger.warn('food nutrition chunk failed', {
                        reason: outcome.reason instanceof Error ? outcome.reason.message : 'unknown error',
                        ids: inFlight[index]?.length ?? 0,
                    });

                    return;
                }

                for (const food of outcome.value.foods) {
                    const data: CachedNutrition = {
                        ...(food.caloriesPer100g !== undefined ? { caloriesPer100g: food.caloriesPer100g } : {}),
                        ...(food.proteinGPer100g !== undefined ? { proteinGPer100g: food.proteinGPer100g } : {}),
                        ...(food.carbsGPer100g !== undefined ? { carbsGPer100g: food.carbsGPer100g } : {}),
                        ...(food.fatGPer100g !== undefined ? { fatGPer100g: food.fatGPer100g } : {}),
                        portions: food.portions,
                    };

                    // The cache holds the DATA; freshness describes this read of it, so it is added here
                    // and never stored — otherwise a value cached while stale would be replayed as stale
                    // forever.
                    this.cache.set(food.id, data);
                    byFoodId.set(food.id, { ...data, freshness: 'fresh' });
                }
            });
        }

        // KTD-3b for the ids whose chunk failed, and ONLY those: last known value, marked stale. An id
        // with nothing cached is left out entirely — absent, never zero.
        for (const id of failedIds) {
            const cached = this.cache.get(id, { allowStale: true });

            if (cached !== undefined) {
                byFoodId.set(id, { ...cached, freshness: 'stale' });
            }
        }

        return { byFoodId, degraded };
    }

    /**
     * Serve whatever the cache still holds, INCLUDING expired entries (KTD-3b).
     *
     * @param wanted - The ids that were requested.
     * @param reason - Why the live fetch did not happen or did not succeed.
     * @returns Whatever the cache still holds, every entry marked `stale`; ids with nothing cached are
     *   simply absent from the map.
     * @sideEffect Logs the degradation.
     */
    private fromCacheOnly(wanted: readonly string[], reason: string): FoodNutritionLookup {
        const byFoodId = new Map<string, FoodNutritionEntry>();

        for (const id of wanted) {
            // `allowStale` — this is the branch the option exists for: the entry is past its TTL and is
            // returned anyway, because a slightly old number the reader is TOLD is old beats no number.
            const cached = this.cache.get(id, { allowStale: true });

            if (cached !== undefined) {
                byFoodId.set(id, { ...cached, freshness: 'stale' });
            }
        }

        this.logger.warn('food nutrition degraded', { reason, recovered: byFoodId.size, requested: wanted.length });

        return { byFoodId, degraded: true };
    }
}
