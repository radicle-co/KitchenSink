/**
 * The drain lane: one drain at a time per outbox, and a drain asked for meanwhile runs once more — as the NEWEST pass.
 *
 * ⛔ WRITTEN BEFORE THE LANE EXISTS, from the defect it removes. `SyncProvider` kept one `draining` flag and one re-arm
 * flag for the whole provider, and the running loop answered the re-arm by looping again with ITS OWN closure. A change
 * of cook while a request was on the wire therefore re-ran the previous cook's drain, and the new cook's never ran.
 */
import { describe, expect, it } from 'vitest';

import { createDrainLane, drainLaneFor } from '../drainLane.js';
import { createMemoryOutboxStore } from '../outboxStore.js';

/** A promise and the function that resolves it. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });

    return { promise, resolve };
}

describe('createDrainLane', () => {
    it('runs a pass asked for while the lane is idle', async () => {
        const lane = createDrainLane();
        const ran: string[] = [];

        await lane.request(async () => {
            ran.push('first');
        });

        expect(ran).toStrictEqual(['first']);
    });

    it('⛔ never runs two passes at once', async () => {
        const lane = createDrainLane();
        const gate = deferred();
        let running = 0;
        let most = 0;

        const pass = async (): Promise<void> => {
            running += 1;
            most = Math.max(most, running);
            await gate.promise;
            running -= 1;
        };

        const first = lane.request(pass);
        const second = lane.request(pass);

        gate.resolve();
        await Promise.all([first, second]);

        expect(most).toBe(1);
    });

    /**
     * ⛔ THE DEFECT. The re-run is the pass asked for LAST, not the one that was running: the old loop re-ran its own
     * closure, which is how cook B's drain became a second pass of cook A's.
     */
    it('⛔ answers requests made during a pass with ONE more pass, and it is the newest one', async () => {
        const lane = createDrainLane();
        const gate = deferred();
        const ran: string[] = [];

        const done = lane.request(async () => {
            ran.push('running');
            await gate.promise;
        });

        void lane.request(async () => {
            ran.push('older');
        });
        void lane.request(async () => {
            ran.push('newest');
        });

        gate.resolve();
        await done;

        expect(ran).toStrictEqual(['running', 'newest']);
    });

    it('resolves every request once the lane is idle again, including a coalesced one', async () => {
        const lane = createDrainLane();
        const gate = deferred();
        const ran: string[] = [];

        const first = lane.request(async () => {
            await gate.promise;
            ran.push('first');
        });
        const second = lane.request(async () => {
            ran.push('second');
        });

        gate.resolve();
        await second;

        expect(ran).toStrictEqual(['first', 'second']);
        await expect(first).resolves.toBeUndefined();
    });

    /** A pass that rejects ends only itself: the re-run asked for meanwhile still runs, and the lane is not wedged. */
    it('⛔ keeps the re-run, and keeps working, after a pass rejects', async () => {
        const lane = createDrainLane();
        const gate = deferred();
        const ran: string[] = [];

        const failing = lane.request(async () => {
            await gate.promise;
            throw new Error('store unavailable');
        });
        void lane.request(async () => {
            ran.push('re-run');
        });

        gate.resolve();
        await expect(failing).resolves.toBeUndefined();
        expect(ran).toStrictEqual(['re-run']);

        await lane.request(async () => {
            ran.push('later');
        });
        expect(ran).toStrictEqual(['re-run', 'later']);
    });

    /**
     * A request made in the instant the last pass ends is not lost: the lane is either still running it (and runs it)
     * or idle (and starts it). There is no window where it is neither.
     */
    it('runs a pass requested from inside the pass that is ending', async () => {
        const lane = createDrainLane();
        const ran: string[] = [];

        await lane.request(async () => {
            ran.push('first');
            void lane.request(async () => {
                ran.push('asked from inside');
            });
        });

        expect(ran).toStrictEqual(['first', 'asked from inside']);
    });
});

describe('drainLaneFor', () => {
    it('is the same lane for the same store and subject, as the mutator is', () => {
        const store = createMemoryOutboxStore();

        expect(drainLaneFor(store, 'cook_a')).toBe(drainLaneFor(store, 'cook_a'));
    });

    /** ⛔ One lane per cook: a cook's drain never waits behind another cook's request on the wire. */
    it('⛔ gives each subject its own lane, so one cook`s pass does not hold another`s', async () => {
        const store = createMemoryOutboxStore();
        const gate = deferred();
        const ran: string[] = [];

        const held = drainLaneFor(store, 'cook_a').request(async () => {
            await gate.promise;
            ran.push('a');
        });

        await drainLaneFor(store, 'cook_b').request(async () => {
            ran.push('b');
        });

        expect(ran).toStrictEqual(['b']);

        gate.resolve();
        await held;
        expect(ran).toStrictEqual(['b', 'a']);
    });

    it('gives another store its own lane for the same subject', () => {
        expect(drainLaneFor(createMemoryOutboxStore(), 'cook_a')).not.toBe(
            drainLaneFor(createMemoryOutboxStore(), 'cook_a'),
        );
    });
});
