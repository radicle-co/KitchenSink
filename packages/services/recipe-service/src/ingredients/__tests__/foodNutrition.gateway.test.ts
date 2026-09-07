/**
 * The recipe→food nutrition gateway (KTD-3b, plan U10).
 *
 * ⛔ This gateway is where U10's accepted cost lands: the recipe READ path now depends on food's
 * availability. Every test here is about what happens when that dependency fails, because the failure modes
 * are the whole reason the gateway exists rather than a bare client call.
 *
 * ⚠️ Assertions here moved from a batch-level `result.freshness` onto the ENTRY, and `absent` stopped
 * being a value — an id nothing recovered is simply not in the map. That is not a test edit to make things
 * compile: chunks now run concurrently under `Promise.allSettled`, so one answer legitimately mixes fresh
 * and stale ids, and a single scalar could only describe that by lying in one direction.
 *
 * The rule is **stale, then absent, never wrong**. A fabricated or zeroed calorie count is a factual claim
 * about a food, and a food-service outage is not evidence for it.
 */
import { describe, it, expect, vi } from 'vitest';

import { FoodNutritionGateway, MAX_CONCURRENT_CHUNKS } from '../foodNutrition.gateway.js';

const CALLER = { kind: 'user', token: 't' } as never;

function makeClients(getNutrition: ReturnType<typeof vi.fn>) {
    return { nutrition: () => ({ getNutrition }) } as never;
}

const chicken = { id: 'f1', status: 'RESOLVED', caloriesPer100g: 165, proteinGPer100g: 31, portions: [] };

/** A gateway whose food client runs `respond` per chunk — so a test can fail ONE chunk and not others. */
function makeGateway(respond: (chunk: readonly string[]) => Promise<unknown>): FoodNutritionGateway {
    return new FoodNutritionGateway(makeClients(vi.fn((chunk: readonly string[]) => respond(chunk))));
}

describe('the happy path', () => {
    it('returns food`s projection, marked fresh', async () => {
        const getNutrition = vi.fn().mockResolvedValue({ foods: [chicken], unknownIds: [] });
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        const result = await gateway.lookup(CALLER, ['f1']);

        expect(result.byFoodId.get('f1')?.freshness).toBe('fresh');
        expect(result.degraded).toBe(false);
        expect(result.byFoodId.get('f1')).toMatchObject({ caloriesPer100g: 165, proteinGPer100g: 31 });
    });

    it('de-duplicates and sorts the ids, so the URL food sees is the canonical cache key', async () => {
        const getNutrition = vi.fn().mockResolvedValue({ foods: [], unknownIds: [] });
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        await gateway.lookup(CALLER, ['b', 'a', 'b']);

        expect(getNutrition).toHaveBeenCalledWith(['a', 'b']);
    });

    it('issues ONE call for a whole list of recipes', async () => {
        // The plan's requirement: a 20-recipe list makes exactly one call to food, not one per recipe.
        const getNutrition = vi.fn().mockResolvedValue({ foods: [], unknownIds: [] });
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        await gateway.lookup(
            CALLER,
            Array.from({ length: 40 }, (_, i) => `f${i}`),
        );

        expect(getNutrition).toHaveBeenCalledTimes(1);
    });

    it('SPLITS at food`s published cap rather than letting the whole batch 400', async () => {
        // A large list can legitimately reference more than 100 distinct foods. That is not a client error,
        // and failing the entire read because of it would be the gateway inventing a limit food never set.
        const getNutrition = vi.fn().mockResolvedValue({ foods: [], unknownIds: [] });
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        await gateway.lookup(
            CALLER,
            Array.from({ length: 150 }, (_, i) => `f${String(i).padStart(3, '0')}`),
        );

        expect(getNutrition).toHaveBeenCalledTimes(2);
        expect((getNutrition.mock.calls[0]![0] as string[]).length).toBe(100);
        expect((getNutrition.mock.calls[1]![0] as string[]).length).toBe(50);
    });

    it('is a no-op with no ids — an all-freeform recipe must not call food at all', async () => {
        const getNutrition = vi.fn();
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        const result = await gateway.lookup(CALLER, []);

        expect(getNutrition).not.toHaveBeenCalled();
        expect(result.degraded).toBe(false);
    });
});

