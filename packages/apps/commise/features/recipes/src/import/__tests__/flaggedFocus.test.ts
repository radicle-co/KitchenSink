/**
 * Unit tests for `flaggedFocus.ts`: where focus goes when a flagged row's Use saves and the row leaves the list (WCAG
 * 2.4.3; on native the screen-reader cursor). Without it the control that held focus unmounts and focus falls to the
 * page. Seen red first.
 *
 * The landing is the SAME rule a retry uses (`flaggedRowViewOf`): the next row's Use, or its Choose another when the
 * check offered it no food. The search for the next row mirrors the matched list's `nextOpenLineKey`: the row after,
 * else the first row before, because a row above is still one the cook must settle. With no other row, the heading.
 */
import { describe, expect, it, vi } from 'vitest';

import { controlFocusOf, flaggedFocusAfterSave } from '../flaggedFocus.js';
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

describe('controlFocusOf: one control, two sources of a request', () => {
    const retry = (requested: boolean) => ({ requested, onHandled: vi.fn() });

    it('requests nothing when neither the retry nor the host names this control', () => {
        const focus = controlFocusOf(undefined, 'a', 'use', { landing: 'use', focus: retry(false) });

        expect(focus.requested).toBe(false);
    });

    it('a retry request counts only on the row’s landing control', () => {
        expect(controlFocusOf(undefined, 'a', 'use', { landing: 'use', focus: retry(true) }).requested).toBe(true);
        expect(controlFocusOf(undefined, 'a', 'chooseAnother', { landing: 'use', focus: retry(true) }).requested).toBe(
            false,
        );
    });

    it('the host’s request counts only for its row AND its control', () => {
        const rowFocus = { key: 'a', landing: 'use' as const, onHandled: vi.fn() };
        const none = { landing: 'use' as const, focus: retry(false) };

        expect(controlFocusOf(rowFocus, 'a', 'use', none).requested).toBe(true);
        expect(controlFocusOf(rowFocus, 'a', 'chooseAnother', none).requested).toBe(false);
        expect(controlFocusOf(rowFocus, 'b', 'use', none).requested).toBe(false);
    });

    it('taking the focus lowers the host’s request only when it was the host’s, and always the retry’s', () => {
        const rowFocus = { key: 'a', landing: 'use' as const, onHandled: vi.fn() };
        const own = retry(false);

        controlFocusOf(rowFocus, 'a', 'use', { landing: 'use', focus: own }).onHandled();
        expect(rowFocus.onHandled).toHaveBeenCalledTimes(1);
        expect(own.onHandled).toHaveBeenCalledTimes(1);

        controlFocusOf(rowFocus, 'b', 'use', { landing: 'use', focus: own }).onHandled();
        expect(rowFocus.onHandled).toHaveBeenCalledTimes(1);
    });
});
