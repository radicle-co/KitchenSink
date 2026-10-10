/**
 * Unit tests for the back-interceptor registry — the pure half of the hardware-back seam, with no React and
 * no React Native in it, which is the whole reason it exists as its own module.
 *
 * The behaviours below are not incidental; each is load-bearing for the data-loss defect the seam fixes:
 *
 *  - **Most-recently-registered first.** A pushed surface registers AFTER the host that hosts it, so LIFO is
 *    what lets the recipe editor veto a back press the navigator would otherwise answer by popping.
 *  - **The first `true` stops the walk.** A link that consumed the press must not let a later link answer it
 *    too — that is the double-navigation this seam exists to prevent.
 *  - **Dispatch walks a SNAPSHOT.** A handler is allowed to unregister itself (or a sibling) while it runs;
 *    mutating the live array mid-walk would skip a link or read past the end.
 */
import { describe, expect, it, vi } from 'vitest';

import { createBackInterceptRegistry } from '../backInterceptRegistry.js';

describe('createBackInterceptRegistry', () => {
    it('declines a press when nothing is registered', () => {
        expect(createBackInterceptRegistry().dispatch()).toBe(false);
    });

    it('declines when the only handler declines, having asked it exactly once', () => {
        const registry = createBackInterceptRegistry();
        const handler = vi.fn(() => false);
        registry.register(handler);

        expect(registry.dispatch()).toBe(false);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('consumes the press when the only handler consumes it', () => {
        const registry = createBackInterceptRegistry();
        registry.register(() => true);

        expect(registry.dispatch()).toBe(true);
    });

    it('⛔ offers the press MOST-RECENTLY-REGISTERED first, and stops at the link that consumes it', () => {
        const registry = createBackInterceptRegistry();
        const order: string[] = [];
        registry.register(() => {
            order.push('host');

            return true;
        });
        registry.register(() => {
            order.push('surface');

            return true;
        });

        expect(registry.dispatch()).toBe(true);
        // The host must NOT be asked: the surface consumed the press. Asserting the absence is the point —
        // a registry that asked everyone would still answer `true` here and look correct.
        expect(order).toEqual(['surface']);
    });

    it('falls through to the earlier link when the most recent one declines', () => {
        const registry = createBackInterceptRegistry();
        const order: string[] = [];
        registry.register(() => {
            order.push('host');

            return true;
        });
        registry.register(() => {
            order.push('surface');

            return false;
        });

        expect(registry.dispatch()).toBe(true);
        expect(order).toEqual(['surface', 'host']);
    });

    it('removes exactly the handler whose own unregister is called, and tolerates a second call', () => {
        const registry = createBackInterceptRegistry();
        const kept = vi.fn(() => false);
        const dropped = vi.fn(() => false);
        registry.register(kept);
        const unregisterDropped = registry.register(dropped);

        unregisterDropped();
        unregisterDropped();
        registry.dispatch();

        expect(dropped).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledTimes(1);
    });

    it('holds a handler registered twice ONCE, so one press asks it once', () => {
        const registry = createBackInterceptRegistry();
        const handler = vi.fn(() => false);
        registry.register(handler);
        registry.register(handler);

        registry.dispatch();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('walks a SNAPSHOT: a handler may unregister a sibling mid-dispatch without the walk skipping a link', () => {
        const registry = createBackInterceptRegistry();
        const asked: string[] = [];
        registry.register(() => {
            asked.push('bottom');

            return false;
        });
        const unregisterMiddle = registry.register(() => {
            asked.push('middle');

            return false;
        });
        registry.register(() => {
            asked.push('top');
            // Removing the NEXT link to be visited is the case a live-array walk gets wrong: the index
            // shifts under it and `bottom` is skipped.
            unregisterMiddle();

            return false;
        });

        expect(registry.dispatch()).toBe(false);
        expect(asked).toEqual(['top', 'middle', 'bottom']);
    });

    it('walks a SNAPSHOT: a handler may unregister ITSELF mid-dispatch', () => {
        const registry = createBackInterceptRegistry();
        const below = vi.fn(() => false);
        registry.register(below);
        const unregisterSelf = registry.register(() => {
            unregisterSelf();

            return false;
        });

        expect(registry.dispatch()).toBe(false);
        expect(below).toHaveBeenCalledTimes(1);
        // The self-removal really took effect — the next press asks only the survivor.
        registry.dispatch();
        expect(below).toHaveBeenCalledTimes(2);
    });
});
