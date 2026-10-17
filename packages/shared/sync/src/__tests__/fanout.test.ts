/**
 * The fan-out: one value to many listeners, one listener's failure isolated from the rest AND reported to the
 * subscriber that owns it.
 *
 * ⛔ WRITTEN TO FAIL ON A SWALLOW: the failure of a listener must reach the sink that listener was subscribed with, and
 * only that sink, while every other listener still hears the value.
 */
import { describe, expect, it, vi } from 'vitest';

import { createFanout } from '../fanout.js';

describe('createFanout', () => {
    it('tells every subscriber the value, in subscription order', () => {
        const fanout = createFanout<number>();
        const heard: string[] = [];

        fanout.subscribe((value) => heard.push(`a${String(value)}`));
        fanout.subscribe((value) => heard.push(`b${String(value)}`));
        fanout.publish(1);

        expect(heard).toStrictEqual(['a1', 'b1']);
    });

    it('stops telling a subscriber after it unsubscribes', () => {
        const fanout = createFanout<number>();
        const listener = vi.fn();
        const unsubscribe = fanout.subscribe(listener);

        unsubscribe();
        fanout.publish(1);

        expect(listener).not.toHaveBeenCalled();
    });

    it('⛔ isolates a throwing listener from the others and reports it to its own sink only', () => {
        const fanout = createFanout<number>();
        const boom = new Error('listener bug');
        const ownSink = vi.fn();
        const otherSink = vi.fn();
        const after = vi.fn();

        fanout.subscribe(() => {
            throw boom;
        }, ownSink);
        fanout.subscribe(after, otherSink);

        expect(() => {
            fanout.publish(7);
        }).not.toThrow();
        expect(after).toHaveBeenCalledWith(7);
        expect(ownSink).toHaveBeenCalledExactlyOnceWith(boom);
        expect(otherSink).not.toHaveBeenCalled();
    });

    it('isolates a throwing listener that has no sink', () => {
        const fanout = createFanout<number>();
        const after = vi.fn();

        fanout.subscribe(() => {
            throw new Error('listener bug');
        });
        fanout.subscribe(after);

        expect(() => {
            fanout.publish(1);
        }).not.toThrow();
        expect(after).toHaveBeenCalledOnce();
    });

    it('does not let a throwing sink break the fan-out', () => {
        const fanout = createFanout<number>();
        const after = vi.fn();

        fanout.subscribe(
            () => {
                throw new Error('listener bug');
            },
            () => {
                throw new Error('sink bug');
            },
        );
        fanout.subscribe(after);

        expect(() => {
            fanout.publish(1);
        }).not.toThrow();
        expect(after).toHaveBeenCalledOnce();
    });
});
