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

import type { FoodStatus } from '@kitchensink/food-service-client';
import type { NutritionFreshness } from '@kitchensink/recipe-core';

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
    /**
     * The food's LIFECYCLE STATUS as food published it on this read.
     *
     * ⛔ Carried because it is the ONLY channel by which a recipe learns its line's food was WITHDRAWN
     * (owner rulings 3 + 4). The persisted `ingredients.food_resolution_status` mirror is never refreshed
     * for a withdrawal — recipe deliberately records no value for it — so a food withdrawn yesterday still
     * reads `RESOLVED` there forever. `foodPresenceStatus` derives the line's treatment from THIS field, at
     * read time, and writes nothing.
     *
     * ⚠️ Absent on a STALE entry recovered from cache: the cache holds the DATA, and a status is a fact
     * about a moment rather than about the food, so replaying a cached one would let a pre-withdrawal
     * `RESOLVED` outlive the withdrawal it predates. Absent means "could not ask", which
     * `foodPresenceStatus` treats as "change nothing" — never as a removal.
     */
    readonly status?: FoodStatus;
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

/*
 * How one entry was obtained is `NutritionFreshness` from `@kitchensink/recipe-core` — the SAME vocabulary the
 * recipe detail and the card batch carry on the wire, so the gateway cannot spell it a third way.
 *
 * ⛔ There is no `absent` member. An id nothing recovered is simply NOT IN THE MAP, the same way an unreadable
 * recipe is simply not in the wire response: absence is the signal, so there is no value a consumer could
 * accidentally render as a reading.
 */

/**
 * The nutrition data itself, without the per-read provenance — what the cache retains.
 *
 * ⛔ `status` is excluded alongside `freshness`, and for the same reason: both describe THIS read rather
 * than the food. A cached `RESOLVED` replayed after the food was withdrawn would suppress the very signal
 * the withdrawal overlay exists to raise.
 */
type CachedNutrition = Omit<FoodNutritionEntry, 'freshness' | 'status'>;

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
export const MAX_IDS_PER_REQUEST = 100;

/**
 * Which latency contract a lookup runs under — and so which food client the factory mints for it.
 *
 * `'read'` — the GET detail and the card batch: the standard deadline, because a slightly slower right answer
 * beats a degraded one on a read. `'postCommit'` — the nutrition a response carries AFTER its write has
 * committed: the short deadline, because that figure is extra information on a result that already succeeded
 * and must not hold it past the recipe client's own deadline. See `FoodServiceClients` for the numbers.
 */
export type NutritionReadBudget = 'read' | 'postCommit';

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
     * @param budget - The latency contract this lookup runs under (see {@link NutritionReadBudget}).
     * @returns The nutrition by id plus how fresh it is.
     * @sideEffect Performs batched food-service HTTP requests; populates the in-process cache.
     */
    public async lookup(
        caller: CallerToken | undefined,
        foodIds: readonly string[],
        budget: NutritionReadBudget,
    ): Promise<FoodNutritionLookup> {
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

        const client = ((): ReturnType<FoodServiceClients['nutrition']> => {
            switch (budget) {
                case 'read':
                    return this.clients.nutrition(caller);
                case 'postCommit':
                    return this.clients.postCommitNutrition(caller);
            }
        })();
        const byFoodId = new Map<string, FoodNutritionEntry>();
        // A Set, not an array: `missing` below asks "did this id's chunk fail?" once per wanted id, and when every
        // chunk of a 5,000-food batch fails that question over an array is 25 million comparisons on the request
        // thread — CPU spent exactly when food is already down.
        const failedIds = new Set<string>();
        let degraded = false;
        // ⛔ ONE DEADLINE OVER THE WHOLE LOOKUP (deadline propagation). Every request below carries this signal, so
        // the lookup's worst case is the deadline — not the sum of per-request timeouts it used to be (a shared chunk
        // then the authored call at 8 s each was the recipe detail's 16 s; nine waves plus the authored call was a
        // card batch's 80 s). The number is the budget's, and the factory owns it.
        const deadlineMs = this.clients.nutritionLookupDeadlineMs(budget);
        const deadline = AbortSignal.timeout(deadlineMs);

        for (let wave = 0; wave < chunks.length; wave += MAX_CONCURRENT_CHUNKS) {
            if (deadline.aborted) {
                // A spent budget is not spent again on food: the remaining waves are NOT sent, which also sheds load
                // from a food service that is already not answering in time. Their ids degrade exactly as a failed
                // chunk's do — stale from cache, else absent.
                const unsent = chunks.slice(wave).flat();

                degraded = true;
                unsent.forEach((id) => failedIds.add(id));
                this.logger.warn('food nutrition deadline passed before every chunk was requested', {
                    deadlineMs,
                    unsentIds: unsent.length,
                    budget,
                });
                break;
            }

            const inFlight = chunks.slice(wave, wave + MAX_CONCURRENT_CHUNKS);
            const settled = await Promise.allSettled(
                inFlight.map((chunk) => client.getNutrition(chunk, { signal: deadline })),
            );

            settled.forEach((outcome, index) => {
                if (outcome.status === 'rejected') {
                    // Remember the ids rather than the error: what this chunk owed is recoverable from
                    // cache below, and one failed chunk says nothing about the others.
                    degraded = true;
                    (inFlight[index] ?? []).forEach((id) => failedIds.add(id));
                    this.logger.warn('food nutrition chunk failed', {
                        reason: outcome.reason instanceof Error ? outcome.reason.message : 'unknown error',
                        ids: inFlight[index]?.length ?? 0,
                        budget,
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
                    byFoodId.set(food.id, { ...data, freshness: 'fresh', status: food.status });
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

        // U18's cache split, second phase: ids the SHARED route disowned may be the caller's own PRIVATE
        // authored foods (excluded from the caller-independent edge-cacheable response by construction).
        // Ask the authenticated per-caller route for exactly those. ⛔ Deliberately NOT written to the
        // in-process cache: it is keyed by food id alone and shared across callers, so caching a private
        // food's macros here would serve one user's private data to the next request that asks.
        const missing = wanted.filter((id) => !byFoodId.has(id) && !failedIds.has(id));

        if (missing.length > 0 && deadline.aborted) {
            // The shared phase used the whole budget. Starting the authored call now is what made the old worst case
            // TWO full timeouts; the ids stay absent (never zero) and the read is reported degraded.
            degraded = true;
            this.logger.warn('authored nutrition phase skipped: deadline already passed', {
                deadlineMs,
                ids: missing.length,
                budget,
            });
        } else if (missing.length > 0) {
            try {
                const authored = await client.getAuthoredNutrition(missing, { signal: deadline });

                for (const food of authored.foods) {
                    byFoodId.set(food.id, {
                        ...(food.caloriesPer100g !== undefined ? { caloriesPer100g: food.caloriesPer100g } : {}),
                        ...(food.proteinGPer100g !== undefined ? { proteinGPer100g: food.proteinGPer100g } : {}),
                        ...(food.carbsGPer100g !== undefined ? { carbsGPer100g: food.carbsGPer100g } : {}),
                        ...(food.fatGPer100g !== undefined ? { fatGPer100g: food.fatGPer100g } : {}),
                        portions: food.portions,
                        freshness: 'fresh',
                        status: food.status,
                    });
                }
            } catch (error) {
                // Absent, never zero — the same degradation as a failed shared chunk, without the cache
                // fallback (there deliberately is none for private data).
                degraded = true;
                this.logger.warn('authored nutrition phase failed', {
                    reason: error instanceof Error ? error.message : 'unknown error',
                    ids: missing.length,
                    budget,
                });
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
