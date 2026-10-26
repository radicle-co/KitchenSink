/**
 * Unit tests for `flaggedFocus.ts`: where focus goes when a flagged row's Use saves and the row leaves the list (WCAG
 * 2.4.3; on native the screen-reader cursor). Without it the control that held focus unmounts and focus falls to the
 * page. Seen red first.
 *
 * The landing is the SAME rule a retry uses (`flaggedRowViewOf`): the next row's Use, or its Choose another when the
 * check offered it no food. The search for the next row mirrors the matched list's `nextOpenLineKey`: the row after,
 * else the first row before, because a row above is still one the cook must settle. With no other row, the heading.
 */
import { describe, expect, it } from 'vitest';

import { flaggedFocusAfterSave } from '../flaggedFocus.js';
import type { ImportFlaggedLineItem } from '../props.js';

const row = (key: string, withUse = true): ImportFlaggedLineItem => ({
    key,
    text: `line ${key}`,
    recipeTitle: 'Pancakes',
    matchedFood: 'milk crackers',
    ...(withUse ? { suggestion: { foodId: `f-${key}`, name: `Food ${key}` } } : {}),
});

describe('flaggedFocusAfterSave', () => {
    it('lands on the next row’s Use', () => {
        expect(flaggedFocusAfterSave([row('a'), row('b'), row('c')], 'a')).toEqual({
            kind: 'row',
            key: 'b',
            landing: 'use',
        });
    });

    it('lands on the next row’s Choose another when that row has no Use', () => {
        expect(flaggedFocusAfterSave([row('a'), row('b', false)], 'a')).toEqual({
            kind: 'row',
            key: 'b',
            landing: 'chooseAnother',
        });
    });

    it('with no row after, goes back to the first row before it', () => {
        expect(flaggedFocusAfterSave([row('a'), row('b'), row('c')], 'c')).toEqual({
            kind: 'row',
            key: 'a',
            landing: 'use',
        });
    });

    it('goes to the heading when the saved row was the only one', () => {
        expect(flaggedFocusAfterSave([row('a')], 'a')).toEqual({ kind: 'heading' });
    });

    it('goes to the heading when nothing is listed', () => {
        expect(flaggedFocusAfterSave([], 'a')).toEqual({ kind: 'heading' });
    });

    it('a saved key that is not listed (it already left) lands on the first row', () => {
        expect(flaggedFocusAfterSave([row('a'), row('b')], 'gone')).toEqual({
            kind: 'row',
            key: 'a',
            landing: 'use',
        });
    });
});
