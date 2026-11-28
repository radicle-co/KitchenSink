'use client';

/**
 * @module @commise/ui/snackbar — the web {@link SnackbarHost}: mounted once, above every page (in the app's providers),
 * it gives screens `useSnackbar` and draws the one snackbar on screen. It never remounts with a page, so a snackbar,
 * its timer and its Undo outlive a page change.
 *
 * The status region is ALWAYS mounted, empty at rest, so a message dropped into it is announced (a live region added
 * with its content is not reliably spoken). It is polite and never takes focus, and a page change does not announce
 * it again. Given a `label` it sits in a landmark of that name, which follows `main` in the DOM. It is centred at the
 * foot, the gap above the CURRENT page's bottom chrome: each page's `PopupInsetsProvider` registers its reader with
 * the host's placement store, and the host re-places when one registers, unregisters or a snackbar shows. The pointer
 * or focus inside the snackbar pauses its timer (SC 2.2.1). Across the viewport it is centred over the CURRENT page's
 * content column, which the same registration may state (`PageColumn`), so beside the sidebar it never covers it;
 * where no page states one it spans the viewport.
 *
 * A `subject` (the signed-in user id, `null` signed out, `undefined` while loading) closes the snackbar showing when it
 * changes from a known one, so a snackbar that names a recipe never shows to the next person.
 *
 * It also publishes the showing snackbar's measured height (`SnackbarClearanceContext`), so the floating create button
 * rises above the bar, which is full width below `nav`, instead of sitting under it.
 *
 * While a sheet is open the host hands the snackbar to the sheet's outlet (`SnackbarOutlet`, mounted by `Sheet`) and
 * draws nothing itself, because Radix leaves everything outside an open dialog unreachable. The queue, the timer and
 * the pause stay here, so closing the sheet moves the snackbar back without ending it.
 *
 * `'use client'`: the queue is state and its timer an effect.
 *
 * The orchestration half for the snackbar: it owns the queue and its timer, and the leaf it draws only renders.
 *
 * @pattern Mediator — the host stands between the screens that ask and the one snackbar that shows; the queue's rules
 *     are the pure reducer's (State + Command)
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type FC } from 'react';

import { useRenderedHeight } from '../layout/useRenderedHeight.js';
import { PopupInsetsRegistryContext } from '../popupInsets/popupInsetsRegistry.js';
import type { SnackbarHostProps } from './props.js';
import { SnackbarClearanceContext } from './snackbarClearanceContext.js';
import { SnackbarContext } from './snackbarContext.js';
import { SnackbarOutletContext } from './snackbarOutletContext.js';
import { createSnackbarPlacement } from './snackbarPlacement.js';
import {
    NO_OUTLETS,
    registerOutlet,
    topOutlet,
    unregisterOutlet,
    type SnackbarOutletEntry,
} from './snackbarOutlets.js';
import { UndoSnackbar } from './UndoSnackbar.js';
import { useSnackbarQueue } from './useSnackbarQueue.js';

/** The web snackbar host. */
export const SnackbarHost: FC<SnackbarHostProps> = ({ children, label, subject }) => {
    const queue = useSnackbarQueue();
    const [placement] = useState(createSnackbarPlacement);
    const bottom = useSyncExternalStore(placement.subscribe, placement.getBottom, placement.getBottom);
    const left = useSyncExternalStore(placement.subscribe, placement.getLeft, placement.getLeft);
    const right = useSyncExternalStore(placement.subscribe, placement.getRight, placement.getRight);
    const { current, observeSubject, show } = queue;

    // The person the snackbars belong to: one effect, as the timer provider does it.
    useEffect(() => {
        observeSubject(subject);
    }, [observeSubject, subject]);

    // Stable, so a `show` a page captured before it unmounted still works, and places as it shows.
    const showPlaced = useCallback<typeof show>(
        (input) => {
            placement.place();

            return show(input);
        },
        [placement, show],
    );
    const action = current?.input.action;
    const [region, setRegion] = useState<HTMLElement | null>(null);
    const regionHeight = useRenderedHeight(region, 0);
    const [outlets, setOutlets] = useState(NO_OUTLETS);
    const register = useCallback((entry: SnackbarOutletEntry) => {
        setOutlets((stack) => registerOutlet(stack, entry));

        return () => {
            setOutlets((stack) => unregisterOutlet(stack, entry.token));
        };
    }, []);
    const top = topOutlet(outlets);
    const actionProps =
        action === undefined || current === null
            ? {}
            : {
                  action: {
                      label: action.label,
                      onAction: () => {
                          queue.act(current.id, action);
                      },
                  },
              };
    const snackbar =
        current === null ? null : (
            <UndoSnackbar
                key={current.id}
                message={current.input.message}
                {...actionProps}
                onPause={() => {
                    queue.pause(current.id);
                }}
                onResume={() => {
                    queue.resume(current.id);
                }}
            />
        );

    const api = useMemo(() => ({ show: showPlaced, withdraw: queue.withdraw }), [showPlaced, queue.withdraw]);

    const statusRegion = (
        <div
            ref={setRegion}
            role="status"
            className="pointer-events-none fixed z-50 flex justify-center px-4"
            style={{ bottom, left, right }}
        >
            {top === undefined ? snackbar : null}
        </div>
    );

    return (
        <SnackbarContext value={api}>
            {/* The page providers below register their chrome here, and the snackbar follows the current page's. */}
            <PopupInsetsRegistryContext value={placement}>
                {/* The measured height, or 0 when nothing shows, so the floating create button can rise above it. */}
                <SnackbarClearanceContext value={current === null ? 0 : regionHeight}>
                    {/* An open sheet draws the snackbar in its outlet: outside it, Radix leaves it unreachable. */}
                    <SnackbarOutletContext value={{ register, top, snackbar }}>{children}</SnackbarOutletContext>
                </SnackbarClearanceContext>
            </PopupInsetsRegistryContext>
            {/* Named, the always-mounted status sits in a landmark that follows `main` in the DOM, so Tab from the
                page's last control reaches the Undo. The snackbar itself never takes focus. */}
            {label === undefined ? statusRegion : <section aria-label={label}>{statusRegion}</section>}
        </SnackbarContext>
    );
};
