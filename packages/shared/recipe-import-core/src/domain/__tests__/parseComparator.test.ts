/**
 * THE TEST TABLE IS THE DESIGN (U19).
 *
 * The comparator decides two separate things and the split is what most of this file is about: **what the
 * merged parse is** (a field-level winner rule) and **what the disagreement was** (a shape). They are
 * computed independently, so a canonicalisation that removes a disagreement never changes which engine's
 * words are stored, and a winner rule that changes never silently changes the reported agreement.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | U19 — identical parses agree | "two readings of the same line agree" |
 * | KTD-11 — amounts from the CRF | "takes a differing amount from the CRF and reports it" |
 * | KTD-11 — identity and preparation from the LLM | "takes a differing food identity from the LLM and reports it" |
 * | KTD-11 — historical units from the LLM | "takes a historical unit the CRF was blind to, and calls it no disagreement" |
 * | U36 — an absent CRF unit is rescued whatever unit the LLM read | "U36 — rescues a MODERN unit too, because the CRF stating none is absence, not a reading" |
 * | ⛔ U36 — and NOTHING more: two STATED units that differ still go to the CRF | "still gives the CRF the unit when BOTH engines named one and they disagree" |
 * | U36 — mutual silence is not a rescue | "bucket 1 of 4 — mutual silence is NOT rescued, so the 29 genuine counts keep the CRF measure" |
 * | U36 — a SIZE word is a valid unit | "bucket 3 of 4 — a SIZE word is a unit, and rescuing it is what keeps the word at all" |
 * | U36 — alternation is a modelling gap, not a parse error | "bucket 4 of 4 — an ALTERNATION takes one sensible reading, which is a known limitation" |
 * | KTD-11 — the rescue does NOT reach the number | "still takes the number from the CRF when the LLM supplied the historical unit" |
 * | KTD-12 — an unavailable engine is never a disagreement | "reports a single engine, never a disagreement" |
 * | KTD-12 — as a PROPERTY, over every shape the survivor can take | "is single-engine even when the answering parse is the kind that WOULD have differed" |
 * | U19 — both unavailable resolves nothing | "resolves nothing when neither engine answered" |
 * | U19 / `statedMeasure.ts` — the STATED pair is compared, never the restated one | "never compares a restatement" + "drops the restatement whichever engine kept it" |
 * | U19 — merging is deterministic under argument order | "is deterministic under argument order" |
 * | KTD-11b — a past participle is preparation | "canonicalises a participle into preparation before comparing" |
 * | KTD-11b — an adjective is identity | "canonicalises an adjective into identity before comparing" |
 * | KTD-11b — a temperature is preparation | "canonicalises a temperature into preparation" |
 * | KTD-11b trap 1 — `red`/`green` are colours | "treats a colour as identity, not preparation" |
 * | KTD-11b trap 2 — `cut`/`ground`/`beaten` are participles | "treats an irregular participle as preparation" |
 * | U16 / KTD-11 `crfSizeField` — `large` is an adjective | "canonicalises the CRF size word into the name" |
 * | KTD-11a — function words only | "ignores relative-clause scaffolding when comparing" + "ignores an article in the identity too, not only in the preparation" |
 * | KTD-11a — the stopword list stops short of conjunctions | "does NOT drop `and`, which is the only signal that a name holds two foods" |
 * | KTD-11a — duplication only | "ignores a modifier one engine emitted twice" |
 * | ⚠️ U19 — normalising for COMPARISON must not normalise what is STORED | "stores the winner own words, not the comparison view" |
 * | U19 — provenance records the winner rule | "records provenance from the winner rule, not from its inputs" |
 *
 * ⚠️ Many of these assert an ABSENCE of disagreement, which is exactly the assertion a comparator that
 * returned `agree` unconditionally would also pass. Every one of them is therefore paired with a positive
 * assertion about the MERGED line — the words, the field they sit in, and which engine is credited — so
 * the pair fails if either half of the policy is inverted.
 *
 * ⚠️ Measured 2026-08-24: thirteen mutations — each of the four winner entries, both directions of the
 * historical rescue, the rescue's scope, KTD-12's branch, the placement canonicalisation, the adjective
 * rule, the stopword list, the restatement drop, and the food comparison — each fail **at least two**
 * tests in this file. No rule here is held up by a single assertion.
 *
 * ⚠️ Measured 2026-08-26, for U36: four further mutations of `llmRescuedTheMeasure`, each of which is a
 * repair a later reader is likely to propose, and each caught here.
 *
 * | mutation | tests it fails |
 * | -------- | -------------- |
 * | restore the `isHistoricalUnit` conjunct | "rescues a MODERN unit too…", "the 13 plain rescues…", both size-word cases |
 * | fire the rescue when BOTH measures are bare | "bucket 1 of 4 — mutual silence is NOT rescued…" |
 * | reject size words as fabricated units | "bucket 3 of 4 — a SIZE word is a unit…", "bucket 4 of 4 — an ALTERNATION…" |
 * | let the rescue reach the QUANTITY as well | "still takes the number from the CRF…", "bucket 2 of 4 — the number is still the CRF's…" |
 * | drop `statesAUnit` back to a `!== null` test | "does not rescue a unit that normalises to nothing…" |
 */
