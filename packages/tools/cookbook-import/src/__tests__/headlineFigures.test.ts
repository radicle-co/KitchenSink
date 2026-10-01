/**
 * U15's three headline figures — the numbers that say whether any of the plan worked.
 *
 * ## Why three numbers and not one
 *
 * The plan is explicit: "record **resolution rate**, an **adjudicated accuracy** figure over a random sample,
 * and the **share of lines surfaced to a user for correction** — the friction metric the origin names as the
 * abandonment risk. Rate alone is gameable: a system that resolves confidently wrong raises it."
 *
 * The report already counted the ingredients of these figures and never derived them, so the release had no
 * headline evidence at all. This file derives them, and pins the three ways deriving them can lie.
 *
 * ## ⛔ The unit trap, which this report has already been burned by once
 *
 * `foodBacked` counts LINES; `foodResolvedIngredients` counts DISTINCT INGREDIENTS. `ImportReportData`'s own
 * docstring records that presenting the two as a ratio "understated resolution by roughly 4x" — one
 * ingredient backs many lines ("butter" appeared 138 times in a single run). Every figure below therefore
 * states its denominator in its name and NONE of them divides a line count by an ingredient count.
 *
 * ## ⛔ Accuracy is WITHHELD, not estimated
 *
 * A machine can propose a match; it cannot adjudicate its own match. `adjudicatedAccuracy` is `undefined`
 * until a human has judged the sample, exactly as `observedAgreementRate` withholds a rate from a
 * single-annotator judgement set rather than returning a flattering 1.0. A number computed from the
 * importer's own verdicts would say "the system agrees with itself", which is not a measurement.
 */
import { describe, expect, it } from 'vitest';

import { adjudicationSample, headlineFigures } from '../headlineFigures.js';
import { emptyReport, type ImportReportData } from '../importReport.js';

/** A report with the counters the figures read, defaulted to a run that resolved nothing. */
function reportWith(overrides: Partial<ImportReportData>): ImportReportData {
    return { ...emptyReport('test-book'), ...overrides };
}

describe('headlineFigures', () => {
    it('reports the resolution rate over LINES', () => {
        const figures = headlineFigures(reportWith({ ingredientLines: 200, foodBacked: 150 }));

        expect(figures.resolutionRateOfLines).toBeCloseTo(0.75, 5);
    });

    it('reports the correction-surfaced share over LINES', () => {
        // A `freeform` line carries no food at all: nothing to show nutrition from, so a cook must fix it.
        const figures = headlineFigures(
            reportWith({
                ingredientLines: 200,
                resolutionKinds: { local_suggestion: 120, catalog_suggestion: 30, added_by_name: 20, freeform: 30 },
            }),
        );

        expect(figures.correctionSurfacedShareOfLines).toBeCloseTo(0.15, 5);
    });

    it('⛔ does NOT define the surfaced share as one-minus-the-rate', () => {
        // They are independent, and collapsing them would make the second figure decorative. A local
        // suggestion can carry NO `food_id` (it is one of the caller's own freeform rows from an earlier
        // import) — so it counts against the rate while needing no correction; and an `added_by_name` line
        // IS food-backed while still pending. Same denominator, different questions.
        const figures = headlineFigures(
            reportWith({
                ingredientLines: 100,
                foodBacked: 60,
                resolutionKinds: { local_suggestion: 30, catalog_suggestion: 40, added_by_name: 20, freeform: 10 },
            }),
        );

        expect(figures.resolutionRateOfLines).toBeCloseTo(0.6, 5);
        expect(figures.correctionSurfacedShareOfLines).toBeCloseTo(0.1, 5);
        expect(figures.correctionSurfacedShareOfLines).not.toBeCloseTo(1 - 0.6, 5);
    });

    it('withholds every rate when nothing ran, rather than reporting zero', () => {
        // Zero would read as "we measured, and it was terrible". `undefined` reads as "we did not measure".
        const figures = headlineFigures(reportWith({ ingredientLines: 0 }));

        expect(figures.resolutionRateOfLines).toBeUndefined();
        expect(figures.correctionSurfacedShareOfLines).toBeUndefined();
    });

    it('⛔ withholds adjudicated accuracy until a human has judged the sample', () => {
        const figures = headlineFigures(reportWith({ ingredientLines: 200, foodBacked: 150 }));

        expect(figures.adjudicatedAccuracy).toBeUndefined();
    });
});

describe('adjudicationSample', () => {
    /** A report whose examples carry `size` resolved lines, named so the draw is observable. */
    function reportWithLines(size: number): ImportReportData {
        return reportWith({
            examples: [
                {
                    recipeId: '11111111-1111-4111-8111-111111111111',
                    title: 'Sample',
                    lines: Array.from({ length: size }, (_, index) => ({
                        quantity: { kind: 'exact' as const, value: index + 1 },
                        unit: 'g',
                        name: `ingredient ${String(index).padStart(3, '0')}`,
                        kind: 'catalog_suggestion' as const,
                        foodId: `food_${index}`,
                        foodResolutionStatus: 'RESOLVED',
                    })),
                },
            ],
        });
    }

    it('is REPRODUCIBLE — the same report draws the same sample', () => {
        // U15 requires "the run is reproducible from a committed corpus manifest". A sample drawn with
        // `Math.random()` cannot be re-adjudicated, re-checked, or compared across releases.
        const report = reportWithLines(50);

        expect(adjudicationSample(report, 10)).toStrictEqual(adjudicationSample(report, 10));
    });

    it('spreads the draw across the run rather than taking the first N', () => {
        // The first N are whatever the book happened to open with. A spread draw is what makes the sample
        // representative of the corpus instead of of its first recipe.
        const names = adjudicationSample(reportWithLines(50), 5).map((candidate) => candidate.phrase);

        expect(names).toHaveLength(5);
        expect(new Set(names).size).toBe(5);
        expect(names).not.toStrictEqual([
            'ingredient 000',
            'ingredient 001',
            'ingredient 002',
            'ingredient 003',
            'ingredient 004',
        ]);
    });

    it('draws only lines that CLAIM a food — an unresolved line has no claim to adjudicate', () => {
        const report = reportWith({
            examples: [
                {
                    recipeId: '11111111-1111-4111-8111-111111111111',
                    title: 'Sample',
                    lines: [
                        {
                            quantity: { kind: 'exact', value: 1 },
                            unit: 'g',
                            name: 'resolved',
                            kind: 'catalog_suggestion',
                            foodId: 'food_a',
                            foodResolutionStatus: 'RESOLVED',
                        },
                        {
                            quantity: { kind: 'exact', value: 1 },
                            unit: 'g',
                            name: 'freeform',
                            kind: 'freeform',
                            foodId: undefined,
                            foodResolutionStatus: undefined,
                        },
                    ],
                },
            ],
        });

        expect(adjudicationSample(report, 10).map((candidate) => candidate.phrase)).toStrictEqual(['resolved']);
    });

    it('never draws more than exist', () => {
        expect(adjudicationSample(reportWithLines(3), 10)).toHaveLength(3);
    });
});
