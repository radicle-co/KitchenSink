/**
 * Truth table for the bound_by carry-forward: identity is the FOOD only, consumed as a multiset in stored order.
 */
import { describe, expect, it } from 'vitest';

import {
    BOUND_BY_VALUES,
    carryForwardBinding,
    resolveLineBindings,
    type IncomingBinding,
    type LineOriginDirective,
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
/** A line kept as written: no food, but its own declared binding (a freeform name never converges with another's). */
const storedAsWritten = (keptLookupId: string, importLineId: string | null = null): StoredBinding => ({
    foodLookupId: undefined,
    keptLookupId,
    boundBy: null,
    importLineId,
});
const incomingAsWritten = (keptLookupId: string, importLineId: string | null = null): IncomingBinding => ({
    foodLookupId: undefined,
    keptLookupId,
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

describe('carryForwardBinding — a line kept as written keeps its import link by its OWN binding', () => {
    // ⛔ WHY: both shipped editors send EVERY ingredient on EVERY save, and a kept-as-written line has no food to carry
    // by. Without an identity of its own, a title-only edit would drop the link of every such line and silently count it
    // as accepted, which empties the "to check" list the cook has not looked at (ADR-0072 §10).
    it('carries the link when the same kept binding comes back (a title-only save)', () => {
        expect(carryForwardBinding([storedAsWritten('W1', 'L1')], [incomingAsWritten('W1')])).toEqual([
            { boundBy: null, importLineId: 'L1' },
        ]);
    });

    it('follows the binding when lines are reordered', () => {
        const result = carryForwardBinding(
            [storedAsWritten('W1', 'L1'), storedAsWritten('W2', 'L2')],
            [incomingAsWritten('W2'), incomingAsWritten('W1')],
        );
        expect(result).toEqual([
            { boundBy: null, importLineId: 'L2' },
            { boundBy: null, importLineId: 'L1' },
        ]);
    });

    it('gives a stored line to ONE incoming line only', () => {
        const result = carryForwardBinding(
            [storedAsWritten('W1', 'L1')],
            [incomingAsWritten('W1'), incomingAsWritten('W1')],
        );
        expect(result).toEqual([
            { boundBy: null, importLineId: 'L1' },
            { boundBy: null, importLineId: null },
        ]);
    });

    it('drops the link when the cook points the line at a food (that is the cook’s decision)', () => {
        expect(carryForwardBinding([storedAsWritten('W1', 'L1')], [incoming(FLOUR)])).toEqual([
            { boundBy: 'cook', importLineId: null },
        ]);
    });

    it('never lends a bound line’s link to an as-written line, or the reverse', () => {
        expect(carryForwardBinding([stored(FLOUR, 'exact', 'L1')], [incomingAsWritten('W1')])).toEqual([
            { boundBy: null, importLineId: null },
        ]);
        expect(carryForwardBinding([storedAsWritten('W1', 'L1')], [incoming(FLOUR)])[0]?.importLineId).toBeNull();
    });

    it('a stored as-written line with no kept binding carries nothing (the old behaviour is the fallback)', () => {
        expect(
            carryForwardBinding(
                [{ foodLookupId: undefined, boundBy: null, importLineId: 'L1' }],
                [incomingAsWritten('W1')],
            ),
        ).toEqual([{ boundBy: null, importLineId: null }]);
    });
});

describe('resolveLineBindings — the save path’s directives over the carry-forward rule', () => {
    const line = (
        foodLookupId: string | undefined,
        directive?: LineOriginDirective,
        keptLookupId?: string,
    ): IncomingBinding & { readonly directive?: LineOriginDirective } => ({
        foodLookupId,
        ...(keptLookupId === undefined ? {} : { keptLookupId }),
        importLineId: null,
        ...(directive === undefined ? {} : { directive }),
    });

    it('with no directive it IS the carry-forward rule', () => {
        const store = [stored(FLOUR, 'exact', 'L1'), storedAsWritten('W1', 'L2')];
        const lines = [line(FLOUR), line(undefined, undefined, 'W1'), line(BUTTER)];

        expect(resolveLineBindings(store, lines)).toEqual(
            carryForwardBinding(
                store,
                lines.map(({ directive: _directive, ...rest }) => rest),
            ),
        );
    });

    it('⛔ a title-only save keeps a bound line, an as-written line and its links (the required PATCH case)', () => {
        const result = resolveLineBindings(
            [stored(FLOUR, 'autoBest', 'L1'), storedAsWritten('W1', 'L2')],
            [line(FLOUR), line(undefined, undefined, 'W1')],
        );

        expect(result).toEqual([
            { boundBy: 'autoBest', importLineId: 'L1' },
            { boundBy: null, importLineId: 'L2' },
        ]);
    });

    it('⛔ a food change makes the line the cook’s and clears the link (the required PATCH case)', () => {
        expect(resolveLineBindings([stored(FLOUR, 'exact', 'L1')], [line(BUTTER)])).toEqual([
            { boundBy: 'cook', importLineId: null },
        ]);
    });

    describe('directive: set — the import’s own save states the origin exactly', () => {
        it('stores what it is told and consumes nothing from the stored lines', () => {
            const result = resolveLineBindings(
                [stored(FLOUR, 'exact', 'L1')],
                [line(FLOUR, { kind: 'set', boundBy: 'autoBest', importLineId: 'N1' }), line(FLOUR)],
            );

            expect(result).toEqual([
                { boundBy: 'autoBest', importLineId: 'N1' },
                { boundBy: 'exact', importLineId: 'L1' },
            ]);
        });

        it('can state a line kept as written with its link', () => {
            expect(
                resolveLineBindings([], [line(undefined, { kind: 'set', boundBy: null, importLineId: 'N2' })]),
            ).toEqual([{ boundBy: null, importLineId: 'N2' }]);
        });
    });

    describe('directive: cook — the cook confirmed this line (a rebind, even to the same food)', () => {
        it('turns a carried origin into cook on the SAME food, keeping the stored link', () => {
            expect(resolveLineBindings([stored(FLOUR, 'autoBest', 'L1')], [line(FLOUR, { kind: 'cook' })])).toEqual([
                { boundBy: 'cook', importLineId: 'L1' },
            ]);
        });

        it('keeps the link the rebind passes on a CHANGED food', () => {
            expect(
                resolveLineBindings(
                    [stored(FLOUR, 'exact', 'L1')],
                    [line(BUTTER, { kind: 'cook', importLineId: 'L1' })],
                ),
            ).toEqual([{ boundBy: 'cook', importLineId: 'L1' }]);
        });

        it('leaves the other lines to the carry-forward rule', () => {
            expect(
                resolveLineBindings(
                    [stored(FLOUR, 'exact', 'L1'), stored(BUTTER, 'default', 'L2')],
                    [line(FLOUR), line(BUTTER, { kind: 'cook' })],
                ),
            ).toEqual([
                { boundBy: 'exact', importLineId: 'L1' },
                { boundBy: 'cook', importLineId: 'L2' },
            ]);
        });

        it('never invents a food for a line kept as written', () => {
            expect(
                resolveLineBindings([storedAsWritten('W1', 'L1')], [line(undefined, { kind: 'cook' }, 'W1')]),
            ).toEqual([{ boundBy: null, importLineId: 'L1' }]);
        });
    });
});
