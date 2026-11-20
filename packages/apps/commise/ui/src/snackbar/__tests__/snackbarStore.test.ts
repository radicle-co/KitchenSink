/**
 * The snackbar store and the targeted withdraw. A fake clock stands in for `Date.now`, and nothing here renders. The
 * store applies the pure reducer synchronously, so a handler can show and withdraw in one breath.
 */
import { describe, expect, it, vi } from 'vitest';

import { createSnackbarStore } from '../snackbarStore.js';

function setup() {
    const clock = { now: 0 };
    const store = createSnackbarStore(() => clock.now);

    return { store, clock };
}

/** Runs what a host runs for a commit: each settled snackbar's `onTimeout`, then drains them. */
function runSettled(store: ReturnType<typeof createSnackbarStore>): void {
    for (const entry of store.getState().settled) {
        entry.input.onTimeout?.();
    }

    store.dispatch({ type: 'drained', ids: store.getState().settled.map((entry) => entry.id) });
}

describe('withdraw is targeted', () => {
    it('a replaced handle answers undefined and leaves the snackbar now showing, which still commits', () => {
        const { store, clock } = setup();
        const onTimeoutB = vi.fn();
        const handleA = store.show({ message: 'A' });
        store.show({ message: 'B', onTimeout: onTimeoutB });
        const before = store.getState();

        expect(store.withdraw(handleA)).toBeUndefined();
        expect(store.getState()).toBe(before);
        expect(store.getState().current?.input.message).toBe('B');

        clock.now = 6000;
        const current = store.getState().current;
        store.dispatch({ type: 'expire', id: current?.id ?? -1 });
        runSettled(store);

        expect(onTimeoutB).toHaveBeenCalledTimes(1);
    });

    it('answers undefined with nothing showing, and for a snackbar that timed out or was acted on', () => {
        const { store } = setup();
        const stale = store.show({ message: 'A' });

        store.dispatch({ type: 'expire', id: store.getState().current?.id ?? -1 });

        expect(store.withdraw(stale)).toBeUndefined();

        const acted = store.show({ message: 'B' });
        store.dispatch({ type: 'act', id: store.getState().current?.id ?? -1 });

        expect(store.withdraw(acted)).toBeUndefined();
        expect(store.withdraw({ snackbar: true })).toBeUndefined();
    });

    it('answers undefined the second time', () => {
        const { store } = setup();
        const handle = store.show({ message: 'A' });

        expect(store.withdraw(handle)).toBe(6000);
        expect(store.withdraw(handle)).toBeUndefined();
    });

    it('gives a different handle each time, and a handle from another store matches nothing', () => {
        const first = setup().store;
        const second = setup().store;
        const handleOne = first.show({ message: 'A' });
        const handleTwo = first.show({ message: 'B' });
        const other = second.show({ message: 'C' });

        expect(handleOne).not.toBe(handleTwo);
        expect(first.withdraw(other)).toBeUndefined();
        expect(first.getState().current?.input.message).toBe('B');
    });

    it('names a showing, not its input: the first handle of one input object shown twice leaves the second showing', () => {
        const { store } = setup();
        const input = { message: 'A' };
        const first = store.show(input);
        const second = store.show(input);

        expect(store.withdraw(first)).toBeUndefined();
        expect(store.getState().current?.handle).toBe(second);
        expect(store.withdraw(second)).toBe(6000);
    });
});

describe('the remaining time excludes paused time', () => {
    it('counts only the running seconds: 6000 ms, 1000 run, paused 5000, 1000 run, leaves 4000', () => {
        const { store, clock } = setup();
        const handle = store.show({ message: 'A' });
        const id = store.getState().current?.id ?? -1;

        clock.now = 1000;
        store.dispatch({ type: 'pause', id, now: clock.now });
        clock.now = 6000;
        store.dispatch({ type: 'resume', id, now: clock.now });
        clock.now = 7000;

        expect(store.withdraw(handle)).toBe(4000);
    });

    it('withdrawn while paused gives the time banked at the pause', () => {
        const { store, clock } = setup();
        const handle = store.show({ message: 'A' });
        const id = store.getState().current?.id ?? -1;

        clock.now = 1000;
        store.dispatch({ type: 'pause', id, now: clock.now });
        clock.now = 30_000;

        expect(store.withdraw(handle)).toBe(5000);
    });
});

describe('a withdrawn snackbar runs neither callback', () => {
    it('not its onTimeout and not its action, even after expiry, a later show, or the drain', () => {
        const { store, clock } = setup();
        const onTimeout = vi.fn();
        const onAction = vi.fn();
        const handle = store.show({ message: 'A', onTimeout, action: { label: 'Undo', onAction } });

        expect(store.withdraw(handle)).toBe(6000);

        clock.now = 60_000;
        runSettled(store);
        store.show({ message: 'B' });
        runSettled(store);

        expect(store.getState().settled).toEqual([]);
        expect(onTimeout).not.toHaveBeenCalled();
        expect(onAction).not.toHaveBeenCalled();
    });
});

describe('the store notifies only on a change', () => {
    it('tells a subscriber about a show and a withdraw, and stays quiet for a withdraw that does nothing', () => {
        const { store } = setup();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        const handle = store.show({ message: 'A' });

        expect(listener).toHaveBeenCalledTimes(1);

        store.withdraw(handle);
        store.withdraw(handle);

        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        store.show({ message: 'B' });

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('stays quiet for an action that changes nothing', () => {
        const { store } = setup();
        const listener = vi.fn();
        store.subscribe(listener);
        store.show({ message: 'A' });

        store.dispatch({ type: 'act', id: -1 });
        store.dispatch({ type: 'pause', id: -1, now: 0 });

        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('act, pause and resume read the store clock', () => {
    it('a pause and a resume bank and restart the time by the injected clock, not the wall clock', () => {
        const { store, clock } = setup();
        const handle = store.show({ message: 'A' });
        const id = store.getState().current?.id ?? -1;

        clock.now = 2_000;
        store.pause(id);
        clock.now = 50_000;
        store.resume(id);
        clock.now = 51_000;

        expect(store.withdraw(handle)).toBe(3_000);
    });

    it('a withdraw after a pause that landed after the snackbar was due answers zero, never a negative', () => {
        const { store, clock } = setup();
        const handle = store.show({ message: 'A' });
        const id = store.getState().current?.id ?? -1;

        clock.now = 60_000;
        store.pause(id);

        expect(store.withdraw(handle)).toBe(0);
    });

    it('act closes the snackbar without committing it, then runs the action', () => {
        const { store } = setup();
        const onTimeout = vi.fn();
        const onAction = vi.fn();
        store.show({ message: 'A', onTimeout });
        const id = store.getState().current?.id ?? -1;

        store.act(id, { label: 'Undo', onAction });
        runSettled(store);

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('act closes before the action runs, so a snackbar the action shows never commits the old one', () => {
        const { store } = setup();
        const onTimeoutA = vi.fn();
        store.show({ message: 'A', onTimeout: onTimeoutA });
        const current = store.getState().current;

        if (current === null) {
            throw new Error('A is not showing');
        }

        store.act(current.id, { label: 'Undo', onAction: () => store.show({ message: 'B' }) });
        runSettled(store);

        expect(onTimeoutA).not.toHaveBeenCalled();
        expect(store.getState().current?.input.message).toBe('B');
    });
});