import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';
import { describe, it, expect } from 'vitest';

import type { ParsedFacts, ParsedFood, ParsedLine, ParseEngine, ParseProvenance } from '../../parsedLine.js';
import { makeParsedLine } from '../../__tests__/__fixtures__/makeParsedLine.js';
import { compareParses, type ComparedFact, type ParseComparison } from '../parseComparator.js';

/** An exact amount, through recipe-core's smart constructor so a test cannot spell an impossible one. */
function exactly(value: number): IngredientQuantity {
    return statedQuantity(value) ?? ABSENT_QUANTITY;
}

/** Every fact attributed to one engine — an input's own provenance, and a single-engine merge's. */
function throughout(engine: ParseEngine): ParseProvenance {
    return { statedMeasure: engine, quantity: engine, unit: engine, foods: engine };
}

/** The merged provenance the winner rule produces when both engines answered and none was blind. */
const BY_WINNER_RULE: ParseProvenance = { statedMeasure: 'crf', quantity: 'crf', unit: 'crf', foods: 'llm' };

/** One engine's parse of a line, with that engine's own provenance so a copied one is visible. */
function crfParse(overrides: Partial<ParsedLine> = {}): ParsedLine {
    return makeParsedLine({ provenance: throughout('crf'), ...overrides });
}

/** The other engine's parse of the same line. */
function llmParse(overrides: Partial<ParsedLine> = {}): ParsedLine {
    return makeParsedLine({ provenance: throughout('llm'), ...overrides });
}

/** The single food of a merged line, for the placement assertions. Fails loudly rather than returning a hole. */
function onlyFood(result: ParseComparison): ParsedFood {
    expect(result.merged).not.toBeNull();
    const foods = result.merged?.foods ?? [];
    expect(foods).toHaveLength(1);

    return foods[0] as ParsedFood;
}

/**
 * ⛔ COMPILE-TIME. `ComparedFact` must stay DERIVED from `ParsedFacts` — the same discipline
 * `ParseProvenance` uses — so a fact added to the contract without a comparison rule is a type error
 * rather than a field the comparator silently never looks at.
 */
const EVERY_FACT_IS_COMPARABLE: Record<keyof ParsedFacts, ComparedFact> = {
    statedMeasure: 'statedMeasure',
    quantity: 'quantity',
    unit: 'unit',
    foods: 'foods',
};

