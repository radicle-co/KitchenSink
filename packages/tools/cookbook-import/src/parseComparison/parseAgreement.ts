/**
 * THE AGREEMENT CLASSIFIER — how two readings of one line differ, named rather than merely counted.
 *
 * DESIGN PATTERN: **first-match rule chain over a folded value object**, yielding a discriminated verdict
 * per field. Every comparison folds through `parseNormalization`, so this module owns WHAT COUNTS AS A
 * DIFFERENCE and nothing owns it twice.
 *
 * ## ⛔ NEITHER SIDE IS CORRECT HERE, AND NO FUNCTION IN THIS FILE DECIDES OTHERWISE
 *
 * There is no ground truth for this corpus and none is invented. A verdict names the SHAPE of a
 * disagreement so that the set can be sized and handed to a human; it never says which reading is right.
 * `crfUnitInName` is not "the CRF is wrong" — it is "the CRF put what the model called a unit inside the
 * food name", which is a fact about the two outputs and an argument for neither.
 *
 * ## ⚠️ WHY THE SHAPED VERDICTS EXIST AT ALL
 *
 * A flat agree/differ census would report a single large number and leave a human to read hundreds of
 * pairs to find out what it meant. Three shapes were known before the run and each moves a downstream
 * decision, so each gets its own name:
 *
 *  - `crfUnitInName` — the CRF has no vocabulary for a historical unit (`gill`, `saltspoon`), so it reads
 *    the unit as the first word of the food. Every one of these is a nutrition lookup against a food that
 *    does not exist.
 *  - `crfSizeField` — the CRF routes `large`/`small` to a `size` field our answer shape has no slot for.
 *    This is a shape mismatch between two designs, not an error by either.
 *  - `crfPrepInModelName` / `modelPrepInCrfName` — a state word (`cooked`, `toasted`, `grated`) sits in
 *    the food name on one side and in the preparation on the other. It changes which nutrition-table row
 *    the line resolves to, so it is the shape with the largest downstream consequence.
 *
 * A shape NOT anticipated arrives as a plain `unitDiffers` / `differ`, and that residue is exactly the
 * candidate list for human adjudication. It is meant to be read, not explained away.
 *
 * ## ⚠️ A FOURTH SHAPE, FOUND AFTERWARDS — and this is what that residue is FOR
 *
 * `crfUnitAbsent` was not anticipated. It arrived exactly as the paragraph above says an unanticipated
 * shape arrives — inside the `unitDiffers` residue — and U23's oracle read it out of there: the CRF returns
 * a bare `1` and NO unit for `one and a half quarts of boiling water`, which `crfWins` would publish as one
 * quart, unit-less, against a source stating one and a half. It is named here (owner ruling 2026-08-25)
 * because a leg that stated no unit did not offer a competing reading; see {@link DISPOSITIONS} for the
 * argument and for why it does not overturn KTD-11's amount column.
 */
import type { CrfParse } from './crfParse.js';
import { normalizeMeasure, normalizeName, normalizePrep, unitComparableWords } from './parseNormalization.js';
import { classifyParseResponse } from './parseResponse.js';
import type { ModelParse } from './parseResponse.js';

/** How the two readings of the MEASURE relate. */
export type MeasureVerdict =
    | 'agree'
    | 'crfUnitInName'
    | 'crfUnitAbsent'
    | 'crfSizeField'
    | 'amountCountDiffers'
    | 'unitDiffers'
    | 'quantityDiffers';

/** How the two readings of the FOOD NAMES relate. */
export type NameVerdict = 'agree' | 'modelSplitsFoods' | 'differ';

/** How the two readings of the PREPARATION relate. */
export type PrepVerdict = 'agree' | 'crfPrepInModelName' | 'modelPrepInCrfName' | 'differ';

/**
 * The one verdict a census row is keyed on: the FIRST field that disagreed, in the order measure → names →
 * preparation.
 *
 * ⚠️ First-field-wins, not a set. A line whose measure disagrees usually has a knock-on name disagreement
 * (the `gill of milk` case is both), and tallying both would double-count one defect and inflate the
 * candidate list. The per-field verdicts are reported alongside for anyone who wants the other view.
 */
