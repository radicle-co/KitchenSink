import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SNACKBAR_MS } from '../props.js';
import { INITIAL_SNACKBAR_STATE, msUntilExpiry, snackbarReducer, type SnackbarState } from '../snackbarQueue.js';

/**
 * The snackbar queue — a pure reducer that owns the ONE-AT-A-TIME rule and the timer's arithmetic; the host only
 * dispatches and runs what the reducer has settled.
 */
const show = (state: SnackbarState, message: string, now: number, extra: object = {}): SnackbarState =>
    snackbarReducer(state, { type: 'show', input: { message, ...extra }, now });

describe('snackbarReducer', () => {
    it('shows a snackbar, running from now for its default duration', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'Removed Pasta', 1000);

        expect(state.current?.input.message).toBe('Removed Pasta');
        expect(state.current?.remainingMs).toBe(DEFAULT_SNACKBAR_MS);
        expect(state.current?.runningSince).toBe(1000);
        expect(state.settled).toStrictEqual([]);
    });

    it('runs for the duration a screen asks for', () => {
        expect(show(INITIAL_SNACKBAR_STATE, 'Saved', 0, { durationMs: 3000 }).current?.remainingMs).toBe(3000);
    });

    it('commits the snackbar a new one replaces, before showing the new one', () => {
        const onTimeout = vi.fn();
        const first = show(INITIAL_SNACKBAR_STATE, 'Removed Pasta', 0, { onTimeout });
        const second = show(first, 'Removed Soup', 2000);

        expect(second.current?.input.message).toBe('Removed Soup');
        expect(second.settled.map((entry) => entry.input.message)).toStrictEqual(['Removed Pasta']);
        expect(second.current?.id).not.toBe(first.current?.id);
    });

    it('commits a snackbar that expires, and only the one that is showing', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'Removed Pasta', 0);
        const id = state.current?.id ?? -1;

        expect(snackbarReducer(state, { type: 'expire', id: id + 1 })).toBe(state);

        const expired = snackbarReducer(state, { type: 'expire', id });

        expect(expired.current).toBeNull();
        expect(expired.settled.map((entry) => entry.id)).toStrictEqual([id]);
    });

    it('closes without committing when its action is taken', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'Removed Pasta', 0);
        const acted = snackbarReducer(state, { type: 'act', id: state.current?.id ?? -1 });

        expect(acted.current).toBeNull();
        expect(acted.settled).toStrictEqual([]);
    });

    it('pauses with the time it has left, and resumes from then', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'Removed Pasta', 1000);
        const id = state.current?.id ?? -1;
        const paused = snackbarReducer(state, { type: 'pause', id, now: 3500 });

        expect(paused.current?.remainingMs).toBe(DEFAULT_SNACKBAR_MS - 2500);
        expect(paused.current?.runningSince).toBeNull();

        const resumed = snackbarReducer(paused, { type: 'resume', id, now: 10_000 });

        expect(resumed.current?.runningSince).toBe(10_000);
        expect(resumed.current?.remainingMs).toBe(DEFAULT_SNACKBAR_MS - 2500);
    });

    it('ignores a second pause, and a resume while running', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'Removed Pasta', 0);
        const id = state.current?.id ?? -1;
        const paused = snackbarReducer(state, { type: 'pause', id, now: 1000 });

        expect(snackbarReducer(paused, { type: 'pause', id, now: 4000 })).toBe(paused);
        expect(snackbarReducer(state, { type: 'resume', id, now: 4000 })).toBe(state);
    });

    it('lets the host forget the commits it has run', () => {
        const state = show(show(INITIAL_SNACKBAR_STATE, 'A', 0), 'B', 1);
        const [settled] = state.settled;

        expect(snackbarReducer(state, { type: 'drained', ids: [settled?.id ?? -1] }).settled).toStrictEqual([]);
    });
});

describe('msUntilExpiry', () => {
    it('is the time left on a running snackbar', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'A', 1000);

        expect(msUntilExpiry(state.current, 2500)).toBe(DEFAULT_SNACKBAR_MS - 1500);
    });

    it('is never negative', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'A', 0);

        expect(msUntilExpiry(state.current, 60_000)).toBe(0);
    });

    it('is null while paused, and with nothing showing', () => {
        const state = show(INITIAL_SNACKBAR_STATE, 'A', 0);
        const paused = snackbarReducer(state, { type: 'pause', id: state.current?.id ?? -1, now: 10 });

        expect(msUntilExpiry(paused.current, 20)).toBeNull();
        expect(msUntilExpiry(null, 20)).toBeNull();
    });
});
