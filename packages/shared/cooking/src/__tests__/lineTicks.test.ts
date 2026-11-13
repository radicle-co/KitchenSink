import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isInvalidLineIndexError, isInvalidStepIndexError } from '../errors.js';
import {
    allLinesTicked,
    createLineTicks,
    focusLineIndex,
    isLineTicked,
    tickLine,
    tickedLineCount,
    untickLine,
} from '../lineTicks.js';
import type { LineTicks } from '../lineTicks.js';
import type { CookingStep } from '../cookingSteps.js';

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

/** Steps with the given line counts, as `cookingStepsOf` would build them. */
function stepsWith(...lineCounts: readonly number[]): readonly CookingStep[] {
    return lineCounts.map((count, index) => ({
        stepNumber: index + 1,
        lines: Array.from({ length: count }, (_, line) => `Line ${line + 1}.`),
    }));
}

/** Three steps of three lines each. */
const STEPS = stepsWith(3, 3, 3);

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
        const steps = stepsWith(3, 3, 3, 3, 1);
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

        expect(focusLineIndex(ticks, 0, stepsWith(0))).toBeNull();
        expect(allLinesTicked(ticks, 0, stepsWith(0))).toBe(false);
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
        const steps = stepsWith(1, 3);
        const ticks = tickLine(createLineTicks(), { stepIndex: 0, lineIndex: 0 }, steps);

        expect(focusLineIndex(ticks, 0, steps)).toBeNull();
        expect(allLinesTicked(ticks, 0, steps)).toBe(true);
        expect(focusLineIndex(ticks, 1, steps)).toBe(0);
        expect(allLinesTicked(ticks, 1, steps)).toBe(false);
    });

    it('reads the line count from the named step, not from another step', () => {
        const steps = stepsWith(1, 3);

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
    const steps = stepsWith(lineCount, lineCount, lineCount);
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
