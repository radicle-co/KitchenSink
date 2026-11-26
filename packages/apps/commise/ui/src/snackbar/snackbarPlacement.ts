/**
 * @module @commise/ui/snackbar — the snackbar's placement store: where the host draws the snackbar, as the current
 * page's chrome says.
 *
 * The page providers (`PopupInsetsProvider`) register an entry here, with a token, a depth and a reader. The top entry
 * is picked by the same rule as the outlets (`topEntry`): the deepest provider, the latest among equals. The snackbar
 * sits the gap above that page's bottom chrome, and at the base gap when no page provides any.
 *
 * It re-places when an entry registers or unregisters, and when `place()` is called as a snackbar shows. A reader
 * measures the page, so it is read only then, never from `getBottom`, which React calls during render. A chrome that
 * resizes while a snackbar shows is not re-read until the next of those: no worse than the snapshot it replaces.
 *
 * @pattern Observer — a store of the page entries, read by the host through `useSyncExternalStore`
 */
import type { PopupInsetsEntry, PopupInsetsRegistry } from '../popupInsets/popupInsetsRegistry.js';
import { SNACKBAR_GAP } from './props.js';
import { registerOutlet, topEntry, unregisterOutlet, type SnackbarOutletStack } from './snackbarOutlets.js';

/** The placement store. It is the registry the page providers register with. */
export interface SnackbarPlacement extends PopupInsetsRegistry {
    /** The offset from the viewport's foot, in CSS px. Never reads a page. */
    readonly getBottom: () => number;
    readonly subscribe: (listener: () => void) => () => void;
    /** Re-reads the top page's chrome. Called as a snackbar shows. */
    readonly place: () => void;
}

/**
 * A placement store for one host.
 *
 * @returns The store.
 * @sideEffect Holds the registered entries and the offset, and notifies its subscribers. Reads a page's reader when it
 *     re-places.
 */
export function createSnackbarPlacement(): SnackbarPlacement {
    let stack: SnackbarOutletStack<PopupInsetsEntry> = [];
    let bottom = SNACKBAR_GAP;
    const listeners = new Set<() => void>();

    const place = (): void => {
        const top = topEntry(stack);
        const next = (top === undefined ? 0 : top.read().bottom) + SNACKBAR_GAP;

        if (next === bottom) {
            return;
        }

        bottom = next;
        listeners.forEach((listener) => {
            listener();
        });
    };

    return {
        getBottom: () => bottom,
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        place,
        register: (entry) => {
            stack = registerOutlet(stack, entry);
            place();

            return () => {
                stack = unregisterOutlet(stack, entry.token);
                place();
            };
        },
    };
}
