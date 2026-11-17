import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isInvalidLineIndexError, isInvalidStepIndexError } from '../errors.js';
import {
    allLinesTicked,
    createLineTicks,
    focusLineIndex,
    focusLineOf,
    isLineTicked,
    tickLine,
    tickedLineCount,
    untickLine,
} from '../lineTicks.js';
import type { LineTicks, TappedLine } from '../lineTicks.js';
import { makeCookingSteps } from '../__fixtures__/cookingSteps.js';

/**
 * `lineTicks` — the cook's ticks on the LINES of each step, and the focus line derived from them.
 *
 * These are session ticks keyed `{ stepIndex, lineIndex }`. They are not the recipe's ingredient cook marks. The rules
 * under test:
 * - the focus is the first unticked line of a step;
 * - ticking the focus moves it to the next unticked line;
 * - unticking a line above the focus makes it the focus again;
 * - every line ticked gives no focus and "all ticked" (Next coming);
 * - ticks on one step never change another step (Back keeps the ticks);
 * - a fresh state has no ticks (Cook it again);
 * - every line count is read from the parsed steps, never passed in, so an unknown step is rejected.
 *
 * Every state is deep-frozen, so an in-place mutation throws instead of passing silently.
 */

/** Three steps of three lines each. */
const STEPS = makeCookingSteps(3, 3, 3);

function frozen(ticks: LineTicks): LineTicks {
    Object.freeze(ticks.ticked);

    for (const key of ticks.ticked) {
        Object.freeze(key);
    }

    return Object.freeze(ticks);
}

function ticksOf(...keys: readonly (readonly [number, number])[]): LineTicks {
    return frozen(
        keys.reduce<LineTicks>(
            (state, [stepIndex, lineIndex]) => tickLine(state, { stepIndex, lineIndex }, STEPS),
            createLineTicks(),
        ),
    );
}

describe('lineTicks — a fresh state', () => {
    it('has no ticks, and the focus is line 0', () => {
        const ticks = createLineTicks();

        expect(ticks).toEqual({ ticked: [] });
        expect(focusLineIndex(ticks, 0, STEPS)).toBe(0);
        expect(tickedLineCount(ticks, 0)).toBe(0);
        expect(allLinesTicked(ticks, 0, STEPS)).toBe(false);
    });

    it('survives a JSON round trip unchanged', () => {
        const ticks = ticksOf([1, 2], [0, 0]);

        expect(JSON.parse(JSON.stringify(ticks))).toEqual(ticks);
    });
});

describe('lineTicks — ticking moves the focus', () => {
    it('ticking line 0 of 3 moves the focus to line 1, with one ticked', () => {
        const ticks = ticksOf([0, 0]);

        expect(isLineTicked(ticks, { stepIndex: 0, lineIndex: 0 })).toBe(true);
        expect(focusLineIndex(ticks, 0, STEPS)).toBe(1);
        expect(tickedLineCount(ticks, 0)).toBe(1);
        expect(allLinesTicked(ticks, 0, STEPS)).toBe(false);
    });

    it('ticking the last unticked line leaves no focus and every line ticked', () => {
        const ticks = ticksOf([0, 0], [0, 1], [0, 2]);

        expect(focusLineIndex(ticks, 0, STEPS)).toBeNull();
        expect(allLinesTicked(ticks, 0, STEPS)).toBe(true);
        expect(tickedLineCount(ticks, 0)).toBe(3);
    });

    it('the focus skips a ticked line to the first unticked one', () => {
        expect(focusLineIndex(ticksOf([0, 0], [0, 1]), 0, STEPS)).toBe(2);
        expect(focusLineIndex(ticksOf([0, 1]), 0, STEPS)).toBe(0);
    });

    it('ticking an already ticked line changes nothing', () => {
        const once = ticksOf([0, 1]);

        expect(tickLine(once, { stepIndex: 0, lineIndex: 1 }, STEPS)).toEqual(once);
    });

    it('a one-line step with its line ticked is all ticked', () => {
        const steps = makeCookingSteps(3, 3, 3, 3, 1);
        const ticks = tickLine(createLineTicks(), { stepIndex: 4, lineIndex: 0 }, steps);

        expect(focusLineIndex(ticks, 4, steps)).toBeNull();
        expect(allLinesTicked(ticks, 4, steps)).toBe(true);
    });

    it('does not mutate the state it is given', () => {
        const before = ticksOf([0, 0]);

        tickLine(before, { stepIndex: 0, lineIndex: 1 }, STEPS);

        expect(before).toEqual({ ticked: [{ stepIndex: 0, lineIndex: 0 }] });
    });
});

