import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RecipeStepView } from '@kitchensink/recipe-core';

import {
    cancelTimer,
    completedTimers,
    createTimerFromStep,
    isComplete,
    isDuplicateTimerIdError,
    isInvalidTimerDurationError,
    isInvalidTimerStateError,
    isInvalidTimestampError,
    isStepHasNoTimerError,
    isUnknownTimerError,
    pauseTimer,
    remainingMs,
    resumeTimer,
    startTimer,
} from '../timerEngine.js';
import type { CookingTimer } from '../types.js';

/**
 * T-003 / MOD-006 — unit tests for the countdown timer engine (FR-034 / REQ-004, REQ-005, REQ-006).
 *
 * DEVIATION FROM `v-model/module-design.md` MOD-006, recorded deliberately: that pseudocode describes a
 * stateful single-timer class driven by `setInterval` that decrements a second counter. The shipped
 * engine is instead **pure**, holds an array of concurrent timers, and takes `nowIso` as an input. Two
 * reasons: (a) a tick-decrement counter drifts and stops entirely when a mobile app is backgrounded —
 * deriving `remaining` from wall-clock timestamps is correct across suspend/resume, which is the normal
 * case in a kitchen; (b) time-as-input makes every branch here deterministic without fake timers.
 * Scheduling the re-render tick belongs to the platform widget (MOD-007), not to the domain engine.
 *
 * UTP-006-F is the safety case from spec.md D-002: a yield scale factor must never reach a timer
 * duration. It is asserted structurally, because a behavioural test alone can be defeated by a later
 * edit that reintroduces the dependency (same technique as `UTS-020-D2`).
 */

/** 25 minutes, the canonical "bake for 25 minutes" step from REQ-004. */
const TWENTY_FIVE_MINUTES_SECONDS = 1_500;
const TWENTY_FIVE_MINUTES_MS = 1_500_000;

const START = '2026-08-07T12:00:00.000Z';
const AT_10_MIN = '2026-08-07T12:10:00.000Z';
const ONE_MS_BEFORE_END = '2026-08-07T12:24:59.999Z';
const EXACTLY_AT_END = '2026-08-07T12:25:00.000Z';
const LONG_AFTER_END = '2026-08-07T12:40:00.000Z';

// `RecipeStepView` — the wire projection the CLIENT actually holds on `RecipeDetail.steps`. It has no
// persistence `id`, which is why the timer id is derived from `stepNumber` (see `timerIdForStep`).
const bakeStep: RecipeStepView = {
    stepNumber: 3,
    instruction: 'Bake for 25 minutes',
    timerSeconds: TWENTY_FIVE_MINUTES_SECONDS,
};

const runningBakeTimer: CookingTimer = {
    id: 'step-3',
    label: 'Bake for 25 minutes',
    stepNumber: 3,
    durationMs: TWENTY_FIVE_MINUTES_MS,
    startedAt: START,
    isPaused: false,
};

/**
 * Captures a thrown value without asserting on it, so each test can assert the *specific* error type.
 * A bare `expect(...).toThrow()` also passes against an unimplemented stub, which proves nothing.
 */
function capture(action: () => unknown): unknown {
    try {
        action();
    } catch (error) {
        return error;
    }

    return undefined;
}

