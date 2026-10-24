/**
 * @module @commise/ui/scroll-host — the section-change event both `ScrollHost` leaves raise from their scroll handler.
 * A consumer that must ACT on a change (the editor's section-change checkpoint) subscribes here, so it never relays
 * `current` through a state counter and an effect (staff-code-quality REACT-04). A consumer that only DRAWS the section
 * reads `current` instead.
 *
 * @pattern Observer — the host is the subject; `subscribe` returns the unsubscribe
 */

/** A section change: the scroll spy's section now, and the one before it (`undefined` before the first report). */
export type CurrentChangeListener = (current: string | undefined, previous: string | undefined) => void;

/** The subject a host owns for its whole life. */
export interface CurrentChangeSubject {
    /** Subscribes a listener. @returns The unsubscribe. */
    readonly subscribe: (listener: CurrentChangeListener) => () => void;
    /** Tells every listener of a change. Called only from an event handler, never during render. @sideEffect */
    readonly notify: CurrentChangeListener;
}

/**
 * A new subject with no listeners.
 *
 * @returns The subject. @sideEffect Its `notify` calls the listeners.
 */
export function createCurrentChangeSubject(): CurrentChangeSubject {
    const listeners = new Set<CurrentChangeListener>();

    return {
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        notify: (current, previous) => {
            for (const listener of listeners) {
                listener(current, previous);
            }
        },
    };
}
