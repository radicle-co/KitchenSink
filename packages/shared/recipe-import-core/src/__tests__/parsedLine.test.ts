/**
 * THE PROJECTION'S LOSSINESS IS THE SUBJECT (U16, KTD-18).
 *
 * `ParsedLine` is the canonical parse: many foods, a preparation per food, and the measure the source
 * stated in its own words. `ParsedIngredientLine` is the NARROW shape one caller already compiles
 * against. What is under test here is not that the two share fields — it is exactly what the narrowing
 * throws away, and which of those losses the reader is told about.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U16 — a multi-food line projects to the first food and SAYS the rest were dropped | "the foods it cannot carry" |
 * | U16 — a single-food line round-trips with no review reason | "round-trips a clean single-food line" |
 * | KTD-11b — preparation is never concatenated into identity, in either direction | "preparation, which KTD-11b files apart from identity" |
 * | U16 — a stated measure survives the projection | "carries the measure through as the quantity and unit it was read into" |
 * | R40 — `absent` is never a `0` and never a fabricated `1` | "preserves an absent quantity" |
 *
 * ⚠️ Several tests assert an ABSENCE — a reason NOT raised, a word NOT moved. Those are the ones that
 * would still pass against a projection that did nothing at all, so each is paired with a positive case
 * that fails the moment the rule is inverted.
 */
import { ABSENT_QUANTITY, statedQuantity } from '@kitchensink/recipe-core';
import { describe, it, expect } from 'vitest';

import { corruptsStatedValue, type IngredientReviewReason } from '../ingredientLine.js';
import { projectToIngredientLine, type ParsedFacts, type ParseEngine, type ParseProvenance } from '../parsedLine.js';

import { makeParsedFood, makeParsedLine } from './__fixtures__/makeParsedLine.js';

/**
 * ⛔ COMPILE-TIME, and it is the whole guarantee that provenance cannot fall behind the facts.
 *
 * `ParseProvenance` is DERIVED from `ParsedFacts` by a mapped type, so a fact added there without a
 * provenance entry is a type error rather than a field nobody can attribute. This line fails to compile
 * if that derivation is ever replaced by a hand-written list that drifts.
 */
const PROVENANCE_COVERS_EVERY_FACT: Record<keyof ParsedFacts, ParseEngine> = {
    statedMeasure: 'crf',
    quantity: 'llm',
    unit: 'crf',
    foods: 'llm',
} satisfies ParseProvenance;

