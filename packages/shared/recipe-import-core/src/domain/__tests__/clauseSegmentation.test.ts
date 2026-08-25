/**
 * Unit tests for the clause SEGMENTER — where an ingredient span ends inside a clause of prose.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U22a — a vessel/duration/target riding on an ingredient clause never reaches a parse engine | "cuts the trailing instruction" |
 * | U22a — a tail that is a SECOND FOOD is never dropped | "refuses the cut" |
 * | U22a — equipment is not an ingredient at all | "reads a whole span of equipment as an instruction" |
 * | R29 — a boundary inside a quantity phrase is not a boundary | "never cuts inside a quantity phrase" |
 *
 * ## The property that carries the value, and the mutant that proves it
 *
 * The dangerous half of this module is not the cut, it is the REFUSAL. Dropping the tail of
 * `one-half pound chocolate in one cup of water` deletes a food the source states, and every case below
 * that begins "refuses" exists so that removing `statesASecondFood` fails the suite rather than
 * silently corrupting the corpus. A suite without those cases passes on the value-corrupting
 * implementation, which is the whole reason this file was written before the module.
 *
 * The examples are the ones KTD-11a measured on the 1919 corpus, quoted from the plan, not invented here.
 */
import { describe, expect, it } from 'vitest';

import { dropTrailingInstruction, segmentClause, type ClauseSegment } from '../clauseSegmentation.js';

/** Narrow to an ingredient segment, failing with the actual kind rather than an opaque undefined. */
function ingredientSegment(span: string): Extract<ClauseSegment, { kind: 'ingredient' }> {
    const segment = segmentClause(span);

    if (segment.kind !== 'ingredient') {
        throw new Error(`expected ${JSON.stringify(span)} to segment as an ingredient, got ${segment.kind}`);
    }

    return segment;
}

describe('segmentClause — the instruction that rode in on an ingredient clause (U22a)', () => {
    /**
     * ⛔ THE DEFECT THIS CLOSES, measured 2026-08-23 (KTD-11a).
     *
     * `proseRecipe` accepted the whole clause suffix as the ingredient's source text, so both parse
     * engines were handed a vessel, a duration or a target riding behind the food. The CRF folded it into
     * the name, the LLM filed it as prep, and the comparator scored a disagreement that was never a model
     * disagreement at all.
     */
    it.each([
        ['one tablespoon of butter in a frying-pan', 'one tablespoon of butter', 'in a frying-pan'],
        ['one pound of flour into a deep bowl', 'one pound of flour', 'into a deep bowl'],
        ['one pint of milk for five minutes', 'one pint of milk', 'for five minutes'],
        ['four tablespoons of flour to it', 'four tablespoons of flour', 'to it'],
        ['three cups of milk for twenty minutes', 'three cups of milk', 'for twenty minutes'],
        ['one cup of flour, sifted', 'one cup of flour', ', sifted'],
    ])('cuts the trailing instruction off %j', (clause, span, trailingInstruction) => {
        expect(ingredientSegment(clause)).toEqual({ kind: 'ingredient', span, trailingInstruction });
    });

    it('leaves a clause that is only an ingredient exactly as it found it', () => {
        expect(ingredientSegment('one cup of milk')).toEqual({
            kind: 'ingredient',
            span: 'one cup of milk',
            trailingInstruction: null,
        });
    });

    /**
     * The counterpart property. "Cut nothing" would pass every case above if the cut were removed, so the
     * suite has to prove the span is REPORTED as whole when there is nothing to cut — `trailingInstruction`
     * is `null`, never `''`, because a caller raising a review reason keys on the absence.
     */
    it('reports an uncut span with a null tail rather than an empty one', () => {
        expect(ingredientSegment('two pounds of beef').trailingInstruction).toBeNull();
    });
});

describe('segmentClause — ⛔ the cut is REFUSED when the tail is a second food', () => {
    /**
     * ⛔ THE MANDATORY MUTANT. Remove the second-food guard and this case loses `one cup of water` — a
     * food the source states, deleted from a public recipe. The plan names this exact line as the danger
     * ("Dropping the tail is value-corrupting when the tail was a second food"), and the whole span is
     * kept instead so `ParsedLine.foods`, which holds many, is where the second food lands.
     */
    it('keeps the whole span of "one-half pound chocolate in one cup of water"', () => {
        expect(ingredientSegment('one-half pound chocolate in one cup of water')).toEqual({
            kind: 'ingredient',
            span: 'one-half pound chocolate in one cup of water',
            trailingInstruction: null,
        });
    });

    it('refuses the cut when the second food sits behind a vessel in the same tail', () => {
        // The tail is `a pan with one cup of water` — a vessel AND a food. Parsing the tail from its
        // start reads `a pan` (no unit) and would wrongly clear the guard; the food is only visible from
        // the SECOND quantity phrase, which is why the guard scans every phrase in the tail.
        expect(ingredientSegment('one tablespoon of butter in a pan with one cup of water')).toEqual({
            kind: 'ingredient',
            span: 'one tablespoon of butter in a pan with one cup of water',
            trailingInstruction: null,
        });
    });

    /**
     * The refusal must be narrow or it swallows the fix. A DURATION states a number and no unit of
     * substance, so `five minutes` is not a second food and the cut stands — pinned above, and asserted
     * here from the other direction so a guard widened to "the tail contains any quantity phrase" fails.
     */
    it('does not treat a stated duration as a second food', () => {
        expect(ingredientSegment('one pint of milk for five minutes').trailingInstruction).toBe('for five minutes');
    });
});