describe('lineTicks — unticking above the focus', () => {
    it('unticking line 0 when lines 0 and 1 are ticked makes line 0 the focus again', () => {
        const ticks = untickLine(ticksOf([0, 0], [0, 1]), { stepIndex: 0, lineIndex: 0 });

        expect(focusLineIndex(ticks, 0, STEPS)).toBe(0);
        expect(isLineTicked(ticks, { stepIndex: 0, lineIndex: 1 })).toBe(true);
        expect(tickedLineCount(ticks, 0)).toBe(1);
    });

    it('unticking a line of an all-ticked step brings back the focus and ends Next coming', () => {
        const ticks = untickLine(ticksOf([0, 0], [0, 1], [0, 2]), { stepIndex: 0, lineIndex: 2 });

        expect(focusLineIndex(ticks, 0, STEPS)).toBe(2);
        expect(allLinesTicked(ticks, 0, STEPS)).toBe(false);
    });

    it('unticking a line that is not ticked changes nothing', () => {
        const ticks = ticksOf([0, 0]);

        expect(untickLine(ticks, { stepIndex: 0, lineIndex: 2 })).toEqual(ticks);
    });
});

describe('lineTicks — steps are independent, so Back keeps the ticks', () => {
    it('ticks on step 1 do not change step 0 or step 2', () => {
        const ticks = ticksOf([1, 0], [1, 1], [1, 2]);

        expect(focusLineIndex(ticks, 0, STEPS)).toBe(0);
        expect(focusLineIndex(ticks, 2, STEPS)).toBe(0);
        expect(tickedLineCount(ticks, 0)).toBe(0);
        expect(allLinesTicked(ticks, 1, STEPS)).toBe(true);
        expect(allLinesTicked(ticks, 0, STEPS)).toBe(false);
    });

    it('the same line index on another step is a different line', () => {
        const ticks = ticksOf([0, 1]);

        expect(isLineTicked(ticks, { stepIndex: 1, lineIndex: 1 })).toBe(false);
        expect(isLineTicked(ticks, { stepIndex: 0, lineIndex: 0 })).toBe(false);
    });
});

describe('lineTicks — a step with no lines', () => {
    it('has no focus and is never all ticked, so it never shows Next coming', () => {
        const ticks = createLineTicks();

        expect(focusLineIndex(ticks, 0, makeCookingSteps(0))).toBeNull();
        expect(allLinesTicked(ticks, 0, makeCookingSteps(0))).toBe(false);
        expect(tickedLineCount(ticks, 0)).toBe(0);
    });
});

