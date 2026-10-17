/**
 * @module @kitchensink/sync — the drain lane: one drain at a time per outbox, and the NEWEST drain asked for runs next.
 *
 * ⛔ THE RE-RUN IS THE PASS ASKED FOR LAST, NEVER THE ONE THAT WAS RUNNING. A request made while a pass runs replaces
 * any re-run still waiting, so the re-run carries the caller's current sender and session. Re-running the running
 * pass's own closure would, after a change of cook, drain the previous cook's outbox again and never the new cook's.
 *
 * ⛔ ONE LANE PER OUTBOX, KEYED EXACTLY AS `outboxMutatorFor` IS. A cook's drain never waits behind another
 * cook's request on the wire, and a provider that remounts while a request is out joins the lane already running
 * instead of starting a second drain of the same outbox beside it. Duplicate SENDS are not this lane's job — the
 * journal's `claim` already refuses a record that is on the wire — the lane keeps the order serial (`drain` is serial
 * by decision) and makes sure a drain asked for is never dropped.
 *
 * @pattern Coalescing single-flight (trailing edge) — one runner per key; requests during a run collapse into one
 *     re-run with the latest work.
 */
import type { OutboxStore } from './outboxStore.js';

/** One drain of an outbox. A pass should not reject; one that does ends only itself. */
export type DrainPass = () => Promise<void>;

/** The one place an outbox's drains run. */
export interface DrainLane {
    /**
     * Run `pass` now if the lane is idle; otherwise run it once the running pass ends, in place of any pass asked for
     * before it that has not started. Resolves once the lane is idle again. Never rejects.
     */
    readonly request: (pass: DrainPass) => Promise<void>;
}

/**
 * A new, idle lane.
 *
 * @returns The lane. @sideEffect Its `request` runs the passes it is given.
 */
export function createDrainLane(): DrainLane {
    let waiting: DrainPass | undefined;
    let running: Promise<void> | undefined;

    /** Run passes until none is waiting. @sideEffect Runs the passes. */
    const start = (): Promise<void> => {
        let markIdle: () => void = () => undefined;
        const idle = new Promise<void>((resolve) => {
            markIdle = resolve;
        });

        // ⛔ SET BEFORE THE FIRST PASS BEGINS, so a pass that asks for another from its own synchronous part finds the
        // lane running and is queued, not started beside it.
        running = idle;

        void (async () => {
            // ⛔ The check of `waiting` and the release of `running` are ONE synchronous step after the last await, so a
            // request cannot land between them and find the lane neither running nor idle.
            while (waiting !== undefined) {
                const pass = waiting;

                waiting = undefined;

                try {
                    await pass();
                } catch {
                    // A pass's own failure is its caller's to handle; the lane's job is that the next pass still runs.
                }
            }

            running = undefined;
            markIdle();
        })();

        return idle;
    };

    return {
        request: (pass) => {
            waiting = pass;

            return running ?? start();
        },
    };
}

/** One lane per store and subject, for as long as the store is alive. */
const lanes = new WeakMap<OutboxStore, Map<string, DrainLane>>();

/**
 * THE lane for a user's outbox on a store.
 *
 * @param store - The platform adapter.
 * @param subject - The IdP subject that namespaces the outbox.
 * @returns The same lane every time for the same pair. @sideEffect Caches it on the store.
 */
export function drainLaneFor(store: OutboxStore, subject: string): DrainLane {
    const bySubject = lanes.get(store) ?? new Map<string, DrainLane>();
    const existing = bySubject.get(subject);

    if (existing !== undefined) {
        return existing;
    }

    const created = createDrainLane();

    bySubject.set(subject, created);
    lanes.set(store, bySubject);

    return created;
}
