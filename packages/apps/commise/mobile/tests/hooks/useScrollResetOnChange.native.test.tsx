/**
 * The wizard must return to the top when it advances a step.
 *
 * ## The defect this was written for
 *
 * `RecipeEditor` puts ONE `ScrollView` around `Wizard.Rail` and all four `Wizard.Step` bodies. Changing step
 * swaps the body but leaves the scroller where it was, so a cook who scrolls down to reach `Next:
 * Ingredients` taps it and lands at the BOTTOM of the ingredients step — no heading, no `Step 2 of 4`, no
 * indication anything happened.
 *
 * Measured on the CI emulator on 2026-08-22: four Maestro flows (`edit`, `versions`, `conflict-merge`,
 * `photos`) failed on `assertVisible: 'Step 2 of 4'` immediately after tapping `Next: Ingredients`, with the
 * step indicator scrolled off the top of the screen.
 *
 * ⚠️ `Wizard.native.tsx` is UNCHANGED on this branch — this is a latent bug that only became reachable when
 * step 1 grew tall enough to need scrolling before `Next` was in reach. It is a real usability defect, not a
 * test artefact: the flows are reporting what a cook would see.
 *
 * ## Why a ref, given the repo near-forbids them
 *
 * A scroll position is exactly the carve-out `CLAUDE.md` names — a genuinely external, non-declarative
 * system with no alternative. React Native exposes no prop that says "you are scrolled to the top"; the only
 * way to move a `ScrollView` is to call `scrollTo` on its handle. The ref is therefore wrapped in ONE hook
 * with a stated contract rather than sprinkled through the screen, and this file is that contract.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { useScrollResetOnChange } from '../../src/hooks/useScrollResetOnChange.js';
import type { ScrollResettable } from '../../src/hooks/useScrollResetOnChange.js';

/** A stand-in for the `ScrollView` handle — the only method the hook is allowed to touch. */
function fakeScrollable(): ScrollResettable & { scrollTo: Mock<(options: ScrollToOptions) => void> } {
    return { scrollTo: vi.fn<(options: ScrollToOptions) => void>() };
}

/** The argument shape `scrollTo` is called with, named so the fake and the hook cannot drift. */
type ScrollToOptions = Parameters<ScrollResettable['scrollTo']>[0];

describe('useScrollResetOnChange', () => {
    it('does NOT scroll on first render', () => {
        // The view already opens at the top. Scrolling on mount would fight a caller that legitimately
        // restored a position, and would fire on every screen entry for no reason.
        const scrollable = fakeScrollable();
        const { result } = renderHook(({ key }) => useScrollResetOnChange(key), { initialProps: { key: 1 } });

        result.current.current = scrollable;

        expect(scrollable.scrollTo).not.toHaveBeenCalled();
    });

    it('scrolls to the top when the key changes', () => {
        const scrollable = fakeScrollable();
        const { result, rerender } = renderHook(({ key }) => useScrollResetOnChange(key), {
            initialProps: { key: 1 },
        });

        result.current.current = scrollable;
        rerender({ key: 2 });

        // `animated: false` on purpose: an animated reset races the newly-mounted step body and lands
        // somewhere between the two, which is how a "reset" ends up half-scrolled.
        expect(scrollable.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    });

    it('does not scroll when the key is unchanged across a re-render', () => {
        // A step body re-renders on every keystroke. Resetting then would yank the view away mid-edit.
        const scrollable = fakeScrollable();
        const { result, rerender } = renderHook(({ key }) => useScrollResetOnChange(key), {
            initialProps: { key: 1 },
        });

        result.current.current = scrollable;
        rerender({ key: 1 });

        expect(scrollable.scrollTo).not.toHaveBeenCalled();
    });

    it('is inert when no scrollable is attached', () => {
        // The ref is null before mount and after unmount; a reset arriving then must not throw.
        const { rerender } = renderHook(({ key }) => useScrollResetOnChange(key), { initialProps: { key: 1 } });

        expect(() => rerender({ key: 2 })).not.toThrow();
    });
});
