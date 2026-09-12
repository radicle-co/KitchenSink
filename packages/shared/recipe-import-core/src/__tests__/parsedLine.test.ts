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
import { readFileSync } from 'node:fs';

import { ABSENT_QUANTITY, statedQuantity } from '@kitchensink/recipe-core';
import { PARSE_ENGINES } from '@kitchensink/recipe-core/parsing/parse-key';
import { describe, it, expect } from 'vitest';

import { corruptsStatedValue, type IngredientReviewReason } from '../ingredientLine.js';
import {
    projectToIngredientLine,
    type ParsedFacts,
    type ParseEngine,
    type ParseFactSource,
    type ParseProvenance,
} from '../parsedLine.js';

import { makeParsedFood, makeParsedLine } from './__fixtures__/makeParsedLine.js';

/**
 * Type-level equality, in the form `recipe-workers`' `llmParse.test.ts` and `recipe-core`'s
 * `parsePrompt.test.ts` already use. Invariant position, so a merely-assignable type fails.
 */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

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

/**
 * ⛔ U31 CANNOT REACH THROUGH THIS PROJECTION, AND HERE IS WHY — with the one loss that DOES survive.
 *
 * U31 is "`parseIngredientLine` folds measurements into the food name". Its close asked whether the same
 * defect arrives here, since `ParsedIngredientLine` is now reachable by two routes. It does not, and the
 * reason is structural rather than lucky: the narrow `name` is `ParsedFood.name` verbatim, and this
 * function performs NO text surgery at all. `takeMeasurementOutOf` — the strip that both caused and cured
 * U31 — never runs on this path. What lands in `name` is whatever the ENGINE put in `ParsedFood.name`,
 * which the contract defines as identity plus adjectives, so a measurement there is that engine's defect
 * to answer for and the comparator's (U19) to catch.
 *
 * ⚠️ Asserting that is not a formality. "The projection should clean the name up" is an obvious-looking
 * improvement, and it would be wrong twice over: it would put a second, drifting copy of a rule that lives
 * in `ingredientLine.ts`, and it would break this function's stated contract that it reports only the loss
 * IT causes.
 *
 * ⚠️ What DOES survive is the other half of U31's third row. A vague measure — `"a handful"`, `"the size
 * of an egg"` — is held by `statedMeasure`, which this projection drops. That is accepted, not overlooked:
 * `raw` comes through byte-identical, so the words are still there; only the SEGMENTATION is lost. See
 * this function's drop table, corrected on the same day.
 */
describe('projectToIngredientLine, on U31 — a measurement in the name', () => {
    it('does not clean the name, because the strip that owns that rule lives one module away', () => {
        const projected = projectToIngredientLine(
            makeParsedLine({
                raw: '2 cups and 1 tablespoon flour',
                statedMeasure: '2 cups and 1 tablespoon',
                unit: 'cup',
                foods: [makeParsedFood('and 1 tablespoon flour')],
            }),
        );

        expect(projected.name).toBe('and 1 tablespoon flour');
        expect(projected.reviewReasons).toEqual([]);
    });

    /**
     * ⚠️ The pair to the case above. If a producer DID notice the measurement, the reason travels — the
     * projection carries every reason the canonical line held. So the taxonomy is shared end to end, and
     * the only thing this function chooses not to do is DERIVE a reason nobody raised.
     */
    it('carries measurement_in_name through when the producer raised it', () => {
        const projected = projectToIngredientLine(
            makeParsedLine({
                raw: '2 cups and 1 tablespoon flour',
                foods: [makeParsedFood('flour')],
                reviewReasons: ['measurement_in_name'],
            }),
        );

        expect(projected.reviewReasons).toEqual(['measurement_in_name']);
        expect(projected.needsReview).toBe(true);
    });

    /**
     * ⛔ THE ACCEPTED LOSS, asserted so the next reader finds a decision instead of a bug. A measure no
     * number can hold is dropped as a FIELD and kept as WORDS: `statedMeasure` has nowhere to go in the
     * narrow shape, and `raw` still says `"a handful of fresh basil"`. Widening `ParsedIngredientLine` to
     * hold it is what U16 explicitly refused — it would leave the narrow shape canonical.
     */
    it('drops a vague measure as a field but keeps it in raw, and adds no reason of its own', () => {
        const projected = projectToIngredientLine(
            makeParsedLine({
                raw: 'a handful of fresh basil, torn',
                statedMeasure: 'a handful',
                quantity: ABSENT_QUANTITY,
                unit: null,
                foods: [makeParsedFood('fresh basil', 'torn')],
                reviewReasons: ['no_quantity'],
            }),
        );

        expect(projected).not.toHaveProperty('statedMeasure');
        expect(projected.raw).toBe('a handful of fresh basil, torn');
        expect(projected.quantity).toEqual({ kind: 'absent' });
        expect(projected.unit).toBeNull();
        // Exactly the producer's reason — nothing derived here, nothing swallowed.
        expect(projected.reviewReasons).toEqual(['no_quantity']);
    });
});

