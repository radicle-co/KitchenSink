'use client';

/**
 * @module @commise/features-recipes/collections — leave a screen only AFTER the confirm dialog that asked for it has closed.
 *
 * A confirm dialog is a window of its own on native: popping the screen that hosts it while it is still
 * open makes Android re-parent a view that already has a parent (`addViewAt ... The specified child already has a
 * parent`, a process crash — the collection detail's delete flow hit it). On web the same ordering is merely tidier,
 * and it is the same flow, so both apps get ONE rule: the request arms the leave, the close commits, and the leave runs
 * in an effect that sees the committed close.
 *
 * ⛔ For a SHEET this is not enough: native keeps the sheet's `Modal` mounted for its slide-out after `open` turns
 * false, so the commit is not "gone". A sheet's host leaves from `Sheet`'s `onDismissed` instead.
 *
 * `leave` is read through an Effect Event, so a host that builds it inline (a fresh closure per render, as a
 * navigator's `onDeleted` is) cannot make the effect fire again: it runs once per arming, on the transition.
 *
 * @pattern Observer — an effect on a derived "ready to leave" flag, with the callback held out of the dependency list
 *     by React's Effect Event
 * @sideEffect Calls `leave` (a navigation) from an effect.
 */
import { useEffect, useEffectEvent } from 'react';

/**
 * Call `leave` once the sheet has closed after leaving was asked for.
 *
 * @param armed - Leaving has been asked for (the mutation succeeded, the cook chose the destination).
 * @param open - Whether the sheet that was open at the time is still on screen.
 * @param leave - The navigation to run.
 */
export function useLeaveWhenClosed(armed: boolean, open: boolean, leave: () => void): void {
    const leaving = armed && !open;
    const onLeave = useEffectEvent(leave);

    useEffect(() => {
        if (leaving) {
            onLeave();
        }
    }, [leaving]);
}
