/**
 * Truth table for the bound_by carry-forward: identity is the FOOD only, consumed as a multiset in stored order.
 */
import { describe, expect, it } from 'vitest';

import {
    BOUND_BY_VALUES,
    carryForwardBinding,
    type IncomingBinding,
    type StoredBinding,
} from '../bindingOriginCarryForward.js';

const FLOUR = 'flour';
const BUTTER = 'butter';

const stored = (
    foodLookupId: string | undefined,
    boundBy: StoredBinding['boundBy'],
    importLineId: string | null = null,
): StoredBinding => ({ foodLookupId, boundBy, importLineId });
const incoming = (foodLookupId: string | undefined, importLineId: string | null = null): IncomingBinding => ({
    foodLookupId,
    importLineId,
});

describe('carryForwardBinding', () => {
    it('pins the six origins', () => {
        expect([...BOUND_BY_VALUES]).toEqual(['exact', 'curated', 'review', 'default', 'autoBest', 'cook']);
    });

    it('returns one entry per incoming line, in order, for an empty store', () => {
        expect(carryForwardBinding([], [incoming(FLOUR), incoming(undefined)])).toEqual([
            { boundBy: 'cook', importLineId: null },
            { boundBy: null, importLineId: null },
        ]);
        expect(carryForwardBinding([], [])).toEqual([]);
    });

    it('carries bound_by and the import link when the food is unchanged', () => {
        expect(carryForwardBinding([stored(FLOUR, 'exact', 'L1')], [incoming(FLOUR)])).toEqual([
            { boundBy: 'exact', importLineId: 'L1' },
        ]);
    });

    it('carries every origin unchanged', () => {
        for (const origin of BOUND_BY_VALUES) {
            expect(carryForwardBinding([stored(FLOUR, origin, 'L')], [incoming(FLOUR)])[0]?.boundBy).toBe(origin);
        }
    });

    it('follows the food when lines are reordered', () => {
        const result = carryForwardBinding(
            [stored(FLOUR, 'exact', 'L1'), stored(BUTTER, 'default', 'L2')],
            [incoming(BUTTER), incoming(FLOUR)],
        );
        expect(result).toEqual([
            { boundBy: 'default', importLineId: 'L2' },
            { boundBy: 'exact', importLineId: 'L1' },
        ]);
    });

    it('gives a stored line to ONE incoming line only: the second flour becomes the cook', () => {
        const result = carryForwardBinding([stored(FLOUR, 'autoBest', 'L1')], [incoming(FLOUR), incoming(FLOUR)]);
        expect(result).toEqual([
            { boundBy: 'autoBest', importLineId: 'L1' },
            { boundBy: 'cook', importLineId: null },
        ]);
    });

    it('consumes duplicates in stored order', () => {
        const result = carryForwardBinding(
            [stored(FLOUR, 'exact', 'L1'), stored(FLOUR, 'default', 'L2')],
            [incoming(FLOUR), incoming(FLOUR)],
        );
        expect(result).toEqual([
            { boundBy: 'exact', importLineId: 'L1' },
            { boundBy: 'default', importLineId: 'L2' },
        ]);
    });

    it('makes a changed food the cook and clears the link', () => {
        expect(carryForwardBinding([stored(FLOUR, 'exact', 'L1')], [incoming(BUTTER)])).toEqual([
            { boundBy: 'cook', importLineId: null },
        ]);
    });

    it('keeps the link on a changed food only when the rebind command passes it', () => {
        expect(carryForwardBinding([stored(FLOUR, 'exact', 'L1')], [incoming(BUTTER, 'L1')])).toEqual([
            { boundBy: 'cook', importLineId: 'L1' },
        ]);
    });

    it('stores a line kept as written as NULL', () => {
        expect(carryForwardBinding([stored(FLOUR, 'exact', 'L1')], [incoming(undefined)])).toEqual([
            { boundBy: null, importLineId: null },
        ]);
    });

    it('keeps a passed link on an as-written line, and never invents one', () => {
        expect(carryForwardBinding([], [incoming(undefined, 'L9')])).toEqual([{ boundBy: null, importLineId: 'L9' }]);
    });

    it('does not match a stored as-written line to an incoming food', () => {
        expect(carryForwardBinding([stored(undefined, null, 'L1')], [incoming(FLOUR)])).toEqual([
            { boundBy: 'cook', importLineId: null },
        ]);
    });

    it('does not carry from a stored line with no origin even on an equal food', () => {
        expect(carryForwardBinding([stored(FLOUR, null, 'L1')], [incoming(FLOUR)])).toEqual([
            { boundBy: 'cook', importLineId: null },
        ]);
    });

    it('does not mutate its inputs', () => {
        const s = [stored(FLOUR, 'exact', 'L1')];
        const i = [incoming(FLOUR)];
        const before = JSON.stringify([s, i]);
        carryForwardBinding(s, i);
        expect(JSON.stringify([s, i])).toBe(before);
    });
});
