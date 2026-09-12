/**
 * @module headlineFigures — U15's three headline numbers, derived from the import report's counters.
 *
 * ## Why three, and why they are not interchangeable
 *
 * The plan (U15) asks for "resolution rate, an adjudicated accuracy figure over a random sample, and the
 * share of lines surfaced to a user for correction — the friction metric the origin names as the abandonment
 * risk", and says why: **rate alone is gameable, because a system that resolves confidently wrong raises
 * it.** The report counted the ingredients of all three and derived none of them, so the release had no
 * headline evidence.
 *
 * ## ⛔ The unit trap this report has already been burned by
 *
 * `foodBacked` counts LINES. `foodResolvedIngredients` counts DISTINCT INGREDIENTS. `ImportReportData`'s own
 * docstring records that presenting those two as a ratio "understated resolution by roughly 4x" — one
 * ingredient backs many lines ("butter" appeared 138 times in a single run). Every field below therefore
 * carries its denominator IN ITS NAME, and nothing here divides a line count by an ingredient count.
 *
 * ## ⛔ Accuracy is withheld, never estimated
 *
 * A machine can propose a match; it cannot adjudicate its own match. {@link headlineFigures} returns
 * `adjudicatedAccuracy: undefined` and emits a sample instead — the same posture as the judgement set's
 * `observedAgreementRate`, which withholds a rate from a single-annotator set rather than returning the
 * flattering 1.0 it could compute. A figure derived from the importer's own verdicts would report that the
 * system agrees with itself.
 */
import type { ImportReportData } from './importReport.js';
import type { IngredientResolutionKind } from './resolveIngredient.js';

/** One resolved line put forward for a human to judge. */
export interface AdjudicationCandidate {
    /** The recipe the line came from, so a judge can read it in context. */
    readonly recipeId: string;
    /** The phrase the book gave, verbatim — what the match is judged AGAINST. */
    readonly phrase: string;
    /** The food the system chose for it. */
    readonly foodId: string;
    /** Which rung of the ladder chose it. */
    readonly kind: IngredientResolutionKind;
}

/** The three figures, plus the sample the third one waits on. */
export interface HeadlineFigures {
    /**
     * Lines that reached a row carrying a real `food_id`, over lines submitted.
     *
     * `undefined` when no lines ran — "we did not measure", which zero would misreport as "we measured, and
     * it was terrible".
     */
    readonly resolutionRateOfLines: number | undefined;
    /**
     * Lines a cook would have to fix by hand, over lines submitted.
     *
     * ⛔ NOT one minus the rate, and the difference is the whole point of reporting both. A `local_suggestion`
     * can carry no `food_id` at all (it is one of the caller's own freeform rows from an earlier import), so
     * it counts against the RATE while needing no correction; an `added_by_name` line is food-backed while
     * still pending. Only a `freeform` line ends with nothing to show nutrition from, which is what puts a
     * correction in front of a person.
     */
    readonly correctionSurfacedShareOfLines: number | undefined;
    /** Adjudicated accuracy over {@link adjudicationSample} — `undefined` until a human has judged it. */
    readonly adjudicatedAccuracy: undefined;
}

/**
 * Derive the headline figures from a completed run.
 *
 * @param report - The run's counters.
 * @returns The three figures. Pure.
 */
export function headlineFigures(report: ImportReportData): HeadlineFigures {
    const share = (part: number): number | undefined =>
        report.ingredientLines === 0 ? undefined : part / report.ingredientLines;

    return {
        resolutionRateOfLines: share(report.foodBacked),
        correctionSurfacedShareOfLines: share(report.resolutionKinds.freeform),
        adjudicatedAccuracy: undefined,
    };
}

/**
 * Draw a reproducible, spread sample of resolved lines for adjudication.
 *
 * ⚠️ DETERMINISTIC BY CONSTRUCTION — no `Math.random()`. U15 requires the run to be "reproducible from a
 * committed corpus manifest", and a sample nobody can redraw cannot be re-adjudicated, re-checked, or
 * compared against the next release's. The draw is evenly spaced through the run rather than the first N,
 * because the first N are whatever book the run happened to open with.
 *
 * Only lines that CLAIM a food are drawn: an unresolved line has made no claim, so there is nothing for a
 * judge to agree or disagree with. Its cost is already counted by
 * {@link HeadlineFigures.correctionSurfacedShareOfLines}.
 *
 * @param report - The run's report, whose `examples` carry the per-line detail.
 * @param size - How many candidates to draw. Fewer are returned when fewer exist.
 * @returns The drawn candidates, in run order. Pure.
 */
export function adjudicationSample(report: ImportReportData, size: number): readonly AdjudicationCandidate[] {
    const claims: AdjudicationCandidate[] = report.examples.flatMap((example) =>
        example.lines
            .filter((line): line is typeof line & { foodId: string } => line.foodId !== undefined)
            .map((line) => ({
                recipeId: example.recipeId,
                phrase: line.name,
                foodId: line.foodId,
                kind: line.kind,
            })),
    );

    if (size <= 0 || claims.length === 0) {
        return [];
    }

    if (claims.length <= size) {
        return claims;
    }

    // Evenly spaced indices across the whole run. Integer arithmetic on the position keeps the draw stable
    // across platforms in a way a floating step accumulated in a loop would not.
    return Array.from({ length: size }, (_, position) =>
        claims.at(Math.floor((position * claims.length) / size)),
    ).filter((candidate): candidate is AdjudicationCandidate => candidate !== undefined);
}
