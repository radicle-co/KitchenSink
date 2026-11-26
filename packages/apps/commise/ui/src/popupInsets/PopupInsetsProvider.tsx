'use client';

/**
 * @module @commise/ui/popup-insets — {@link PopupInsetsProvider}: a page publishes the chrome it draws, once.
 *
 * It provides `PopupInsetsContext` to the popups below it, as a bare context provider did, and registers the same
 * reader upward with the snackbar host's registry, one level deeper than the provider around it. So every page that
 * provides insets reports them to the host without page code, and a nested provider (the editor inside the app shell)
 * outranks the one around it. It withdraws its entry on unmount and touches only its own.
 *
 * Presentational glue: props → context providers, plus the one registration effect.
 *
 * @pattern Observer — publishes the page's reader to the host's registry while mounted, and withdraws it
 */
import { useContext, useEffect, useId, type FC, type ReactNode } from 'react';

import { PopupInsetsContext, type PopupInsetsReader } from './popupInsetsContext.js';
import { PopupInsetsDepthContext, PopupInsetsRegistryContext } from './popupInsetsRegistry.js';

/** Props for {@link PopupInsetsProvider}. */
export interface PopupInsetsProviderProps {
    /** Reads the page's chrome extent now. Stable (memoised) where the page can: a new reader re-registers. */
    readonly reader: PopupInsetsReader;
    readonly children: ReactNode;
}

/** Provides a page's chrome reader down to its popups and up to the snackbar host. */
export const PopupInsetsProvider: FC<PopupInsetsProviderProps> = ({ reader, children }) => {
    const registry = useContext(PopupInsetsRegistryContext);
    const depth = useContext(PopupInsetsDepthContext) + 1;
    const token = useId();

    useEffect(() => registry?.register({ token, depth, read: reader }), [registry, token, depth, reader]);

    return (
        <PopupInsetsDepthContext value={depth}>
            <PopupInsetsContext value={reader}>{children}</PopupInsetsContext>
        </PopupInsetsDepthContext>
    );
};