describe('⛔ KTD-3b — food is unreachable', () => {
    it('serves the last known value MARKED STALE when the cache is warm', async () => {
        const getNutrition = vi
            .fn()
            .mockResolvedValueOnce({ foods: [chicken], unknownIds: [] })
            .mockRejectedValue(new Error('food is down'));
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        await gateway.lookup(CALLER, ['f1']);
        const degraded = await gateway.lookup(CALLER, ['f1']);

        expect(degraded.byFoodId.get('f1')?.freshness).toBe('stale');
        expect(degraded.byFoodId.get('f1')?.caloriesPer100g).toBe(165);
    });

    it('reports ABSENT with a cold cache — never zero, never fabricated', async () => {
        // A zero calorie count is a factual claim about a food. An outage is not evidence for it, and a
        // reader cannot tell a real zero from an invented one.
        const getNutrition = vi.fn().mockRejectedValue(new Error('food is down'));
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        const result = await gateway.lookup(CALLER, ['f1']);

        // 'absent' is no longer a VALUE: an id nothing recovered is simply not in the map.
        expect(result.byFoodId.size).toBe(0);
        expect(result.degraded).toBe(true);
        expect(result.byFoodId.size).toBe(0);
    });

    it('NEVER rejects — a food outage degrades the recipe read, it does not fail it', async () => {
        const getNutrition = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        await expect(gateway.lookup(CALLER, ['f1'])).resolves.toBeDefined();
    });

    it('serves stale even AFTER the TTL has expired — that is what the retention is for', async () => {
        vi.useFakeTimers();

        try {
            const getNutrition = vi
                .fn()
                .mockResolvedValueOnce({ foods: [chicken], unknownIds: [] })
                .mockRejectedValue(new Error('down'));
            const gateway = new FoodNutritionGateway(makeClients(getNutrition), { ttlMs: 1_000 });

            await gateway.lookup(CALLER, ['f1']);
            vi.advanceTimersByTime(60_000);
            const degraded = await gateway.lookup(CALLER, ['f1']);

            expect(degraded.byFoodId.get('f1')?.freshness).toBe('stale');
            expect(degraded.byFoodId.get('f1')?.caloriesPer100g).toBe(165);
        } finally {
            vi.useRealTimers();
        }
    });

    it('degrades without calling food when there is no caller credential to forward', async () => {
        // Substituting another credential would let one user read under another's authorization.
        const getNutrition = vi.fn();
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        const result = await gateway.lookup(undefined, ['f1']);

        expect(getNutrition).not.toHaveBeenCalled();
        expect(result.byFoodId.size).toBe(0);
        expect(result.degraded).toBe(true);
    });
});

