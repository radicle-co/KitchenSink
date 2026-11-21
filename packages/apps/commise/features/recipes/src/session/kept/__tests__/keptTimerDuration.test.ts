/**
 * The kept layer's contract is that a refusal is an outcome, never a throw. The reducer throws when added time would
 * take a timer past 24 h, so a second tab that adds time to a record already near the limit must get an outcome, and a
 * parked command that hits it on replay must not block the writes after it.
 */
import { MAX_TIMER_MS } from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import { applyKeptCommand, type KeptCommand } from '../keptCommands.js';
import { replay } from '../chooseBase.js';

import { HOUR, iso, makeDoc, makeTimer, T0, timerId } from '../__fixtures__/keptFixtures.js';

const MINUTE = 60_000;
const NOW = T0 + HOUR / 2;
/** A timer that already holds 23 h 59 m. */
const NEAR_LIMIT = makeTimer({ durationMs: MAX_TIMER_MS - MINUTE, endsAt: iso(T0 + 2 * HOUR) });
const ADD_TWO_MINUTES: KeptCommand = {
    type: 'timer',
    command: { kind: 'addTime', id: timerId(1), run: 1, addMs: 2 * MINUTE, nowMs: NOW },
    undo: undefined,
};

describe('added time past 24 h', () => {
    it('is an outcome, not a throw: the record refuses it with its reason', () => {
        const doc = makeDoc({ timers: [NEAR_LIMIT] });

        expect(applyKeptCommand(doc, ADD_TWO_MINUTES, iso(NOW))).toEqual({ kind: 'refused', reason: 'duration' });
    });

    it('still adds time that fits', () => {
        const doc = makeDoc({ timers: [NEAR_LIMIT] });
        const fits: KeptCommand = {
            ...ADD_TWO_MINUTES,
            command: { kind: 'addTime', id: timerId(1), run: 1, addMs: MINUTE, nowMs: NOW },
        };

        expect(applyKeptCommand(doc, fits, iso(NOW)).kind).toBe('applied');
    });

    it('does not block a parked command list: replay skips it and applies the ones after it', () => {
        const doc = makeDoc({ timers: [NEAR_LIMIT] });
        const pause: KeptCommand = {
            type: 'timer',
            command: { kind: 'pause', id: timerId(1), run: 1, nowMs: NOW },
            undo: undefined,
        };
        const replayed = replay(doc, [
            { command: ADD_TWO_MINUTES, at: iso(NOW) },
            { command: pause, at: iso(NOW) },
        ]);

        expect(replayed.timers[0]).toMatchObject({ state: 'paused', durationMs: MAX_TIMER_MS - MINUTE });
    });
});