export type AgreementKind = MeasureVerdict | NameVerdict | PrepVerdict;

/** What one model reading and one CRF reading of the same line say about each other. */
export interface ParseAgreement {
    readonly measure: MeasureVerdict;
    readonly names: NameVerdict;
    readonly prep: PrepVerdict;
    /** The first disagreeing field's verdict, or `'agree'` when all three agree. */
    readonly kind: AgreementKind;
    readonly agrees: boolean;
}

/** A field of the answer shape, for reporting which one moved between two passes. */
export type ParseField = 'measure' | 'foods' | 'prep';

/**
 * What is DONE about a shape — KTD-11's disposition column, which this module classified toward and did
 * not carry.
 *
 * ⛔ THIS IS THE ONE PLACE IN THIS FILE THAT TAKES A SIDE, AND IT TAKES IT PER SHAPE, NEVER PER LINE.
 * Everything above deliberately refuses to say which reading is right, because there is no ground truth
 * for an individual line here. A DISPOSITION is a different claim: it says what the corpus-wide evidence
 * licenses for a whole class, and KTD-11 measured that evidence before writing it down. Keeping the two
 * apart is why `crfUnitInName` can be "the LLM wins" here while `judgeMeasure` still calls it a fact about
 * two outputs and an argument for neither.
 */
export type AgreementDisposition =
    /** The two readings said the same thing. There is nothing to dispose of. */
    | 'agreed'
    /**
     * The CRF's reading stands, and the LLM's is RECORDED beside it rather than discarded.
     *
     * ⚠️ "Record both" is KTD-11's wording and it is load-bearing: the losing reading is the only evidence
     * a later calibration has that the rule was ever wrong. U23's oracle found one class where it WAS —
     * the report's §10 on `one and a half`, where the CRF drops the fraction and this disposition would
     * have published two thirds of the stated amount. That class is now `crfUnitAbsent` and no longer
     * reaches here (owner ruling 2026-08-25).
     *
     * ⚠️ ONE MEASURED SPELLING OF IT STILL DOES, and it is recorded rather than tidied away: the CRF reads
     * `one and a half cups of sugar` as TWO amounts, `('1', '')` and `('half', 'cup')`, which the sidecar
     * joins to `1 half cups` and the fold reads as half a cup. Its unit is `cup`, not empty — the CRF
     * ANSWERED, and answered a different number — so it is a genuine `quantityDiffers` and KTD-11 governs
     * it. Widening the new shape to cover it would overturn the amount column outright.
     */
    | 'crfWins'
    /**
     * The LLM's reading stands, silently — no human sees the line.
     *
     * Reserved for the shapes where the CRF is DEMONSTRABLY wrong rather than merely different: it has no
     * vocabulary for a historical unit, and it cannot express more than one food.
     */
    | 'llmWins'
    /**
     * Neither engine wins: KTD-11b decides where the word goes, on BOTH answers, and the disagreement
     * stops existing rather than being won.
     *
     * ⛔ Strictly better than picking a side, and KTD-11 says why: "a winner rule would keep re-deciding,
     * per line, a question that has one answer."
     */
    | 'canonicalised'
    /** The residue KTD-11 calls "the genuine adjudication list". A human reads it. */
    | 'adjudicate';

/**
 * KTD-11's disposition per shape.
 *
 * ⛔ A TOTAL `Record` over {@link AgreementKind}, never a lookup with a fallback. A new verdict added to
 * any of the three per-field unions is a COMPILE error here, which is the property that made this table
 * worth writing at all — the alternative, a `switch` with a `default`, would silently dispose of a shape
 * nobody had decided about, and "silently disposed of" is indistinguishable from "decided" in every
 * downstream number.
 *
 * ⚠️ `crfPrepInModelName` is in KTD-11's TYPE but not in its measured TABLE — it scored n = 0 on Nova
 * Micro, so a table transcribed from the report would have had no row for it. It is the exact mirror of
 * `modelPrepInCrfName`, and KTD-11b settles both the same way, so it is `canonicalised` rather than the
 * `llmWins` its mirror carries. Reading the mirror's disposition off the report and stopping there would
 * have handed the LLM a placement win in one direction only — on the axis where the CRF's filing matched
 * the ruling 125 times to the LLM's 58.
 *
 * ⚠️ `crfUnitAbsent` is likewise not in KTD-11's table — it did not exist when that table was measured. The
 * compile error this `Record` produced when the verdict was added to `MeasureVerdict` is precisely the
 * property described above, working: the shape could not be classified without someone deciding what is
 * done about it.
 */
