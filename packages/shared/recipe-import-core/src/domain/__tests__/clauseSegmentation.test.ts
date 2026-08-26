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

/**
 * Narrow to an ingredient segment, failing with the actual kind rather than an opaque undefined.
 *
 * ⚠️ `precededBy` defaults to `''` — "this span opens its clause, so nothing governs it". That is the
 * position every case written before the 2026-08-26 position ruling was implicitly asserting, so the
 * default keeps each of them saying exactly what it always said.
 */
function ingredientSegment(span: string, precededBy = ''): Extract<ClauseSegment, { kind: 'ingredient' }> {
    const segment = segmentClause(span, precededBy);

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

describe('segmentClause — ⛔ a food with NO unit is still a food (F1)', () => {
    /**
     * ⛔ THE DEFECT THIS PINS, found by architecture review on 2026-08-25 and confirmed end to end.
     *
     * The guard originally asked `unit !== null`, justified as "what separates a second food from a
     * duration is a unit of substance". That justification is **false**: `five minutes` has no unit
     * either. `two eggs` parses to `{quantity: 2, unit: null, name: 'eggs'}` — the NORMAL form of every
     * count ingredient in a cookbook (eggs, apples, lemons, onions) — so the guard could not see it and
     * the cut deleted it. Measured: `Beat one cup of milk with two eggs until light` imported `milk`
     * alone, with `droppedLines` EMPTY, so nothing reported the loss.
     *
     * ` with ` is not a `CLAUSE_SPLIT` boundary, so these clauses reach the segmenter whole, and the
     * extractor's suffix scan cannot recover the second food: it keeps the first suffix that parses and
     * moves on to the next clause.
     *
     * What actually separates residue from food is whether the thing named IS a food — a duration, a
     * dimension or a vessel is not — which is what `notAFoodLexicon.ts` now decides.
     */
    it.each([
        ['one cup of milk with two eggs until light'],
        ['one cup of flour with two apples'],
        ['one pint of cream with three lemons'],
    ])('refuses the cut on %j, because the tail names a food with no unit', (span) => {
        expect(ingredientSegment(span)).toEqual({ kind: 'ingredient', span, trailingInstruction: null });
    });

    /**
     * The counterpart, and the reason the fix cannot be "never cut a tail that parses a quantity". A
     * DURATION and a DIMENSION also parse a quantity with no unit of substance; both are KTD-11a residue
     * and both must still be cut, or the repair for F1 silently undoes the whole unit.
     */
    it.each([
        ['one pint of milk for five minutes', 'one pint of milk'],
        ['three cups of milk for twenty minutes', 'three cups of milk'],
    ])('still cuts %j, whose tail measures no substance', (span, expected) => {
        expect(ingredientSegment(span).span).toBe(expected);
    });
});

describe('segmentClause — ⛔ a duration in the SPAN does not make the span an instruction', () => {
    /**
     * ⛔ THE OVER-CORRECTION THIS PINS, caught by re-measuring the whole 1919 book after F1's fix: two
     * recipes stopped importing (`SUNSHINE CAKE`, `KIDNEY BEANS WITH BROWN SAUCE`).
     *
     * Fixing F1 taught the guard that a duration is not a food — correct — and then applied that same
     * vocabulary to the WHOLE-SPAN test, which asks a different question. `Sift one cup of flour three
     * times` has no instruction boundary (`three` is not a cut word), so the whole span was classified
     * head-final on `times` and thrown away — **deleting one cup of flour**, which is precisely the class
     * of loss F1 was about.
     *
     * The two questions are not the same and now use different vocabularies:
     *
     *  - _Is this span an ingredient at all?_ — only a VESSEL says no. A duration trailing a real
     *    quantity is residue on an ingredient, not a reason to drop it, and the extractor's own gate
     *    already refuses a line whose UNIT is a duration.
     *  - _Would cutting this tail delete a food?_ — a vessel AND a duration both say no.
     */
    it.each([
        ['one cup of flour three times'],
        ['one teaspoon butter three minutes'],
        ['two cups of sugar four times'],
    ])('keeps %j as an ingredient, because a real amount of a real food is stated', (span) => {
        expect(segmentClause(span, '').kind).toBe('ingredient');
    });

    /** The counterpart: a span that is ONLY a duration still names no food. */
    it('still refuses a span that names nothing but a vessel', () => {
        expect(segmentClause('a large preserving kettle', '')).toEqual({ kind: 'instruction' });
    });
});

describe('segmentClause — ⛔ a refused cut is never judged equipment (F3)', () => {
    /**
     * ⛔ The equipment test ran BEFORE the second-food guard, so a span whose head is a vessel was
     * called an instruction without ever asking whether its tail named a food. `segmentClause` is on the
     * package barrel — a contract — and the only reason this was not a live loss is that today's single
     * caller happens to own a retrying suffix scan. U22's `parsePipeline` will not.
     *
     * The guard now runs FIRST: a refused cut yields the whole span, and equipment is only ever judged on
     * a head the boundary actually takes.
     */
    it('keeps "a large kettle with two cups of sugar" rather than calling it a kettle', () => {
        expect(ingredientSegment('a large kettle with two cups of sugar')).toEqual({
            kind: 'ingredient',
            span: 'a large kettle with two cups of sugar',
            trailingInstruction: null,
        });
    });

    it('still reads a vessel whose tail names no food as an instruction', () => {
        expect(segmentClause('a large platter to dry', '')).toEqual({ kind: 'instruction' });
        expect(segmentClause('a large salad bowl with lettuce leaves', '')).toEqual({ kind: 'instruction' });
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
            expect(segmentClause(span, '')).toEqual({ kind: 'instruction' });
        },
    );

    /**
     * The counterpart, and the reason the vessel test is HEAD-FINAL rather than "contains a vessel word".
     * A food whose name merely mentions a vessel is still a food.
     */
    it.each([['one pound of pot roast'], ['two cups of pan gravy'], ['one dish of stewed prunes']])(
        'still reads %j as an ingredient',
        (span) => {
            expect(segmentClause(span, '').kind).toBe('ingredient');
        },
    );
});

describe('segmentClause — ⛔ a VESSEL is not a second food, and a refused cut is not equipment', () => {
    /**
     * ⛔ THE DEFECT THIS PINS, found on 2026-08-25 by re-running the extractor over the whole 1919 book
     * and diffing the NAMES it produced — not by reading the code. `Melt one tablespoon of butter in a
     * large frying-pan` LOST its butter: a real food, one tablespoon of it, deleted from a published
     * recipe by the very unit that exists to stop text being lost.
     *
     * Two defects compounded, and each is fixed here:
     *
     *  1. `a large frying-pan` parses to `1 large :: frying-pan` — `parse-ingredient` reads `large` as a
     *     UNIT — so the second-food guard saw a quantity, a unit and a name, and refused the cut. A vessel
     *     is not a food however it parses, so the guard now asks the same {@link ClauseSegment} vocabulary
     *     that classifies a whole span.
     *  2. The equipment test then ran on the span whose cut had been REFUSED, whose last word is the
     *     tail's last word (`frying-pan`) rather than the food the span is about. The test now always runs
     *     on the head the boundary PROPOSES, which is the only text a span is ever "about".
     */
    it('cuts the vessel off "one tablespoon of butter in a large frying-pan" instead of losing the butter', () => {
        expect(ingredientSegment('one tablespoon of butter in a large frying-pan')).toEqual({
            kind: 'ingredient',
            span: 'one tablespoon of butter',
            trailingInstruction: 'in a large frying-pan',
        });
    });

    it.each([
        ['two tablespoons of fresh butter in a spider', 'two tablespoons of fresh butter'],
        ['a cup of sweet cream in a kettle', 'a cup of sweet cream'],
        ['four ounces of butter into a saucepan', 'four ounces of butter'],
    ])('cuts the vessel off %j, whose "unit" is a size word', (span, expected) => {
        expect(ingredientSegment(span).span).toBe(expected);
    });

    /**
     * The second defect on its own. Here the cut IS correctly refused — `one cup of water` is a real
     * second food — and the whole span therefore ends on a vessel word. Judging equipment by that word
     * would throw away a span carrying TWO foods, which is the worst outcome this module can produce.
     */
    it('keeps a span whose refused cut leaves it ending on a vessel word', () => {
        expect(ingredientSegment('one-half pound chocolate in one cup of water in a kettle')).toEqual({
            kind: 'ingredient',
            span: 'one-half pound chocolate in one cup of water in a kettle',
            trailingInstruction: null,
        });
    });
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
        expect(() => segmentClause(span, '')).not.toThrow();
    });

    it('never cuts at position zero, which would leave no ingredient at all', () => {
        // `in a pan` opens with a cut word. There is nothing before it, so there is no cut to make; the
        // span is equipment and the answer is an instruction, not an ingredient with an empty span.
        expect(segmentClause('in a pan', '')).toEqual({ kind: 'instruction' });
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

describe("segmentClause — ⛔ a vessel's role is its POSITION, not the word (owner ruling 2026-08-26)", () => {
    /**
     * ⛔ THE RULING THIS IMPLEMENTS, and the defect that surfaced it (measured over the whole 1919 book).
     *
     * U22a decided a vessel by the WORD alone, so every vessel meant "not an ingredient". A cook genuinely
     * measures by vessel, and the owner ruled the two apart by GRAMMAR:
     *
     *  - **object of a preposition** → an instruction, cut it (`butter IN A FRYING-PAN`, `INTO A DEEP BOWL`);
     *  - **heading the measure phrase** → a UNIT, keep it (`A BOWL of flour`, `A GLASS of milk`).
     *
     * The book's own case is `In a large mixing bowl whip to a cream two eggs` (PEACH PUDDING). The vessel
     * is the object of `In`, so it is a place and not an amount — but the extractor published an ingredient
     * literally named **`mixing bowl whip`**, quantity 1, unit `large`, in a public recipe. Owner: _"mixing
     * bowl is wrong — that's just obviously not a food"_, _"'large mixing bowl' is the whole measurement"_.
     *
     * ⚠️ The position lives HERE, in the policy, and never in `notAFoodLexicon.ts`. The lexicon answers
     * "which words are vessels"; what a vessel in a given position MEANS is this module's decision.
     */
    it.each([
        ['a large mixing bowl whip to a cream two eggs', 'In '],
        ['a large bowl sift one pound of fine flour', 'Into '],
        ['a large pan of water', 'drop them in '],
        ['a bowl of flour', 'sift it into '],
        ['a large kettle of boiling water', 'plunge them into '],
    ])('reads %j as an instruction, because %j governs it', (span, precededBy) => {
        expect(segmentClause(span, precededBy)).toEqual({ kind: 'instruction' });
    });

    /**
     * ⚠️ A STATED LIMIT, not an oversight. The ruling's third "keep" example is `a glass of milk`, and
     * `glass` is not in the vessel lexicon — so governing it changes nothing, in either direction. That is
     * a VOCABULARY question and this change is a POSITION one; widening the word list would move corpus
     * lines nobody asked to move. Recorded in ADR-0026 §7 as an open limit rather than silently fixed.
     */
    it('has no opinion about a vessel word the lexicon does not know', () => {
        expect(segmentClause('a glass of milk', 'pour it into ').kind).toBe('ingredient');
    });

    /**
     * ⛔ MUTANT 1 — REVERT TO WORD-ONLY (any vessel means "not an ingredient"). These are the owner's own
     * "keep it" examples: the vessel HEADS the measure phrase and a food follows it, so the vessel is a
     * unit and the whole phrase is the measurement. A word-based test calls every one of them equipment
     * and throws away a real measurement, and this case is what says so.
     */
    it.each([
        ['a bowl of flour'],
        ['a glass of milk'],
        ['a large mixing bowl of batter'],
        ['one dish of stewed prunes'],
    ])('keeps %j as a measure, because nothing governs it and the vessel heads the measure phrase', (span) => {
        expect(ingredientSegment(span)).toEqual({ kind: 'ingredient', span, trailingInstruction: null });
    });

    /**
     * ⛔ The direction that must NOT widen. A vessel word inside a FOOD's name is not a vessel in any
     * position — `pot roast` is a roast — and the partitive `of` is what keeps the measure-phrase scan off
     * it: the phrase the preposition governs is `one pound`, never `pot roast`. Governed on purpose here,
     * because ungoverned they would pass without the guard doing anything.
     */
    it.each([
        ['one pound of pot roast', 'serve it with '],
        ['two cups of pan gravy', 'cover it with '],
        ['one-half pound of pot cheese', 'mix it with '],
        ['one pound of sweet pot cheese', 'stir in '],
    ])('still reads %j as an ingredient, even governed by %j', (span, precededBy) => {
        expect(segmentClause(span, precededBy).kind).toBe('ingredient');
    });

    /**
     * ⛔ MUTANT 2 — INVERT THE POSITION TEST (a prepositional vessel becomes a unit). The tail cut is the
     * other half of the same ruling: `in a frying-pan` is a vessel governed by `in`, so it is residue.
     * Inverting the test stops this being cut and hands the engines the vessel again.
     */
    it('still cuts a vessel that a preposition governs INSIDE the span', () => {
        expect(ingredientSegment('one tablespoon of butter in a frying-pan', 'Melt ')).toEqual({
            kind: 'ingredient',
            span: 'one tablespoon of butter',
            trailingInstruction: 'in a frying-pan',
        });
    });

    /**
     * ⛔ THE FOOD LOSSES THE WORD-ONLY RULE WAS CAUSING, both measured in the 1919 book on 2026-08-26.
     * `through` is a preposition and was missing from the boundary lexicon, so no cut was proposed and the
     * head-final test judged the whole span by the vessel the preposition governs — **deleting one and
     * one-half cups of canned tomatoes, and one quart of cottage cheese, from published recipes.** Under
     * the ruling the governed vessel is a tail to CUT, never a reason to condemn the food in front of it.
     */
    it.each([
        [
            'one and one-half cups of canned tomatoes rubbed through a strainer',
            'one and one-half cups of canned tomatoes rubbed',
            'through a strainer',
        ],
        [
            'one quart of fine cottage cheese through a coarse sieve or colander',
            'one quart of fine cottage cheese',
            'through a coarse sieve or colander',
        ],
    ])('cuts %j at its preposition instead of deleting the food', (span, head, tail) => {
        expect(ingredientSegment(span)).toEqual({ kind: 'ingredient', span: head, trailingInstruction: tail });
    });

    /**
     * The position test reads the clause, so it must be TOTAL over whatever the clause happens to be —
     * including a span that opens its clause and one whose governor is punctuation or nothing at all.
     */
    it.each([[''], ['   '], ['Have '], ['and '], [',']])(
        'answers for a vessel span preceded by %j without throwing',
        (precededBy) => {
            expect(() => segmentClause('a large mixing bowl of batter', precededBy)).not.toThrow();
        },
    );

    /**
     * ⛔ A preposition that is merely SOMEWHERE in the preceding text does not govern this span — only the
     * word immediately before it does. `Have a large stew-pan half full of boiling water` is a real
     * measurement of real water, and the extractor imports it; reading the `of` five words back as a
     * governor would delete it.
     */
    it('does not treat a preposition earlier in the clause as the governor', () => {
        expect(ingredientSegment('a large stew-pan half full of boiling water', 'Have ').kind).toBe('ingredient');
    });
});

describe('segmentClause — ⛔ the position test REQUIRES a delimiter, or it becomes the word-only rule', () => {
    /**
     * ⛔ THE MUTANT THE TIGHTENING EXISTS FOR, caught by architecture review before it shipped. The first
     * implementation read the measure phrase as "up to the first `of`, the first boundary, **or the end**"
     * — and that third arm makes the measure phrase the WHOLE SPAN whenever a span carries neither. The
     * word-anywhere scan then runs over a span, which is exactly the test the head-final discipline exists
     * to forbid: `two pot roasts` behind a preposition is a governed vessel by that reading, and a real
     * food is deleted.
     *
     * Refusing to answer without a delimiter costs nothing measurable: a bare governed vessel phrase
     * (`into a large preserving kettle`) is head-final a vessel, so the whole-span test refuses it anyway
     * — asserted directly below so the "costs nothing" half is not taken on faith.
     */
    it.each([
        ['two pot roasts', 'serve it with '],
        ['a pot roast', 'season the '],
        ['two tin cups', 'fill it with '],
        ['three pan cakes', 'stack them on '],
    ])('keeps %j governed by %j, because it carries no measure delimiter', (span, precededBy) => {
        expect(segmentClause(span, precededBy).kind).toBe('ingredient');
    });

    it('still refuses a bare governed vessel phrase, which needs no delimiter to be equipment', () => {
        expect(segmentClause('a large preserving kettle', 'pour it into ')).toEqual({ kind: 'instruction' });
        expect(segmentClause('a large kettle', 'boil it in ')).toEqual({ kind: 'instruction' });
    });
});

describe('segmentClause — ⛔ ANTI-REGRESSION: every equipment removal U22a measured is still removed', () => {
    /**
     * ⛔ THE BAR THIS CHANGE WAS HELD TO. These are the spans `docs/reports/2026-08-23-002-…` §9.3 records
     * U22a removing from the 1919 book, verbatim. The position ruling is purely ADDITIVE — rule (a), the
     * head-final test, is untouched — so none of them may come back, and every one is asserted at its
     * clause-head position, where the position test cannot fire at all.
     *
     * ⚠️ Re-measured over the whole book on 2026-08-26, the removal set is 21 distinct spans rather than
     * §9.3's fourteen: the corpus moved under later unit fixes, not under this one. The ADR records the
     * re-measured set; this block pins the ones §9.3 named, because those are the ones a future reader
     * will look for.
     */
    it.each([
        ['a large platter'],
        ['a large platter to dry'],
        ['a large kettle'],
        ['a large preserving kettle'],
        ['a large earthen jar'],
        ['a large stone jar'],
        ['a large salad bowl with lettuce leaves'],
        ['a large colander to drain'],
        ['one large mould'],
    ])('still removes %j', (span) => {
        expect(segmentClause(span, '')).toEqual({ kind: 'instruction' });
    });

    /**
     * ⛔ And the two the ruling DELIBERATELY stops removing, because removing them deleted food. Kept as a
     * pair with the block above so a reader sees the whole delta in one place: the rest of the removals
     * stay, these two become bounded ingredients. Their full assertion — head and tail — is in the
     * position block above.
     */
    it.each([
        ['one and one-half cups of canned tomatoes rubbed through a strainer'],
        ['one quart of fine cottage cheese through a coarse sieve or colander'],
    ])('no longer removes %j, which was a stated food', (span) => {
        expect(segmentClause(span, '').kind).toBe('ingredient');
    });
});

/**
 * ⛔ ReDoS REGRESSION GUARD (CodeQL `js/polynomial-redos`, PR 91, 2026-08-26).
 *
 * `PARTITIVE_OF` shipped as `/\s+of\s+/` — two UNANCHORED `\s+` quantifiers around a literal. `search()`
 * retries at every start position, and at each one the leading `\s+` consumes the whole run before
 * backtracking to look for `o`. MEASURED before the fix: 0.8ms → 2.8ms → 11.0ms → 43.7ms across
 * 2k → 16k spaces, i.e. doubling the input roughly QUADRUPLED the time.
 *
 * ⚠️ This is the SECOND instance of this exact shape in this package — `splitMeasurement.ts` carries the
 * first, with the same measurement in its own guard. Both read a span lifted from imported recipe prose,
 * and nothing between the source text and either function bounds a run of whitespace.
 */
describe('clause segmentation — ReDoS guard', () => {
    it('does not backtrack catastrophically on a long whitespace run inside a real span', () => {
        // ⚠️ The run must sit INSIDE a span that reaches the partitive scan — a span of pure whitespace
        // short-circuits earlier (measured: 0.0ms at 40k) and would make this assertion vacuous.
        const pathological = `one pound${' '.repeat(20_000)}beef in a frying-pan`;
        const started = performance.now();

        segmentClause(pathological, '');

        // ⚠️ 100ms, not 5ms, and the gap is DELIBERATE. `partitiveOfAt` costs 0.09ms here; the remaining
        // ~68ms is `INSTRUCTION_BOUNDARY`, whose own alternation carries the SAME unanchored-quantifier
        // shape and which §7a's author measured at 65ms for this input and accepted as residual risk.
        // MEASURED 2026-08-26: 136ms before this fix, 68ms after — so a bound of 100 catches a
        // reintroduction of the regex without falsely failing on the residual that is already recorded.
        expect(performance.now() - started).toBeLessThan(100);
    });
});
