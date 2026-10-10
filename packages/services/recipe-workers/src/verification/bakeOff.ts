/**
 * THE BAKE-OFF'S SCORING (plan U11 / KTD-4, KTD-5) — the arithmetic that picks which model ships.
 *
 * DESIGN PATTERN: **pure reducer.** No I/O, no model, no clock. The runner (`scripts/verificationBakeOff.ts`)
 * does the calling; this decides what the calls MEAN.
 *
 * ## ⛔ WHY THE SCORING IS SEPARATE FROM THE RUN
 *
 * The bake-off is the most expensive thing in this unit to execute: 2,432 lines x 2 models x 2 swap orders is
 * ~9,700 billed calls, and at `reservedConcurrency = 1` and ~1s per call that is roughly two hours
 * serialized. An arithmetic error discovered after that run costs the whole run again. So every number that
 * decides the outcome is computed here, where it is a truth table.
 *
 * ## ⛔ THERE IS NO `accuracy` FIELD, AND THAT IS THE POINT
 *
 * The two error directions are not symmetric and must never be averaged:
 *
 *  - A **false agree** passes data that would have shipped anyway — no worse than today.
 *  - A **false disagree** withholds nutrition from a CORRECT line, which IS worse than today. The plan names
 *    its rate as "the number that triggers a rethink", including a fallback to observe-only.
 *
 * A single accuracy figure is exactly what would let a model with an unacceptable false-disagree rate win on
 * the strength of its false-agree rate. The owner ruling is "ship the winner and improve from there", so the
 * bake-off SELECTS rather than gates — which makes it more important, not less, that the number a human reads
 * is the one that matters.
 *
 * ## ⚠️ CALIBRATE ON THE RESIDUAL, and record both numbers
 *
 * The plan is explicit: the gate sees a systematically different distribution from the corpus as a whole. The
 * bake-off runs on the full corpus for comparability, but the committed thresholds come from the residual
 * slice. This module scores whatever it is handed; the runner is what decides which slice that is, and
 * reports both so they cannot be confused later.
 */

/** One judged line, from one model, in one candidate order. */
export interface BakeOffTrial {
    /** Stable id for the corpus line. Pairs the two swap variants. */
    readonly lineId: string;
    /** GROUND TRUTH from the labelled corpus: was our parse actually right? */
    readonly parseIsCorrect: boolean;
    /** The band the gate produced — `verified`, `contradicted` or `inconclusive`. */
    readonly band: string;
    /** The response's stop reason, for the structured-output census. */
    readonly stopReason: string;
    /** What this call cost, in micro-dollars. */
    readonly costMicros: number;
    /** Which candidate ordering this trial used. Absent for an unaugmented run. */
    readonly swapVariant?: 'original' | 'swapped' | undefined;
}

/** What one model scored. */
export interface BakeOffReport {
    readonly modelId: string;
    readonly trials: number;
    /**
     * ⛔ THE NUMBER THAT TRIGGERS A RETHINK. Correct parses the model contradicted, over correct parses it
     * JUDGED (inconclusive excluded — see {@link BakeOffReport.inconclusiveRate}).
     */
    readonly falseDisagreeRate: number;
    /** Incorrect parses the model passed, over incorrect parses it judged. The tolerable direction. */
    readonly falseAgreeRate: number;
    /**
     * Trials the model declined to judge.
     *
     * Its own number, not folded into either error rate: an abstention publishes, so it cannot be a false
     * disagree, and it is not an endorsement, so counting it as a false agree would penalise the honesty the
     * prompt asks for. ⚠️ Read it FIRST — a model that abstained on half the corpus has not been evaluated on
     * that half, whatever its other two rates say.
     */
    readonly inconclusiveRate: number;
    /** How many trials ended with each stop reason. KTD-4's open risk, measured. */
    readonly stopReasons: Readonly<Record<string, number>>;
    readonly totalCostMicros: number;
    readonly meanCostMicros: number;
    /** Lines that were run in BOTH candidate orders. */
    readonly swapPairs: number;
    /**
     * Paired lines whose band FLIPPED when the order was swapped.
     *
     * Plan U11 mitigates position bias with swap augmentation; this is the measurement that makes the
     * mitigation verifiable rather than asserted. A flipped line is not a verdict — it is a measurement of
     * the model's sensitivity to presentation.
     */
    readonly swapDisagreements: number;
}

/** A rate that is 0 rather than NaN when the denominator is empty. */
function rate(numerator: number, denominator: number): number {
    // ⛔ NaN loses EVERY comparison silently, so a `<` test between two reports would pick the wrong model
    // without erroring. A corpus slice with no incorrect parses is a real thing — the residual is not
    // balanced — so this branch is reachable, not defensive.
    return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Score one model's trials.
 *
 * @param modelId - The model these trials came from. Carried into the report so two cannot be confused.
 * @param trials - Every judged line.
 * @returns The report. Pure.
 */
export function scoreBakeOff(modelId: string, trials: readonly BakeOffTrial[]): BakeOffReport {
    const judged = trials.filter((item) => item.band !== 'inconclusive');
    const judgedCorrect = judged.filter((item) => item.parseIsCorrect);
    const judgedIncorrect = judged.filter((item) => !item.parseIsCorrect);

    const stopReasons: Record<string, number> = {};

    for (const item of trials) {
        stopReasons[item.stopReason] = (stopReasons[item.stopReason] ?? 0) + 1;
    }

    const totalCostMicros = trials.reduce((sum, item) => sum + item.costMicros, 0);

    // Pair the swap variants by line. A line whose swapped variant never completed (a throttle, a DLQ) is NOT
    // a pair: counting it as agreeing would make the bias measurement improve every time the run got flakier.
    const byLine = new Map<string, { original?: string; swapped?: string }>();

    for (const item of trials) {
        if (item.swapVariant === undefined) {
            continue;
        }

        const entry = byLine.get(item.lineId) ?? {};
        entry[item.swapVariant] = item.band;
        byLine.set(item.lineId, entry);
    }

    const pairs = [...byLine.values()].filter((entry) => entry.original !== undefined && entry.swapped !== undefined);

    return {
        modelId,
        trials: trials.length,
        falseDisagreeRate: rate(
            judgedCorrect.filter((item) => item.band === 'contradicted').length,
            judgedCorrect.length,
        ),
        falseAgreeRate: rate(judgedIncorrect.filter((item) => item.band === 'verified').length, judgedIncorrect.length),
        inconclusiveRate: rate(trials.length - judged.length, trials.length),
        stopReasons,
        totalCostMicros,
        meanCostMicros: rate(totalCostMicros, trials.length),
        swapPairs: pairs.length,
        swapDisagreements: pairs.filter((entry) => entry.original !== entry.swapped).length,
    };
}