describe('lineTicks — rejects a line that does not exist', () => {
    it.each([
        { stepIndex: -1, lineIndex: 0 },
        { stepIndex: 0.5, lineIndex: 0 },
        { stepIndex: Number.NaN, lineIndex: 0 },
        { stepIndex: 3, lineIndex: 0 },
    ])('tickLine(%j) on three steps rejects the step index, naming the real step count', (key) => {
        expect(() => tickLine(createLineTicks(), key, STEPS)).toThrow(
            expect.toSatisfy((error) => isInvalidStepIndexError(error) && error.totalSteps === 3),
        );
    });

    it.each([
        { stepIndex: 0, lineIndex: -1 },
        { stepIndex: 0, lineIndex: 3 },
        { stepIndex: 0, lineIndex: 1.5 },
    ])('tickLine(%j) on a three-line step rejects the line index', (key) => {
        expect(() => tickLine(createLineTicks(), key, STEPS)).toThrow(
            expect.toSatisfy((error) => isInvalidLineIndexError(error) && error.lineCount === 3),
        );
    });

    it.each([-1, 0.5, Number.NaN, 3])(
        'focusLineIndex and allLinesTicked reject step index %s of three, naming the real step count',
        (stepIndex) => {
            const named = expect.toSatisfy((error) => isInvalidStepIndexError(error) && error.totalSteps === 3);

            expect(() => focusLineIndex(createLineTicks(), stepIndex, STEPS)).toThrow(named);
            expect(() => allLinesTicked(createLineTicks(), stepIndex, STEPS)).toThrow(named);
        },
    );

    it('focusLineIndex and allLinesTicked read the line count from the named step', () => {
        const steps = makeCookingSteps(1, 3);
        const ticks = tickLine(createLineTicks(), { stepIndex: 0, lineIndex: 0 }, steps);

        expect(focusLineIndex(ticks, 0, steps)).toBeNull();
        expect(allLinesTicked(ticks, 0, steps)).toBe(true);
        expect(focusLineIndex(ticks, 1, steps)).toBe(0);
        expect(allLinesTicked(ticks, 1, steps)).toBe(false);
    });

    it('reads the line count from the named step, not from another step', () => {
        const steps = makeCookingSteps(1, 3);

        expect(() => tickLine(createLineTicks(), { stepIndex: 0, lineIndex: 2 }, steps)).toThrow(
            expect.toSatisfy(isInvalidLineIndexError),
        );
        expect(
            isLineTicked(tickLine(createLineTicks(), { stepIndex: 1, lineIndex: 2 }, steps), {
                stepIndex: 1,
                lineIndex: 2,
            }),
        ).toBe(true);
    });
});

/** The invariant over action sequences nobody writes by hand. */
describe('lineTicks — properties', () => {
    const lineCount = 4;
    const steps = makeCookingSteps(lineCount, lineCount, lineCount);
    const action = fc.record({
        tick: fc.boolean(),
        stepIndex: fc.integer({ min: 0, max: 2 }),
        lineIndex: fc.integer({ min: 0, max: lineCount - 1 }),
    });

    it('the focus is always the first unticked line, and the count matches the ticks, after any sequence', () => {
        fc.assert(
            fc.property(fc.array(action, { maxLength: 30 }), (actions) => {
                const model = new Set<string>();
                let ticks = createLineTicks();

                for (const { tick, stepIndex, lineIndex } of actions) {
                    const key = { stepIndex, lineIndex };
                    ticks = tick ? tickLine(ticks, key, steps) : untickLine(ticks, key);

                    if (tick) {
                        model.add(`${stepIndex}:${lineIndex}`);
                    } else {
                        model.delete(`${stepIndex}:${lineIndex}`);
                    }
                }

                for (let stepIndex = 0; stepIndex <= 2; stepIndex++) {
                    const unticked = [0, 1, 2, 3].filter((line) => !model.has(`${stepIndex}:${line}`));

                    expect(focusLineIndex(ticks, stepIndex, steps)).toBe(unticked[0] ?? null);
                    expect(tickedLineCount(ticks, stepIndex)).toBe(lineCount - unticked.length);
                    expect(allLinesTicked(ticks, stepIndex, steps)).toBe(unticked.length === 0);
                }

                expect(ticks.ticked).toHaveLength(model.size);
            }),
        );
    });
});

/**
 * `focusLineOf`: the line the cook tapped is the focus only while four facts hold, and
 * is derived, never cleared. Any other state falls back to the first unticked line. The step's digest is the kept
 * store's (ADR-0094 section 9), handed in by the caller, so there is one meaning of "step digest".
 *
 * Steps 0 to 2 have three lines each. The cook is on step 1 with lines A (0), B (1) and C (2) unticked, and taps C.
 */
