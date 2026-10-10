/**
 * The editor's write lane (slice 7 blueprint): ONE server write per recipe at a time, because each update must carry the
 * version the previous answer returned (ADR-0057: "the editor owns the CAS token"). A checkpoint that meets a write on
 * the wire is remembered, not sent; the strongest such trigger runs once the answer lands.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { EMPTY_LANE, createLaneStore, laneReducer, strongerTrigger, type LaneState } from '../writeLane.js';

const sent = makeFilledRecipeFormValues();
const queued = (seq: number, finishing = false): LaneState =>
    laneReducer(EMPTY_LANE, { type: 'queued', seq, kind: 'update', sent, finishing });

describe('laneReducer', () => {
    it('tracks the queued write, and a coalesced re-submit replaces it (new seq, newest draft)', () => {
        const newer = makeFilledRecipeFormValues({ title: 'Newer' });
        const state = laneReducer(queued(1), { type: 'queued', seq: 2, kind: 'update', sent: newer, finishing: false });

        expect(state).toStrictEqual({
            outstanding: { seq: 2, kind: 'update', sent: newer, finishing: false, parked: false },
        });
    });

    it('a Publish that coalesces into a pending checkpoint still finishes', () => {
        const state = laneReducer(queued(1, true), { type: 'queued', seq: 2, kind: 'update', sent, finishing: false });

        expect(state.outstanding?.finishing).toBe(true);
    });

    it('remembers the strongest trigger refused while the write was on the wire', () => {
        const once = laneReducer(queued(1), { type: 'refusedInFlight', trigger: 'checkpointIdle' });
        const twice = laneReducer(once, { type: 'refusedInFlight', trigger: 'publish' });
        const thrice = laneReducer(twice, { type: 'refusedInFlight', trigger: 'sectionChange' });

        expect(thrice.deferred).toBe('publish');
    });

    it('clears the outstanding write when ITS answer lands, keeping what was deferred for the caller to run', () => {
        const waiting = laneReducer(queued(3), { type: 'refusedInFlight', trigger: 'editorExit' });

        expect(laneReducer(waiting, { type: 'synced', seq: 3 })).toStrictEqual({ deferred: 'editorExit' });
    });

    it('ignores an answer for another record (an older, coalesced-away write)', () => {
        const state = queued(5);

        expect(laneReducer(state, { type: 'synced', seq: 4 })).toBe(state);
        expect(laneReducer(state, { type: 'parked', seq: 4 })).toBe(state);
    });

    it('a parked answer keeps the record outstanding, marked parked, until it is withdrawn', () => {
        const parked = laneReducer(queued(2), { type: 'parked', seq: 2 });

        expect(parked.outstanding?.parked).toBe(true);
        expect(laneReducer(parked, { type: 'withdrawn', seq: 2 })).toStrictEqual({});
    });

    it('closes once the editor hands off, keeping what it held, and stays closed', () => {
        const closed = laneReducer(queued(1), { type: 'closed' });

        expect(closed).toStrictEqual({ ...queued(1), closed: true });
        expect(laneReducer(closed, { type: 'synced', seq: 1 }).closed).toBe(true);
    });

    it('running the deferred trigger consumes it', () => {
        const state = laneReducer(laneReducer(queued(1), { type: 'refusedInFlight', trigger: 'publish' }), {
            type: 'synced',
            seq: 1,
        });

        expect(laneReducer(state, { type: 'deferredTaken' })).toStrictEqual({});
    });
});

describe('strongerTrigger', () => {
    it.each([
        ['publish', 'saveChanges', 'publish'],
        ['saveChanges', 'editorExit', 'saveChanges'],
        ['checkpointIdle', 'editorExit', 'editorExit'],
        ['fieldBlur', 'sectionChange', 'sectionChange'],
        [undefined, 'appHidden', 'appHidden'],
    ] as const)('%s vs %s → %s', (a, b, expected) => {
        expect(strongerTrigger(a, b)).toBe(expected);
        expect(strongerTrigger(b, a ?? b)).toBe(expected);
    });
});

describe('createLaneStore', () => {
    it('shows a dispatch to the next read at once, and tells subscribers only of a change', () => {
        const store = createLaneStore<string>();
        const heard: LaneState[] = [];
        const unsubscribe = store.subscribe(() => heard.push(store.get()));

        store.dispatch({ type: 'queued', seq: 1, kind: 'create', sent, finishing: false });
        expect(store.get().outstanding?.seq).toBe(1);

        // An answer for another record changes nothing, and says nothing.
        store.dispatch({ type: 'synced', seq: 9 });
        expect(heard).toHaveLength(1);

        unsubscribe();
        store.dispatch({ type: 'synced', seq: 1 });
        expect(store.get()).toStrictEqual({});
        expect(heard).toHaveLength(1);
    });
});

describe('createLaneStore — an answer before the record`s number', () => {
    it('hands a kept answer over the moment the lane records that record, and only once', () => {
        const store = createLaneStore<string>();
        const handed: string[] = [];
        store.subscribeEarly((answer) => handed.push(`${answer} @ ${String(store.get().outstanding?.seq)}`));

        store.keepEarly(3, 'answer for 3');
        store.dispatch({ type: 'queued', seq: 4, kind: 'update', sent, finishing: false });
        expect(handed).toEqual([]);

        // The lane already names record 3 when the answer is handed over.
        store.dispatch({ type: 'queued', seq: 3, kind: 'update', sent, finishing: false });
        store.dispatch({ type: 'queued', seq: 3, kind: 'update', sent, finishing: false });
        expect(handed).toEqual(['answer for 3 @ 3']);
    });

    it('keeps only the few most recent', () => {
        const store = createLaneStore<number>();
        const handed: number[] = [];
        store.subscribeEarly((answer) => handed.push(answer));

        for (const seq of [1, 2, 3, 4, 5]) {
            store.keepEarly(seq, seq);
        }

        store.dispatch({ type: 'queued', seq: 1, kind: 'update', sent, finishing: false });
        store.dispatch({ type: 'queued', seq: 5, kind: 'update', sent, finishing: false });
        expect(handed).toEqual([5]);
    });
});

/**
 * The lane across editors of one recipe and through a waiting Discard (findings 1 and 2 of the 2026-10-10 review).
 */
