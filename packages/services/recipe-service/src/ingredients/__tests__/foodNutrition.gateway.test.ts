/**
 * The recipe→food nutrition gateway (KTD-3b, plan U10).
 *
 * ⛔ This gateway is where U10's accepted cost lands: the recipe READ path now depends on food's
 * availability. Every test here is about what happens when that dependency fails, because the failure modes
 * are the whole reason the gateway exists rather than a bare client call.
 *
 * The rule is **stale, then absent, never wrong**. A fabricated or zeroed calorie count is a factual claim
 * about a food, and a food-service outage is not evidence for it.
 */
import { describe, it, expect, vi } from 'vitest';

import { FoodNutritionGateway } from '../foodNutrition.gateway.js';

const CALLER = { kind: 'user', token: 't' } as never;

function makeClients(getNutrition: ReturnType<typeof vi.fn>) {
    return { nutrition: () => ({ getNutrition }) } as never;
}

const chicken = { id: 'f1', status: 'RESOLVED', caloriesPer100g: 165, proteinGPer100g: 31, portions: [] };

describe('the happy path', () => {
    it('returns food`s projection, marked fresh', async () => {
        const getNutrition = vi.fn().mockResolvedValue({ foods: [chicken], unknownIds: [] });
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        const result = await gateway.lookup(CALLER, ['f1']);

        expect(result.freshness).toBe('fresh');
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
        expect(result.freshness).toBe('fresh');
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

        expect(degraded.freshness).toBe('stale');
        expect(degraded.byFoodId.get('f1')?.caloriesPer100g).toBe(165);
    });

    it('reports ABSENT with a cold cache — never zero, never fabricated', async () => {
        // A zero calorie count is a factual claim about a food. An outage is not evidence for it, and a
        // reader cannot tell a real zero from an invented one.
        const getNutrition = vi.fn().mockRejectedValue(new Error('food is down'));
        const gateway = new FoodNutritionGateway(makeClients(getNutrition));

        const result = await gateway.lookup(CALLER, ['f1']);

        expect(result.freshness).toBe('absent');
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

            expect(degraded.freshness).toBe('stale');
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
        expect(result.freshness).toBe('absent');
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
            expect(second.freshness).toBe('fresh');
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
