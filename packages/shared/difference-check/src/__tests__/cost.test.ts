/**
 * The cost bound (KTD-3, qse F-11, Q-L1): the check runs synchronously on the save path, so the measures must not be
 * quadratic in the text.
 *
 * A wall-clock limit cannot tell a quadratic measure from the bit-parallel one on a shared CI runner: both grow with
 * n x m, and load moves a wall-clock limit by more than the 32-fold gap between them. So the tripwire is a ratio taken
 * on one machine, back to back. It times the plain table (the quadratic yardstick) on 3,000 x 3,000 tokens to get the
 * cost of one cell right now, then times L and R on two independent sequences of 70,000 tokens, and asks that each
 * spend under 1/20 of a table cell's time per (baseline x steps) cell. Load slows both runs about equally, so it
 * cancels. Measured on a developer machine: L about 1/180, R about 1/130, a naive quadratic R about 1/3.5, the plain
 * table 1. No absolute time is asserted: the ratio is the bound, and vitest cannot stop a synchronous run.
 */
import { describe, expect, it } from 'vitest';

import { plainLcs } from '../__fixtures__/plainLcs.js';
import { seededDraw, synthWord, textOf } from '../__fixtures__/synthetic.js';
import { differenceCheckV1 } from '../differenceCheckV1.js';
import { longestCommonSubsequence } from '../measures/alignment.js';
import { longestSharedRun } from '../measures/measures.js';

/**
 * The most of a table cell's time a measure may spend on one cell of the pair: a twentieth. Measured on one machine, per
 * cell against the plain table: L 0.0055 (9 times under the bound), R 0.0075 (6.7 times under), a naive quadratic R
 * 0.285 (5.7 times over), the plain table in place of L about 1. A bound of 1/4 would catch the naive R by only 14%,
 * which is too thin on a loaded runner.
 */
const MAXIMUM_CELL_COST_RATIO = 1 / 20;

/** The size of the yardstick pair, and of the pair under test. */
const YARDSTICK_TOKENS = 3000;
const TRIPWIRE_TOKENS = 70_000;

/** `length` words drawn from the 4096 synthetic words. */
function words(seed: number, length: number): string[] {
    const draw = seededDraw(seed);

    return Array.from({ length }, () => synthWord(Math.floor(draw() * 4096)));
}

/** The fastest of three runs, in milliseconds: the run least disturbed by whatever else the machine is doing. */
function fastestOfThree(run: () => unknown): number {
    return Math.min(
        ...[0, 1, 2].map(() => {
            const start = performance.now();
            run();

            return performance.now() - start;
        }),
    );
}

describe('the cost of the measures', () => {
    it(
        "spends under a twentieth of a table cell's time per cell on L and on R, at 70,000 tokens",
        { timeout: 60_000 },
        () => {
            const tableMilliseconds = fastestOfThree(() =>
                plainLcs(words(1, YARDSTICK_TOKENS), words(2, YARDSTICK_TOKENS)),
            );
            const tableCell = tableMilliseconds / YARDSTICK_TOKENS ** 2;
            const baseline = words(1, TRIPWIRE_TOKENS);
            const steps = words(2, TRIPWIRE_TOKENS);
            const cells = TRIPWIRE_TOKENS ** 2;

            const alignmentCell = fastestOfThree(() => longestCommonSubsequence(baseline, steps)) / cells;
            const runCell = fastestOfThree(() => longestSharedRun(baseline, steps)) / cells;

            expect(alignmentCell / tableCell).toBeLessThan(MAXIMUM_CELL_COST_RATIO);
            expect(runCell / tableCell).toBeLessThan(MAXIMUM_CELL_COST_RATIO);
        },
    );

    // The 30 s timeout is not a speed claim (the ratio case above is); it keeps a loaded CI runner from failing a
    // case that only shows the whole check returns its result at the body limit.
    it('completes the whole check on a pair at the 100 kB body limit', { timeout: 30_000 }, () => {
        const baseline = words(3, 17_000);
        const result = differenceCheckV1(textOf(baseline), textOf(words(4, 17_000)));

        expect(result.total).toBeGreaterThan(0);
        expect(result.alignTotal).toBe(17_000);
    });
});