describe('laneReducer — a record another editor queued, and a Discard that waits', () => {
    it('tracks a record it does not hold, with no body of its own', () => {
        expect(laneReducer(EMPTY_LANE, { type: 'tracked', seq: 7, kind: 'create' })).toStrictEqual({
            outstanding: { seq: 7, kind: 'create', sent: undefined, finishing: false, parked: false },
        });
    });

    it.each([
        ['the same', 1],
        ['another', 9],
    ])(
        '⛔ never tracks over its own write (%s record): a Publish on the wire keeps `finishing` and its body',
        (_case, seq) => {
            const publishing = queued(1, true);

            expect(laneReducer(publishing, { type: 'tracked', seq, kind: 'update' })).toBe(publishing);
        },
    );

    it('hands a kept answer over when it tracks that record', () => {
        const store = createLaneStore<string>();
        const handed: string[] = [];
        store.subscribeEarly((answer) => handed.push(answer));

        store.keepEarly(7, 'answer for 7');
        store.dispatch({ type: 'tracked', seq: 7, kind: 'create' });

        expect(handed).toEqual(['answer for 7']);
    });

    it('a Discard can be taken back only while it waits for a create, not while the outbox is being asked', () => {
        const asking = laneReducer(queued(1), { type: 'discarding', phase: 'asking' });
        const waiting = laneReducer(asking, { type: 'discarding', phase: 'waiting' });

        expect(laneReducer(asking, { type: 'discardCancelled' })).toBe(asking);
        expect(laneReducer(waiting, { type: 'discardCancelled' }).discarding).toBeUndefined();
    });

    it('closing ends a Discard, and a closed lane starts none', () => {
        const closed = laneReducer(laneReducer(queued(1), { type: 'discarding', phase: 'waiting' }), {
            type: 'closed',
        });

        expect(closed.discarding).toBeUndefined();
        expect(closed.closed).toBe(true);
        expect(laneReducer(closed, { type: 'discarding', phase: 'asking' })).toBe(closed);
    });
});