describe('timerEngine — UTP-006-A: createTimerFromStep converts SECONDS to milliseconds', () => {
    it('UTS-006-A1: a 25-minute (1500 s) step yields exactly 1_500_000 ms', () => {
        expect(createTimerFromStep(bakeStep, START).durationMs).toBe(TWENTY_FIVE_MINUTES_MS);
    });

    it('UTS-006-A2: the factor is exactly 1000 — not 60, and not 60_000 (minutes)', () => {
        expect(createTimerFromStep({ ...bakeStep, timerSeconds: 1 }, START).durationMs).toBe(1_000);
        expect(createTimerFromStep({ ...bakeStep, timerSeconds: 90 }, START).durationMs).toBe(90_000);
        expect(createTimerFromStep({ ...bakeStep, timerSeconds: 3_600 }, START).durationMs).toBe(3_600_000);
    });

    it('UTS-006-A3: carries the step identity and starts unpaused at nowIso', () => {
        expect(createTimerFromStep(bakeStep, START)).toEqual({
            id: 'step-3',
            label: 'Bake for 25 minutes',
            stepNumber: 3,
            durationMs: TWENTY_FIVE_MINUTES_MS,
            startedAt: START,
            isPaused: false,
        });
    });

    it('UTS-006-A4: normalises startedAt to canonical UTC ISO 8601', () => {
        expect(createTimerFromStep(bakeStep, '2026-08-07T13:00:00.000+01:00').startedAt).toBe(START);
    });

    it('UTS-006-A5: a step with no timerSeconds yields no timer', () => {
        const { timerSeconds: _omitted, ...stepWithoutTimer } = bakeStep;

        expect(isStepHasNoTimerError(capture(() => createTimerFromStep(stepWithoutTimer, START)))).toBe(true);
    });

    it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'UTS-006-A6: rejects the unusable duration %s seconds',
        (timerSeconds) => {
            expect(
                isInvalidTimerDurationError(capture(() => createTimerFromStep({ ...bakeStep, timerSeconds }, START))),
            ).toBe(true);
        },
    );

    it('UTS-006-A7: rejects an unparseable nowIso', () => {
        expect(isInvalidTimestampError(capture(() => createTimerFromStep(bakeStep, 'not-a-timestamp')))).toBe(true);
    });

    it('UTS-006-A8: does not mutate the step it reads (REQ-CN-001)', () => {
        const step: RecipeStepView = { ...bakeStep };
        createTimerFromStep(step, START);

        expect(step).toEqual(bakeStep);
    });
});

