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
 */
import type { CrfParse } from './crfParse.js';
import { normalizeMeasure, normalizeName, normalizePrep, unitComparableWords } from './parseNormalization.js';
import { classifyParseResponse } from './parseResponse.js';
import type { ModelParse } from './parseResponse.js';

/** How the two readings of the MEASURE relate. */
export type MeasureVerdict =
    | 'agree'
    | 'crfUnitInName'
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