const DISPOSITIONS: Readonly<Record<AgreementKind, AgreementDisposition>> = {
    agree: 'agreed',
    // Amounts — "CRF wins, record both" (KTD-11).
    quantityDiffers: 'crfWins',
    unitDiffers: 'crfWins',
    amountCountDiffers: 'crfWins',
    // The CRF is demonstrably wrong, so the LLM wins silently (KTD-11).
    crfUnitInName: 'llmWins',
    // ⛔ ABSENCE IS NOT DISSENT — owner ruling 2026-08-25, and it does NOT overturn KTD-11.
    //
    // The amount block above — `quantityDiffers`, `unitDiffers`, `amountCountDiffers` — stands exactly as
    // it was: when both engines name a unit and name different ones, the CRF still wins. What this row says
    // is narrower and PRIOR to that: a leg that stated NO unit has not offered a competing reading, so there
    // is no disagreement for a winner rule to resolve in the first place.
    //
    // It mirrors ADR-0026 §3 one field DOWN. That section rules `single-engine` is not `differ` because an
    // engine that did not answer is absence rather than dissent, and collapsing the two corrupts every
    // measured rate. An empty unit is the same shape at FIELD granularity: `crfWins` on it does not pick
    // the better of two readings, it publishes silence.
    //
    // KTD-11 already carries the precedent, one line above: `crfUnitInName` is "the CRF is demonstrably
    // wrong, so the LLM wins silently". This is that category, discovered later — by U23's oracle, on
    // `one and a half quarts of boiling water` (seed L00177, 9 corpus lines), where the CRF returns `1`
    // with no unit at all against a source that plainly states one and a half quarts.
    crfUnitAbsent: 'llmWins',
    modelSplitsFoods: 'llmWins',
    modelPrepInCrfName: 'llmWins',
    // Placement, decided by KTD-11b on both answers rather than won by either.
    crfSizeField: 'canonicalised',
    crfPrepInModelName: 'canonicalised',
    // The residue.
    differ: 'adjudicate',
};

/**
 * What KTD-11 says is done about a shape.
 *
 * @param kind - The first-disagreeing-field verdict from {@link compareParses}.
 * @returns The disposition. Pure and TOTAL — every inhabitant of the union has a row.
 */
export function disposeAgreement(kind: AgreementKind): AgreementDisposition {
    return DISPOSITIONS[kind];
}

/**
 * Compare a model's reading of a line with the CRF parser's.
 *
 * @param model - The model's parse.
 * @param crf - The CRF parser's parse of the same line.
 * @returns A verdict per field plus the first-disagreeing-field summary. Pure.
 */
export function compareParses(model: ModelParse, crf: CrfParse): ParseAgreement {
    const modelMeasure = normalizeMeasure(model.measure);
    const crfMeasure = normalizeMeasure(crf.measure);
    // ⚠️ Empty names are filtered on BOTH sides, like preps: a model emitting `{"name":""}` contributes a
    // token nothing can ever match, which would force `differ` for a food it did not actually name.
    const modelNames = new Set(model.foods.map((food) => normalizeName(food.name)).filter(nonEmpty));
    const crfNames = new Set(crf.names.map(normalizeName).filter(nonEmpty));
    const modelPreps = new Set(model.foods.map((food) => normalizePrep(food.prep)).filter(nonEmpty));
    const crfPrep = normalizePrep(crf.preparation);

    const measure = judgeMeasure(modelMeasure, crfMeasure, [...crfNames], normalizePrep(crf.size));
    const names = judgeNames(modelNames, crfNames);
    const prep = judgePrep(modelPreps, crfPrep, modelNames, crfNames);
    const agrees = measure === 'agree' && names === 'agree' && prep === 'agree';

    return {
        measure,
        names,
        prep,
        kind: measure !== 'agree' ? measure : names !== 'agree' ? names : prep,
        agrees,
    };
}