describe('focusLineOf', () => {
    const DIGEST = 's1:aaaaaaaa';
    const tappedC: TappedLine = { stepIndex: 1, stepDigest: DIGEST, lineIndex: 2, tickedAtTap: [] };

    const focus = (overrides: {
        readonly ticks?: LineTicks;
        readonly stepIndex?: number;
        readonly stepDigest?: string;
        readonly tapped?: TappedLine | null;
    }): number | null =>
        focusLineOf({
            ticks: overrides.ticks ?? ticksOf(),
            stepIndex: overrides.stepIndex ?? 1,
            steps: STEPS,
            stepDigest: overrides.stepDigest ?? DIGEST,
            tapped: overrides.tapped === undefined ? tappedC : overrides.tapped,
        });

    it('is the tapped line while nothing changed', () => {
        expect(focus({})).toBe(2);
    });

    it('is the first unticked line when nothing was tapped, for every tick state of the step (no regression)', () => {
        const states: readonly LineTicks[] = [
            ticksOf(),
            ticksOf([1, 0]),
            ticksOf([1, 1]),
            ticksOf([1, 0], [1, 1]),
            ticksOf([1, 0], [1, 1], [1, 2]),
            ticksOf([0, 0], [2, 1]),
        ];

        for (const ticks of states) {
            expect(focus({ ticks, tapped: null })).toBe(focusLineIndex(ticks, 1, STEPS));
        }
    });

    it('goes back to the first unticked line when the tapped line is ticked', () => {
        expect(focus({ ticks: ticksOf([1, 2]) })).toBe(0);
    });

    it('goes back when another source ticked a different line of the step (the ticked set moved)', () => {
        expect(focus({ ticks: ticksOf([1, 1]) })).toBe(0);
    });

    it('goes back when the step text changed: the digest differs (mutant: the tap is kept by index)', () => {
        expect(focus({ stepDigest: 's1:bbbbbbbb' })).toBe(0);
    });

    it('goes back when the session is on another step', () => {
        expect(focus({ stepIndex: 0 })).toBe(0);
        expect(focus({ stepIndex: 2 })).toBe(0);
    });

    it('goes back when the tapped line is past the end of the step after an edit', () => {
        expect(focus({ tapped: { ...tappedC, lineIndex: 3 } })).toBe(0);
        expect(focus({ tapped: { ...tappedC, lineIndex: -1 } })).toBe(0);
    });

    it('keeps the tap when only another step is ticked (a tick on step 0 or 2)', () => {
        expect(focus({ ticks: ticksOf([0, 0], [2, 1]) })).toBe(2);
    });

    it('keeps the tap when the ticked set equals the one at the tap, whatever order it was ticked in', () => {
        const tapped: TappedLine = { ...tappedC, tickedAtTap: [0, 1] };

        expect(focus({ ticks: ticksOf([1, 1], [1, 0]), tapped })).toBe(2);
        expect(focus({ ticks: ticksOf([1, 0], [1, 1]), tapped })).toBe(2);
    });

    it('with A ticked and B unticked, a tap on C holds, and unticking A ends it: the focus is A', () => {
        const tapped: TappedLine = { ...tappedC, tickedAtTap: [0] };

        expect(focus({ ticks: ticksOf([1, 0]), tapped })).toBe(2);
        expect(focus({ ticks: ticksOf(), tapped })).toBe(0);
    });

    it('goes back when another source swapped one tick for another: same count, different lines', () => {
        const tapped: TappedLine = { ...tappedC, tickedAtTap: [0] };

        expect(focus({ ticks: ticksOf([1, 0]), tapped })).toBe(2);
        expect(focus({ ticks: ticksOf([1, 1]), tapped })).toBe(0);
    });

    it('never makes a ticked line the focus, even for a tap whose record lists that line as ticked', () => {
        const malformed: TappedLine = { ...tappedC, tickedAtTap: [2] };

        expect(focus({ ticks: ticksOf([1, 2]), tapped: malformed })).toBe(0);
    });

    it('does not tick, untick or change anything it reads', () => {
        const ticks = ticksOf([1, 0]);
        const tapped: TappedLine = Object.freeze({ ...tappedC, tickedAtTap: Object.freeze([0]) });

        focus({ ticks, tapped });

        expect(ticks).toEqual(ticksOf([1, 0]));
    });
});
