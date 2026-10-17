/**
 * @module @commise/features-recipes/editor — the editor's one lane to the server.
 *
 * ⛔ ONE SERVER WRITE PER RECIPE AT A TIME. Every update carries an `expectedVersion`, and the version is the one the
 * previous write's answer returned (ADR-0057: "the editor owns the CAS token; the outbox does not rewrite payloads"). An
 * update sent while another is on the wire carries a stale version and 409s against the cook's own write. So a
 * checkpoint that meets a write on the wire is DEFERRED, and the strongest deferred trigger runs once the answer lands.
 * A checkpoint while the write is still queued (not yet claimed) simply replaces it in the outbox — whole drafts, so
 * losslessly — and the lane tracks the new record.
 *
 * Whether the outbox found the slot free, on the wire or parked is decided inside the outbox's serialized mutation
 * (`SyncQueue.submitExclusive`); this reducer only records what the editor was told.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern State machine — a pure reducer over the lane's events (a Single-Flight lane keyed by the record's sequence
 *     number, the Correlation Identifier the outbox replies with)
 */
import type { RecipeFormValues } from '../form/values.js';
import type { CheckpointTrigger } from './checkpointPolicy.js';

/** The write the editor is waiting on. */
export interface OutstandingWrite {
    /** The outbox record's sequence number: how its answer is recognised. */
    readonly seq: number;
    readonly kind: 'create' | 'update';
    /**
     * The draft the record carries — what the server holds once it syncs. `undefined` for a record this editor did not
     * queue ({@link LaneEvent} `tracked`): its body is unknown here, so its answer is adopted as the server states it.
     */
    readonly sent: RecipeFormValues | undefined;
    /**
     * Whether it FINISHES the edit — a Publish, or a published recipe's Save changes: its answer takes the cook to the
     * recipe. A checkpoint does not.
     */
    readonly finishing: boolean;
    /** Whether the outbox parked it: it waits for the cook (a conflict, a refusal, an unknown outcome). */
    readonly parked: boolean;
}

/** The lane. */
export interface LaneState {
    readonly outstanding?: OutstandingWrite;
    /** The strongest checkpoint refused while a write was on the wire, run once its answer lands. */
    readonly deferred?: CheckpointTrigger;
    /**
     * The editor handed off (published, saved, discarded or left): no checkpoint runs again. It lives here, not in
     * React state, because a trigger can arrive in the same tick as the hand-off — navigation announces a leave
     * synchronously, inside the exit — and must see it before the next render does.
     */
    readonly closed?: true;
    /**
     * The outbox is being asked to take a confirmed Discard. No checkpoint runs and no device draft is written
     * meanwhile, for `closed`'s reason. It ends when the Discard finishes (`closed`), is refused because a write is on
     * the wire (`discardRefused`), or storage refused it (`discardFailed`). There is no waiting for a write's answer:
     * the control is unavailable while one is on the wire (owner ruling 2026-10-17).
     */
    readonly discarding?: true;
    /**
     * The outbox's storage refused a confirmed Discard: nothing was queued or dropped, and the draft stays. The confirm
     * shows the failure until the cook tries again (a new `discarding`) or keeps editing (`discardCancelled`).
     */
    readonly discardFailed?: true;
    /** The editor was left (unmounted) while a Discard waited: it finishes with no hand-off, for nobody is there. */
    readonly left?: true;
    /**
     * The cook is leaving: the exit checkpoint ran (×, browser Back, a shell link, the unmount). The address bar stops
     * following the recipe from then on — a create's answer that rewrites the URL meanwhile discards the leave's own
     * navigation (E3). It lives here beside `closed`, for the same reason: the answer can arrive before React renders.
     * Unlike `closed` it is taken back (`stayed`): StrictMode's development replay runs the unmount cleanup at mount.
     */
    readonly leaving?: true;
}

/** What happened to the lane. */
export type LaneEvent =
    | {
          readonly type: 'queued';
          readonly seq: number;
          readonly kind: OutstandingWrite['kind'];
          readonly sent: RecipeFormValues;
          readonly finishing: boolean;
      }
    /**
     * The outbox reported a record of this recipe on the wire that the lane does not hold: another editor of the same
     * recipe queued it (an exit checkpoint, then Back and Forward). The lane waits on it, so its answer is this editor's.
     */
    | { readonly type: 'tracked'; readonly seq: number; readonly kind: OutstandingWrite['kind'] }
    | { readonly type: 'refusedInFlight'; readonly trigger: CheckpointTrigger }
    | { readonly type: 'synced'; readonly seq: number }
    | { readonly type: 'parked'; readonly seq: number }
    | { readonly type: 'withdrawn'; readonly seq: number }
    | { readonly type: 'deferredTaken' }
    | { readonly type: 'closed' }
    | { readonly type: 'discarding' }
    /** The outbox declined the Discard because a write of the recipe is on the wire: nothing was queued or dropped. */
    | { readonly type: 'discardRefused' }
    | { readonly type: 'discardCancelled' }
    | { readonly type: 'discardFailed' }
    | { readonly type: 'left' }
    | { readonly type: 'leaving' }
    | { readonly type: 'stayed' };

/** A lane with nothing outstanding. */
export const EMPTY_LANE: LaneState = {};

/** The triggers, weakest first: a deferred trigger keeps the strongest. */
const TRIGGER_STRENGTH: readonly CheckpointTrigger[] = [
    'typingIdle',
    'fieldBlur',
    'checkpointIdle',
    'sectionChange',
    'appHidden',
    'editorExit',
    'saveChanges',
    'publish',
];

/**
 * The stronger of two triggers: the one whose write asks for more.
 *
 * @param a - A trigger, or none.
 * @param b - A trigger.
 * @returns The stronger. Pure.
 */
