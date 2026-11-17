/**
 * The timer model over arbitrary command sequences. The clock moves in random steps, BACKWARDS as well as forwards and by
 * more than a day (a device clock change), and commands name timers from the ones started so far, so stale and
 * misplaced commands are common. A caller mints a fresh id for every start it sends, so the generator does too.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isInvalidTimerDurationError } from '../errors.js';
import {
    MAX_TIMER_MS,
    MIN_TIMER_MS,
    NO_TIMER,
    reduceTimer,
    timeLeftMs,
    type ActiveTimer,
    type TimerCommand,
    type TimerEvent,
    type TimerState,
} from '../timer.js';

type Template =
    | { readonly kind: 'start'; readonly durationMs: number; readonly step: number }
    | { readonly kind: 'pause' | 'resume' | 'cancel' | 'stop' | 'discardUndo'; readonly pick: number }
    | { readonly kind: 'addTime'; readonly pick: number; readonly addMs: number }
    | { readonly kind: 'rematch'; readonly picks: readonly number[]; readonly steps: readonly number[] }
    | { readonly kind: 'ring' | 'restore' };

/** The most timers the generated callers allow: the limit in force today (1) and the one S6.U1 brings (10). */
const LIMITS = [1, 10] as const;

interface Step {
    readonly template: Template;
    readonly advanceMs: number;
}

const templateArb: fc.Arbitrary<Template> = fc.oneof(
    fc.record({
        kind: fc.constant('start' as const),
        durationMs: fc.integer({ min: MIN_TIMER_MS, max: 3_600_000 }),
        step: fc.integer({ min: 0, max: 2 }),
    }),
    fc.record({
        kind: fc.constantFrom(
            'pause' as const,
            'resume' as const,
            'cancel' as const,
            'stop' as const,
            'discardUndo' as const,
        ),
        pick: fc.nat(),
    }),
    fc.record({
        kind: fc.constant('rematch' as const),
        picks: fc.array(fc.nat(), { maxLength: 4 }),
        steps: fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 4 }),
    }),
    fc.record({
        kind: fc.constant('addTime' as const),
        pick: fc.nat(),
        addMs: fc.integer({ min: MIN_TIMER_MS, max: 600_000 }),
    }),
    fc.record({ kind: fc.constantFrom('ring' as const, 'restore' as const) }),
);

const limitArb = fc.constantFrom(...LIMITS);

const stepsArb = fc.array(
    fc.record({ template: templateArb, advanceMs: fc.integer({ min: -2 * MAX_TIMER_MS, max: 4_000_000 }) }),
    { maxLength: 40 },
);

/** Commands as a caller sends them: every start gets a fresh id, and the rest name a timer started so far. */
function commandFor(template: Template, startedSoFar: number, nowMs: number, limit: number): TimerCommand {
    const pickedId = (pick: number) => `t${pick % (startedSoFar + 1)}`;

    switch (template.kind) {
        case 'start':
            return {
                kind: 'start',
                id: `t${startedSoFar}`,
                recipeId: 'r',
                stepIndex: template.step,
                stepDigest: `s1:${String(template.step).padStart(8, '0')}`,
                name: undefined,
                durationMs: template.durationMs,
                limit,
                nowMs,
            };
        case 'ring':
            return { kind: 'ring', nowMs };
        case 'restore':
            return { kind: 'restore', limit, nowMs };
        case 'rematch':
            return {
                kind: 'rematch',
                moves: template.picks.map((pick, i) => ({
                    id: pickedId(pick),
                    stepIndex: template.steps[i] ?? 0,
                    stepDigest: `s1:${String(template.steps[i] ?? 0).padStart(8, '0')}`,
                })),
                nowMs,
            };
        case 'addTime':
            return { kind: 'addTime', id: pickedId(template.pick), addMs: template.addMs, nowMs };
        default:
            return { kind: template.kind, id: pickedId(template.pick), nowMs };
    }
}

interface Trace {
    readonly command: TimerCommand;
    readonly before: TimerState;
    readonly after: TimerState;
    readonly events: readonly TimerEvent[];
    readonly nowMs: number;
}

/** Run the steps, treating only the typed duration refusal as "no change". Any other error fails the property. */
function trace(steps: readonly Step[], limit: number): readonly Trace[] {
    const out: Trace[] = [];
    let state = NO_TIMER;
    let nowMs = 1_000_000;
    let startedSoFar = 0;

    for (const step of steps) {
        nowMs += step.advanceMs;
        const command = commandFor(step.template, startedSoFar, nowMs, limit);
        let next = { state, events: [] as readonly TimerEvent[] };

        try {
            next = reduceTimer(state, command);

            if (command.kind === 'start') {
                startedSoFar += 1;
            }
        } catch (error) {
            if (!isInvalidTimerDurationError(error)) {
                throw error;
            }
        }

        out.push({ command, before: state, after: next.state, events: next.events, nowMs });
        state = next.state;
    }

    return out;
}

