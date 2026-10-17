import { describe, expect, it } from 'vitest';

import { bridgeClassFor, placementFor } from '../tooltipPlacement.js';

describe('placementFor', () => {
    it.each([
        ['end', 'ltr', 'right'],
        ['end', 'rtl', 'left'],
        ['top', 'ltr', 'top'],
        ['top', 'rtl', 'top'],
        ['bottom', 'ltr', 'bottom'],
        ['bottom', 'rtl', 'bottom'],
    ] as const)('puts a %s tooltip on the %s page’s %s side', (side, direction, placement) => {
        expect(placementFor(side, direction)).toBe(placement);
    });
});

describe('bridgeClassFor', () => {
    // The tip joins its control by padding, not a gap, so the pointer can cross onto it (SC 1.4.13 hoverable); the wide
    // side faces the control, and keeps the label clear of a divider line the control sits beside.
    it.each([
        ['right', 'pl-4'],
        ['left', 'pr-4'],
        ['top', 'pb-4'],
        ['bottom', 'pt-4'],
        ['right-start', 'pl-4'],
        ['top-end', 'pb-4'],
    ] as const)('pads a %s tip on its control’s side with %s', (placement, wide) => {
        expect(bridgeClassFor(placement).split(' ')).toContain(wide);
    });

    it('pads the other sides narrowly', () => {
        expect(bridgeClassFor('right')).toBe('pl-4 pr-2 py-2');
    });
});