describe('compareParses — agreement', () => {
    it('two readings of the same line agree', () => {
        const line = { statedMeasure: '1 tablespoon', quantity: exactly(1), unit: 'tablespoon' };
        const result = compareParses({ crf: crfParse(line), llm: llmParse(line) });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(result.merged).toEqual({
            raw: '1 tablespoon butter',
            statedMeasure: '1 tablespoon',
            quantity: exactly(1),
            unit: 'tablespoon',
            foods: [{ name: 'butter', prep: null }],
            reviewReasons: [],
            provenance: BY_WINNER_RULE,
        });
    });

    it('reports every comparable fact it found different, and nothing it did not', () => {
        const result = compareParses({
            crf: crfParse({ statedMeasure: 'two cups', quantity: exactly(2), unit: 'cup' }),
            llm: llmParse({ statedMeasure: 'three cups', quantity: exactly(3), unit: 'cup' }),
        });

        expect(result.agreement).toEqual({ kind: 'differ', fields: ['statedMeasure', 'quantity'] });
        expect(Object.values(EVERY_FACT_IS_COMPARABLE)).toContain('unit');
    });

    it('unions both engines review reasons rather than dropping the loser', () => {
        const result = compareParses({
            crf: crfParse({ reviewReasons: ['no_quantity', 'name_too_long'] }),
            llm: llmParse({ reviewReasons: ['name_too_long', 'group_header'] }),
        });

        expect(result.merged?.reviewReasons).toEqual(['no_quantity', 'name_too_long', 'group_header']);
    });

    /**
     * U35 — one engine reading `T` while the other reads `t` is a REAL disagreement, and the comparison
     * must say so (owner ruling, 2026-08-25: capital `T` is a tablespoon, lowercase `t` a teaspoon).
     *
     * ⛔ `unitView` used to lower-case before handing the token to `normalizeUnit`, which was harmless
     * while the normalizer lower-cased anyway and became a MUTED SIGNAL the moment it stopped: both
     * spellings would have folded to one canonical form, and a threefold disagreement between the two
     * engines would have been reported as AGREEMENT. That is the failure ADR-0026 rules against — the
     * census metric moving because the detector stopped detecting — so the fold is asserted away here
     * rather than left to a comment.
     *
     * ⚠️ `statedMeasure` deliberately still AGREES on `'2 T'` against `'2 t'`, and that is not an oversight
     * left over from the fix. `measureView` compares the phrase the two engines ECHOED, as text, and a
     * text fold is case-insensitive for the same reason a food name's is. The meaning lives in `unit`, and
     * `unit` is where the difference is now reported. Widening the text fold to be case-sensitive would
     * make `'2 Tbsp'` differ from `'2 tbsp'` — a spelling, not a disagreement — which is exactly the noise
     * this comparison exists to suppress.
     */
    it('U35 — reports T against t as a unit DISAGREEMENT, never as agreement', () => {
        const result = compareParses({
            crf: crfParse({ statedMeasure: '2 T', quantity: exactly(2), unit: 'T' }),
            llm: llmParse({ statedMeasure: '2 t', quantity: exactly(2), unit: 't' }),
        });

        expect(result.agreement).toEqual({ kind: 'differ', fields: ['unit'] });
    });

    it('U35 — still agrees when the two engines write the SAME case-sensitive spelling', () => {
        const line = { statedMeasure: '2 T', quantity: exactly(2), unit: 'T' };
        const result = compareParses({ crf: crfParse(line), llm: llmParse(line) });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(result.merged?.unit).toBe('T');
    });

    it('U35 — every OTHER unit still compares case-insensitively, so a mere spelling is not a difference', () => {
        const result = compareParses({
            crf: crfParse({ statedMeasure: '2 Tbsp', quantity: exactly(2), unit: 'Tbsp' }),
            llm: llmParse({ statedMeasure: '2 Tbsp', quantity: exactly(2), unit: 'tablespoons' }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
    });
});

describe('compareParses — the field-level winner rule', () => {
    it('takes a differing amount from the CRF and reports it', () => {
        const result = compareParses({
            crf: crfParse({ quantity: exactly(2) }),
            llm: llmParse({ quantity: exactly(3) }),
        });

        expect(result.agreement).toEqual({ kind: 'differ', fields: ['quantity'] });
        expect(result.merged?.quantity).toEqual(exactly(2));
        expect(result.merged?.provenance.quantity).toBe('crf');
    });

    it('takes a differing unit from the CRF and reports it', () => {
        const result = compareParses({
            crf: crfParse({ unit: 'tablespoon' }),
            llm: llmParse({ unit: 'teaspoon' }),
        });

        expect(result.agreement).toEqual({ kind: 'differ', fields: ['unit'] });
        expect(result.merged?.unit).toBe('tablespoon');
        expect(result.merged?.provenance.unit).toBe('crf');
    });

    it('takes a differing food identity from the LLM and reports it', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'flour', prep: null }] }),
            llm: llmParse({ foods: [{ name: 'sugar', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'differ', fields: ['foods'] });
        expect(result.merged?.foods).toEqual([{ name: 'sugar', prep: null }]);
        expect(result.merged?.provenance.foods).toBe('llm');
    });

    it('takes a multi-food reading from the LLM, which the CRF cannot express', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'onion celery and carrot', prep: 'chopped' }] }),
            llm: llmParse({
                foods: [
                    { name: 'onion', prep: 'chopped' },
                    { name: 'celery', prep: 'chopped' },
                    { name: 'carrot', prep: 'chopped' },
                ],
            }),
        });

        expect(result.agreement).toEqual({ kind: 'differ', fields: ['foods'] });
        expect(result.merged?.foods).toHaveLength(3);
    });

    it('records provenance from the winner rule, not from its inputs', () => {
        // ⛔ Both inputs are handed the OTHER engine's provenance. A merge that copied the winner's
        // provenance instead of stating the rule would report it exactly backwards.
        const result = compareParses({
            crf: crfParse({ provenance: throughout('llm'), foods: [{ name: 'flour', prep: null }] }),
            llm: llmParse({ provenance: throughout('crf'), foods: [{ name: 'sugar', prep: null }] }),
        });

        expect(result.merged?.provenance).toEqual(BY_WINNER_RULE);
    });

    it('carries the line through unchanged, because both engines read the same line', () => {
        const result = compareParses({ crf: crfParse(), llm: llmParse() });

        expect(result.merged?.raw).toBe('1 tablespoon butter');
    });
});

