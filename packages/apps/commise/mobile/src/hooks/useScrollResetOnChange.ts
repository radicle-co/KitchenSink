/**
 * @module hooks/useScrollResetOnChange — return a scroller to the top when the thing it shows changes.
 *
 * ## Why this exists
 *
 * `RecipeEditor` wraps `Wizard.Rail` and all four `Wizard.Step` bodies in ONE `ScrollView`. Changing step
 * swaps the body but leaves the scroller where it was, so a cook who scrolls down to reach `Next:
 * Ingredients` taps it and arrives at the BOTTOM of the next step — no heading, no `Step 2 of 4`, nothing
 * that says the wizard moved. Four Maestro flows caught exactly that on 2026-08-22.
 *
 * ⚠️ The wizard shell did not change to cause this. The bug became reachable when step 1 grew tall enough to
 * need scrolling before `Next` was on screen; the missing reset had been there all along.
 *
 * ## Why a ref, when this repo near-forbids them
 *
 * A scroll position is the carve-out `CLAUDE.md` names: a genuinely external, non-declarative system with no
 * alternative. React Native publishes no prop meaning "you are at the top" — the only way to move a
 * `ScrollView` is to call `scrollTo` on its handle. So the ref is confined to this one hook with a stated
 * contract, rather than living loose in a screen.
 *
 * PATTERN: headless hook over an imperative handle. The caller attaches the returned ref to its scroller and
 * says WHAT changing means a reset (`key`); it never touches the handle itself.
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** The only capability this hook uses from a scroller handle — deliberately narrower than `ScrollView`. */
export interface ScrollResettable {
    /** Move the scroller. Only ever called here as `{ y: 0, animated: false }`. */
    readonly scrollTo: (options: { readonly y: number; readonly animated: boolean }) => void;
}

/**
 * A ref to attach to a scroller, which is returned to the top whenever `key` changes.
 *
 * Deliberately inert on FIRST render: the view already opens at the top, and resetting on mount would fire
 * on every screen entry and fight any caller that legitimately restored a position.
 *
 * Generic in the handle so a caller can attach it to a real `ScrollView` (whose type carries forty other
 * methods) while this module still declares the ONE method it is allowed to use.
 *
 * @param key - The value whose CHANGE means "you are looking at something else now" (the wizard's step).
 * @returns A ref for the scroller. Null before mount and after unmount, and a reset arriving then is a no-op.
 * @sideEffect Calls `scrollTo` on the attached handle when `key` changes.
 */
export function useScrollResetOnChange<Handle extends ScrollResettable = ScrollResettable>(
    key: unknown,
): RefObject<Handle | null> {
    const scroller = useRef<Handle | null>(null);
    const seen = useRef(key);

    useEffect(() => {
        // The effect also runs on mount, where `seen` still holds the initial key — that equality is what
        // makes "no scroll on first render" a property of the hook rather than of React's scheduling.
        if (seen.current === key) {
            return;
        }

        seen.current = key;
        // NOT animated: an animated reset races the newly-mounted step body's layout and settles part-way
        // down it, which reads to a cook as "the reset half worked".
        scroller.current?.scrollTo({ y: 0, animated: false });
    }, [key]);

    return scroller;
}
