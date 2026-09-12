// @vitest-environment jsdom
/**
 * The names of the bar's controls (`docs/design/compactHeightLayout.md` §4.4): the slot attribute that carries each, and
 * the parser that reads it back into a `BarControl`. REWRITTEN: reading which control has focus moved to
 * `@commise/ui/pinned-footer`, whose suite now holds those cases.
 */
import { describe, expect, it } from 'vitest';

import { BAR_CONTROL_ATTRIBUTE, BAR_CONTROL_FOCUS, barControlSlot, isBarControl } from '../barControlFocus.js';

describe('isBarControl', () => {
    it.each([
        ['previous', true],
        ['saveDraft', true],
        ['primary', true],
        ['next', false],
        ['', false],
        [null, false],
        [undefined, false],
    ] as const)('%s → %s', (value, expected) => {
        expect(isBarControl(value)).toBe(expected);
    });
});

describe('barControlSlot', () => {
    it('names the control on the attribute the reader looks for', () => {
        expect(barControlSlot('saveDraft')).toEqual({ [BAR_CONTROL_ATTRIBUTE]: 'saveDraft' });
    });
});

// Which control had focus is read by `@commise/ui/pinned-footer` (its own suite covers a slot outside the footer and a
// stray name); this pins that the wizard hands it the attribute its slots carry and a parser that admits only controls.
describe('BAR_CONTROL_FOCUS', () => {
    it('names the attribute `barControlSlot` writes', () => {
        expect(Object.keys(barControlSlot('primary'))).toEqual([BAR_CONTROL_FOCUS.attribute]);
    });

    it.each([
        ['saveDraft', 'saveDraft'],
        ['next', null],
        [null, null],
    ] as const)('reads %s back as %s', (value, control) => {
        expect(BAR_CONTROL_FOCUS.parse(value)).toBe(control);
    });
});