describe('compareParses — the measure', () => {
    it('takes a historical unit the CRF was blind to, and calls it no disagreement', () => {
        const result = compareParses({
            crf: crfParse({
                statedMeasure: 'one',
                quantity: exactly(1),
                unit: null,
                foods: [{ name: 'milk', prep: null }],
            }),
            llm: llmParse({
                statedMeasure: 'one gill',
                quantity: exactly(1),
                unit: 'gill',
                foods: [{ name: 'milk', prep: null }],
            }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(result.merged?.unit).toBe('gill');
        expect(result.merged?.statedMeasure).toBe('one gill');
        // ⛔ The rescue takes the two facts the CRF's blindness corrupts — the phrase and the unit — and
        // NOT the number. Missing `gill` does not stop the CRF reading `one`.
        expect(result.merged?.provenance).toEqual({
            statedMeasure: 'llm',
            quantity: 'crf',
            unit: 'llm',
            foods: 'llm',
        });
    });

    it('still takes the number from the CRF when the LLM supplied the historical unit', () => {
        const result = compareParses({
            crf: crfParse({ statedMeasure: 'two', quantity: exactly(2), unit: null }),
            llm: llmParse({ statedMeasure: 'one gill', quantity: exactly(1), unit: 'gill' }),
        });

        // The measure phrase and the unit are silenced; the numbers genuinely disagree, so that is reported.
        expect(result.agreement).toEqual({ kind: 'differ', fields: ['quantity'] });
        expect(result.merged?.quantity).toEqual(exactly(2));
        expect(result.merged?.unit).toBe('gill');
    });

    it('U36 — rescues a MODERN unit too, because the CRF stating none is absence, not a reading', () => {
        // ⛔ REWRITTEN FOR U36, and it now asserts the OPPOSITE of what it did. As "does not silence an
        // ordinary unit disagreement" this same input asserted `differ: ['unit']` with a `null` merged
        // unit — correct only while the rescue required a HISTORICAL unit, which reached 4 of the 13
        // plain rescues in the corpus. The owner ruling of 2026-08-26 overturns that reading: an engine
        // that stated no unit offered no competing one, so there is nothing for a winner rule to pick
        // between. The coverage this test used to hold — that an absent CRF unit is not a blanket
        // licence for the LLM — did not go away; it moved to the test directly below, which is the case
        // KTD-11 actually governs.
        const result = compareParses({
            crf: crfParse({ statedMeasure: 'one cup', quantity: exactly(1), unit: null }),
            llm: llmParse({ statedMeasure: 'one cup', quantity: exactly(1), unit: 'cup' }),
        });

        expect(result.merged).not.toBeNull();
        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(result.merged?.unit).toBe('cup');
        expect(result.merged?.provenance.unit).toBe('llm');
        expect(result.merged?.provenance.statedMeasure).toBe('llm');
    });

    it('still gives the CRF the unit when BOTH engines named one and they disagree', () => {
        // ⛔ THE ANTI-OVER-REACH ASSERTION, and the one that stops U36 becoming "the LLM's unit wins".
        // KTD-11's amount column is untouched by the ruling: two engines that each STATE a unit and
        // state different ones is `unitDiffers`, which goes to the CRF and is REPORTED. A rescue widened
        // to "take the LLM's unit whenever the two differ" passes every other test in this file — the
        // absent-unit cases included, because absence is a special case of differing — and fails only
        // here.
        const result = compareParses({
            crf: crfParse({ statedMeasure: 'one cup', quantity: exactly(1), unit: 'cup' }),
            llm: llmParse({ statedMeasure: 'one pint', quantity: exactly(1), unit: 'pint' }),
        });

        expect(result.merged).not.toBeNull();
        expect(result.agreement).toEqual({ kind: 'differ', fields: ['statedMeasure', 'unit'] });
        expect(result.merged?.unit).toBe('cup');
        expect(result.merged?.statedMeasure).toBe('one cup');
        expect(result.merged?.provenance).toEqual(BY_WINNER_RULE);
    });

    it('never compares a restatement', () => {
        // ⛔ `one gill (½ cup)` states ONE amount twice. Comparing the phrases whole manufactures a
        // disagreement about a line both engines read correctly — the defect `statedMeasure.ts` records.
        const crf = crfParse({ statedMeasure: 'one gill (½ cup)', quantity: exactly(1), unit: 'gill' });
        const llm = llmParse({ statedMeasure: 'one gill', quantity: exactly(1), unit: 'gill' });
        expect(crf.statedMeasure).not.toBe(llm.statedMeasure);

        const result = compareParses({ crf, llm });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(result.merged?.statedMeasure).toBe('one gill (½ cup)');
    });

    it('drops the restatement whichever engine kept it', () => {
        // The mirror of the case above, and not redundant: here the phrase the CRF WINS is the shorter
        // one, so the drop has to happen on the LLM's side of the comparison to reach the same verdict.
        const result = compareParses({
            crf: crfParse({ statedMeasure: 'one pound', quantity: exactly(1), unit: 'pound' }),
            llm: llmParse({ statedMeasure: 'one pound (about 4 cups)', quantity: exactly(1), unit: 'pound' }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(result.merged?.statedMeasure).toBe('one pound');
    });

    it('treats an absent QUANTITY and a stated one as a disagreement, since absence there is a reading', () => {
        // ⛔ REWRITTEN FOR U36, which changed two thirds of what this asserted. It previously expected
        // `differ: ['statedMeasure', 'quantity', 'unit']`, which was the shape only while an absent CRF
        // unit counted as dissent; the phrase and the unit are now rescued, because a CRF that named no
        // unit offered no competing one and dropping the LLM's `tablespoon` would publish silence.
        //
        // ⛔ WHAT IT IS FOR IS UNCHANGED, and is the third field: `ABSENT_QUANTITY` is a READING — the
        // CRF looked and found no amount, as in `salt to taste` — NOT a silence. So it competes with the
        // LLM's `1`, the disagreement is reported, and KTD-11 keeps the number on the CRF.
        //
        // ⚠️ The accepted consequence is recorded in ADR-0026 §8: the merged line then holds the LLM's
        // measure PHRASE beside the CRF's number, and on this input the two do not agree. The mismatch
        // is REPORTED rather than reconciled — the same split `one and a half quarts` takes.
        const result = compareParses({
            crf: crfParse({ statedMeasure: null, quantity: ABSENT_QUANTITY, unit: null }),
            llm: llmParse({ statedMeasure: '1 tablespoon', quantity: exactly(1), unit: 'tablespoon' }),
        });

        expect(result.merged).not.toBeNull();
        expect(result.agreement).toEqual({ kind: 'differ', fields: ['quantity'] });
        expect(result.merged?.quantity).toEqual(ABSENT_QUANTITY);
        expect(result.merged?.provenance.quantity).toBe('crf');
        expect(result.merged?.unit).toBe('tablespoon');
    });
});

/**
 * U36 — THE FOUR MEASURED BUCKETS (owner ruling 2026-08-26).
 *
 * A real Nova Micro run over the 2,502-line 1919 corpus found **53** ingredient lines on which the CRF's
 * measure is a bare number with no unit at all. That population divides into exactly four shapes, and
 * there is one test below per shape, spelled with the lines the run actually produced:
 *
 * | bucket | n | what the LLM gave |
 * | ------ | --: | ----------------- |
 * | the LLM is silent too | 29 | nothing — the CRF is right, these are genuine counts |
 * | a plain unit | 13 | `one and a half quarts`, `two and a half pounds`, `one-half saltspoon`, `one wineglass`, `half a can` |
 * | a SIZE used as the unit | 7 | `one small` (onion), `four large` (onions), `one large` (cauliflower) |
 * | an alternation | 4 | `one large onion or two small ones` — genuinely two candidate measures |
 *
 * ⚠️ Only **4 of the 13** plain rescues are historical, which is the measurement that condemns the old
 * `isHistoricalUnit` conjunct: it reached under a third of the cases it existed to serve.
 *
 * The full argument, the disproved "reject size words" proposal, and the two limitations these tests
 * PIN rather than fix are in ADR-0026 §8 and `docs/reports/2026-08-23-002-…` §12.
 */
describe('compareParses — U36, an absent CRF unit is absence, not dissent', () => {
    it('bucket 1 of 4 — mutual silence is NOT rescued, so the 29 genuine counts keep the CRF measure', () => {
        // ⛔ THE 29, AND THE LARGEST BUCKET. Both engines read a bare number, so nothing was rescued and
        // nothing is disputed — the line really does state a count. A rescue keyed on "the CRF has no
        // unit" ALONE, without also requiring the LLM to have stated one, would re-attribute every one
        // of these to the LLM and rewrite the provenance of over half the population for no reading
        // gained.
        const result = compareParses({
            crf: crfParse({
                statedMeasure: 'two',
                quantity: exactly(2),
                unit: null,
                foods: [{ name: 'eggs', prep: null }],
            }),
            llm: llmParse({
                statedMeasure: 'two',
                quantity: exactly(2),
                unit: null,
                foods: [{ name: 'eggs', prep: null }],
            }),
        });

        expect(result.merged).not.toBeNull();
        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(result.merged?.unit).toBeNull();
        expect(result.merged?.provenance).toEqual(BY_WINNER_RULE);
    });

    it('bucket 2 of 4 — the 13 plain rescues, of which only the last two were reachable before', () => {
        // The units the LLM read where the CRF read none, taken from the measured lines: `one and a half
        // QUARTS`, `two and a half POUNDS` and `half a CAN` are modern and were unreachable by the
        // historical rule, while `one-half SALTSPOON` and `one WINEGLASS` are the historical shape that
        // already rescued. ⛔ THE LAST TWO ARE THE ANTI-REGRESSION: the historical rescue is now a
        // SUBSET of this rule, so removing the old conjunct must not cost a gill or a wineglass its
        // rescue.
        const units = ['quarts', 'pounds', 'can', 'saltspoon', 'wineglass', 'gill'] as const;

        for (const unit of units) {
            const result = compareParses({
                crf: crfParse({ statedMeasure: 'one', quantity: exactly(1), unit: null }),
                llm: llmParse({ statedMeasure: `one ${unit}`, quantity: exactly(1), unit }),
            });

            expect(result.merged).not.toBeNull();
            expect(result.agreement).toEqual({ kind: 'agree' });
            expect(result.merged?.unit).toBe(unit);
            expect(result.merged?.statedMeasure).toBe(`one ${unit}`);
            expect(result.merged?.provenance.unit).toBe('llm');
            expect(result.merged?.provenance.statedMeasure).toBe('llm');
        }
    });

    it("bucket 2 of 4 — the number is still the CRF's, and the disagreement about it is REPORTED", () => {
        // `one and a half quarts of boiling water` — oracle seed L00177, 9 corpus lines. The CRF returns
        // `('1', '')`, so on this shape its NUMBER is wrong too. ⛔ U36 does not reach it: KTD-11's
        // amount column is explicitly untouched, the quantity stays the CRF's, and the disagreement is
        // reported as `differ: ['quantity']` rather than silenced. The stored line therefore reads one
        // quart against a source stating one and a half — a KNOWN residual, recorded in ADR-0026 §8 and
        // NOT closed here, but visible in the agreement instead of vanishing with the unit.
        const result = compareParses({
            crf: crfParse({ statedMeasure: 'one', quantity: exactly(1), unit: null }),
            llm: llmParse({ statedMeasure: 'one and a half quarts', quantity: exactly(1.5), unit: 'quarts' }),
        });

        expect(result.merged).not.toBeNull();
        expect(result.agreement).toEqual({ kind: 'differ', fields: ['quantity'] });
        expect(result.merged?.quantity).toEqual(exactly(1));
        expect(result.merged?.unit).toBe('quarts');
        expect(result.merged?.statedMeasure).toBe('one and a half quarts');
        expect(result.merged?.provenance).toEqual({
            statedMeasure: 'llm',
            quantity: 'crf',
            unit: 'llm',
            foods: 'llm',
        });
    });

    it('bucket 3 of 4 — a SIZE word is a unit, and rescuing it is what keeps the word at all', () => {
        // ⛔ THE RULE THAT WAS PROPOSED AND DISPROVED. Rejecting `small`/`large` as "fabricated units"
        // does not merely leave the measure imprecise — it DELETES the word. `DEFAULT_WINNERS` takes the
        // foods from the LLM, and the LLM read `onion` with `small` in the unit, so refusing the unit
        // stores neither. And the word is not fabricated: `unitToGrams` resolves a unit against the
        // catalog's own portion LABELS, which USDA publishes verbatim as `small`/`medium`/`large` (see
        // `units.test.ts`, "a size word used as a unit is resolvable, and FAILS SAFE when it is not").
        const cases: readonly (readonly [string, string, string])[] = [
            ['one', 'small', 'onion'],
            ['four', 'large', 'onions'],
            ['one', 'large', 'cauliflower'],
        ];

        for (const [amount, size, food] of cases) {
            const result = compareParses({
                crf: crfParse({
                    statedMeasure: amount,
                    quantity: exactly(amount === 'four' ? 4 : 1),
                    unit: null,
                    // U16: the CRF's own `size` FIELD was canonicalised into its name by the adapter.
                    foods: [{ name: `${size} ${food}`, prep: null }],
                }),
                llm: llmParse({
                    statedMeasure: `${amount} ${size}`,
                    quantity: exactly(amount === 'four' ? 4 : 1),
                    unit: size,
                    foods: [{ name: food, prep: null }],
                }),
            });

            expect(result.merged).not.toBeNull();
            expect(result.merged?.unit).toBe(size);
            expect(result.merged?.statedMeasure).toBe(`${amount} ${size}`);
            expect(result.merged?.provenance.unit).toBe('llm');
            expect(result.merged?.foods).toEqual([{ name: food, prep: null }]);
            // ⚠️ The FOODS still differ and that is reported, not silenced: U16 put the word in the
            // CRF's NAME and the LLM read it as the UNIT, so the two genuinely filed it in different
            // places. Only the measure is rescued — silencing `foods` here would hide a real difference
            // in what the two engines think the ingredient IS.
            expect(result.agreement).toEqual({ kind: 'differ', fields: ['foods'] });
        }
    });

    it('bucket 4 of 4 — an ALTERNATION takes one sensible reading, which is a known limitation', () => {
        // `one large onion or two small ones` states TWO candidate measures, and `ParsedFacts` has ONE
        // measure field. ⛔ That is a MODELLING GAP, not a parse error, and U36 deliberately does not
        // close it: alternation support would be a contract change. Per the ruling an ambiguous-but-
        // sensible single reading is acceptable, so the rescue takes the LLM's first measure and the
        // second is lost with nothing in the shape recording that it existed. Recorded in ADR-0026 §8.
        const result = compareParses({
            crf: crfParse({
                statedMeasure: 'one',
                quantity: exactly(1),
                unit: null,
                foods: [{ name: 'large onion', prep: null }],
            }),
            llm: llmParse({
                statedMeasure: 'one large',
                quantity: exactly(1),
                unit: 'large',
                foods: [{ name: 'onion', prep: null }],
            }),
        });

        expect(result.merged).not.toBeNull();
        expect(result.merged?.unit).toBe('large');
        expect(result.merged?.statedMeasure).toBe('one large');
        // ⛔ PINS THE LOSS. The second measure appears nowhere, and no review reason marks its absence.
        expect(result.merged?.statedMeasure).not.toContain('two');
        expect(result.merged?.reviewReasons).toEqual([]);
    });

    it('does not rescue a unit that normalises to nothing, which is silence spelled differently', () => {
        // ⛔ `unitView` has TWO spellings of "this engine stated no unit": `null` for an empty field, and
        // `''` for a field holding only what `normalizeUnit` strips — a bare `.` trims to nothing, which
        // is why `classifyUnit` guards the same case and calls it `unknown`. A rescue tested with
        // `unitView(llm.unit) !== null` would read the second as an ANSWER and store a unit of `.`,
        // publishing punctuation as a measure on a line that stated none.
        const result = compareParses({
            crf: crfParse({ statedMeasure: 'one', quantity: exactly(1), unit: null }),
            llm: llmParse({ statedMeasure: 'one', quantity: exactly(1), unit: '.' }),
        });

        expect(result.merged).not.toBeNull();
        expect(result.merged?.unit).toBeNull();
        expect(result.merged?.provenance.unit).toBe('crf');
        expect(result.merged?.provenance.statedMeasure).toBe('crf');
    });
});

describe('compareParses — KTD-11b placement, canonicalised before comparing', () => {
    it('canonicalises a participle into preparation before comparing', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'onions', prep: 'chopped' }] }),
            llm: llmParse({ foods: [{ name: 'chopped onions', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(result)).toEqual({ name: 'onions', prep: 'chopped' });
    });

    it('canonicalises an adjective into identity before comparing', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'onion', prep: 'sweet' }] }),
            llm: llmParse({ foods: [{ name: 'sweet onion', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(result)).toEqual({ name: 'sweet onion', prep: null });
    });

    it('canonicalises a temperature into preparation', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'milk', prep: 'hot' }] }),
            llm: llmParse({ foods: [{ name: 'hot milk', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(result)).toEqual({ name: 'milk', prep: 'hot' });
    });

    it('canonicalises the CRF size word into the name', () => {
        // `crfSizeField`, 24 lines. The contract has NO size member, so the CRF adapter has nowhere but
        // `prep` to put it — and `large` is an adjective, so KTD-11b sends it to the name.
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'onion', prep: 'large' }] }),
            llm: llmParse({ foods: [{ name: 'large onion', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(result)).toEqual({ name: 'large onion', prep: null });
    });

    it('treats a colour as identity, not preparation', () => {
        const red = compareParses({
            crf: crfParse({ foods: [{ name: 'peppers', prep: 'red' }] }),
            llm: llmParse({ foods: [{ name: 'red peppers', prep: null }] }),
        });
        expect(red.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(red)).toEqual({ name: 'red peppers', prep: null });

        const green = compareParses({
            crf: crfParse({ foods: [{ name: 'peas', prep: 'green' }] }),
            llm: llmParse({ foods: [{ name: 'green peas', prep: null }] }),
        });
        expect(green.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(green)).toEqual({ name: 'green peas', prep: null });
    });

    it('treats an irregular participle as preparation', () => {
        const cases: readonly (readonly [string, string])[] = [
            ['ground', 'almonds'],
            ['beaten', 'eggs'],
            ['cut', 'dates'],
        ];

        for (const [modifier, food] of cases) {
            const result = compareParses({
                crf: crfParse({ foods: [{ name: food, prep: modifier }] }),
                llm: llmParse({ foods: [{ name: `${modifier} ${food}`, prep: null }] }),
            });

            expect(result.agreement, modifier).toEqual({ kind: 'agree' });
            expect(onlyFood(result), modifier).toEqual({ name: food, prep: modifier });
        }
    });

    it('moves an adverb with the participle it qualifies', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'onions', prep: 'finely chopped' }] }),
            llm: llmParse({ foods: [{ name: 'finely chopped onions', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(result)).toEqual({ name: 'onions', prep: 'finely chopped' });
    });

    it('never empties a food name, because identity is what the catalog resolves', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'chopped', prep: null }] }),
            llm: { unavailable: true },
        });

        expect(onlyFood(result)).toEqual({ name: 'chopped', prep: null });
    });
});

