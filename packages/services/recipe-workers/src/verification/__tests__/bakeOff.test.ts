/**
 * The bake-off's SCORING (plan U11 / KTD-4, KTD-5) — the arithmetic that picks a model.
 *
 * ⛔ WHY THE SCORING IS A SEPARATE, PURE MODULE. The bake-off is the most expensive thing in this unit to
 * run: 2,432 lines x 2 models x 2 swap orders is ~9,700 billed calls and roughly two hours serialized at
 * `reservedConcurrency = 1`. An arithmetic error discovered AFTER that run costs the whole run again. So the
 * numbers that decide which model ships are computed here, where they are a truth table, and the runner is
 * left with nothing but I/O.
 *
 * ⚠️ THE TWO ERROR RATES ARE NOT SYMMETRIC, and the tests below are built around that:
 *
 *  - A **false agree** passes data that would have shipped anyway — no worse than today.
 *  - A **false disagree** withholds nutrition from a CORRECT line, which IS worse than today, and the plan
 *    names its rate as "the number that triggers a rethink".
 *
 * So they are reported separately and never averaged into an accuracy figure. An accuracy number is the one
 * summary that would let a model with a terrible false-disagree rate win.
 */
import { describe, expect, it } from 'vitest';

import { scoreBakeOff, type BakeOffTrial } from '../bakeOff.js';

/** A trial: what the corpus says is true, and what the model said. */
const trial = (truth: 'correct' | 'incorrect', band: string, overrides: Partial<BakeOffTrial> = {}): BakeOffTrial => ({
    lineId: `line-${Math.random()}`,
    parseIsCorrect: truth === 'correct',
    band,
    stopReason: 'end_turn',
    costMicros: 30,
    ...overrides,
});

describe('scoreBakeOff', () => {
    it('separates the two error rates instead of averaging them into accuracy', () => {
        const report = scoreBakeOff('amazon.nova-micro-v1:0', [
            // A correct parse the model contradicted: a FALSE DISAGREE. The expensive kind.
            trial('correct', 'contradicted'),
            trial('correct', 'contradicted'),
            trial('correct', 'verified'),
            trial('correct', 'verified'),
            // An incorrect parse the model passed: a FALSE AGREE. The cheap kind.
            trial('incorrect', 'verified'),
            trial('incorrect', 'contradicted'),
        ]);

        // 2 of the 4 correct lines were contradicted.
        expect(report.falseDisagreeRate).toBeCloseTo(0.5, 5);
        // 1 of the 2 incorrect lines was passed.
        expect(report.falseAgreeRate).toBeCloseTo(0.5, 5);
        // ⛔ No `accuracy` field. A single summary is what lets a model with an unacceptable false-disagree
        // rate win on the strength of its false-agree rate.
        expect(Object.hasOwn(report, 'accuracy')).toBe(false);
    });

    it('counts an INCONCLUSIVE verdict as neither error, and reports it separately', () => {
        // An abstention publishes, so it cannot be a false disagree. Nor is it an endorsement, so counting it
        // as a false agree would penalise a model for the honesty the prompt asks for. It is its own number,
        // because a model that abstains on half the corpus has not been evaluated on that half.
        const report = scoreBakeOff('m', [
            trial('correct', 'inconclusive'),
            trial('incorrect', 'inconclusive'),
            trial('correct', 'verified'),
            trial('incorrect', 'contradicted'),
        ]);

        expect(report.falseDisagreeRate).toBe(0);
        expect(report.falseAgreeRate).toBe(0);
        expect(report.inconclusiveRate).toBeCloseTo(0.5, 5);
    });

    it('excludes inconclusive trials from BOTH denominators', () => {
        // Otherwise a model that abstained on everything would post a perfect 0% on both error rates.
        const report = scoreBakeOff('m', [
            trial('correct', 'inconclusive'),
            trial('correct', 'inconclusive'),
            trial('correct', 'contradicted'),
        ]);

        // One judged correct line, and it was contradicted: 100%, not 33%.
        expect(report.falseDisagreeRate).toBe(1);
    });

    it('reports a rate of ZERO — not NaN — when a class has no judged trials', () => {
        // A corpus slice with no incorrect parses is a real thing (the residual is not balanced). `0/0` would
        // put NaN into the report, and NaN loses every comparison silently, so the WORSE model would win a
        // `<` test against it.
        const report = scoreBakeOff('m', [trial('correct', 'verified')]);

        expect(report.falseAgreeRate).toBe(0);
        expect(Number.isNaN(report.falseAgreeRate)).toBe(false);
    });

    it('counts structured-output failures by stop reason, for KTD-4’s open risk', () => {
        // KTD-4: "Nova's structured-output enforcement strength is unverified". This is the measurement that
        // closes it, and it is a COUNT per cause rather than a single failure rate, because
        // `malformed_model_output` and `max_tokens` call for different fixes.
        const report = scoreBakeOff('m', [
            trial('correct', 'inconclusive', { stopReason: 'malformed_model_output' }),
            trial('correct', 'inconclusive', { stopReason: 'malformed_model_output' }),
            trial('correct', 'inconclusive', { stopReason: 'max_tokens' }),
            trial('correct', 'verified'),
        ]);

        expect(report.stopReasons).toEqual({ end_turn: 1, malformed_model_output: 2, max_tokens: 1 });
    });

    it('totals the measured cost, so KTD-4’s ~30x model spread is a number rather than an estimate', () => {
        const report = scoreBakeOff('m', [
            trial('correct', 'verified', { costMicros: 30 }),
            trial('correct', 'verified', { costMicros: 45 }),
        ]);

        expect(report.totalCostMicros).toBe(75);
        expect(report.meanCostMicros).toBeCloseTo(37.5, 5);
    });

    it('reports the model it scored, so two reports cannot be confused', () => {
        expect(scoreBakeOff('amazon.nova-micro-v1:0', [trial('correct', 'verified')]).modelId).toBe(
            'amazon.nova-micro-v1:0',
        );
    });

    it('handles an empty corpus without dividing by zero', () => {
        const report = scoreBakeOff('m', []);

        expect(report.trials).toBe(0);
        expect(report.falseAgreeRate).toBe(0);
        expect(report.meanCostMicros).toBe(0);
    });

    it('reports POSITION-BIAS DISAGREEMENT across a swapped pair', () => {
        // Plan U11: mitigate position bias "with swap augmentation (10–15 points)". A line judged one way in
        // one candidate order and the other way when the order is swapped is not a verdict — it is a
        // measurement of the model's sensitivity to presentation. Counting it is what makes the mitigation
        // verifiable rather than asserted.
        const report = scoreBakeOff('m', [
            trial('correct', 'verified', { lineId: 'a', swapVariant: 'original' }),
            trial('correct', 'contradicted', { lineId: 'a', swapVariant: 'swapped' }),
            trial('correct', 'verified', { lineId: 'b', swapVariant: 'original' }),
            trial('correct', 'verified', { lineId: 'b', swapVariant: 'swapped' }),
        ]);

        // Line `a` flipped; line `b` did not.
        expect(report.swapDisagreements).toBe(1);
        expect(report.swapPairs).toBe(2);
    });

    it('does not count an unpaired trial as a swap agreement', () => {
        // A line whose swapped variant failed (a throttle, a DLQ) has NOT been shown stable. Counting it as
        // agreeing would make the bias measurement improve every time the run got flakier.
        const report = scoreBakeOff('m', [trial('correct', 'verified', { lineId: 'a', swapVariant: 'original' })]);

        expect(report.swapPairs).toBe(0);
        expect(report.swapDisagreements).toBe(0);
    });
});
