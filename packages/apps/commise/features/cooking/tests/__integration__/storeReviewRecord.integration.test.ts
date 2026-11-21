/**
 * The store-review record across app launches (S12 U2, plan 0011): what only a SECOND store built over the same device
 * storage can show. A store keeps nothing in memory between calls, so a finish counted by one launch must be read by the
 * next, a plain sign-out must leave the cook's entry in place, and another cook's sign-in must leave it alone.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeMemoryKeptPort, makeSerialRunner } from '../../src/storeReview/__fixtures__/makeMemoryKeptPort.js';
import { createStoreReviewRecord, STORE_REVIEW_KEY } from '../../src/storeReview/storeReviewRecord.js';

const REQUEST = '2026-10-21T10:00:00.000Z';
const THIRTY_DAYS_LATER = '2026-11-20T10:00:00.000Z';

/** One app launch: a new record over the same device storage, so nothing is carried in memory. */
function launch(device: ReturnType<typeof makeMemoryKeptPort>, now: string) {
    const report = vi.fn();

    return {
        report,
        record: createStoreReviewRecord({ port: device.port, exclusive: makeSerialRunner(), now: () => now, report }),
    };
}

describe('the store-review record over one device storage', () => {
    it('counts two finishes across two launches', async () => {
        const device = makeMemoryKeptPort();

        await launch(device, REQUEST).record.recordFinish('user_a');
        await launch(device, REQUEST).record.recordFinish('user_a');

        expect(await launch(device, REQUEST).record.read('user_a')).toEqual({ finishes: 2 });
    });

    it('keeps the last request through a plain sign-out and a sign-in as the same cook 30 days later', async () => {
        const device = makeMemoryKeptPort();
        const first = launch(device, REQUEST).record;

        await first.recordFinish('user_a');
        await first.recordFinish('user_a');
        await first.recordRequest('user_a');
        // A plain sign-out touches no key of this record: nothing in this module runs, so the storage is as it was.
        const afterSignIn = launch(device, THIRTY_DAYS_LATER).record;

        expect(await afterSignIn.read('user_a')).toEqual({ finishes: 2, lastRequestAt: REQUEST });
    });

    it('lets another cook sign in: the first cook`s entry is kept and the second starts at zero', async () => {
        const device = makeMemoryKeptPort();

        await launch(device, REQUEST).record.recordFinish('user_a');
        const second = launch(device, REQUEST).record;

        expect(await second.read('user_b')).toEqual({ finishes: 0 });
        await second.recordFinish('user_b');
        expect(await launch(device, REQUEST).record.read('user_a')).toEqual({ finishes: 1 });
        expect(await launch(device, REQUEST).record.read('user_b')).toEqual({ finishes: 1 });
    });

    it('clears one cook for good and leaves the other', async () => {
        const device = makeMemoryKeptPort();
        const record = launch(device, REQUEST).record;

        await record.recordFinish('user_a');
        await record.recordFinish('user_b');
        await launch(device, REQUEST).record.clear('user_a');

        expect(await launch(device, REQUEST).record.read('user_a')).toEqual({ finishes: 0 });
        expect(await launch(device, REQUEST).record.read('user_b')).toEqual({ finishes: 1 });
    });

    it('heals a corrupt entry across launches, reporting it once, and leaves the other cook`s entries as stored', async () => {
        const device = makeMemoryKeptPort({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 'x' }, user_b: { finishes: 7 }, user_c: null }),
        });
        const { record, report } = launch(device, THIRTY_DAYS_LATER);

        expect(await record.read('user_a')).toBeUndefined();
        await record.recordFinish('user_a');

        expect(report).toHaveBeenCalledTimes(1);
        expect(JSON.parse(device.data.get(STORE_REVIEW_KEY) ?? 'null')).toEqual({
            user_a: { finishes: 1, lastRequestAt: THIRTY_DAYS_LATER },
            user_b: { finishes: 7 },
            user_c: null,
        });
    });
});
