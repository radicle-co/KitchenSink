'use client';

/**
 * @module @commise/features-recipes/hooks — leave a screen only AFTER the confirm dialog that asked for it has closed.
 *
 * It keeps the screen a cook is leaving from changing as it goes. Left in the same tick as the success, the
 * dialog's busy confirm turns idle inside a screen react-native-screens is already removing. On Android a restyle
 * there that moves a view crashes the app (`addViewAt ... The specified child already has a parent`): the library marks
 * the leaving screen's views as transitioning, the open dialog's included, before the restyle is applied, and a
 * transitioning view cannot be moved (react-native-screens#4677). Closed first, the dialog's last change is its
 * removal, which moves nothing. The shared Button no longer moves its children when it turns busy or idle
 * (`nativeFlattenFlips.test.ts`), so that crash is closed at its source; this order keeps the dialog's own restyle off
 * a leaving screen as well. On web the same ordering is merely tidier, and it is the same flow, so both apps get ONE rule: the
 * request arms the leave, the close commits, and the leave runs in an effect that sees the committed close.
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