describe('compareParses — the normalisations that are for COMPARISON only', () => {
    it('ignores relative-clause scaffolding when comparing', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'peas', prep: 'boiled soft' }] }),
            llm: llmParse({ foods: [{ name: 'peas', prep: 'that have been boiled soft' }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
    });

    it('ignores an article in the identity too, not only in the preparation', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'the fresh peas', prep: null }] }),
            llm: llmParse({ foods: [{ name: 'fresh peas', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(result)).toEqual({ name: 'fresh peas', prep: null });
    });

    it('does NOT drop `and`, which is the only signal that a name holds two foods', () => {
        // ⛔ The stopword list stops short of conjunctions on purpose: `salt and pepper` comparing equal to
        // `salt pepper` would erase the very difference `modelSplitsFoods` exists to surface.
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'salt and pepper', prep: null }] }),
            llm: llmParse({ foods: [{ name: 'salt pepper', prep: null }] }),
        });

        expect(result.agreement).toEqual({ kind: 'differ', fields: ['foods'] });
    });

    it('stores the winner own words, not the comparison view', () => {
        // ⚠️ THE LINE THIS UNIT MUST NOT CROSS. The stopwords above are dropped to decide whether the two
        // engines said the same thing; dropping them from what is STORED would quietly rewrite the corpus.
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'peas', prep: 'boiled soft' }] }),
            llm: llmParse({ foods: [{ name: 'peas', prep: 'that have been boiled soft' }] }),
        });

        expect(onlyFood(result)).toEqual({ name: 'peas', prep: 'that have been boiled soft' });
    });

    it('ignores a modifier one engine emitted twice', () => {
        // The LLM's duplication defect (19 lines): `chopped` in BOTH fields is one answer being wrong,
        // not two answers disagreeing — and placement puts it in exactly one field, never twice.
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'celery', prep: 'chopped' }] }),
            llm: llmParse({ foods: [{ name: 'chopped celery', prep: 'chopped' }] }),
        });

        expect(result.agreement).toEqual({ kind: 'agree' });
        expect(onlyFood(result)).toEqual({ name: 'celery', prep: 'chopped' });
    });
});

