/**
 * The relations `PARSE_LINE_DELIVERY` must hold, not its literals (plan 2026-10-15-011).
 *
 * The numbers are the parse queue's own; what this pins is that they stay a coherent family — a lease the queue
 * outlasts, and a stall threshold no healthy re-offer can reach — because each reader trusts exactly that.
 */
import { describe, expect, it } from 'vitest';

import { PARSE_LINE_DELIVERY } from '../parseLineDelivery.js';

describe('PARSE_LINE_DELIVERY', () => {
    it('lets the queue outlast the claim lease, so a redelivery never meets a live claim', () => {
        expect(PARSE_LINE_DELIVERY.leaseSeconds).toBeLessThan(PARSE_LINE_DELIVERY.visibilityTimeoutSeconds);
    });

    it('calls a paste stalled only after two re-offers were missed, never inside one', () => {
        expect(PARSE_LINE_DELIVERY.stallSeconds).toBe(2 * PARSE_LINE_DELIVERY.visibilityTimeoutSeconds);
        expect(PARSE_LINE_DELIVERY.stallSeconds).toBeGreaterThan(PARSE_LINE_DELIVERY.leaseSeconds);
    });

    it('is the handler timeout the stack is built from: whole positive seconds', () => {
        for (const value of Object.values(PARSE_LINE_DELIVERY)) {
            expect(Number.isInteger(value) && value > 0).toBe(true);
        }
    });

    it('cannot be changed at run time', () => {
        expect(Object.isFrozen(PARSE_LINE_DELIVERY)).toBe(true);
    });
});
