/**
 * Unit tests for the not-a-food LEXICON — the words that name something a recipe does not CONTAIN.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22a — only a VESSEL answers "this span is not an ingredient" | "namesEquipment" |
 * | U22a — a vessel OR a duration answers "cutting this tail would delete a food" | "namesNoFood" |
 * | U22a — a DIMENSION is not a measure of an ingredient | "measuresNoSubstance" |
 * | Position ruling 2026-08-26 — the word-anywhere scan, and the precondition that makes it correct | "mentionsAVessel" |
 * | Position ruling 2026-08-26 — ONE tokenizer serves every question | "lastWordOf" |
 *
 * ## ⛔ Why this file exists, and what it is really guarding
 *
 * The module had no unit tests at all: every one of its predicates was exercised only through
 * `clauseSegmentation.ts`, so a change to the vocabulary could only fail through a policy that might
 * happen to mask it. That is the wrong place to learn that `pot roast` became equipment.
 *
 * The dangerous export is {@link mentionsAVessel}, which DELIBERATELY breaks this module's own head-final
 * discipline. Nothing about the function can enforce its precondition — that the caller passes a bounded
 * leading measure phrase — so the tests below assert the wrong usage IS wrong, in so many words. A reader
 * who sees `mentionsAVessel('one pound of pot roast') === true` and calls it on a whole span anyway has
 * been told.
 */
import { describe, expect, it } from 'vitest';

import { lastWordOf, measuresNoSubstance, mentionsAVessel, namesEquipment, namesNoFood } from '../notAFoodLexicon.js';

describe('lastWordOf — ONE tokenizer, so two questions cannot fold a word two ways', () => {
    it.each([
        ['a large preserving kettle', 'kettle'],
        ['Into', 'into'],
        ['drop them in ', 'in'],
        ['put it in a pan.', 'pan'],
        ['(a large bowl)', 'bowl'],
        // ⛔ The hyphen survives. `frying-pan` is one word in this book, and `fryingpan` is in no set.
        ['a small frying-pan', 'frying-pan'],
    ])('reduces %j to %j', (text, expected) => {
        expect(lastWordOf(text)).toBe(expected);
    });

    it.each([[''], ['   '], ['***']])('is total over %j', (text) => {
        expect(typeof lastWordOf(text)).toBe('string');
    });
});

describe('namesEquipment — head-final, because the noun a phrase is ABOUT sits at its end', () => {
    it.each([['a large preserving kettle'], ['a frying-pan'], ['one deep bowl'], ['two large kettles'], ['the stove']])(
        'reads %j as equipment',
        (text) => {
            expect(namesEquipment(text)).toBe(true);
        },
    );

    /**
     * ⛔ THE PROPERTY THE HEAD-FINAL RULE EXISTS FOR. Every phrase here MENTIONS a vessel word and is a
     * food. A test that merely listed equipment would pass on a word-anywhere implementation; these are
     * what fail on it.
     */
    it.each([
        ['one pound of pot roast'],
        ['two cups of pan gravy'],
        ['one dish of stewed prunes'],
        ['one-half pound of pot cheese'],
        ['a bowl of flour'],
        ['a large mixing bowl of batter'],
    ])('does NOT read %j as equipment, though it mentions a vessel', (text) => {
        expect(namesEquipment(text)).toBe(false);
    });

    it('is total over empty input', () => {
        expect(namesEquipment('')).toBe(false);
    });
});

describe('namesNoFood — the WIDER question, and the one that must never be asked of a whole span', () => {
    it.each([['a large kettle'], ['five minutes'], ['twenty minutes'], ['one-quarter inch'], ['four persons']])(
        'reads %j as naming no food',
        (text) => {
            expect(namesNoFood(text)).toBe(true);
        },
    );

    it.each([['two eggs'], ['one cup of water'], ['three lemons']])('still reads %j as a food', (text) => {
        expect(namesNoFood(text)).toBe(false);
    });

    /**
     * ⛔ The two predicates are NOT interchangeable, and the difference is a whole recipe. `three times` is
     * a duration: `namesNoFood` says so and `namesEquipment` must not, because a duration trailing a real
     * quantity is residue ON an ingredient rather than a reason to drop it. Widening `namesEquipment` to
     * this dropped `Sift one cup of flour three times` and cost two recipes.
     */
    it('parts company with namesEquipment on a duration', () => {
        expect(namesNoFood('one cup of flour three times')).toBe(true);
        expect(namesEquipment('one cup of flour three times')).toBe(false);
    });
});

describe('measuresNoSubstance — a DIMENSION is not a measure of an ingredient', () => {
    it.each([['inch'], ['inches'], ['minutes'], ['hours'], ['degrees'], ['persons']])(
        'reads %j as measuring no substance',
        (unit) => {
            expect(measuresNoSubstance(unit)).toBe(true);
        },
    );

    it.each([['cup'], ['tablespoon'], ['lb'], ['gill']])('still reads %j as a measure of food', (unit) => {
        expect(measuresNoSubstance(unit)).toBe(false);
    });
});

describe('mentionsAVessel — ⛔ the word-anywhere scan, and the precondition that makes it correct', () => {
    /**
     * What it is FOR: the leading measure phrase a preposition governs, already bounded by the caller at
     * the partitive `of` or an instruction boundary. Head-finality cannot answer these — `a large mixing
     * bowl whip` is head-final `whip`, a verb — which is precisely why this predicate exists.
     */
    it.each([
        ['a large mixing bowl whip'],
        ['a large bowl'],
        ['a large pan'],
        ['a dish'],
        ['a large preserving kettle'],
    ])('finds the vessel in the bounded measure phrase %j', (measurePhrase) => {
        expect(mentionsAVessel(measurePhrase)).toBe(true);
    });

    it.each([['one pound'], ['two cups'], ['one and one-half cups'], ['a teaspoon']])(
        'finds no vessel in %j, which is what a real measure phrase looks like',
        (measurePhrase) => {
            expect(mentionsAVessel(measurePhrase)).toBe(false);
        },
    );

    /**
     * ⛔⛔ THE MISUSE, ASSERTED AS TRUE SO NOBODY DISCOVERS IT ON A CORPUS. Handed a whole span instead of
     * a bounded measure phrase, this predicate calls real food equipment. Nothing in the function can stop
     * that — its precondition is documentation and a caller's discipline — so the failure is written down
     * here, in the suite, rather than left for a reader to assume it is safe.
     */
    it.each([['one pound of pot roast'], ['two cups of pan gravy'], ['one dish of stewed prunes']])(
        'WOULD wrongly report %j as a vessel if asked of a whole span — which is why it must not be',
        (wholeSpan) => {
            expect(mentionsAVessel(wholeSpan)).toBe(true);
            // The predicate a caller must use when it has not bounded the text itself.
            expect(namesEquipment(wholeSpan)).toBe(false);
        },
    );

    it.each([[''], ['   ']])('is total over %j', (measurePhrase) => {
        expect(mentionsAVessel(measurePhrase)).toBe(false);
    });
});
