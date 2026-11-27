/**
 * @module @commise/ui/snackbar — the snackbar's placement store: where the host draws the snackbar, as the current
 * page's chrome says.
 *
 * The page providers (`PopupInsetsProvider`) register an entry here, with a token, a depth and a reader. The top entry
 * is picked by the same rule as the outlets (`topEntry`): the deepest provider, the latest among equals. The snackbar
 * sits the gap above that page's bottom chrome, and at the base gap when no page provides any. Across the viewport it
 * sits over the content column of the deepest entry that states one (`PageColumn`), and spans the viewport when none does.
 *
 * It re-places when an entry registers or unregisters, when `place()` is called as a snackbar shows, and when an
 * entry's `watch` says its chrome resized. A reader measures the page, so it is read only then, never from
 * `getBottom`, which React calls during render. The watch starts when the entry registers and stops when it withdraws,
 * so the store holds no listener of its own. It follows the chrome's SIZE only: a bar that moves without resizing (the
 * editor's bar leaving the viewport's foot as the page scrolls, or a viewport that changes height) is read again at
 * the next of the events above.
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
    /** The offset from the viewport's left and right edges to the page's content column, in CSS px. Never reads a page. */
    readonly getLeft: () => number;
    readonly getRight: () => number;
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
    let left = 0;
    let right = 0;
    const listeners = new Set<() => void>();

    const place = (): void => {
        const top = topEntry(stack);
        // The column is ranked apart from the chrome, by the same rule over the entries that state one.
        const column = topEntry(stack.filter((candidate) => candidate.column !== undefined))?.column?.();
        const next = (top === undefined ? 0 : top.read().bottom) + SNACKBAR_GAP;
        const nextLeft = column?.left ?? 0;
        const nextRight = column?.right ?? 0;

        if (next === bottom && nextLeft === left && nextRight === right) {
            return;
        }

        bottom = next;
        left = nextLeft;
        right = nextRight;
        listeners.forEach((listener) => {
            listener();
        });
    };

    return {
        getBottom: () => bottom,
        getLeft: () => left,
        getRight: () => right,
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        place,
        register: (entry) => {
            stack = registerOutlet(stack, entry);
            const stopWatching = entry.watch?.(place);
            place();

            return () => {
                stopWatching?.();
                stack = unregisterOutlet(stack, entry.token);
                place();
            };
        },
    };
}
