import { describe, expect, it, vi } from 'vitest';

import {
    type EventClock,
    FETCH_FAILED_DETAIL_TYPE,
    FOOD_FETCH_COMPLETED_DETAIL_TYPE,
    FoodEventEmitter,
    buildFetchFailed,
    buildFoodFetchCompleted,
} from '../FoodEventEmitter.js';
import { InMemoryPublisher } from '@kitchensink/messaging';

const fixedClock: EventClock = {
    now: () => new Date('2026-06-29T00:00:00.000Z'),
    newEventId: () => 'evt_1',
};

/**
 * The shared capturing adapter, replacing this suite's hand-rolled bus fake (plan U4). Food-service carried
 * nine separate ad-hoc doubles, each re-deciding what "captured" meant; one shared double means these
 * assertions run against the same shape the production adapter receives.
 */
function captureBus(): { publisher: InMemoryPublisher } {
    return { publisher: new InMemoryPublisher() };
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

describe('FoodEventEmitter (fire-and-forget over the shared publish port)', () => {
    it('publishes FoodFetchCompleted under the canonical detailType (matches the CDK rule)', async () => {
        const { publisher } = captureBus();

        await new FoodEventEmitter(publisher, fixedClock).publishFoodFetchCompleted({ id: 'f', status: 'RESOLVED' });

        expect(publisher.messages).toHaveLength(1);
        expect(publisher.messages[0]?.kind).toBe(FOOD_FETCH_COMPLETED_DETAIL_TYPE);
        expect(publisher.messages[0]?.payload).toMatchObject({ id: 'f', status: 'RESOLVED' });
        // The substrate group (KTD-2): a consumer subscribes to ONE food's progress, not a firehose.
        expect(publisher.messages[0]).toMatchObject({ groupType: 'food', groupId: 'f' });
    });

    it('publishes FetchFailed under the canonical detailType', async () => {
        const { publisher } = captureBus();

        await new FoodEventEmitter(publisher, fixedClock).publishFetchFailed({ id: 'f', attempts: 5, lastError: 'x' });

        expect(publisher.messages[0]?.kind).toBe(FETCH_FAILED_DETAIL_TYPE);
        expect(publisher.messages[0]?.payload).toMatchObject({ id: 'f', attempts: 5, lastError: 'x' });
        expect(publisher.messages[0]).toMatchObject({ groupType: 'food', groupId: 'f' });
    });

    it('swallows a publish failure and reports it (a completion signal must never fail the drain)', async () => {
        const onError = vi.fn();
        const failing = {
            send: async () => {
                throw new Error('substrate down');
            },
        };

        await expect(
            new FoodEventEmitter(failing, fixedClock, onError).publishFoodFetchCompleted({
                id: 'f',
                status: 'FAILED',
            }),
        ).resolves.toBeUndefined();
        expect(onError).toHaveBeenCalledOnce();
    });
});
