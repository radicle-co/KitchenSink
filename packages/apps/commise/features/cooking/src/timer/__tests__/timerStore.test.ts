/** The store's own contract for React and its listeners (S3a.U3 C3). The clock cases live in the integration tier. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTimerStore } from '../timerStore.js';

const STEP = { recipeId: 'roast', stepIndex: 2, stepDigest: 's1:0000000d', label: undefined } as const;
const MINUTE = 60_000;

beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-11-20T10:00:00.000Z') });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createTimerStore', () => {
    it('starts empty, and a start gives the id the timer holds', () => {
        const store = createTimerStore();

        expect(store.getSnapshot().timers).toEqual([]);

        const id = store.start({ ...STEP, durationMs: 5 * MINUTE });

        expect(store.getSnapshot().timers[0]).toMatchObject({ id, kind: 'running', run: 1 });
        store.dispose();
    });

    it('tells a subscriber once per change, and not after it stops', () => {
        const store = createTimerStore();
        const listener = vi.fn();
        const stop = store.subscribe(listener);

        store.start({ ...STEP, durationMs: 5 * MINUTE });

        expect(listener).toHaveBeenCalledTimes(1);

        stop();
        store.command({ kind: 'cancel', id: store.getSnapshot().timers[0]?.id ?? '', run: 1 });

        expect(listener).toHaveBeenCalledTimes(1);
        store.dispose();
    });

    it('keeps the same snapshot and tells nobody when a command changes nothing', () => {
        const store = createTimerStore();
        const listener = vi.fn();

        store.start({ ...STEP, durationMs: 5 * MINUTE });
        store.subscribe(listener);
        const before = store.getSnapshot();

        store.command({ kind: 'pause', id: 'someone-else', run: 1 });

        expect(store.getSnapshot()).toBe(before);
        expect(listener).not.toHaveBeenCalled();
        store.dispose();
    });

    it('tells an ended listener once, and not after it stops', () => {
        const store = createTimerStore();
        const heard = vi.fn();
        const stop = store.onEnded(heard);

        store.start({ ...STEP, durationMs: 5_000 });
        vi.advanceTimersByTime(5_000);

        expect(heard).toHaveBeenCalledTimes(1);

        stop();
        store.command({ kind: 'stop', id: store.getSnapshot().timers[0]?.id ?? '', run: 1 });
        store.start({ ...STEP, durationMs: 5_000 });
        vi.advanceTimersByTime(5_000);

        expect(heard).toHaveBeenCalledTimes(1);
        store.dispose();
    });
});
