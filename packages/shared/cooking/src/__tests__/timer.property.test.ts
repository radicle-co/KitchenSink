/**
 * The timer model over arbitrary command sequences. The clock moves in random steps, BACKWARDS as well as forwards and by
 * more than a day (a device clock change), and commands name timers from the ones started so far, so stale and
 * misplaced commands are common. A caller mints a fresh id for every start it sends, so the generator does too.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isInvalidTimerDurationError, isTimerAlreadyActiveError } from '../errors.js';
import {
    MAX_TIMER_MS,
    MIN_TIMER_MS,
    NO_TIMER,
    reduceTimer,
    timeLeftMs,
    type TimerCommand,
    type TimerEvent,
    type TimerState,
} from '../timer.js';

type Template =
    | { readonly kind: 'start'; readonly durationMs: number }
    | { readonly kind: 'pause' | 'resume' | 'cancel' | 'stop'; readonly pick: number }
    | { readonly kind: 'addTime'; readonly pick: number; readonly addMs: number }
    | { readonly kind: 'ring' | 'restore' };

interface Step {
    readonly template: Template;
    readonly advanceMs: number;
}

const templateArb: fc.Arbitrary<Template> = fc.oneof(
    fc.record({ kind: fc.constant('start' as const), durationMs: fc.integer({ min: MIN_TIMER_MS, max: 3_600_000 }) }),
    fc.record({
        kind: fc.constantFrom('pause' as const, 'resume' as const, 'cancel' as const, 'stop' as const),
        pick: fc.nat(),
    }),
    fc.record({
        kind: fc.constant('addTime' as const),
        pick: fc.nat(),
        addMs: fc.integer({ min: MIN_TIMER_MS, max: 600_000 }),
    }),
    fc.record({ kind: fc.constantFrom('ring' as const, 'restore' as const) }),
);

const stepsArb = fc.array(
    fc.record({ template: templateArb, advanceMs: fc.integer({ min: -2 * MAX_TIMER_MS, max: 4_000_000 }) }),
    { maxLength: 40 },
);

/** Commands as a caller sends them: every start gets a fresh id, and the rest name a timer started so far. */
function commandFor(template: Template, startedSoFar: number, nowMs: number): TimerCommand {
    const pickedId = (pick: number) => `t${pick % (startedSoFar + 1)}`;

    switch (template.kind) {
        case 'start':
            return {
                kind: 'start',
                id: `t${startedSoFar}`,
                recipeId: 'r',
                stepIndex: 0,
                name: undefined,
                durationMs: template.durationMs,
                nowMs,
            };
        case 'ring':
        case 'restore':
            return { kind: template.kind, nowMs };
        case 'addTime':
            return { kind: 'addTime', id: pickedId(template.pick), addMs: template.addMs, nowMs };
        default:
            return { kind: template.kind, id: pickedId(template.pick), nowMs };
    }
}

interface Trace {
    readonly before: TimerState;
    readonly after: TimerState;
    readonly events: readonly TimerEvent[];
    readonly nowMs: number;
}

/** Run the steps, treating only the two typed refusals as "no change". Any other error fails the property. */
function trace(steps: readonly Step[]): readonly Trace[] {
    const out: Trace[] = [];
    let state = NO_TIMER;
    let nowMs = 1_000_000;
    let startedSoFar = 0;

    for (const step of steps) {
        nowMs += step.advanceMs;
        const command = commandFor(step.template, startedSoFar, nowMs);
        let next = { state, events: [] as readonly TimerEvent[] };

        try {
            next = reduceTimer(state, command);

            if (command.kind === 'start') {
                startedSoFar += 1;
            }
        } catch (error) {
            if (!isInvalidTimerDurationError(error) && !isTimerAlreadyActiveError(error)) {
                throw error;
            }
        }

        out.push({ before: state, after: next.state, events: next.events, nowMs });
        state = next.state;
    }

    return out;
}

describe('the timer model over any command sequence', () => {
    it('emits ended at most once per (id, run), only on an edge into ringing', () => {
        fc.assert(
            fc.property(stepsArb, (steps) => {
                const seen = new Set<string>();

                for (const { before, after, events } of trace(steps)) {
                    for (const event of events) {
                        const key = `${event.id}:${event.run}`;

                        expect(seen.has(key)).toBe(false);
                        seen.add(key);
                        expect(after.timer).toMatchObject({ kind: 'ringing', id: event.id, run: event.run });
                        expect(before.timer?.kind).not.toBe('ringing');
                    }
                }
            }),
            { numRuns: 500 },
        );
    });

    it('never holds a snapshot for Undo beside a live timer', () => {
        fc.assert(
            fc.property(stepsArb, (steps) => {
                for (const { after } of trace(steps)) {
                    if (after.timer !== undefined) {
                        expect(after.undo).toBeUndefined();
                    }
                }
            }),
        );
    });

    it('keeps a paused timer at the same time left until something resumes, cancels or stops it', () => {
        fc.assert(
            fc.property(stepsArb, (steps) => {
                let pausedLeft: { readonly id: string; readonly remainingMs: number } | undefined;

                for (const { after } of trace(steps)) {
                    if (after.timer?.kind === 'paused') {
                        const { id, remainingMs } = after.timer;

                        expect(remainingMs).toBeLessThanOrEqual(after.timer.durationMs);
                        expect(remainingMs).toBeGreaterThan(0);

                        if (pausedLeft?.id === id) {
                            expect(remainingMs).toBe(pausedLeft.remainingMs);
                        }

                        pausedLeft = { id, remainingMs };
                    } else {
                        pausedLeft = undefined;
                    }
                }
            }),
        );
    });

    it('measures a running timer against the clock: the time it loses is exactly the time that passed', () => {
        fc.assert(
            fc.property(stepsArb, fc.integer({ min: -2 * MAX_TIMER_MS, max: 2 * MAX_TIMER_MS }), (steps, probe) => {
                for (const { after } of trace(steps)) {
                    const { timer } = after;

                    if (timer?.kind !== 'running') {
                        continue;
                    }

                    const first = Math.min(probe, timer.endsAt);
                    const second = Math.min(probe + 1_000, timer.endsAt);

                    expect(timeLeftMs(timer, first) - timeLeftMs(timer, second)).toBe(second - first);
                    expect(timeLeftMs(timer, timer.endsAt + 1)).toBe(0);
                }
            }),
        );
    });
});
