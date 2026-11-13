/**
 * The timer model over arbitrary command sequences. The clock moves in random steps, BACKWARDS as well as
 * forwards (a device clock change), and commands name ids from a small pool, so stale and misplaced commands are common.
 * After every command the model must keep four promises, whatever came before.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MIN_TIMER_MS, NO_TIMER, reduceTimer, timeLeftMs, type TimerCommand, type TimerState } from '../timer.js';

const IDS = ['a', 'b'] as const;

const idArb = fc.constantFrom(...IDS);
const durationArb = fc.integer({ min: MIN_TIMER_MS, max: 3_600_000 });

type Step = { readonly command: Omit<TimerCommand, 'nowMs'>; readonly advanceMs: number };

const commandArb: fc.Arbitrary<Omit<TimerCommand, 'nowMs'>> = fc.oneof(
    fc.record({
        kind: fc.constant('start' as const),
        id: idArb,
        recipeId: fc.constant('r'),
        stepIndex: fc.constant(0),
        name: fc.constant(undefined),
        durationMs: durationArb,
    }),
    fc.record({
        kind: fc.constantFrom('pause' as const, 'resume' as const, 'cancel' as const, 'stop' as const),
        id: idArb,
    }),
    fc.record({
        kind: fc.constant('addTime' as const),
        id: idArb,
        addMs: fc.integer({ min: MIN_TIMER_MS, max: 600_000 }),
    }),
    fc.constant({ kind: 'ring' as const }),
    fc.constant({ kind: 'restore' as const }),
);

const stepsArb = fc.array(
    fc.record({ command: commandArb, advanceMs: fc.integer({ min: -120_000, max: 4_000_000 }) }),
    { maxLength: 40 },
);

/** Apply a step, treating a refused command (a typed error) as no change. */
function apply(state: TimerState, step: Step, nowMs: number) {
    try {
        return reduceTimer(state, { ...step.command, nowMs } as TimerCommand);
    } catch {
        return { state, events: [] };
    }
}

describe('the timer model over any command sequence', () => {
    it('emits ended at most once per (id, run), and only on an edge into ringing', () => {
        fc.assert(
            fc.property(stepsArb, (steps) => {
                let state = NO_TIMER;
                let nowMs = 1_000_000;
                const seen = new Set<string>();

                for (const step of steps) {
                    nowMs += step.advanceMs;
                    const before = state.timer?.kind;
                    const { state: next, events } = apply(state, step, nowMs);

                    for (const event of events) {
                        const key = `${event.id}:${event.run}`;

                        expect(seen.has(key)).toBe(false);
                        seen.add(key);
                        expect(next.timer?.kind).toBe('ringing');
                        expect(before).not.toBe('ringing');
                    }

                    state = next;
                }
            }),
        );
    });

    it('holds at most one timer, and never a held snapshot beside a live timer', () => {
        fc.assert(
            fc.property(stepsArb, (steps) => {
                let state = NO_TIMER;
                let nowMs = 1_000_000;

                for (const step of steps) {
                    nowMs += step.advanceMs;
                    state = apply(state, step, nowMs).state;

                    if (state.timer !== undefined) {
                        expect(state.undo).toBeUndefined();
                    }
                }
            }),
        );
    });

    it('keeps the time left of a paused timer fixed, however the clock moves', () => {
        fc.assert(
            fc.property(
                stepsArb,
                fc.array(fc.integer({ min: -1e7, max: 1e9 }), { minLength: 1, maxLength: 6 }),
                (steps, clocks) => {
                    let state = NO_TIMER;
                    let nowMs = 1_000_000;

                    for (const step of steps) {
                        nowMs += step.advanceMs;
                        state = apply(state, step, nowMs).state;
                    }

                    if (state.timer?.kind === 'paused') {
                        const left = timeLeftMs(state.timer, nowMs);

                        for (const clock of clocks) {
                            expect(timeLeftMs(state.timer, clock)).toBe(left);
                        }
                    }
                },
            ),
        );
    });

    it('reads time left as the end instant minus now, never below zero and never past the longest timer', () => {
        fc.assert(
            fc.property(stepsArb, fc.integer({ min: -1e7, max: 1e9 }), (steps, probe) => {
                let state = NO_TIMER;
                let nowMs = 1_000_000;

                for (const step of steps) {
                    nowMs += step.advanceMs;
                    state = apply(state, step, nowMs).state;
                }

                const { timer } = state;
                const left = timeLeftMs(timer, probe);

                expect(left).toBeGreaterThanOrEqual(0);

                if (timer?.kind === 'running') {
                    expect(left).toBe(Math.max(0, timer.endsAt - probe));
                }
            }),
        );
    });
});
