import { describe, expect, it, vi } from 'vitest';

import {
    buildFetchFailed,
    buildFoodFetchCompleted,
    FETCH_FAILED_DETAIL_TYPE,
    FOOD_FETCH_COMPLETED_DETAIL_TYPE,
    FoodEventEmitter,
    type EventBus,
    type EventBusPutInput,
    type EventClock,
} from '../food-event-emitter.js';

const fixedClock: EventClock = {
    now: () => new Date('2026-06-29T00:00:00.000Z'),
    newEventId: () => 'evt_1',
};

function captureBus(): { puts: EventBusPutInput[]; bus: EventBus } {
    const puts: EventBusPutInput[] = [];
    const bus: EventBus = {
        putEvent: async (input) => {
            puts.push(input);
        },
    };

    return { puts, bus };
}

describe('event payload builders (T-165, plan §4)', () => {
    it('buildFoodFetchCompleted carries id, status, eventId, and an ISO-8601 timestamp', () => {
        const detail = buildFoodFetchCompleted({ id: 'food_1', status: 'RESOLVED' }, fixedClock);

        expect(detail).toEqual({
            eventId: 'evt_1',
            timestamp: '2026-06-29T00:00:00.000Z',
            id: 'food_1',
            status: 'RESOLVED',
        });
    });

    it('buildFetchFailed carries id, attempts, and lastError (FAILED only, DSN-9)', () => {
        const detail = buildFetchFailed({ id: 'food_2', attempts: 5, lastError: 'all_sources_errored' }, fixedClock);

        expect(detail).toEqual({
            eventId: 'evt_1',
            timestamp: '2026-06-29T00:00:00.000Z',
            id: 'food_2',
            attempts: 5,
            lastError: 'all_sources_errored',
        });
    });

    it('defaults to a parseable ISO timestamp and a non-empty event id', () => {
        const detail = buildFoodFetchCompleted({ id: 'food_3', status: 'NOT_FOUND' });

        expect(detail.id).toBe('food_3');
        expect(Number.isNaN(Date.parse(detail.timestamp))).toBe(false);
        expect(detail.eventId.length).toBeGreaterThan(0);
    });
});

describe('FoodEventEmitter (fire-and-forget over the injectable EventBus)', () => {
    it('publishes FoodFetchCompleted under the canonical detailType (matches the CDK rule)', async () => {
        const { puts, bus } = captureBus();

        await new FoodEventEmitter(bus, fixedClock).publishFoodFetchCompleted({ id: 'f', status: 'RESOLVED' });

        expect(puts).toHaveLength(1);
        expect(puts[0]?.detailType).toBe(FOOD_FETCH_COMPLETED_DETAIL_TYPE);
        expect(puts[0]?.detail).toMatchObject({ id: 'f', status: 'RESOLVED' });
    });

    it('publishes FetchFailed under the canonical detailType', async () => {
        const { puts, bus } = captureBus();

        await new FoodEventEmitter(bus, fixedClock).publishFetchFailed({ id: 'f', attempts: 5, lastError: 'x' });

        expect(puts[0]?.detailType).toBe(FETCH_FAILED_DETAIL_TYPE);
        expect(puts[0]?.detail).toMatchObject({ id: 'f', attempts: 5, lastError: 'x' });
    });

    it('swallows a bus failure and reports it (a completion signal must never fail the drain)', async () => {
        const onError = vi.fn();
        const bus: EventBus = {
            putEvent: async () => {
                throw new Error('eventbridge down');
            },
        };

        await expect(
            new FoodEventEmitter(bus, fixedClock, onError).publishFoodFetchCompleted({ id: 'f', status: 'FAILED' }),
        ).resolves.toBeUndefined();
        expect(onError).toHaveBeenCalledOnce();
    });
});