const stepsWithLimit = fc.tuple(stepsArb, limitArb);

/** Every timer that holds a number: the list and the held Undo. */
const holdersOf = (state: TimerState): readonly ActiveTimer[] =>
    state.undo === undefined ? state.timers : [...state.timers, state.undo];

describe('the timer model over any command sequence', () => {
    it('emits ended at most once per (id, run), only on an edge into ringing', () => {
        fc.assert(
            fc.property(stepsWithLimit, ([steps, limit]) => {
                const seen = new Set<string>();

                for (const { before, after, events } of trace(steps, limit)) {
                    for (const event of events) {
                        const key = `${event.id}:${event.run}`;

                        expect(seen.has(key)).toBe(false);
                        seen.add(key);
                        expect(after.timers.find((t) => t.id === event.id)).toMatchObject({
                            kind: 'ringing',
                            run: event.run,
                        });
                        expect(before.timers.find((t) => t.id === event.id)?.kind).not.toBe('ringing');
                    }
                }
            }),
            { numRuns: 500 },
        );
    });

    it('changes the held Undo only on cancel, restore and discardUndo, and otherwise only by a rematch', () => {
        fc.assert(
            fc.property(stepsWithLimit, ([steps, limit]) => {
                for (const { command, before, after } of trace(steps, limit)) {
                    if (['cancel', 'restore', 'discardUndo'].includes(command.kind)) {
                        continue;
                    }

                    expect(after.undo?.id).toBe(before.undo?.id);

                    if (command.kind !== 'rematch') {
                        expect(after.undo).toBe(before.undo);
                    }
                }
            }),
            { numRuns: 500 },
        );
    });

    it('never holds two timers with one id, the Undo id beside a live timer of it, or more timers than the limit', () => {
        fc.assert(
            fc.property(stepsWithLimit, ([steps, limit]) => {
                for (const { after } of trace(steps, limit)) {
                    const ids = holdersOf(after).map((t) => t.id);

                    expect(new Set(ids).size).toBe(ids.length);
                    expect(after.timers.length).toBeLessThanOrEqual(limit);
                }
            }),
            { numRuns: 500 },
        );
    });

    it('numbers the timers and the held Undo on one recipe and step without a repeat', () => {
        fc.assert(
            fc.property(stepsWithLimit, ([steps, limit]) => {
                for (const { after } of trace(steps, limit)) {
                    const keys = holdersOf(after).map((t) => `${t.recipeId}/${t.stepIndex}/${t.ordinal}`);

                    expect(new Set(keys).size).toBe(keys.length);
                    expect(holdersOf(after).every((t) => Number.isInteger(t.ordinal) && t.ordinal >= 1)).toBe(true);
                }
            }),
            { numRuns: 500 },
        );
    });

    it('keeps a paused timer at the same time left until something resumes, cancels or stops it', () => {
        fc.assert(
            fc.property(stepsWithLimit, ([steps, limit]) => {
                const pausedLeft = new Map<string, number>();

                for (const { after } of trace(steps, limit)) {
                    const pausedNow = new Set<string>();

                    for (const timer of after.timers) {
                        if (timer.kind !== 'paused') {
                            continue;
                        }

                        expect(timer.remainingMs).toBeLessThanOrEqual(timer.durationMs);
                        expect(timer.remainingMs).toBeGreaterThan(0);

                        const before = pausedLeft.get(timer.id);

                        if (before !== undefined) {
                            expect(timer.remainingMs).toBe(before);
                        }

                        pausedLeft.set(timer.id, timer.remainingMs);
                        pausedNow.add(timer.id);
                    }

                    for (const id of [...pausedLeft.keys()]) {
                        if (!pausedNow.has(id)) {
                            pausedLeft.delete(id);
                        }
                    }
                }
            }),
        );
    });

    it('measures a running timer against the clock: the time it loses is exactly the time that passed', () => {
        fc.assert(
            fc.property(
                stepsWithLimit,
                fc.integer({ min: -2 * MAX_TIMER_MS, max: 2 * MAX_TIMER_MS }),
                ([steps, limit], probe) => {
                    for (const { after } of trace(steps, limit)) {
                        for (const timer of after.timers) {
                            if (timer.kind !== 'running') {
                                continue;
                            }

                            const first = Math.min(probe, timer.endsAt);
                            const second = Math.min(probe + 1_000, timer.endsAt);

                            expect(timeLeftMs(timer, first) - timeLeftMs(timer, second)).toBe(second - first);
                            expect(timeLeftMs(timer, timer.endsAt + 1)).toBe(0);
                        }
                    }
                },
            ),
        );
    });
});
