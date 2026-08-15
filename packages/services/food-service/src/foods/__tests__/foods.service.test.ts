/**
 * Unit tests for {@link FoodsService}'s local-store serve-rate instrumentation (T-199b, SC-004/SC-005).
 *
 * `getFood` is the ONLY path that can answer this question honestly: it is the golden-record read the
 * success criteria are written about, it makes no source call by construction, and it is the branch that
 * knows whether the local store had the answer. `getStatus` and `search` are deliberately NOT instrumented
 * — search never touches a source at all, so counting it would drive the rate to ~100% by construction and
 * destroy the signal; and the k6 SC-004 scenario measures `GET /api/v1/foods/{id}`, so instrumenting
 * anything wider would make the runtime metric and the load-test metric mean different things.
 *
 * The rest of `FoodsService` (dedup/enqueue/resolve/backpressure) is covered end-to-end by
 * `tests/foodsApi.integration.test.ts`; this suite pins the emission contract only.
 *
 * @implements SC-004 SC-005
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FoodMetrics } from '../../observability/emfMetrics.js';
import type { FoodDao, FoodStatus, GoldenFoodRecord } from '../dao/index.js';
import { FoodsService } from '../foods.service.js';

const FOOD_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

/** A minimal golden record in `status`; enough for `toFoodResponse` to map it. */
function makeRecord(status: FoodStatus): GoldenFoodRecord {
    return {
        id: FOOD_ID,
        name: 'Broccoli, raw',
        description: null,
        kind: 'ingredient',
        status,
        nutrients: [],
        portions: [],
        sources: [],
        fieldProvenance: [],
    } as unknown as GoldenFoodRecord;
}

/** Build the service with only the collaborators `getFood` touches; the rest would fail loudly if used. */
function makeService(record: GoldenFoodRecord | null): {
    service: FoodsService;
    sink: ReturnType<typeof vi.fn>;
} {
    const foodDao = { readGoldenRecord: vi.fn().mockResolvedValue(record) } as unknown as FoodDao;
    const sink = vi.fn();
    const unused = undefined as unknown as never;
    const service = new FoodsService(
        foodDao,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        new FoodMetrics(sink),
    );

    return { service, sink };
}

/** The serve-rate observations emitted to `sink`, in order. */
function serveRateValues(sink: ReturnType<typeof vi.fn>): number[] {
    return sink.mock.calls
        .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
        .filter((payload) => 'food-local-store-serve-rate' in payload)
        .map((payload) => payload['food-local-store-serve-rate'] as number);
}

describe('FoodsService.getFood — local-store serve rate (SC-004/SC-005)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('records a SERVED read (100) when the local store returns a RESOLVED golden record', async () => {
        const { service, sink } = makeService(makeRecord('RESOLVED'));

        await service.getFood(FOOD_ID);

        expect(serveRateValues(sink)).toEqual([100]);
    });

    it.each<FoodStatus>(['PENDING', 'UNRESOLVED'])(
        'records an UNSERVED read (0) for a %s food — the answer still needs a source fetch',
        async (status) => {
            const { service, sink } = makeService(makeRecord(status));

            await expect(service.getFood(FOOD_ID)).rejects.toThrow();
            expect(serveRateValues(sink)).toEqual([0]);
        },
    );

    it.each<FoodStatus>(['NOT_FOUND', 'FAILED'])('records an UNSERVED read (0) for a %s food', async (status) => {
        const { service, sink } = makeService(makeRecord(status));

        await expect(service.getFood(FOOD_ID)).rejects.toThrow();
        expect(serveRateValues(sink)).toEqual([0]);
    });

    it('records an UNSERVED read (0) when no row exists at all', async () => {
        const { service, sink } = makeService(null);

        await expect(service.getFood(FOOD_ID)).rejects.toThrow();
        expect(serveRateValues(sink)).toEqual([0]);
    });

    it('emits exactly ONE observation per read (CloudWatch aggregates; the service must not double-count)', async () => {
        const { service, sink } = makeService(makeRecord('RESOLVED'));

        await service.getFood(FOOD_ID);
        await service.getFood(FOOD_ID);

        expect(serveRateValues(sink)).toEqual([100, 100]);
    });
});