/**
 * ⛔ ONE `ParseEngine`, AND A SEPARATE AXIS FOR A CORRECTION (ADR-0026's two contract defects).
 *
 * Both defects are of the INVISIBLE kind, and the first one cannot be caught by a type assertion at all —
 * which is why the first test below reads the module's SOURCE.
 *
 *  - **`ParseEngine` was declared twice**, here and in `recipe-core/src/parsing/parseKey.ts`, as two
 *    structurally identical unions. `Exact<A, B>` is `true` for two copies of `'crf' | 'llm'`, so no
 *    type-level assertion can tell a re-export from a duplicate, and neither can `tsc`. What CAN be
 *    asserted is the property that actually matters — that this module holds no second declaration — and
 *    the shape for that is the source-reading guard `packages/infra/global/__tests__/` uses for the same
 *    class of problem.
 *  - **`ParseProvenance` had no inhabitant for a human correction.** U21's correction tier ships, and a
 *    cook is neither `crf` nor `llm`, so its output was untypeable. The fix is a SECOND AXIS —
 *    `ParseFactSource` — and never a widening of `PARSE_ENGINES`, which is
 *    `ingredient_parse_cache.engine`'s CHECK-constrained key domain: a third member there is, in that
 *    module's own words, "a compile error and a migration".
 */
describe('⛔ the parse contract`s two source axes', () => {
    it('holds no ParseEngine declaration of its own, and re-exports the cache`s key domain instead', () => {
        const source = readFileSync(new URL('../parsedLine.ts', import.meta.url), 'utf8');

        // A local declaration in ANY of its spellings — `type`, `enum`, `interface` — is the defect.
        expect(source).not.toMatch(/^\s*(?:export\s+)?(?:type|enum|interface)\s+ParseEngine\b/mu);
        expect(source).toContain("from '@kitchensink/recipe-core/parsing/parse-key'");
    });

    /**
     * ⛔ COMPILE-TIME. `ParseFactSource` is the cache's engine set PLUS the human tier, DERIVED from the
     * runtime constant rather than respelled — so widening `PARSE_ENGINES` (which is a migration) shows up
     * here, and adding a non-engine source does NOT silently widen the cache's key domain.
     */
    it('names exactly the cache`s engines plus the correction tier', () => {
        const sourceIsEnginesPlusCorrection: Exact<ParseFactSource, (typeof PARSE_ENGINES)[number] | 'correction'> =
            true;
        const engineIsTheCacheKeyDomain: Exact<ParseEngine, (typeof PARSE_ENGINES)[number]> = true;

        expect(sourceIsEnginesPlusCorrection).toBe(true);
        expect(engineIsTheCacheKeyDomain).toBe(true);
        // ⛔ The axes are NOT the same set: a correction is representable as a fact's SOURCE and is not
        // representable as a cache row's ENGINE. Runtime, so it holds even where the types were collapsed.
        expect([...PARSE_ENGINES]).not.toContain('correction');
    });

    /**
     * ⛔ THE DEFECT, STATED AS BEHAVIOUR. A line whose amount a cook corrected and whose foods an engine
     * read is exactly what U21's tier produces, and it did not type before this repair.
     */
    it('lets a corrected fact sit beside an engine`s on one line', () => {
        const corrected = makeParsedLine({
            provenance: { statedMeasure: 'correction', quantity: 'correction', unit: 'correction', foods: 'llm' },
        });

        expect(corrected.provenance.quantity).toBe('correction');
        expect(projectToIngredientLine(corrected).name).toBe('butter');
    });

    /**
     * ⛔ `ParseProvenance` stays DERIVED from `ParsedFacts`. Changing its VALUE type must not turn its KEY
     * set into a hand-written list — that is the drift the mapped type exists to prevent.
     */
    it('still derives one source per fact, and no key that is not a fact', () => {
        const keysAreExactlyTheFacts: Exact<keyof ParseProvenance, keyof ParsedFacts> = true;
        const valuesAreTheSourceAxis: Exact<ParseProvenance[keyof ParsedFacts], ParseFactSource> = true;

        expect(keysAreExactlyTheFacts).toBe(true);
        expect(valuesAreTheSourceAxis).toBe(true);
    });
});