describe('the cache', () => {
    it('re-fetches after the TTL rather than serving stale forever on the happy path', async () => {
        vi.useFakeTimers();

        try {
            const getNutrition = vi.fn().mockResolvedValue({ foods: [chicken], unknownIds: [] });
            const gateway = new FoodNutritionGateway(makeClients(getNutrition), { ttlMs: 1_000 });

            await gateway.lookup(CALLER, ['f1']);
            vi.advanceTimersByTime(5_000);
            const second = await gateway.lookup(CALLER, ['f1']);

            expect(getNutrition).toHaveBeenCalledTimes(2);
            expect(second.byFoodId.get('f1')?.freshness).toBe('fresh');
        } finally {
            vi.useRealTimers();
        }
    });

    it('is BOUNDED — an unbounded cache is a memory leak with a nice name', async () => {
        const getNutrition = vi.fn().mockImplementation((ids: string[]) =>
            Promise.resolve({
                foods: ids.map((id) => ({ ...chicken, id })),
                unknownIds: [],
            }),
        );
        const gateway = new FoodNutritionGateway(makeClients(getNutrition), { maxEntries: 2 });

        await gateway.lookup(CALLER, ['a', 'b', 'c']);
        getNutrition.mockRejectedValue(new Error('down'));
        const degraded = await gateway.lookup(CALLER, ['a', 'b', 'c']);

        expect(degraded.byFoodId.size).toBeLessThanOrEqual(2);
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for PARTIAL failure — the case a sequential loop could not represent.
 *
 * The chunk loop used to `await` each chunk in turn inside one `try`, so the FIRST failure abandoned the
 * rest and `fromCacheOnly` rebuilt the whole answer from cache. Two consequences, both wrong:
 *
 *  1. Latency was `ceil(distinctFoods / 100) x foodLatency`, SERIAL. At the 500-recipe cap with low
 *     ingredient overlap that is ~50 round trips in series, past REQ-NF-006's 500ms budget.
 *  2. Chunks that had already SUCCEEDED were re-served from cache and marked `stale` — a lie about data
 *     fetched a second earlier.
 *
 * Running the waves with `Promise.allSettled` fixes both, and in doing so makes a mixed answer real: some
 * ids fresh from this call, others stale from cache, others absent entirely. A single batch-level
 * `freshness` scalar cannot describe that without lying in one direction, which is why `freshness` moved
 * ONTO THE ENTRY and `absent` stopped being a value — an id nothing recovered is simply not in the map,
 * exactly as an unreadable recipe is simply not in the wire response.
 */
describe('⛔ partial failure across chunks', () => {
    it('keeps a SUCCEEDED chunk fresh when a sibling chunk fails', async () => {
        const ids = Array.from({ length: 150 }, (_, index) => `food-${String(index).padStart(3, '0')}`);
        let call = 0;
        const gateway = makeGateway(async (chunk: readonly string[]) => {
            call += 1;

            if (call === 2) {
                throw new Error('food is down for this chunk');
            }

            return { foods: chunk.map((id) => ({ id, caloriesPer100g: 100, portions: [] })), unknownIds: [] };
        });

        const result = await gateway.lookup(CALLER, ids);

        // The surviving chunk is FRESH — not re-labelled stale because a sibling failed.
        expect(result.byFoodId.get('food-000')?.freshness).toBe('fresh');
        expect(result.degraded).toBe(true);
    });

    it('⛔ leaves an id from a failed chunk ABSENT when nothing is cached, never zero', async () => {
        const ids = Array.from({ length: 150 }, (_, index) => `cold-${String(index).padStart(3, '0')}`);
        const gateway = makeGateway(async (chunk: readonly string[]) => {
            if (chunk.includes('cold-149')) {
                throw new Error('down');
            }

            return { foods: chunk.map((id) => ({ id, caloriesPer100g: 100, portions: [] })), unknownIds: [] };
        });

        const result = await gateway.lookup(CALLER, ids);

        expect(result.byFoodId.has('cold-149')).toBe(false);
        expect(result.byFoodId.get('cold-000')?.freshness).toBe('fresh');
    });

    it('marks ONLY the failed chunk`s ids stale when they are cached', async () => {
        const ids = Array.from({ length: 150 }, (_, index) => `warm-${String(index).padStart(3, '0')}`);
        let call = 0;
        const gateway = makeGateway(async (chunk: readonly string[]) => {
            call += 1;

            if (call > 2 && chunk.includes('warm-100')) {
                throw new Error('down');
            }

            return { foods: chunk.map((id) => ({ id, caloriesPer100g: 100, portions: [] })), unknownIds: [] };
        });

        await gateway.lookup(CALLER, ids);
        const result = await gateway.lookup(CALLER, ids);

        expect(result.byFoodId.get('warm-100')?.freshness).toBe('stale');
        expect(result.byFoodId.get('warm-000')?.freshness).toBe('fresh');
    });

    it('⛔ runs chunks CONCURRENTLY, bounded — the whole point of the change', async () => {
        const ids = Array.from({ length: 600 }, (_, index) => `p-${String(index).padStart(3, '0')}`);
        let inFlight = 0;
        let peak = 0;
        const gateway = makeGateway(async (chunk: readonly string[]) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;

            return { foods: chunk.map((id) => ({ id, caloriesPer100g: 1, portions: [] })), unknownIds: [] };
        });

        await gateway.lookup(CALLER, ids);

        // ⛔ The bound is pinned as a LITERAL as well as against the constant. `peak <= MAX_CONCURRENT_CHUNKS`
        // alone is tautological — raising the constant to 1000 satisfies it while putting ~50 simultaneous
        // requests on food from ONE recipe read, which is precisely the failure the bound exists to prevent.
        // A mutation run caught exactly that, so the literal stays.
        expect(MAX_CONCURRENT_CHUNKS).toBeGreaterThan(1);
        expect(MAX_CONCURRENT_CHUNKS).toBeLessThanOrEqual(8);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_CHUNKS);
    });

    it('still NEVER rejects when every chunk fails', async () => {
        const ids = Array.from({ length: 150 }, (_, index) => `x-${index}`);
        const gateway = makeGateway(async () => {
            throw new Error('all down');
        });

        const result = await gateway.lookup(CALLER, ids);

        expect(result.degraded).toBe(true);
        expect(result.byFoodId.size).toBe(0);
    });
});