function judgeMeasure(
    model: ReturnType<typeof normalizeMeasure>,
    crf: ReturnType<typeof normalizeMeasure>,
    crfNames: readonly string[],
    crfSize: string,
): MeasureVerdict {
    if (model.unit === crf.unit) {
        if (model.residue !== crf.residue) {
            return 'amountCountDiffers';
        }

        return model.quantity === crf.quantity ? 'agree' : 'quantityDiffers';
    }

    // The CRF read no unit. Three shapes explain that without either side being wrong, and each is checked
    // before the generic verdict because each names a different downstream consequence.
    //
    // ⛔ THIS WHOLE BRANCH RETURNS. Nothing inside it can fall through to `unitDiffers`, which is the
    // ordering the 2026-08-25 ruling turns on: a unit the CRF never stated must not ALSO be counted as a
    // disagreement about which unit it is.
    //
    // ⚠️ `crf.unit === ''` is the whole of the narrowness, and it is narrow only because of the equality
    // return ABOVE. Mutual silence never reaches here — `model.unit === crf.unit === ''` was already sent
    // to the quantity comparison — which also makes `model.unit !== ''` redundant rather than load-bearing.
    // It is kept because it states the claim (the CRF's silence AGAINST an answer) at the point the claim
    // is made, and a reader must not have to re-derive it from a guard twelve lines up. The mirror case, a
    // silent MODEL, is left on `unitDiffers`, where `crfWins` already gives the unit to the engine that
    // spoke.
    if (crf.unit === '' && model.unit !== '') {
        if (crfSize !== '' && unitComparableWords(crfSize).has(model.unit)) {
            return 'crfSizeField';
        }

        // ⛔ Compared through `unitComparableWords`, NOT `sharesEveryWord` over the raw name fold: the unit
        // side is alias-canonicalised and the name side is not, so a raw comparison answered NO for exactly
        // the historical spellings this detector exists to catch. See `parseNormalization.ts`.
        if (crfNames.some((name) => unitComparableWords(name).has(model.unit))) {
            return 'crfUnitInName';
        }

        // ⚠️ LAST within the branch, deliberately. `crfSizeField` and `crfUnitInName` are both true of a
        // line whose unit went somewhere findable, and they say WHERE — which is strictly more information.
        // Both already dispose the same way this one does, so the order changes what the census NAMES and
        // never what is done about it. Measured: `two and a half pounds of beef` keeps `crfUnitInName`
        // because `pounds` survives inside the CRF's food name, while `one and a half quarts of boiling
        // water` lands here, the unit having vanished entirely.
        return 'crfUnitAbsent';
    }

    return 'unitDiffers';
}

function judgeNames(modelNames: ReadonlySet<string>, crfNames: ReadonlySet<string>): NameVerdict {
    if (sameSet(modelNames, crfNames)) {
        return 'agree';
    }

    // The model named several foods where the CRF named one, and every word it used came from that one
    // name: the two read the same text and disagreed only about how many foods it holds.
    if (modelNames.size > crfNames.size && [...modelNames].every((name) => coveredByAny(name, crfNames))) {
        return 'modelSplitsFoods';
    }

    return 'differ';
}

function judgePrep(
    modelPreps: ReadonlySet<string>,
    crfPrep: string,
    modelNames: ReadonlySet<string>,
    crfNames: ReadonlySet<string>,
): PrepVerdict {
    if (sameSet(modelPreps, crfPrep === '' ? new Set() : new Set([crfPrep]))) {
        return 'agree';
    }

    if (modelPreps.size === 0 && crfPrep !== '' && [...modelNames].some((name) => sharesEveryWord(crfPrep, name))) {
        return 'crfPrepInModelName';
    }

    // ⚠️ `modelPreps` is necessarily non-empty here: empty-vs-empty already returned `agree` above, so the
    // vacuous-truth case this `every` could otherwise admit is unreachable.
    if (crfPrep === '' && [...modelPreps].every((prep) => [...crfNames].some((name) => sharesEveryWord(prep, name)))) {
        return 'modelPrepInCrfName';
    }

    return 'differ';
}