describe('compareParses — KTD-12, an unavailable engine is not a disagreement', () => {
    it('reports a single engine, never a disagreement', () => {
        const result = compareParses({
            crf: crfParse({ foods: [{ name: 'butter', prep: null }] }),
            llm: { unavailable: true },
        });

        expect(result.agreement).toEqual({ kind: 'single-engine', engine: 'crf' });
        expect(result.merged?.provenance).toEqual(throughout('crf'));
        expect(result.merged?.foods).toEqual([{ name: 'butter', prep: null }]);
    });

    it('names the LLM when the CRF is the engine that could not answer', () => {
        const result = compareParses({
            crf: { unavailable: true },
            llm: llmParse({ statedMeasure: 'one gill', unit: 'gill', quantity: exactly(1) }),
        });

        expect(result.agreement).toEqual({ kind: 'single-engine', engine: 'llm' });
        expect(result.merged?.unit).toBe('gill');
        expect(result.merged?.provenance).toEqual(throughout('llm'));
    });

    it('invents no review reason for the engine that was silent', () => {
        const result = compareParses({
            crf: crfParse({ reviewReasons: ['no_quantity'] }),
            llm: { unavailable: true },
        });

        expect(result.agreement).toEqual({ kind: 'single-engine', engine: 'crf' });
        expect(result.merged?.reviewReasons).toEqual(['no_quantity']);
    });

    it('is single-engine even when the answering parse is the kind that WOULD have differed', () => {
        // ⛔ KTD-12, stated as the property rather than as one example: no shape of the surviving parse can
        // turn silence into a mismatch. `contractSkew.ts`: "ABSENCE IS SILENCE, never a mismatch".
        const shapes: readonly Partial<ParsedLine>[] = [
            { quantity: ABSENT_QUANTITY, statedMeasure: null, unit: null },
            { foods: [] },
            { foods: [{ name: 'chopped onions', prep: 'chopped' }] },
            { reviewReasons: ['no_quantity', 'measurement_in_name'] },
        ];

        for (const shape of shapes) {
            expect(compareParses({ crf: crfParse(shape), llm: { unavailable: true } }).agreement).toEqual({
                kind: 'single-engine',
                engine: 'crf',
            });
            expect(compareParses({ crf: { unavailable: true }, llm: llmParse(shape) }).agreement).toEqual({
                kind: 'single-engine',
                engine: 'llm',
            });
        }
    });

    it('resolves nothing when neither engine answered', () => {
        const result = compareParses({ crf: { unavailable: true }, llm: { unavailable: true } });

        expect(result.agreement).toEqual({ kind: 'neither' });
        expect(result.merged).toBeNull();
    });
});

describe('compareParses — purity', () => {
    it('is deterministic under argument order', () => {
        const crf = crfParse({ quantity: exactly(2), foods: [{ name: 'chopped onions', prep: null }] });
        const llm = llmParse({ quantity: exactly(3), foods: [{ name: 'onions', prep: 'chopped' }] });

        // ⛔ The input is a NAMED pair, so "which engine" is never "which position". Building it in the
        // other key order must be the same call.
        expect(compareParses({ llm, crf })).toEqual(compareParses({ crf, llm }));
    });

    it('returns the same answer twice and mutates neither input', () => {
        const crf = crfParse({ foods: [{ name: 'chopped onions', prep: null }] });
        const llm = llmParse({ foods: [{ name: 'onions', prep: 'chopped' }] });
        const crfBefore = structuredClone(crf);
        const llmBefore = structuredClone(llm);

        const first = compareParses({ crf, llm });
        const second = compareParses({ crf, llm });

        expect(second).toEqual(first);
        expect(crf).toEqual(crfBefore);
        expect(llm).toEqual(llmBefore);
    });
});