describe('timerEngine — UTP-006-B: remainingMs counts down and clamps', () => {
    it('UTS-006-B1: at the start instant the full duration remains', () => {
        expect(remainingMs(runningBakeTimer, START)).toBe(TWENTY_FIVE_MINUTES_MS);
    });

    it('UTS-006-B2: after 10 minutes exactly 15 minutes remain', () => {
        expect(remainingMs(runningBakeTimer, AT_10_MIN)).toBe(900_000);
    });

    it('UTS-006-B3: one millisecond before the end, 1 ms remains', () => {
        expect(remainingMs(runningBakeTimer, ONE_MS_BEFORE_END)).toBe(1);
    });

    it('UTS-006-B4: at exactly the duration, zero remains', () => {
        expect(remainingMs(runningBakeTimer, EXACTLY_AT_END)).toBe(0);
    });

    it('UTS-006-B5: an overrun clamps at 0 and never goes negative', () => {
        const overrun = remainingMs(runningBakeTimer, LONG_AFTER_END);

        expect(overrun).toBe(0);
        expect(overrun).toBeGreaterThanOrEqual(0);
    });

    it('UTS-006-B6: a backwards clock jump clamps at the duration, never above it', () => {
        // NTP correction or a manual clock change mid-cook: `now` precedes `startedAt`.
        expect(remainingMs(runningBakeTimer, '2026-08-07T11:55:00.000Z')).toBe(TWENTY_FIVE_MINUTES_MS);
    });

    it('UTS-006-B7: a paused timer reports its captured remaining, frozen while time passes', () => {
        const paused: CookingTimer = { ...runningBakeTimer, isPaused: true, pausedRemainingMs: 900_000 };

        expect(remainingMs(paused, AT_10_MIN)).toBe(900_000);
        expect(remainingMs(paused, LONG_AFTER_END)).toBe(900_000);
    });

    it('UTS-006-B8: rejects an unparseable nowIso, on the paused branch too', () => {
        const paused: CookingTimer = { ...runningBakeTimer, isPaused: true, pausedRemainingMs: 900_000 };

        expect(isInvalidTimestampError(capture(() => remainingMs(runningBakeTimer, '')))).toBe(true);
        expect(isInvalidTimestampError(capture(() => remainingMs(paused, 'nope')))).toBe(true);
    });

    it('UTS-006-B9: rejects an unparseable startedAt', () => {
        const corrupt: CookingTimer = { ...runningBakeTimer, startedAt: '2026-13-45' };

        expect(isInvalidTimestampError(capture(() => remainingMs(corrupt, START)))).toBe(true);
    });

    it('UTS-006-B10: rejects a paused timer with no captured remaining (corrupt restore)', () => {
        const corrupt: CookingTimer = { ...runningBakeTimer, isPaused: true };

        expect(isInvalidTimerStateError(capture(() => remainingMs(corrupt, START)))).toBe(true);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('UTS-006-B11: rejects the durationMs %s', (durationMs) => {
        expect(isInvalidTimerStateError(capture(() => remainingMs({ ...runningBakeTimer, durationMs }, START)))).toBe(
            true,
        );
    });
});

describe('timerEngine — UTP-006-C: isComplete at the exact boundary', () => {
    it('UTS-006-C1: not complete one millisecond before the end', () => {
        expect(isComplete(runningBakeTimer, ONE_MS_BEFORE_END)).toBe(false);
    });

    it('UTS-006-C2: complete at exactly the duration', () => {
        expect(isComplete(runningBakeTimer, EXACTLY_AT_END)).toBe(true);
    });

    it('UTS-006-C3: still complete after an overrun', () => {
        expect(isComplete(runningBakeTimer, LONG_AFTER_END)).toBe(true);
    });

    it('UTS-006-C4: a paused timer with time left is never complete, however long it is paused', () => {
        const paused: CookingTimer = { ...runningBakeTimer, isPaused: true, pausedRemainingMs: 1 };

        expect(isComplete(paused, LONG_AFTER_END)).toBe(false);
    });

    it('UTS-006-C5: a timer paused at zero is complete', () => {
        const paused: CookingTimer = { ...runningBakeTimer, isPaused: true, pausedRemainingMs: 0 };

        expect(isComplete(paused, EXACTLY_AT_END)).toBe(true);
    });
});

describe('timerEngine — UTP-006-D: pause/resume preserves remaining time exactly', () => {
    it('UTS-006-D1: pause captures the remaining time and freezes the timer', () => {
        const paused = pauseTimer(runningBakeTimer, AT_10_MIN);

        expect(paused.isPaused).toBe(true);
        expect(paused.pausedRemainingMs).toBe(900_000);
        expect(paused.durationMs).toBe(TWENTY_FIVE_MINUTES_MS);
    });

    it('UTS-006-D2: pause does not mutate its input', () => {
        const original: CookingTimer = { ...runningBakeTimer };
        pauseTimer(original, AT_10_MIN);

        expect(original).toEqual(runningBakeTimer);
    });

    it('UTS-006-D3: resume restores exactly the remaining time captured at pause', () => {
        const paused = pauseTimer(runningBakeTimer, AT_10_MIN);
        const resumed = resumeTimer(paused, '2026-08-07T12:30:00.000Z');

        expect(remainingMs(resumed, '2026-08-07T12:30:00.000Z')).toBe(900_000);
        expect(resumed.isPaused).toBe(false);
        expect(resumed.pausedRemainingMs).toBeUndefined();
    });

    it('UTS-006-D4: resume drops the paused marker rather than leaving it stale', () => {
        const resumed = resumeTimer(pauseTimer(runningBakeTimer, AT_10_MIN), '2026-08-07T12:30:00.000Z');

        expect(Object.hasOwn(resumed, 'pausedRemainingMs')).toBe(false);
    });

    it('UTS-006-D5: a pause/resume cycle neither shortens nor extends the timer', () => {
        // Paused at 12:10 with 15:00 left, resumed at 12:30 ⇒ it must complete at 12:45, exactly
        // 20 minutes later than the un-paused 12:25, and not one millisecond before.
        const resumed = resumeTimer(pauseTimer(runningBakeTimer, AT_10_MIN), '2026-08-07T12:30:00.000Z');

        expect(remainingMs(resumed, '2026-08-07T12:35:00.000Z')).toBe(600_000);
        expect(isComplete(resumed, '2026-08-07T12:44:59.999Z')).toBe(false);
        expect(isComplete(resumed, '2026-08-07T12:45:00.000Z')).toBe(true);
        expect(resumed.durationMs).toBe(TWENTY_FIVE_MINUTES_MS);
    });

    it('UTS-006-D6: repeated pause/resume cycles do not accumulate drift', () => {
        let timer = runningBakeTimer;
        // Each cycle pauses for 1 minute; the deadline must move by exactly the paused time, every time.
        const cycles = [
            ['2026-08-07T12:05:00.000Z', '2026-08-07T12:06:00.000Z'],
            ['2026-08-07T12:10:00.000Z', '2026-08-07T12:11:00.000Z'],
            ['2026-08-07T12:15:00.000Z', '2026-08-07T12:16:00.000Z'],
        ] as const;

        for (const [pausedAt, resumedAt] of cycles) {
            timer = resumeTimer(pauseTimer(timer, pausedAt), resumedAt);
        }

        // 25 minutes of running time + 3 paused minutes ⇒ completes at 12:28:00.000Z.
        expect(isComplete(timer, '2026-08-07T12:27:59.999Z')).toBe(false);
        expect(isComplete(timer, '2026-08-07T12:28:00.000Z')).toBe(true);
    });

    it('UTS-006-D7: pausing an already-paused timer is a no-op, so the remaining time cannot be re-captured', () => {
        const paused = pauseTimer(runningBakeTimer, AT_10_MIN);

        expect(pauseTimer(paused, LONG_AFTER_END)).toBe(paused);
    });

    it('UTS-006-D8: resuming a running timer is a no-op', () => {
        expect(resumeTimer(runningBakeTimer, AT_10_MIN)).toBe(runningBakeTimer);
    });

    it('UTS-006-D9: resume rejects a paused timer with no captured remaining', () => {
        const corrupt: CookingTimer = { ...runningBakeTimer, isPaused: true };

        expect(isInvalidTimerStateError(capture(() => resumeTimer(corrupt, AT_10_MIN)))).toBe(true);
    });

    it('UTS-006-D10: pause and resume reject an unparseable nowIso', () => {
        const paused = pauseTimer(runningBakeTimer, AT_10_MIN);

        expect(isInvalidTimestampError(capture(() => pauseTimer(runningBakeTimer, 'nope')))).toBe(true);
        expect(isInvalidTimestampError(capture(() => resumeTimer(paused, 'nope')))).toBe(true);
    });
});

describe('timerEngine — UTP-006-E: concurrent timers', () => {
    const fiveMinuteTimer: CookingTimer = {
        id: 'step-boil',
        label: 'Boil the pasta',
        stepNumber: 1,
        durationMs: 300_000,
        startedAt: '2026-08-07T12:03:00.000Z',
        isPaused: false,
    };

    it('UTS-006-E1: startTimer appends without mutating the caller array', () => {
        const timers: CookingTimer[] = [runningBakeTimer];
        const next = startTimer(timers, fiveMinuteTimer);

        expect(next).toEqual([runningBakeTimer, fiveMinuteTimer]);
        expect(timers).toEqual([runningBakeTimer]);
    });

    it('UTS-006-E2: a duplicate id is rejected, not silently deduped', () => {
        const timers = [runningBakeTimer];
        const thrown = capture(() => startTimer(timers, { ...runningBakeTimer, startedAt: AT_10_MIN }));

        expect(isDuplicateTimerIdError(thrown)).toBe(true);
        expect(timers).toEqual([runningBakeTimer]);
    });

    it('UTS-006-E3: concurrent timers count down independently', () => {
        const timers = startTimer([runningBakeTimer], fiveMinuteTimer);
        const at1208 = '2026-08-07T12:08:00.000Z';

        expect(remainingMs(timers[0]!, at1208)).toBe(1_020_000);
        expect(remainingMs(timers[1]!, at1208)).toBe(0);
    });

    it('UTS-006-E4: pausing one timer leaves the others running', () => {
        const timers = startTimer([runningBakeTimer], fiveMinuteTimer);
        const at1208 = '2026-08-07T12:08:00.000Z';
        const pausedBake = pauseTimer(timers[0]!, '2026-08-07T12:05:00.000Z');

        expect(remainingMs(pausedBake, at1208)).toBe(1_200_000);
        expect(remainingMs(timers[1]!, at1208)).toBe(0);
    });

    it('UTS-006-E5: cancelTimer removes only the named timer, without mutating the caller array', () => {
        const timers = [runningBakeTimer, fiveMinuteTimer];
        const next = cancelTimer(timers, 'step-3');

        expect(next).toEqual([fiveMinuteTimer]);
        expect(timers).toEqual([runningBakeTimer, fiveMinuteTimer]);
    });

    it('UTS-006-E6: cancelling an unknown id is rejected rather than silently ignored', () => {
        // A silent no-op would leave a timer the user believes they cancelled still running to an alert.
        expect(isUnknownTimerError(capture(() => cancelTimer([runningBakeTimer], 'step-missing')))).toBe(true);
    });

    it('UTS-006-E7: completedTimers returns only the finished ones, in order', () => {
        const timers = [runningBakeTimer, fiveMinuteTimer];

        expect(completedTimers(timers, '2026-08-07T12:08:00.000Z')).toEqual([fiveMinuteTimer]);
        expect(completedTimers(timers, LONG_AFTER_END)).toEqual([runningBakeTimer, fiveMinuteTimer]);
    });

    it('UTS-006-E8: completedTimers is empty while every timer still has time left', () => {
        expect(completedTimers([runningBakeTimer, fiveMinuteTimer], '2026-08-07T12:04:00.000Z')).toEqual([]);
    });

    it('UTS-006-E9: completedTimers on an empty list is an empty list', () => {
        expect(completedTimers([], START)).toEqual([]);
    });

    it('UTS-006-E10: a paused timer is not reported complete just because its window elapsed', () => {
        const paused = pauseTimer(fiveMinuteTimer, '2026-08-07T12:04:00.000Z');

        expect(completedTimers([paused], LONG_AFTER_END)).toEqual([]);
    });
});

describe('timerEngine — UTP-006-F: SAFETY, yield scaling never reaches a timer (D-002)', () => {
    const source = readFileSync(new URL('../timerEngine.ts', import.meta.url), 'utf8');
    const importLines = source.split('\n').filter((line) => line.trimStart().startsWith('import'));

    it('UTS-006-F1: the module imports nothing scaling-related (structural invariant)', () => {
        expect(importLines.length).toBeGreaterThan(0);
        expect(importLines.some((line) => /scal/i.test(line))).toBe(false);
    });

    it('UTS-006-F2: no exported function accepts a scale factor', () => {
        // Arity is the observable trace of a smuggled-in parameter: every signature is (subject, now)
        // or (timers, subject) — a scale factor could only arrive as an extra argument.
        expect(createTimerFromStep.length).toBe(2);
        expect(remainingMs.length).toBe(2);
        expect(isComplete.length).toBe(2);
        expect(pauseTimer.length).toBe(2);
        expect(resumeTimer.length).toBe(2);
        expect(startTimer.length).toBe(2);
        expect(cancelTimer.length).toBe(2);
        expect(completedTimers.length).toBe(2);
    });

    it('UTS-006-F3: the engine never reads the ambient clock (determinism invariant)', () => {
        expect(/Date\s*\.\s*now\s*\(/.test(source)).toBe(false);
        expect(/new\s+Date\s*\(\s*\)/.test(source)).toBe(false);
    });
});
