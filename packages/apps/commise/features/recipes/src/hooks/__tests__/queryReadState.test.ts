/**
 * The one rule for what a TanStack read shows before it settles (design §S13 P9, §S8.6, §S16 "States").
 */
import { describe, expect, it } from 'vitest';

import { queryReadState } from '../queryReadState.js';

describe('queryReadState', () => {
    it('is settled, carrying the value, once there is something to show, whatever a refetch is doing', () => {
        expect(queryReadState({ value: ['row'], failed: true, fetchStatus: 'paused' }, true)).toEqual({
            kind: 'settled',
            value: ['row'],
        });
    });

    it('is offline for a parked read while the app has focus', () => {
        expect(queryReadState({ value: undefined, failed: false, fetchStatus: 'paused' }, true)).toEqual({
            kind: 'offline',
        });
    });

    it('is still loading for a parked read while the app has no focus: TanStack pauses for focus too', () => {
        expect(queryReadState({ value: undefined, failed: false, fetchStatus: 'paused' }, false)).toEqual({
            kind: 'loading',
        });
    });

    it('is loading while a fetch runs, even after a failure (Try again shows the read starting)', () => {
        expect(queryReadState({ value: undefined, failed: true, fetchStatus: 'fetching' }, true)).toEqual({
            kind: 'loading',
        });
    });

    it('is failed once an unsettled read stops, and loading before it starts', () => {
        expect(queryReadState({ value: undefined, failed: true, fetchStatus: 'idle' }, true)).toEqual({
            kind: 'failed',
        });
        expect(queryReadState({ value: undefined, failed: false, fetchStatus: 'idle' }, true)).toEqual({
            kind: 'loading',
        });
    });
});