describe('projectToIngredientLine', () => {
    describe('the foods it cannot carry', () => {
        it('projects a multi-food line onto its FIRST food', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    raw: 'one-half cup each of chopped onion, celery and carrot',
                    foods: [
                        makeParsedFood('onion', 'chopped'),
                        makeParsedFood('celery', 'chopped'),
                        makeParsedFood('carrot', 'chopped'),
                    ],
                }),
            );

            expect(projected.name).toBe('onion');
        });

        it('says the rest were dropped, so nobody reads the narrow line as the whole line', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({ foods: [makeParsedFood('onion'), makeParsedFood('celery')] }),
            );

            expect(projected.reviewReasons).toContain('additional_foods_dropped');
            expect(projected.needsReview).toBe(true);
        });

        it('raises the reason ONCE however many foods were dropped', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    foods: [makeParsedFood('a'), makeParsedFood('b'), makeParsedFood('c'), makeParsedFood('d')],
                }),
            );

            expect(projected.reviewReasons.filter((reason) => reason === 'additional_foods_dropped')).toHaveLength(1);
        });

        it('does not raise it for a single-food line, which loses no food at all', () => {
            const projected = projectToIngredientLine(makeParsedLine({ foods: [makeParsedFood('butter')] }));

            expect(projected.reviewReasons).not.toContain('additional_foods_dropped');
        });

        it('does not raise it twice when the producer already recorded it', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    foods: [makeParsedFood('onion'), makeParsedFood('celery')],
                    reviewReasons: ['additional_foods_dropped'],
                }),
            );

            expect(projected.reviewReasons).toEqual(['additional_foods_dropped']);
        });

        it('projects a line that named no food to an empty name, inventing no reason of its own', () => {
            const projected = projectToIngredientLine(makeParsedLine({ foods: [], reviewReasons: ['group_header'] }));

            expect(projected.name).toBe('');
            expect(projected.reviewReasons).toEqual(['group_header']);
        });
    });

    describe('what survives', () => {
        it('round-trips a clean single-food line with no review reason', () => {
            const projected = projectToIngredientLine(makeParsedLine());

            expect(projected).toEqual({
                raw: '1 tablespoon butter',
                quantity: { kind: 'exact', value: 1 },
                unit: 'tablespoon',
                name: 'butter',
                needsReview: false,
                reviewReasons: [],
            });
        });

        it('keeps `raw` byte-identical, including the whitespace nobody trimmed (HAZ-041)', () => {
            const raw = '  2 to 3  CUPS   flour  ';

            expect(projectToIngredientLine(makeParsedLine({ raw })).raw).toBe(raw);
        });

        it('carries the measure through as the quantity and unit it was read into', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    raw: '2 to 3 cups flour',
                    statedMeasure: '2 to 3 cups',
                    quantity: statedQuantity(2, 3) ?? ABSENT_QUANTITY,
                    unit: 'cup',
                    foods: [makeParsedFood('flour')],
                }),
            );

            expect(projected.quantity).toEqual({ kind: 'range', low: 2, high: 3 });
            expect(projected.unit).toBe('cup');
        });

        it('preserves an absent quantity — never a `0`, never a fabricated `1` (R40)', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    raw: 'butter the size of an egg',
                    statedMeasure: 'the size of an egg',
                    quantity: ABSENT_QUANTITY,
                    unit: null,
                    foods: [makeParsedFood('butter')],
                    reviewReasons: ['no_quantity'],
                }),
            );

            expect(projected.quantity).toEqual({ kind: 'absent' });
            expect(projected.quantity).not.toEqual({ kind: 'exact', value: 0 });
            expect(projected.quantity).not.toEqual({ kind: 'exact', value: 1 });
            expect(projected.unit).toBeNull();
        });

        it("keeps the producer's own reasons, in order, ahead of the one the projection adds", () => {
            const produced: readonly IngredientReviewReason[] = ['measurement_in_name', 'name_too_long'];
            const projected = projectToIngredientLine(
                makeParsedLine({
                    foods: [makeParsedFood('onion'), makeParsedFood('celery')],
                    reviewReasons: produced,
                }),
            );

            expect(projected.reviewReasons).toEqual([...produced, 'additional_foods_dropped']);
        });

        it('sets needsReview to exactly "there is a reason"', () => {
            expect(projectToIngredientLine(makeParsedLine({ reviewReasons: [] })).needsReview).toBe(false);
            expect(projectToIngredientLine(makeParsedLine({ reviewReasons: ['group_header'] })).needsReview).toBe(true);
        });
    });

    describe('preparation, which KTD-11b files apart from identity', () => {
        it('never concatenates prep into the name', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    raw: 'one-half cup of chopped onions',
                    foods: [makeParsedFood('onions', 'chopped')],
                }),
            );

            expect(projected.name).toBe('onions');
            expect(projected.name).not.toContain('chopped');
        });

        it('never moves an adjective the other way, out of the name (KTD-11b: an adjective is identity)', () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    raw: 'one cup of blanched sweet almonds',
                    foods: [makeParsedFood('sweet almonds', 'blanched')],
                }),
            );

            expect(projected.name).toBe('sweet almonds');
        });

        it('drops prep with no review reason, because prep is not identity and the name is unharmed', () => {
            const projected = projectToIngredientLine(makeParsedLine({ foods: [makeParsedFood('butter', 'melted')] }));

            expect(projected.reviewReasons).toEqual([]);
            expect(projected.needsReview).toBe(false);
        });
    });

    describe('what it silently drops, characterized so the loss stays deliberate', () => {
        it('returns the narrow shape and nothing more — no statedMeasure, no prep, no provenance', () => {
            const projected = projectToIngredientLine(makeParsedLine());

            expect(Object.keys(projected).sort()).toEqual([
                'name',
                'needsReview',
                'quantity',
                'raw',
                'reviewReasons',
                'unit',
            ]);
        });

        it("drops a measure that was never read into a number, without restating the producer's taxonomy", () => {
            const projected = projectToIngredientLine(
                makeParsedLine({
                    raw: 'a little vinegar',
                    statedMeasure: 'a little',
                    quantity: ABSENT_QUANTITY,
                    unit: null,
                    foods: [makeParsedFood('vinegar')],
                    reviewReasons: ['no_quantity'],
                }),
            );

            expect(projected.reviewReasons).toEqual(['no_quantity']);
        });

        it('names the engine per fact on the canonical line, which the projection then cannot carry', () => {
            expect(PROVENANCE_COVERS_EVERY_FACT.quantity).toBe('llm');
            expect(Object.keys(projectToIngredientLine(makeParsedLine()))).not.toContain('provenance');
        });
    });
});

/**
 * R39 — `cookbook-import` DROPS a clause whose reason means the number would be wrong. A dropped SECOND
 * food is the same shape as `multiline_input`: content is missing, but the first food's amount and unit
 * are exactly what the source stated. Filing it as value-corrupting would discard the whole line to avoid
 * an understatement it does not commit.
 */
describe('corruptsStatedValue, on the reason the projection adds', () => {
    it('reports additional_foods_dropped as NOT value-corrupting, because it names an absence', () => {
        expect(corruptsStatedValue('additional_foods_dropped')).toBe(false);
    });
});
