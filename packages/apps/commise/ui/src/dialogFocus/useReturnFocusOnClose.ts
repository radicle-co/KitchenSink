/**
 * @module @commise/ui/dialog-focus — focus-return for a Radix surface whose trigger is a SIBLING.
 *
 * Radix restores focus on close only to an OWNED `*.Trigger`: `DialogContentModal` unconditionally
 * `preventDefault()`s FocusScope's own restore-to-previous-element behaviour and focuses
 * `context.triggerRef.current` instead (read out of `@radix-ui/react-dialog`). Every dialog in this codebase
 * is opened by a sibling control — a row action, a hamburger, a gated widget — so that default silently
 * focuses NOTHING, and the keyboard user is dropped at the top of the document.
 *
 * Six components carried a verbatim copy of the repair. This module is the one copy. Two things about its
 * shape are load-bearing:
 *
 *  1. **The snapshot is taken DURING RENDER, not in an effect.** Effects fire child-first, so by the time a
 *     parent effect ran, `Dialog.Content`'s own autofocus-on-mount would already have moved focus INTO the
 *     dialog and the snapshot would name the dialog's own first control. The render pass is the last moment
 *     at which `document.activeElement` is still the thing that opened the surface.
 *  2. **⛔ The edge latch is `useState` adjusted during render, NEVER a ref** — React's documented
 *     previous-value form. A ref mutation is not part of the render's work, so React never rolls it back: a
 *     render that is DISCARDED (a sibling suspends, a higher-priority update interrupts a transition) still
 *     advanced a ref latch, and the replayed render — the one that actually commits — then saw no edge and
 *     captured nothing, pinning focus-return to whatever happened to have focus during the abandoned
 *     attempt. A render-phase `setState` lives on the work-in-progress fiber and dies with it, so the
 *     replayed render sees the edge again. Pinned by `useReturnFocusOnClose.test.tsx`'s Suspense case,
 *     which fails on the ref shape.
 *
 * The remaining ref holds a DOM node and exists only to call the imperative `.focus()` the DOM API requires
 * — the sanctioned use under CLAUDE.md §3, and the reason the node never leaves this module.
 *
 * @pattern Headless hook (Facade over the DOM focus API) — the caller states only whether the surface is open and
 *     spreads the returned handler onto `Dialog.Content` / `AlertDialog.Content`; the snapshot never escapes.
 */
import { useCallback, useRef, useState } from 'react';

/**
 * Snapshot the element focused at the moment a Radix surface opens, and hand back the `onCloseAutoFocus`
 * handler that returns focus to it.
 *
 * The snapshot is taken on the false→true edge ONLY, so a re-render while the surface is open — a busy
 * state, an error, a loaded diff — cannot re-snapshot a control inside the surface itself. The latch
 * re-arms on close, so a second open captures its own opener.
 *
 * @param open - Whether the surface is currently open. The caller's own `open` prop or state, unchanged.
 * @returns The handler for `Dialog.Content`/`AlertDialog.Content`'s `onCloseAutoFocus`. It
 *     `preventDefault()`s Radix's own (no-op, sibling-blind) restore so there is ONE focus-return path, then
 *     focuses the snapshot. With nothing snapshotted it moves focus nowhere.
 * @sideEffect Reads `document.activeElement` during render and calls `.focus()` when the surface closes.
 */
export function useReturnFocusOnClose(open: boolean): (event: Event) => void {
    const triggerRef = useRef<HTMLElement | null>(null);
    const [wasOpen, setWasOpen] = useState(false);

    if (open !== wasOpen) {
        setWasOpen(open);

        if (open) {
            triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
    }

    return useCallback((event: Event): void => {
        event.preventDefault();
        triggerRef.current?.focus();
    }, []);
}
