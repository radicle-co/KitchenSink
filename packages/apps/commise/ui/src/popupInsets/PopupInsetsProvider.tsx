'use client';

/**
 * @module @commise/ui/popup-insets — {@link PopupInsetsProvider}: a page publishes the chrome it draws, once.
 *
 * It provides `PopupInsetsContext` to the popups below it, as a bare context provider did, and registers the same
 * reader upward with the snackbar host's registry, one level deeper than the provider around it. So every page that
 * provides insets reports them to the host without page code, and a nested provider (the editor inside the app shell)
 * outranks the one around it. It withdraws its entry on unmount and touches only its own. A page that can tell when its
 * chrome resizes passes a `watch`, which rides in the entry so the host re-places a snackbar that is showing; a new
 * `watch`, like a new reader, re-registers.
 *
 * Presentational glue: props → context providers, plus the one registration effect.
 *
 * @pattern Observer — publishes the page's reader to the host's registry while mounted, and withdraws it
 */
import { useContext, useEffect, useId, type FC, type ReactNode } from 'react';

import { PopupInsetsContext, type PopupInsetsReader } from './popupInsetsContext.js';
import { PopupInsetsDepthContext, PopupInsetsRegistryContext, type PopupInsetsWatch } from './popupInsetsRegistry.js';

/** Props for {@link PopupInsetsProvider}. */
export interface PopupInsetsProviderProps {
    /** Reads the page's chrome extent now. Stable (memoised) where the page can: a new reader re-registers. */
    readonly reader: PopupInsetsReader;
    /** Tells the host when the chrome resizes, so a snackbar that shows follows it. Stable where the page can. */
    readonly watch?: PopupInsetsWatch;
    readonly children: ReactNode;
}

/** Provides a page's chrome reader down to its popups and up to the snackbar host. */
export const PopupInsetsProvider: FC<PopupInsetsProviderProps> = ({ reader, watch, children }) => {
    const registry = useContext(PopupInsetsRegistryContext);
    const depth = useContext(PopupInsetsDepthContext) + 1;
    const token = useId();

    useEffect(
        () => registry?.register({ token, depth, read: reader, ...(watch === undefined ? {} : { watch }) }),
        [registry, token, depth, reader, watch],
    );

    return (
        <PopupInsetsDepthContext value={depth}>
            <PopupInsetsContext value={reader}>{children}</PopupInsetsContext>
        </PopupInsetsDepthContext>
    );
};