/**
 * Which fields two readings of the SAME line by the SAME model disagree about.
 *
 * ⚠️ Folded before comparing, so a re-run that only re-spelled its answer is not a divergence. The raw
 * byte comparison is the caller's, and the report prints both: the gap between them is a real fact about
 * the model, and folding first would erase it.
 *
 * @param first - The first pass's parse.
 * @param second - The second pass's parse.
 * @returns The fields that moved, in answer-shape order. Empty when the two readings say the same thing. Pure.
 */
export function divergentFields(first: ModelParse, second: ModelParse): readonly ParseField[] {
    const moved: ParseField[] = [];
    const firstMeasure = normalizeMeasure(first.measure);
    const secondMeasure = normalizeMeasure(second.measure);

    if (firstMeasure.quantity !== secondMeasure.quantity || firstMeasure.unit !== secondMeasure.unit) {
        moved.push('measure');
    }

    if (
        !sameSet(
            new Set(first.foods.map((food) => normalizeName(food.name))),
            new Set(second.foods.map((food) => normalizeName(food.name))),
        )
    ) {
        moved.push('foods');
    }

    if (
        !sameSet(
            new Set(first.foods.map((food) => normalizePrep(food.prep)).filter(nonEmpty)),
            new Set(second.foods.map((food) => normalizePrep(food.prep)).filter(nonEmpty)),
        )
    ) {
        moved.push('prep');
    }

    return moved;
}

/**
 * Whether two responses could be compared at all, and what moved if so.
 *
 * ⚠️ `incomparable` is its own member and must not be folded into either answer. A pair where one pass was
 * unreadable is a pair on which stability was NOT measured — reporting it as divergence would score the
 * contract failure twice, and reporting it as agreement would credit the model for a consistency it never
 * demonstrated.
 */
export type ResponseDivergence =
    | { readonly kind: 'comparable'; readonly fields: readonly ParseField[] }
    | { readonly kind: 'incomparable' };

/**
 * Compare two raw responses to the same line by the same model.
 *
 * ⛔ A WRAPPED answer is still compared. Stability and contract compliance are different questions, and a
 * model that fences every answer would otherwise be unmeasurable for stability — reported as either
 * perfectly stable or perfectly unstable depending on whether its wrapper happened to be byte-identical,
 * neither of which is a fact about the model's reading.
 *
 * ⚠️ The content is read regardless of WHY the response stopped. A cut-off answer is almost always
 * unreadable and lands on `incomparable` for that reason; a complete document that happened to hit the
 * output cap is compared, because the model did state a whole parse.
 *
 * @param firstText - The first pass's response, verbatim.
 * @param secondText - The second pass's response, verbatim.
 * @returns Whether the pair was comparable and, if so, which fields moved. Pure.
 */
export function divergentResponses(firstText: string, secondText: string): ResponseDivergence {
    const first = readableParse(firstText);
    const second = readableParse(secondText);

    if (first === undefined || second === undefined) {
        return { kind: 'incomparable' };
    }

    return { kind: 'comparable', fields: divergentFields(first, second) };
}

/** The parse a response states, whether bare or wrapped. `undefined` when it states none. */
function readableParse(text: string): ModelParse | undefined {
    const reading = classifyParseResponse(text, 'end_turn');

    if (reading.kind === 'valid') {
        return reading.parse;
    }

    if (reading.kind === 'proseWrapper') {
        return reading.parse;
    }

    return undefined;
}

function nonEmpty(text: string): boolean {
    return text.length > 0;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    return left.size === right.size && [...left].every((value) => right.has(value));
}

/** Every word of `needle` appears in `haystack`. Both are already folded, so a word match is a word match. */
function sharesEveryWord(needle: string, haystack: string): boolean {
    if (needle === '') {
        return false;
    }

    const words = new Set(haystack.split(' '));

    return needle.split(' ').every((word) => words.has(word));
}

function coveredByAny(needle: string, haystacks: ReadonlySet<string>): boolean {
    return [...haystacks].some((haystack) => sharesEveryWord(needle, haystack));
}
