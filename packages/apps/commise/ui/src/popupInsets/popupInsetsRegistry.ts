/**
 * @module @commise/ui/popup-insets — how a page's chrome reader reaches the snackbar host ABOVE it.
 *
 * `PopupInsetsContext` carries a reader DOWN to the popups inside a page. A snackbar host that lives above every page
 * needs the opposite channel: the page's current reader, UP. Each provider registers an entry (a token, how deeply
 * providers nest, and its reader) with the registry the host provides, and withdraws it when it unmounts. The host
 * picks the top entry, so a snackbar always follows the CURRENT page's chrome and never the page that raised it.
 *
 * @pattern Observer — the provider publishes its entry to the host's registry and withdraws it on unmount
 */
import { createContext } from 'react';

import type { PopupInsetsReader } from './popupInsetsContext.js';

/** One provider's entry: its token, how deep it is nested, and the reader that gives its chrome's extent. */
export interface PopupInsetsEntry {
    readonly token: string;
    /** 1 for a page's provider, 2 for one inside it, and so on. */
    readonly depth: number;
    readonly read: PopupInsetsReader;
}

/** What the host offers the providers below it. */
export interface PopupInsetsRegistry {
    /** Adds an entry. Returns the withdrawal, which removes only this entry. */
    readonly register: (entry: PopupInsetsEntry) => () => void;
}

/** The host's registry, or `undefined` where no host is above (the provider then only provides). */
export const PopupInsetsRegistryContext = createContext<PopupInsetsRegistry | undefined>(undefined);

/** How many providers enclose the reader: 0 outside any. */
export const PopupInsetsDepthContext = createContext(0);
