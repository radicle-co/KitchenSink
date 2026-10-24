/**
 * Web's R7 (`docs/design/rowEditorOpenDecisions.md` R7 items 2 to 4): a refused save that points at an entry field
 * takes that field's focus AND opens its list. Native does not call this (buildSpec §7.8 supersedes R7 there), so the
 * merge is its own pure function and a platform opts in.
 */
import { describe, expect, it, vi } from 'vitest';

import { withRefusalFocus, type RefusalFocusInput } from '../refusalFocus.js';

const input = (over: Partial<RefusalFocusInput> = {}): RefusalFocusInput => ({
    focusRequested: false,
    listRequested: false,
    onFocusRequestHandled: () => undefined,
    refusalFocus: { pointed: false, onHandled: () => undefined },
    ...over,
});

describe('withRefusalFocus', () => {
    it('leaves a field the refusal does not point at as it was', () => {
        expect(withRefusalFocus(input({ focusRequested: true }))).toMatchObject({
            focusRequested: true,
            listRequested: false,
        });
        expect(withRefusalFocus(input())).toMatchObject({ focusRequested: false, listRequested: false });
    });

    it('asks a pointed-at field for focus AND its list', () => {
        expect(withRefusalFocus(input({ refusalFocus: { pointed: true, onHandled: () => undefined } }))).toMatchObject({
            focusRequested: true,
            listRequested: true,
        });
    });

    it('taking focus acknowledges both the settled request and the refusal', () => {
        const settled = vi.fn();
        const refusal = vi.fn();

        withRefusalFocus(
            input({ onFocusRequestHandled: settled, refusalFocus: { pointed: true, onHandled: refusal } }),
        ).onFocusRequestHandled();

        expect(settled).toHaveBeenCalledTimes(1);
        expect(refusal).toHaveBeenCalledTimes(1);
    });
});