describe('segmentClause — equipment is an instruction, not an ingredient', () => {
    /**
     * ⛔ KTD-11a's equipment case. `a large preserving kettle` parses to `1 large :: preserving kettle`
     * — a quantity, a "unit" and a name — so every gate `proseRecipe` applies passes it, and it reached
     * both engines as an ingredient line.
     *
     * ⚠️ It raises NO review reason. A reason on a line nobody meant to parse is the muted-signal failure
     * KTD-11 rules against, which is why the segmenter answers with a KIND rather than with a flag.
     */
    it.each([['a large preserving kettle'], ['a frying-pan'], ['one deep bowl'], ['two large kettles']])(
        'reads %j as an instruction',
        (span) => {
            expect(segmentClause(span)).toEqual({ kind: 'instruction' });
        },
    );

    /**
     * The counterpart, and the reason the vessel test is HEAD-FINAL rather than "contains a vessel word".
     * A food whose name merely mentions a vessel is still a food.
     */
    it.each([['one pound of pot roast'], ['two cups of pan gravy'], ['one dish of stewed prunes']])(
        'still reads %j as an ingredient',
        (span) => {
            expect(segmentClause(span).kind).toBe('ingredient');
        },
    );
});

describe('segmentClause — R29: a boundary inside a quantity phrase is not a boundary', () => {
    /**
     * ⛔ The R29 defect, one layer down. `and` is in the cut lexicon AND is the middle of
     * "One and one-half" — verbatim in the committed corpus slice. An unguarded cut here would hand the
     * engines `One`, which is the same third-of-the-stated-amount loss the clause splitter already fixed.
     */
    it('never cuts inside "One and one-half cups of flour"', () => {
        expect(ingredientSegment('One and one-half cups of flour').span).toBe('One and one-half cups of flour');
    });

    it('still cuts an instruction that follows a compound quantity', () => {
        expect(ingredientSegment('One and one-half cups of flour into a deep bowl')).toEqual({
            kind: 'ingredient',
            span: 'One and one-half cups of flour',
            trailingInstruction: 'into a deep bowl',
        });
    });
});

describe('segmentClause — total over hostile input', () => {
    it.each([[''], ['   '], ['in'], ['in a pan'], ['   ,   '], ['(']])('answers for %j without throwing', (span) => {
        expect(() => segmentClause(span)).not.toThrow();
    });

    it('never cuts at position zero, which would leave no ingredient at all', () => {
        // `in a pan` opens with a cut word. There is nothing before it, so there is no cut to make; the
        // span is equipment and the answer is an instruction, not an ingredient with an empty span.
        expect(segmentClause('in a pan')).toEqual({ kind: 'instruction' });
    });
});

describe('dropTrailingInstruction — the same lexicon, applied to a NAME', () => {
    /**
     * ⚠️ A SECOND VIEW OF ONE LEXICON, and the difference from {@link segmentClause} is deliberate. When
     * the span-level cut is refused, the parsed NAME still carries the residue — `chocolate in one cup of
     * water` — and a name carrying a measurement matches no catalog row. The name has nowhere to keep a
     * second food (there is one name field), so the name is cut unconditionally while the SPAN is not.
     */
    it.each([
        ['chocolate in one cup of water', 'chocolate'],
        ['milk for five minutes', 'milk'],
        ['onion in thick pieces', 'onion'],
        ['flour to it', 'flour'],
        ['butter', 'butter'],
    ])('cuts %j down to %j', (name, expected) => {
        expect(dropTrailingInstruction(name)).toBe(expected);
    });

    it('does not cut inside a quantity phrase', () => {
        expect(dropTrailingInstruction('one and one-half pounds')).toBe('one and one-half pounds');
    });

    it('is total over empty input', () => {
        expect(dropTrailingInstruction('')).toBe('');
    });
});
