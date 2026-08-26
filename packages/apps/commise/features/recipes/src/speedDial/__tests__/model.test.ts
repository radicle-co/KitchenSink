/**
 * Unit tests for the SpeedDial's PURE keyboard model (U34, owner ruling 2026-08-25).
 *
 * Arrow navigation is the ONE keyboard decision this feature makes for itself — the focus trap, Escape,
 * focus restoration and outside-press dismissal are all owned by the platform machinery each leaf adapts.
 * Isolating that decision here means it is provable without a DOM, without a renderer and without
 * simulating focus, which leaves the component tests proving only that the DOM is wired to it.
 *
 * Two absences are asserted deliberately, because both are DOUBLE-FIRE defects rather than missing
 * features: a `<button>` (and a `role="menuitem"` rendered as one) already synthesises a click from Enter
 * and Space, so a model that ALSO reported them would open-then-close the dial on a single Enter press.
 */
import { describe, expect, it } from 'vitest';

import { nextMenuIndex, openIndexForTriggerKey } from '../model.js';

/** The one-destination dial the ruling actually ships. */
const ONE = 1;

/** A hypothetical dial after 004/005 land — proves the wrap arithmetic is not a `count === 1` accident. */
const THREE = 3;

describe('openIndexForTriggerKey — opening from the collapsed FAB', () => {
    it('opens onto the FIRST destination on ArrowDown', () => {
        expect(openIndexForTriggerKey('ArrowDown', THREE)).toBe(0);
    });

    it('opens onto the LAST destination on ArrowUp', () => {
        expect(openIndexForTriggerKey('ArrowUp', THREE)).toBe(2);
    });

    it('collapses both ends onto the single destination the dial ships with', () => {
        expect(openIndexForTriggerKey('ArrowDown', ONE)).toBe(0);
        expect(openIndexForTriggerKey('ArrowUp', ONE)).toBe(0);
    });

    it('reports NOTHING for Enter and Space — the button element already synthesises a click from both', () => {
        // Were these handled here too, one Enter press would open the dial (keydown) and immediately toggle
        // it shut (the synthesised click). The absence IS the fix, so it is asserted, not assumed.
        expect(openIndexForTriggerKey('Enter', ONE)).toBeUndefined();
        expect(openIndexForTriggerKey(' ', ONE)).toBeUndefined();
    });

    it('reports nothing for keys the dial does not own', () => {
        for (const key of ['Escape', 'Tab', 'Home', 'End', 'ArrowLeft', 'a']) {
            expect(openIndexForTriggerKey(key, ONE)).toBeUndefined();
        }
    });

    it('refuses to open a dial with no destinations at all', () => {
        // Unreachable from `RecipeList` today, but "open onto item -1" is the shape of a crash.
        expect(openIndexForTriggerKey('ArrowDown', 0)).toBeUndefined();
        expect(openIndexForTriggerKey('ArrowUp', 0)).toBeUndefined();
    });
});

describe('nextMenuIndex — navigating the open menu', () => {
    it('walks DOWN the destinations and wraps back to the first', () => {
        expect(nextMenuIndex('ArrowDown', 0, THREE)).toBe(1);
        expect(nextMenuIndex('ArrowDown', 1, THREE)).toBe(2);
        expect(nextMenuIndex('ArrowDown', 2, THREE)).toBe(0);
    });

    it('walks UP the destinations and wraps back to the last', () => {
        expect(nextMenuIndex('ArrowUp', 2, THREE)).toBe(1);
        expect(nextMenuIndex('ArrowUp', 1, THREE)).toBe(0);
        expect(nextMenuIndex('ArrowUp', 0, THREE)).toBe(2);
    });

    it('jumps to the first and last destination on Home and End', () => {
        expect(nextMenuIndex('Home', 1, THREE)).toBe(0);
        expect(nextMenuIndex('End', 1, THREE)).toBe(2);
    });

    it('stays put in both directions on the one-destination dial, never off the end', () => {
        // The shipped shape. `-1` or `1` here is a focus call against `undefined`.
        for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
            expect(nextMenuIndex(key, 0, ONE)).toBe(0);
        }
    });

    it('reports NOTHING for Enter and Space — the menu item synthesises its own click', () => {
        expect(nextMenuIndex('Enter', 0, THREE)).toBeUndefined();
        expect(nextMenuIndex(' ', 0, THREE)).toBeUndefined();
    });

    it('leaves Escape and Tab to the platform machinery that owns the trap', () => {
        expect(nextMenuIndex('Escape', 0, THREE)).toBeUndefined();
        expect(nextMenuIndex('Tab', 0, THREE)).toBeUndefined();
    });

    it('reports nothing for keys the dial does not own', () => {
        for (const key of ['ArrowLeft', 'ArrowRight', 'PageDown', 'x']) {
            expect(nextMenuIndex(key, 0, THREE)).toBeUndefined();
        }
    });

    it('navigates nowhere when the dial has no destinations', () => {
        for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
            expect(nextMenuIndex(key, 0, 0)).toBeUndefined();
        }
    });
});
