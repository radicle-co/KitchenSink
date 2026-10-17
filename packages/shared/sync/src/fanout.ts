/**
 * @module @kitchensink/sync — a fan-out: one value to many listeners, with each listener's failure isolated and
 * reported to the subscriber that owns it.
 *
 * ⛔ ONE LISTENER'S BUG MUST NOT REACH THE PUBLISHER OR THE OTHER LISTENERS (a throw inside a drain would reject the
 * pass mid-queue, the rest unsent), AND IT MUST NOT VANISH. The publisher cannot say what a failed listener means, so
 * the SUBSCRIBER passes the sink its failures go to (the app's error reporter). A listener subscribed with no sink is
 * isolated and unreported, which is a choice the subscriber makes in the open.
 *
 * @pattern Observer — the subscribe/publish pair, with the Observer's usual weakness (a bad observer breaks the
 *     subject) closed in one place instead of hand-copied at each publisher.
 */

/** Where a listener's own failure goes. */
export type FaultSink = (error: unknown) => void;

/** A fan-out of values of type `T`. */
export interface Fanout<T> {
    /** Hear every published value. Returns the unsubscribe. `onFault` receives what `listener` throws. */
    readonly subscribe: (listener: (value: T) => void, onFault?: FaultSink) => () => void;
    /** Tell every current subscriber `value`. Never throws. */
    readonly publish: (value: T) => void;
}

/**
 * A new fan-out with no subscribers.
 *
 * @returns The fan-out. Pure construction; the returned functions mutate its own subscriber set.
 */
export function createFanout<T>(): Fanout<T> {
    const subscribers = new Set<{ readonly listener: (value: T) => void; readonly onFault: FaultSink | undefined }>();

    return {
        subscribe: (listener, onFault) => {
            const subscriber = { listener, onFault };

            subscribers.add(subscriber);

            return () => {
                subscribers.delete(subscriber);
            };
        },
        publish: (value) => {
            for (const subscriber of [...subscribers]) {
                try {
                    subscriber.listener(value);
                } catch (error) {
                    try {
                        subscriber.onFault?.(error);
                    } catch {
                        // A sink that throws has nowhere further to report; the fan-out must still reach the rest.
                    }
                }
            }
        },
    };
}
