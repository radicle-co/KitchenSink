/**
 * @module @commise/ui/focus-request — the design system's one focus-request mechanism, shared by web and native.
 *
 * A host that needs a control focused (a Done that moves focus to the next row, a dialog that opens on Keep) raises a
 * LEVEL, `focusRequested`, and lowers it when the control acknowledges. Focus has no declarative form, so the control
 * calls `take` — its own `.focus()`, through whatever node it already holds — then `onHandled`. Both are read as effect
 * events, so a host's new callback never re-runs a request already taken; only a request raised again does.
 *
 * It holds no ref of its own: the caller's `take` reaches the node the caller holds, so the one reason a primitive keeps
 * a ref (`.focus()`) stays where that ref is declared.
 *
 * @pattern Command — a level-triggered focus request, executed once and acknowledged
 */
import { useEffect, useEffectEvent } from 'react';

/**
 * Take focus while `requested` is raised, then acknowledge it.
 *
 * @param requested - The host's request level.
 * @param take - Moves focus: the caller's own `.focus()` (and anything it does with it).
 * @param onHandled - Acknowledges the request, so the host lowers it.
 * @sideEffect Calls `take` and `onHandled` after a commit in which `requested` became (or is first) true.
 */
export function useFocusRequest(requested: boolean, take: () => void, onHandled?: () => void): void {
    const takeRequest = useEffectEvent(() => {
        take();
        onHandled?.();
    });

    useEffect(() => {
        if (requested) {
            takeRequest();
        }
    }, [requested]);
}