export function strongerTrigger(a: CheckpointTrigger | undefined, b: CheckpointTrigger): CheckpointTrigger {
    if (a === undefined) {
        return b;
    }

    return TRIGGER_STRENGTH.indexOf(a) >= TRIGGER_STRENGTH.indexOf(b) ? a : b;
}

/** The lane with nothing outstanding, its deferred trigger kept. Pure. */
function withoutOutstanding(state: LaneState): LaneState {
    const { outstanding: _settled, ...rest } = state;

    return rest;
}

/**
 * The lane after an event.
 *
 * @param state - The lane.
 * @param event - What happened.
 * @returns The new lane; the same object when the event changes nothing. Pure.
 */
export function laneReducer(state: LaneState, event: LaneEvent): LaneState {
    switch (event.type) {
        case 'queued': {
            // A Publish replaced by a later checkpoint before it was sent still finishes: the record that goes out is the
            // newest draft, and the cook asked for it to be published.
            const finishing = event.finishing || (state.outstanding?.finishing ?? false);

            return {
                ...state,
                outstanding: { seq: event.seq, kind: event.kind, sent: event.sent, finishing, parked: false },
            };
        }

        case 'tracked':
            // ⛔ Never over the lane's own write: that one's `sent` is what the server will hold.
            return state.outstanding === undefined
                ? {
                      ...state,
                      outstanding: {
                          seq: event.seq,
                          kind: event.kind,
                          sent: undefined,
                          finishing: false,
                          parked: false,
                      },
                  }
                : state;

        case 'refusedInFlight':
            return { ...state, deferred: strongerTrigger(state.deferred, event.trigger) };

        case 'synced':
        case 'withdrawn':
            return state.outstanding?.seq === event.seq ? withoutOutstanding(state) : state;

        case 'parked':
            if (state.outstanding?.seq !== event.seq) {
                return state;
            }

            return { ...state, outstanding: { ...state.outstanding, parked: true } };

        case 'deferredTaken': {
            const { deferred: _taken, ...rest } = state;

            return rest;
        }

        case 'closed': {
            const { discarding: _done, discardFailed: _failed, ...rest } = state;

            return state.closed === true ? state : { ...rest, closed: true };
        }

        case 'discarding': {
            const { discardFailed: _retried, ...rest } = state;

            return state.closed === true || state.discarding === true ? state : { ...rest, discarding: true };
        }

        case 'discardRefused': {
            const { discarding: _declined, ...rest } = state;

            return state.discarding === true ? rest : state;
        }

        case 'discardCancelled': {
            const { discardFailed: _dismissed, ...rest } = state;

            return state.discardFailed === true ? rest : state;
        }

        case 'discardFailed': {
            const { discarding: _refused, ...rest } = state;

            return state.closed === true ? state : { ...rest, discardFailed: true };
        }

        case 'left':
            return state.left === true ? state : { ...state, left: true };

        case 'leaving':
            return state.leaving === true ? state : { ...state, leaving: true };

        case 'stayed': {
            const { leaving: _stayed, ...rest } = state;

            return state.leaving === true ? rest : state;
        }

        default: {
            const unreachable: never = event;

            return unreachable;
        }
    }
}

/** How many answers for writes the lane has not recorded yet are kept. */
const EARLY_ANSWERS_KEPT = 4;

/** The lane as a store outside React's render cycle (see {@link createLaneStore}). */
export interface LaneStore<A> {
    readonly get: () => LaneState;
    readonly dispatch: (event: LaneEvent) => void;
    readonly subscribe: (listener: () => void) => () => void;
    /** Keep an answer for a record the lane has not recorded (yet): the outbox answered before the submit returned. */
    readonly keepEarly: (seq: number, answer: A) => void;
    /** Be handed a kept answer the moment the lane records its record (`queued`, `tracked`). Returns the unsubscribe. */
    readonly subscribeEarly: (listener: (answer: A) => void) => () => void;
}

/**
 * The lane, held outside React state.
 *
 * ⛔ THE OUTBOX ANSWERS ON ITS OWN SCHEDULE. It drains as soon as a write is queued, so an answer can arrive before React
 * has rendered the lane that names the write; a lane in React state would not recognise its own answer. Held here, a
 * `dispatch` is visible to the next `get` at once, and the editor renders it through `useSyncExternalStore`.
 *
 * An answer can even land before `submitExclusive` has told the editor the record's number; it is kept (a few at most)
 * and taken back when the lane records that number.
 *
 * @returns A lane store, empty. @sideEffect Its `dispatch` notifies subscribers.
 */
export function createLaneStore<A>(): LaneStore<A> {
    let state = EMPTY_LANE;
    const listeners = new Set<() => void>();
    const earlyListeners = new Set<(answer: A) => void>();
    let early: readonly { readonly seq: number; readonly answer: A }[] = [];

    return {
        keepEarly: (seq, answer) => {
            early = [...early.slice(-(EARLY_ANSWERS_KEPT - 1)), { seq, answer }];
        },
        subscribeEarly: (listener) => {
            earlyListeners.add(listener);

            return () => {
                earlyListeners.delete(listener);
            };
        },
        get: () => state,
        dispatch: (event) => {
            const next = laneReducer(state, event);

            if (next !== state) {
                state = next;

                for (const listener of [...listeners]) {
                    listener();
                }
            }

            const recorded = event.type === 'queued' || event.type === 'tracked' ? event.seq : undefined;
            const kept = recorded === undefined ? undefined : early.find((entry) => entry.seq === recorded);

            if (kept !== undefined) {
                early = early.filter((entry) => entry !== kept);

                for (const listener of [...earlyListeners]) {
                    listener(kept.answer);
                }
            }
        },
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
    };
}
