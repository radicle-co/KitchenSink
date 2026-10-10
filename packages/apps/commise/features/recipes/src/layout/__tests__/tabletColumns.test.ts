/**
 * The tablet-layout rule, at the widths that actually ship.
 *
 * ⛔ THE DEVICE WIDTHS ARE THE TEST. A rule about layout asserted only at 0 and 10,000 proves the comparison
 * operator works and nothing about whether an iPad gets a tablet layout — which is the defect this rule
 * exists for: `supportsTablet: true` with no width adaptation anywhere in the recipe screens, so 768–1024pt
 * rendered a stretched phone.
 */
import { describe, expect, it } from 'vitest';

import { READING_MEASURE_WIDTH, TABLET_MIN_WIDTH, isTabletWidth, recipeGridColumns } from '../tabletColumns.js';

/** Real viewport widths in dp, so a change to the breakpoint is read as a device gaining or losing a layout. */
const DEVICES = [
    { name: 'iPhone SE', width: 320, tablet: false },
    { name: 'iPhone 13 mini', width: 375, tablet: false },
    { name: 'iPhone 15 Pro', width: 393, tablet: false },
    { name: 'iPhone 15 Pro Max', width: 430, tablet: false },
    { name: 'iPad mini portrait', width: 744, tablet: false },
    { name: 'iPad 10.9 portrait', width: 820, tablet: true },
    { name: 'iPad Pro 11 portrait', width: 834, tablet: true },
    { name: 'iPad Pro 12.9 portrait', width: 1024, tablet: true },
] as const;

describe('the tablet layout rule', () => {
    it.each(DEVICES)('classifies $name ($width dp) correctly', ({ width, tablet }) => {
        expect(isTabletWidth(width)).toBe(tablet);
    });

    /**
     * ⚠️ The boundary is asserted on BOTH sides. A rule that reads `>` where it means `>=` is off by exactly
     * one device — the iPad mini in landscape sits at 1133, but a 768-wide viewport is a real iPad portrait
     * on older hardware and is the width the token names.
     */
    it('⛔ includes the breakpoint itself, and excludes one dp below it', () => {
        expect(isTabletWidth(TABLET_MIN_WIDTH)).toBe(true);
        expect(isTabletWidth(TABLET_MIN_WIDTH - 1)).toBe(false);
    });

    /**
     * ⛔ THE TWO GRIDS WANT DIFFERENT COUNTS AT THE SAME WIDTH, which is why this takes a pair rather than
     * deriving one number from a target card width. The list's cards are full-width rows; discovery's are
     * compact tiles. A single formula that gives the list two columns on an iPad gives discovery four.
     */
    it('⛔ gives each grid its own pair, so one rule does not flatten both', () => {
        // The list: one column on a phone, two on a tablet.
        expect(recipeGridColumns(393, { phone: 1, tablet: 2 })).toBe(1);
        expect(recipeGridColumns(1024, { phone: 1, tablet: 2 })).toBe(2);

        // Discovery: already two on a phone, three on a tablet — NOT four, which would return the ~250dp
        // cards the phone layout already shows and waste the extra room on gutters.
        expect(recipeGridColumns(393, { phone: 2, tablet: 3 })).toBe(2);
        expect(recipeGridColumns(1024, { phone: 2, tablet: 3 })).toBe(3);
    });

    /**
     * ⚠️ The measure has to be NARROWER than the tablet it caps, or it is not a cap at all. Asserting the
     * relationship rather than the number keeps the two constants honest against each other if either moves.
     */
    it('⛔ caps body text below the narrowest tablet, so the cap actually binds', () => {
        expect(READING_MEASURE_WIDTH).toBeLessThan(TABLET_MIN_WIDTH);
        expect(READING_MEASURE_WIDTH).toBeGreaterThan(430);
    });
});
